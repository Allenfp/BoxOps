import { readFileSync, readdirSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname } from "node:path";
import { gzipSync } from "node:zlib";
import { type Browser, type Page, expect, test } from "@playwright/test";
import { assembleBundle, hashFolder } from "../cli/site";
import { type AppInfo, type BundleSource, readBundle } from "../src/model/bundle";
import { generateRoadmap } from "../scripts/gen-roadmap";
import { PX_PER_DAY } from "../src/timeline/scale";

// A big roadmap (`npm run perf`, not part of the browser tests): the
// production build with a generated 2,000-box roadmap (and a 500-box one) as
// its roadmap.json, served gzipped as Pages does, opened in WebKit as a
// viewer would, without a token. Checked exactly: the app's main JavaScript
// file stays under MAIN_LIMIT; no file with the yaml library is fetched
// before the timeline shows (the build parsed the files); the timeline draws
// at most MAX_DRAWN boxes when it shows, however big the roadmap (only
// what's near the screen); and a step of a keyboard move or a drag, or a
// keystroke in the box editor, draws again only the departments it's in
// (counted by the timeline for tests, window.__boxopsTest.renders). Timed:
// navigation to the timeline painted, printed for each run; a test fails
// only above CEILING_MS, generous so a slow CI machine doesn't fail it. The
// same roadmap without the build's parsing is timed too, for comparison, and
// so is a keyboard move's step, printed only.
//
// The table and People at 2,000 boxes and 400 engineers with 3 PTO entries
// each, on a roadmap generated around a fixed day (the page's clock fixed
// there too, page.clock.setFixedTime): opening each (from the other view,
// to the new view laid out) and an edit committed with Enter (from the key
// to the page laid out with it), the median of 5 after 2 to warm up, each
// failing above twice its target (TABLE_MS, EDIT_MS); and exactly, at most
// MAX_ROWS rows with data drawn and MAX_OPTIONS <option>s on the page, and
// no textarea measured (its scrollHeight read: that lays the page out).

const MAIN_LIMIT = 400_000;
/** Opening the table or People at 2,000 boxes, target (ms); failing above twice this. */
const TABLE_MS = 300;
/** An edit committed there, target (ms); failing above twice this. */
const EDIT_MS = 50;
/** Rows with data (boxes, PTO, engineers) drawn at once, and <option>s on the page, at most. */
const MAX_ROWS = 70;
const MAX_OPTIONS = 1500;
/** The day the table's roadmap is generated around, and the page's clock fixed at. */
const FIXED_DAY = "2026-10-05";
const CEILING_MS = 2500;
const RUNS = 3;
/** Boxes drawn when the timeline shows, at 1440 × 900: about 70 near the screen, at 500 boxes or 2,000. */
const MAX_DRAWN = 200;

const DIST = new URL("../dist/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, DIST), "utf8");
/** The app as built, so the bundle's parsed files carry the page's own build id. */
const APP: AppInfo = readBundle(JSON.parse(read("roadmap.json"))).app;
/** index.html's script: the app's main file. */
const MAIN = /<script type="module" crossorigin src="\.\/assets\/([^"]+\.js)"/.exec(read("index.html"))?.[1] ?? "";
/** The app's files that hold the yaml library (by a class name it keeps in a string). */
const YAML_FILES = readdirSync(new URL("assets/", DIST)).filter((f) => f.endsWith(".js") && read(`assets/${f}`).includes("YAMLParseError"));

/** Today as YYYY-MM-DD here: the roadmap is laid out around it, and the page's clock is left alone. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const gzipped = new Map<string, Uint8Array>();
/** What the site serves as roadmap.json, gzipped. */
let roadmap: Uint8Array = new Uint8Array();
let server: Server;
let site = "";

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://site").pathname.slice(1) || "index.html";
    let body = path === "roadmap.json" ? roadmap : gzipped.get(path);
    if (!body) {
      try {
        gzipped.set(path, (body = gzipSync(readFileSync(new URL(path, DIST)))));
      } catch {
        res.writeHead(404).end();
        return;
      }
    }
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/json", "content-encoding": "gzip" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  site = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** roadmap.json for a generated roadmap of `boxes` boxes around `day`, as a deploy of a private repository serves it. */
async function bundle(boxes: number, parsed: boolean, day = today()): Promise<Uint8Array> {
  const folder = await hashFolder(generateRoadmap(boxes, day));
  const commit = "c0ffee".padEnd(40, "0");
  const source: BundleSource = {
    repo: "acme/roadmap",
    branch: "main",
    commit,
    dir: "roadmap",
    tree: folder.tree,
    visibility: "private",
    private: true,
    readonly: false,
    author: "Sam Lee",
    subject: "Roadmap: 2 changes",
    date: "2026-10-02T16:00:00Z",
    history: [commit],
  };
  return gzipSync(JSON.stringify(assembleBundle(APP, source, folder, { parsed })));
}

interface Load {
  /** Milliseconds from navigation: the first box in the page, then the frame after it. */
  box: number;
  painted: number;
  /** The app's JavaScript files fetched by then. */
  scripts: string[];
  /** Boxes in the page once it's painted. */
  drawn: number;
}

/** Open the site, and time it until the timeline is painted. */
async function load(page: Page): Promise<Load> {
  // A private repository and no token: the app asks GitHub nothing. Should it, it gets nowhere.
  await page.route(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, (route) => route.abort());
  await page.addInitScript(() => {
    const w = window as unknown as { __load?: Partial<Load> };
    new MutationObserver((_, observer) => {
      if (!document.querySelector(".box")) return;
      observer.disconnect();
      const scripts = () => performance.getEntriesByType("resource").flatMap((e) => /\/assets\/([^/]+\.js)$/.exec(e.name)?.[1] ?? []);
      w.__load = { box: performance.now(), scripts: scripts() };
      requestAnimationFrame(() =>
        setTimeout(() => Object.assign(w.__load!, { painted: performance.now(), drawn: document.querySelectorAll(".box").length }), 0),
      );
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(site);
  await page.waitForFunction(() => (window as unknown as { __load?: Load }).__load?.painted !== undefined, null, { timeout: 30_000 });
  return page.evaluate(() => (window as unknown as { __load: Load }).__load);
}

const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];

/** A fresh browser context (nothing cached) with the project's settings. */
const fresh = (browser: Browser) => browser.newContext({ viewport: test.info().project.use.viewport });

test("the main JavaScript file is small and holds no YAML parser", () => {
  const size = Buffer.byteLength(read(`assets/${MAIN}`));
  console.log(`main JavaScript file ${MAIN}: ${(size / 1000).toFixed(1)} kB (${(gzipSync(read(`assets/${MAIN}`)).length / 1000).toFixed(1)} kB gzipped)`);
  test.info().annotations.push({ type: "main JS (bytes)", description: String(size) });
  expect(MAIN).not.toBe("");
  expect(size).toBeLessThan(MAIN_LIMIT);
  expect(YAML_FILES).toHaveLength(1);
  expect(YAML_FILES).not.toContain(MAIN);
});

for (const boxes of [2000, 500]) {
  test(`${boxes} boxes: the timeline shows without the YAML parser, well within ${CEILING_MS} ms`, async ({ browser }) => {
    roadmap = await bundle(boxes, true);
    const times: number[] = [];
    const drawn: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const context = await fresh(browser);
      const page = await context.newPage();
      const fetched: string[] = [];
      page.on("request", (r) => fetched.push(new URL(r.url()).pathname.split("/").pop()!));
      const l = await load(page);
      expect(l.scripts, "files fetched before the timeline showed").toContain(MAIN);
      expect(l.scripts.filter((f) => YAML_FILES.includes(f)), "the yaml library, before the timeline showed").toEqual([]);
      expect(fetched.filter((f) => YAML_FILES.includes(f)), "the yaml library, at all").toEqual([]);
      times.push(l.painted);
      drawn.push(l.drawn);
      await context.close();
    }
    const ms = median(times);
    console.log(`${boxes} boxes, parsed by the build: timeline painted in ${ms.toFixed(0)} ms (median of ${RUNS}: ${times.map((t) => t.toFixed(0)).join(", ")}), ${drawn[0]} boxes drawn`);
    test.info().annotations.push({ type: `time to timeline, ${boxes} boxes (ms)`, description: ms.toFixed(0) });
    test.info().annotations.push({ type: `boxes drawn, ${boxes} boxes`, description: String(drawn[0]) });
    expect(ms).toBeLessThan(CEILING_MS);
    // The same each time, and as many as the screen holds, not as the roadmap has.
    expect(new Set(drawn).size).toBe(1);
    expect(drawn[0]).toBeGreaterThan(20);
    expect(drawn[0]).toBeLessThanOrEqual(MAX_DRAWN);
  });
}

test("2000 boxes: a keyboard move's step, a drag's and a keystroke in the box editor draw again only the departments they're in", async ({ browser }) => {
  roadmap = await bundle(2000, true);
  const context = await fresh(browser);
  const page = await context.newPage();
  await page.addInitScript(() => (window.__boxopsTest = { renders: {} }));
  await load(page);
  const timeline = page.locator(".timeline");

  /** The departments drawn again while `act` runs, and in the frame after: their ids, in order. */
  const drawn = async (act: () => Promise<unknown>) => {
    await page.evaluate(() => (window.__boxopsTest!.renders = {}));
    await act();
    const counts = await page.evaluate(
      () => new Promise<Record<string, number>>((done) => requestAnimationFrame(() => setTimeout(() => done({ ...window.__boxopsTest!.renders }), 0))),
    );
    return Object.keys(counts).sort();
  };

  // The second department's heading two thirds of the way down, and a box of the first
  // department on screen above it, well clear of the edges: nothing a step does scrolls.
  await timeline.evaluate((el) => {
    const dept = el.querySelector<HTMLElement>('[data-dept-id="dept-02"]')!;
    el.scrollTop += dept.getBoundingClientRect().top - el.getBoundingClientRect().top - (el.clientHeight * 2) / 3;
  });
  const key = await timeline.evaluate((el) => {
    const view = el.getBoundingClientRect();
    const head = el.querySelector(".tl-head")!.getBoundingClientRect().bottom;
    const boxes = [...el.querySelectorAll<HTMLElement>('[data-dept-id="dept-01"] .lane-track .box')];
    return boxes.find((b) => {
      const r = b.getBoundingClientRect();
      return r.width >= 30 && r.left > view.left + 440 && r.right < view.right - 300 && r.top > head + 30;
    })?.dataset.cell;
  });
  expect(key, "a box of the first department on screen").toBeDefined();
  const box = page.locator(`[data-cell="${key}"]`);
  const deptOf = () => box.evaluate((el) => el.closest("[data-dept-id]")!.getAttribute("data-dept-id"));

  // A keyboard move: each step within the department draws it again, and no other.
  await box.focus();
  await page.keyboard.press("Space");
  // How long each step takes: from the key to the page laid out with it (React's commit, then a forced layout).
  await page.evaluate(() => {
    const w = window as unknown as { __steps: number[] };
    w.__steps = [];
    window.addEventListener("keydown", (e) => {
      const mc = new MessageChannel();
      mc.port1.onmessage = () => {
        void document.body.offsetHeight;
        w.__steps.push(performance.now() - e.timeStamp);
      };
      mc.port2.postMessage(0);
    }, true);
  });
  for (let i = 0; i < 10; i++) expect(await drawn(() => page.keyboard.press(i % 2 ? "ArrowLeft" : "ArrowRight"))).toEqual(["dept-01"]);
  // Down through its lanes into the next department: the step across draws the two.
  let across: string[] = [];
  for (let i = 0; i < 10 && (await deptOf()) === "dept-01"; i++) across = await drawn(() => page.keyboard.press("ArrowDown"));
  expect(await deptOf()).toBe("dept-02");
  expect(across).toEqual(["dept-01", "dept-02"]);
  expect(await drawn(() => page.keyboard.press("Escape"))).toEqual(["dept-01", "dept-02"]);
  const steps = await page.evaluate(() => (window as unknown as { __steps: number[] }).__steps.slice(0, 10));
  const step = median(steps);
  console.log(`2000 boxes: a keyboard move's step laid out in ${step.toFixed(1)} ms (median of ${steps.length})`);
  test.info().annotations.push({ type: "keyboard move step, 2000 boxes (ms)", description: step.toFixed(1) });

  // A drag: a move that keeps the day it would land on draws nothing; a day on, its department alone.
  const r = (await box.boundingBox())!;
  const [x, y] = [r.x + r.width / 2, r.y + r.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 6, y);
  expect(await drawn(() => page.mouse.move(x + 7, y))).toEqual([]);
  expect(await drawn(() => page.mouse.move(x + 6 + 3 * PX_PER_DAY.months, y))).toEqual(["dept-01"]);
  expect(await drawn(() => page.keyboard.press("Escape"))).toEqual(["dept-01"]);
  await page.mouse.up();

  // A keystroke in the box's editor: its department alone.
  await box.click();
  const title = page.getByRole("dialog").getByRole("textbox", { name: "Title", exact: true });
  await title.press("End");
  expect(await drawn(() => title.press("x"))).toEqual(["dept-01"]);
  await context.close();
});

test("2000 boxes the build didn't parse: parsed in the browser instead (timed for comparison)", async ({ browser }) => {
  roadmap = await bundle(2000, false);
  const times: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const context = await fresh(browser);
    const l = await load(await context.newPage());
    expect(l.scripts.filter((f) => YAML_FILES.includes(f))).toHaveLength(1);
    times.push(l.painted);
    await context.close();
  }
  const ms = median(times);
  console.log(`2000 boxes, parsed in the browser: timeline painted in ${ms.toFixed(0)} ms (median of ${RUNS}: ${times.map((t) => t.toFixed(0)).join(", ")})`);
  test.info().annotations.push({ type: "time to timeline, 2000 boxes parsed in the browser (ms)", description: ms.toFixed(0) });
  expect(ms).toBeLessThan(CEILING_MS);
});

/** Counts reads of a textarea's scrollHeight (`__textareaReads`): each makes the browser lay the page out. */
function countTextareaReads() {
  const w = window as unknown as { __textareaReads: number };
  w.__textareaReads = 0;
  const height = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!;
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    get() {
      w.__textareaReads++;
      return height.get!.call(this);
    },
    configurable: true,
  });
}

/** Switch to `view`, and time it: from the click to the new view (`shows`) on the page and laid out. */
const timeSwitch = (page: Page, view: string, shows: string) =>
  page.evaluate(
    ([view, shows]) =>
      new Promise<number>((done) => {
        const t0 = performance.now();
        new MutationObserver((_, observer) => {
          if (!document.querySelector(shows)) return;
          observer.disconnect();
          // After React's commit, and anything it set off at once.
          const mc = new MessageChannel();
          mc.port1.onmessage = () => {
            void document.body.offsetHeight;
            done(performance.now() - t0);
          };
          mc.port2.postMessage(0);
        }).observe(document.body, { childList: true, subtree: true });
        [...document.querySelectorAll<HTMLElement>('[aria-label="View"] button')].find((b) => b.textContent === view)!.click();
      }),
    [view, shows],
  );

/** Time edits committed with Enter from now on (`__edits`, emptied each time): from the key to the page laid out with the edit. */
const timeEnter = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __edits?: number[] };
    if (w.__edits) return void (w.__edits = []);
    w.__edits = [];
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Enter") return;
        const t0 = performance.now();
        const mc = new MessageChannel();
        mc.port1.onmessage = () => {
          void document.body.offsetHeight;
          w.__edits!.push(performance.now() - t0);
        };
        mc.port2.postMessage(0);
      },
      true,
    );
  });

/** What a table on the page draws: rows with data, and <option>s. */
const drawnRows = (page: Page, table: string) =>
  page.evaluate(
    (table) => ({
      rows: document.querySelectorAll(`${table} tr.box-row, ${table} tr.pto-table-row, ${table} tr.person-row`).length,
      options: document.querySelectorAll(`${table} option`).length,
    }),
    table,
  );

test("2000 boxes: the table and People open and commit an edit within budget, drawing only rows near the screen", async ({ browser }) => {
  roadmap = await bundle(2000, true, FIXED_DAY);
  const context = await fresh(browser);
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(`${FIXED_DAY}T09:00:00Z`));
  await page.addInitScript(countTextareaReads);
  await load(page);
  const reads = () => page.evaluate(() => (window as unknown as { __textareaReads: number }).__textareaReads);

  const opened = { Table: [] as number[], People: [] as number[] };
  for (let run = 0; run < 7; run++) {
    for (const [view, shows] of [["Table", ".box-table:not(.people-table)"], ["People", ".people-table"]] as const) {
      const ms = await timeSwitch(page, view, shows);
      if (run >= 2) opened[view].push(ms);
      await page.waitForTimeout(100);
    }
  }
  expect(await reads(), "textarea heights read").toBe(0);

  // The table, on screen: only the rows near it, and a lane's options only once its select is used.
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.locator(".box-table:not(.people-table)")).toBeVisible();
  const table = await drawnRows(page, ".box-table");
  expect(table.rows).toBeGreaterThan(10);
  expect(table.rows).toBeLessThanOrEqual(MAX_ROWS);
  expect(table.options).toBeLessThanOrEqual(MAX_OPTIONS);

  // A title changed and committed with Enter, five times after two.
  await timeEnter(page);
  const title = page.locator("tr.box-row").nth(4).getByLabel("Title");
  for (let i = 0; i < 7; i++) {
    await title.press("End");
    await title.press(i % 2 ? "Backspace" : "x");
    await title.press("Enter");
  }
  const tableEdits = await page.evaluate(() => (window as unknown as { __edits: number[] }).__edits.slice(2));
  expect(tableEdits).toHaveLength(5);
  await expect(page.locator(".draft-status")).toContainText("Save · 1 change");

  // People: the same for a role.
  await page.getByRole("button", { name: "People", exact: true }).click();
  await expect(page.locator(".people-table")).toBeVisible();
  const people = await drawnRows(page, ".people-table");
  expect(people.rows).toBeGreaterThan(10);
  expect(people.rows).toBeLessThanOrEqual(MAX_ROWS);
  expect(people.options).toBeLessThanOrEqual(MAX_OPTIONS);
  await timeEnter(page);
  const role = page.locator("tr.person-row").nth(4).getByLabel("Role");
  for (let i = 0; i < 7; i++) {
    await role.press("End");
    await role.press(i % 2 ? "Backspace" : "x");
    await role.press("Enter");
  }
  const peopleEdits = await page.evaluate(() => (window as unknown as { __edits: number[] }).__edits.slice(2));
  expect(peopleEdits).toHaveLength(5);
  expect(await reads(), "textarea heights read").toBe(0);
  await context.close();

  const report = (what: string, times: number[], target: number) => {
    const ms = median(times);
    console.log(`2000 boxes: ${what} in ${ms.toFixed(0)} ms (median of ${times.length}: ${times.map((t) => t.toFixed(0)).join(", ")}; target ${target} ms)`);
    test.info().annotations.push({ type: `${what}, 2000 boxes (ms)`, description: ms.toFixed(0) });
    return ms;
  };
  console.log(`2000 boxes: the table draws ${table.rows} rows with data and ${table.options} options, People ${people.rows} and ${people.options}`);
  expect(report("table opened", opened.Table, TABLE_MS)).toBeLessThan(2 * TABLE_MS);
  expect(report("People opened", opened.People, TABLE_MS)).toBeLessThan(2 * TABLE_MS);
  expect(report("table edit committed", tableEdits, EDIT_MS)).toBeLessThan(2 * EDIT_MS);
  expect(report("People edit committed", peopleEdits, EDIT_MS)).toBeLessThan(2 * EDIT_MS);
});

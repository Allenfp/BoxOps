import { readFileSync, readdirSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname } from "node:path";
import { gzipSync } from "node:zlib";
import { type Browser, type Page, expect, test } from "@playwright/test";
import { assembleBundle, hashFolder } from "../cli/site";
import { type AppInfo, type BundleSource, readBundle } from "../src/model/bundle";
import { generateRoadmap } from "../scripts/gen-roadmap";

// First load of a big roadmap (`npm run perf`, not part of the browser tests):
// the production build with a generated 2,000-box roadmap (and a 500-box
// one) as its roadmap.json, served gzipped as Pages does, opened in WebKit as
// a viewer would, without a token. Checked exactly: the app's main
// JavaScript file stays under MAIN_LIMIT, and no file with the yaml library
// is fetched before the timeline shows (the build parsed the files). Timed:
// navigation to the timeline painted, printed for each run; a test fails
// only above CEILING_MS, generous so a slow CI machine doesn't fail it. The
// same roadmap without the build's parsing is timed too, for comparison.

const MAIN_LIMIT = 400_000;
const CEILING_MS = 2500;
const RUNS = 3;

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

/** roadmap.json for a generated roadmap of `boxes` boxes, as a deploy of a private repository serves it. */
async function bundle(boxes: number, parsed: boolean): Promise<Uint8Array> {
  const folder = await hashFolder(generateRoadmap(boxes, today()));
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
      requestAnimationFrame(() => setTimeout(() => Object.assign(w.__load!, { painted: performance.now() }), 0));
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
    for (let run = 0; run < RUNS; run++) {
      const context = await fresh(browser);
      const page = await context.newPage();
      const fetched: string[] = [];
      page.on("request", (r) => fetched.push(new URL(r.url()).pathname.split("/").pop()!));
      const l = await load(page);
      expect(l.scripts, "files fetched before the timeline showed").toContain(MAIN);
      expect(l.scripts.filter((f) => YAML_FILES.includes(f)), "the yaml library, before the timeline showed").toEqual([]);
      expect(fetched.filter((f) => YAML_FILES.includes(f)), "the yaml library, at all").toEqual([]);
      expect(await page.locator(".box").count()).toBeGreaterThan(0);
      times.push(l.painted);
      await context.close();
    }
    const ms = median(times);
    console.log(`${boxes} boxes, parsed by the build: timeline painted in ${ms.toFixed(0)} ms (median of ${RUNS}: ${times.map((t) => t.toFixed(0)).join(", ")})`);
    test.info().annotations.push({ type: `time to timeline, ${boxes} boxes (ms)`, description: ms.toFixed(0) });
    expect(ms).toBeLessThan(CEILING_MS);
  });
}

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

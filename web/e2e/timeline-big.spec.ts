import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { generateRoadmap } from "../scripts/gen-roadmap";
import type { FakeGitHub } from "./fake-github";
import { boxFile, expect, openTab, pollNow, test, toolbar } from "./helpers";

// A big roadmap's timeline draws only what's near the screen (Timeline.tsx,
// timeline/rows.ts), and nothing on screen is ever missing from it: each
// check is made against the same roadmap drawn whole, in a second tab. 600
// boxes and 360 PTO blocks in 12 departments, one box running nearly two
// years, and two boxes ten months apart in the first department's last
// lane.

const LONG = "bx-0001-long-haul";
const [JAN, NOV] = ["bx-0002-january", "bx-0003-november"];
const boxYaml = (id: string, code: string, lane: string, start: string, end: string, fte = 1) =>
  `id: ${id}\ncode: ${code}\ntitle: ${id.slice(8)}\nlane: ${lane}\nstart: ${start}\nend: ${end}\ntype: project\nfte: ${fte}\n`;
const FILES = {
  ...generateRoadmap(600, "2026-10-03"),
  [`boxes/${LONG}.yaml`]: boxYaml(LONG, "QQQ", "dept-01-1", "2026-01-05", "2027-11-26", 0.5),
  [`boxes/${JAN}.yaml`]: boxYaml(JAN, "QQJ", "dept-01-8", "2026-01-05", "2026-01-16"),
  [`boxes/${NOV}.yaml`]: boxYaml(NOV, "QQN", "dept-01-8", "2026-11-02", "2026-11-13"),
};
test.use({ files: FILES });

const cell = (page: Page, key: string) => page.locator(`[data-cell="${key}"]`);
const dept = (n: number) => `dept-${String(n).padStart(2, "0")}`;

/**
 * Scroll the timeline to these fractions of the way across and down, and wait till it has
 * heard of it (its scroll event, which the app's handler hears first): what it draws has
 * followed by then.
 */
const scrollTo = (page: Page, x: number, y: number) =>
  page.locator(".timeline").evaluate(
    (el, [x, y]) =>
      new Promise<void>((done) => {
        const was = [el.scrollLeft, el.scrollTop];
        el.scrollTo((el.scrollWidth - el.clientWidth) * x, (el.scrollHeight - el.clientHeight) * y);
        // Already there: no scroll event comes.
        if (el.scrollLeft === was[0] && el.scrollTop === was[1]) return done();
        el.addEventListener("scroll", () => done(), { once: true });
      }),
    [x, y],
  );

/** The cells (`data-cell`) on screen: in the timeline's view, below its header. */
const onScreen = (page: Page) =>
  page.locator(".timeline").evaluate((el) => {
    const view = el.getBoundingClientRect();
    const top = el.querySelector(".tl-head")!.getBoundingClientRect().bottom;
    return [...el.querySelectorAll<HTMLElement>("[data-cell]")]
      .filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.right > view.left && r.left < view.left + el.clientWidth && r.bottom > top && r.top < view.top + el.clientHeight;
      })
      .map((c) => c.dataset.cell!)
      .sort();
  });

/** Where the timeline is scrolled to, if it's stopped there (the same two frames running); null while it's moving. */
const stopped = (page: Page) =>
  page.locator(".timeline").evaluate(
    (el) =>
      new Promise<string | null>((done) => {
        const at = () => `${el.scrollLeft},${el.scrollTop}`;
        const was = at();
        requestAnimationFrame(() => requestAnimationFrame(() => done(at() === was ? was : null)));
      }),
  );

/** Each department's room, top to bottom, drawn or not. */
const heights = (page: Page) => page.locator("[data-reorder-id]").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));

/** The same roadmap in another tab, drawn whole, however big. */
function wholeTab(page: Page, github: FakeGitHub): Promise<Page> {
  // Before it opens the app (requests to the page are made in order).
  page.context().once("page", (tab) => void tab.addInitScript(() => (window.__boxopsTest = { cull: false })));
  return openTab(page.context(), github);
}

test("only what's near the screen is drawn; the grid counts every row, and what isn't drawn takes its room", async ({ page, github }) => {
  const whole = await wholeTab(page, github);
  const all = await whole.locator(".box").count();
  expect(all).toBe(603);
  const drawn = await page.locator(".box").count();
  expect(drawn).toBeGreaterThan(10);
  expect(drawn).toBeLessThan(all / 4);
  await expect(page.locator(".dept-away").first()).toHaveAttribute("aria-hidden", "true");
  expect(await heights(page)).toEqual(await heights(whole));

  // Every row, drawn or not, counts; each one drawn says which it is.
  const grid = page.getByRole("grid", { name: "Timeline" });
  const rows = await whole.getByRole("grid", { name: "Timeline" }).getByRole("row").count();
  await expect(grid).toHaveAttribute("aria-rowcount", String(rows));
  const indexes = () => grid.getByRole("row").evaluateAll((els) => els.map((r) => Number(r.getAttribute("aria-rowindex"))));
  expect((await indexes())[0]).toBe(1);
  await scrollTo(page, 0, 1);
  await expect.poll(async () => (await indexes()).at(-1)).toBe(rows);
  expect(await indexes()).toEqual((await indexes()).toSorted((a, b) => a - b));
  // Rows the whole timeline draws are drawn here with the same numbers, and the same names.
  const named = (p: Page) =>
    p.getByRole("grid", { name: "Timeline" }).getByRole("row").evaluateAll((els) => els.map((r, i) => `${r.getAttribute("aria-rowindex") ?? i + 1} ${r.getAttribute("aria-label")}`));
  const everyRow = await named(whole);
  for (const row of await named(page)) expect(everyRow).toContain(row);
  expect(await heights(page)).toEqual(await heights(whole));

  const axe = await new AxeBuilder({ page }).include(".timeline").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("nothing on screen is missing, wherever it's scrolled, at every zoom, and after Today", async ({ page, github }) => {
  // Fifteen places at three zooms, Today and a bigger window, each in this tab and in one that
  // draws all 603 boxes, compared as soon as both have heard of the scroll (scrollTo): what's
  // drawn has followed by then. That's a lot of drawing: in WebKit, 18 to 22 seconds on its own,
  // up to 45 with eight workers busy at once, so three times the 30 allowed.
  test.slow();
  const whole = await wholeTab(page, github);
  for (const zoom of ["Months", "Weeks", "Quarters"]) {
    for (const p of [page, whole]) await p.getByRole("button", { name: zoom, exact: true }).click();
    for (const [x, y] of [[0, 0], [0.5, 0.5], [1, 1], [0.25, 0.8], [0.9, 0.1]]) {
      for (const p of [page, whole]) await scrollTo(p, x, y);
      const expected = await onScreen(whole);
      expect(expected.length).toBeGreaterThan(0);
      expect(await onScreen(page), `${zoom} at ${x}, ${y}`).toEqual(expected);
    }
  }
  // The long box, though it starts and ends far off screen, at weeks zoom.
  for (const p of [page, whole]) {
    await p.getByRole("button", { name: "Weeks", exact: true }).click();
    await scrollTo(p, 0.5, 0);
  }
  expect(await onScreen(whole)).toContain(`box:${LONG}`);
  expect(await onScreen(page)).toContain(`box:${LONG}`);

  // Today, from the far end: the timeline scrolls back, smoothly, drawing what it comes to.
  // Compared once both tabs have got there and stopped, in the same place: mid-scroll, or
  // before they've started, the two can be in the same place and still be on their way.
  for (const p of [page, whole]) {
    await scrollTo(p, 1, 1);
    await expect(p.locator(".today-line")).not.toBeInViewport();
    await p.getByRole("button", { name: "Today" }).click();
  }
  for (const p of [page, whole]) await expect(p.locator(".today-line")).toBeInViewport();
  await expect
    .poll(async () => {
      const at = await stopped(page);
      return at !== null && at === (await stopped(whole));
    })
    .toBe(true);
  await expect.poll(() => onScreen(page)).toEqual(await onScreen(whole));

  // A bigger window: what's drawn follows its size.
  for (const p of [page, whole]) {
    await p.setViewportSize({ width: 2400, height: 1500 });
    await scrollTo(p, 0.4, 0.6);
  }
  await expect.poll(() => onScreen(page)).toEqual(await onScreen(whole));
});

test("focus scrolled far away stays, drawn; the keys go on to cells that weren't drawn, and show them", async ({ page, github: _ }) => {
  const focused = page.locator('[role="grid"] :focus');
  // The last box in a lane's row, far in the future: drawn, and shown.
  await cell(page, `lane:${dept(1)}-1`).focus();
  await page.keyboard.press("End");
  await expect(focused).toHaveAttribute("data-cell", /^box:/);
  await expect(focused).toBeInViewport();
  const last = (await focused.getAttribute("data-cell"))!;
  // Scrolled far away, it stays, with focus.
  await scrollTo(page, 0, 1);
  await expect.poll(() => onScreen(page)).not.toContain(last);
  await expect(cell(page, last)).toBeFocused();
  // On along its row: the box before it, drawn and shown; then the row's first cell, its lane's name.
  await page.keyboard.press("ArrowLeft");
  await expect(focused).toHaveAttribute("data-cell", /^box:/);
  await expect(focused).not.toHaveAttribute("data-cell", last);
  await expect(focused).toBeInViewport();
  await page.keyboard.press("Home");
  await expect(cell(page, `lane:${dept(1)}-1`)).toBeFocused();
  await expect(cell(page, `lane:${dept(1)}-1`)).toBeInViewport();

  // Page Down through every department, each heading drawn and shown as focus comes to it.
  await page.keyboard.press("ControlOrMeta+ArrowUp");
  await expect(cell(page, `dept:${dept(1)}`)).toBeFocused();
  for (let n = 2; n <= 12; n++) {
    await page.keyboard.press("PageDown");
    await expect(cell(page, `dept:${dept(n)}`)).toBeFocused();
    await expect(cell(page, `dept:${dept(n)}`)).toBeInViewport();
  }
  // The very last cell: the last department's latest PTO block. And back to the first.
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await expect(focused).toHaveAttribute("data-cell", /^pto:/);
  await expect(focused).toBeInViewport();
  await page.keyboard.press("ControlOrMeta+ArrowUp");
  await expect(cell(page, `dept:${dept(1)}`)).toBeFocused();
  await expect(cell(page, `dept:${dept(1)}`)).toBeInViewport();

  // Down from a box in the first lane, a row at a time: through the lanes, the PTO row and the
  // next heading (and the extra area, if there is one) into the next department's lanes.
  await cell(page, `lane:${dept(1)}-1`).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(focused).toHaveAttribute("data-cell", /^box:/);
  for (let i = 0; i < 11; i++) await page.keyboard.press("ArrowDown");
  await expect(focused).toBeInViewport();
  expect(await focused.evaluate((el) => el.closest("[data-dept-id]")?.getAttribute("data-dept-id"))).toBe(dept(2));
});

test("a box moved by keyboard stays drawn and on screen, wherever it goes", async ({ page, github: _ }) => {
  await cell(page, `lane:${dept(1)}-1`).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const key = (await page.locator('[role="grid"] :focus').getAttribute("data-cell"))!;
  expect(key).toMatch(/^box:/);
  const moved = cell(page, key);
  const deptOf = () => moved.evaluate((el) => el.closest("[data-dept-id]")?.getAttribute("data-dept-id"));
  await page.keyboard.press("Space");
  // Half a year on, a week at a time.
  for (let i = 0; i < 26; i++) await page.keyboard.press("Shift+ArrowRight");
  await expect(moved).toBeFocused();
  await expect(moved).toBeInViewport();
  // Down through the lanes into the next department (its own lane is one of the first seven).
  for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowDown");
  await expect(moved).toBeInViewport();
  expect(await deptOf()).toBe(dept(2));
  await page.keyboard.press("Escape");
  await expect(moved).toBeFocused();
  await expect(moved).toBeInViewport();
  expect(await deptOf()).toBe(dept(1));
});

test("collapsed departments are a row each; as boxes, those on screen are drawn", async ({ page, github }) => {
  const whole = await wholeTab(page, github);
  const grid = page.getByRole("grid", { name: "Timeline" });
  for (const p of [page, whole]) await p.getByRole("button", { name: "Collapse all" }).click();
  await expect(grid).toHaveAttribute("aria-rowcount", "12");
  await expect(grid.getByRole("row")).toHaveCount(12);
  await expect(page.locator(".dept-away")).toHaveCount(0);
  await expect(page.locator(".use-chart")).toHaveCount(12);

  // Collapsed departments showing their boxes: only those near the screen are drawn.
  await page.evaluate(() => localStorage.setItem("boxops-prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("boxops-prefs")!), collapsedView: "boxes" })));
  for (const p of [page, whole]) {
    await p.reload();
    await p.locator(".box.compact").first().waitFor(); // however long it takes, as the fixture's first load
  }
  expect(await page.locator(".box.compact").count()).toBeLessThan((await whole.locator(".box.compact").count()) / 2);
  for (const [x, y] of [[0, 0], [0.6, 0], [1, 1]]) {
    for (const p of [page, whole]) await scrollTo(p, x, y);
    await expect.poll(() => onScreen(page)).toEqual(await onScreen(whole));
  }

  // One expanded again, far down: drawn whole once it's on screen.
  for (const p of [page, whole]) {
    await cell(p, `dept:${dept(12)}`).click();
    await scrollTo(p, 0, 1);
  }
  await expect.poll(() => onScreen(page)).toEqual(await onScreen(whole));
});

/**
 * What dragIntoCorner sees every 50 ms: how many times it looked, how many of them the box was
 * out of sight, and, once it's held in the corner, how many of them the point it's held at hit
 * the timeline itself, over no lane (WebKit's overlay scrollbars).
 */
type Sight = { seen: number; out: number; overBars: number; held?: { x: number; y: number }; stop?: boolean };

/**
 * A box of the first department on screen, pressed clear of the labels and dragged into the
 * timeline's bottom right corner, `inset` px in from its right and bottom edges, then held there:
 * the timeline scrolls down and on in time, through departments and days that weren't drawn,
 * carrying the box. Waited for until it's three screens down, looking every 50 ms (Sight). It's
 * let go at `release` (by default where it's held).
 */
async function dragIntoCorner(page: Page, inset: number, release?: { x: number; y: number }) {
  const timeline = page.locator(".timeline");
  const view = (await timeline.boundingBox())!;
  const key = await timeline.evaluate((el, id) => {
    const left = el.getBoundingClientRect().left + 300;
    return [...el.querySelectorAll<HTMLElement>(`[data-dept-id="${id}"] .lane-track .box`)].find((b) => b.getBoundingClientRect().right > left + 40)?.dataset.cell;
  }, dept(1));
  const moved = cell(page, key!);
  const was = Number(await moved.getAttribute("data-start"));
  const b = (await moved.boundingBox())!;
  await page.mouse.move(Math.max(b.x, view.x + 300) + 20, b.y + b.height / 2);
  await page.mouse.down();
  await timeline.evaluate((el, key) => {
    const sight: Sight = { seen: 0, out: 0, overBars: 0 };
    (window as unknown as { sight: Sight }).sight = sight;
    const look = () => {
      if (sight.stop) return;
      const r = el.querySelector(`[data-cell="${CSS.escape(key)}"]`)?.getBoundingClientRect();
      const view = el.getBoundingClientRect();
      const top = el.querySelector(".tl-head")!.getBoundingClientRect().bottom;
      sight.seen++;
      if (!r || r.bottom <= top || r.top >= view.top + el.clientHeight || r.right <= view.left || r.left >= view.left + el.clientWidth) sight.out++;
      if (sight.held && document.elementFromPoint(sight.held.x, sight.held.y) === el) sight.overBars++;
      setTimeout(look, 50);
    };
    look();
  }, key!);
  const corner = { x: view.x + view.width - inset, y: view.y + view.height - inset };
  await page.mouse.move(corner.x, corner.y, { steps: 10 });
  await page.evaluate((held) => ((window as unknown as { sight: Sight }).sight.held = held), corner);
  // However long that takes: it scrolls a step a frame, and a busy machine draws fewer frames.
  for (const depth of [1, 2, 3]) {
    await expect.poll(() => timeline.evaluate((el) => el.scrollTop), { timeout: 0 }).toBeGreaterThan(depth * view.height);
    await expect(moved).toHaveCount(1);
    await expect(moved).toBeInViewport();
  }
  const sight = await page.evaluate(() => {
    const w = window as unknown as { sight: Sight };
    w.sight.stop = true;
    return w.sight;
  });
  if (release) await page.mouse.move(release.x, release.y, { steps: 2 });
  await page.mouse.up();
  return { moved, was, sight };
}

test("the box being dragged is drawn all the way as the timeline scrolls far under it, and lands where it's let go", async ({ page, github: _ }) => {
  const view = (await page.locator(".timeline").boundingBox())!;
  // Held 30 px in from the edges, inside the band that scrolls (40); let go mid-screen.
  const { moved, was, sight } = await dragIntoCorner(page, 30, { x: view.x + view.width / 2, y: view.y + view.height / 2 });
  // In sight all the while.
  expect(sight.seen).toBeGreaterThan(10);
  expect(sight.out).toBe(0);
  // Dropped in a department far below, later: one change, and it keeps focus.
  const now = await moved.evaluate((el) => el.closest("[data-dept-id]")?.getAttribute("data-dept-id"));
  expect(Number(now?.slice(5))).toBeGreaterThan(3);
  expect(Number(await moved.getAttribute("data-start"))).toBeGreaterThan(was);
  await expect(moved).toBeFocused();
  await expect(toolbar(page)).toContainText("Save · 1 change");
});

test("held over the timeline's last pixels (WebKit's overlay scrollbars), the box goes on into the lanes just inside, and lands there", async ({
  page,
  browserName,
  github: _,
}) => {
  // 6 px in: on WebKit's overlay scrollbars, which show while the timeline scrolls and hit as the
  // timeline itself, over no lane (checked: the point held at did so). The box goes into the lane
  // just inside them as they pass, in sight all the while (in the last one it was over, it would
  // scroll out of sight); let go there.
  const { moved, was, sight } = await dragIntoCorner(page, 6);
  if (browserName === "webkit") expect(sight.overBars, "looks with the pointer on the scrollbars").toBeGreaterThan(0);
  expect(sight.seen).toBeGreaterThan(10);
  expect(sight.out).toBe(0);
  const now = await moved.evaluate((el) => el.closest("[data-dept-id]")?.getAttribute("data-dept-id"));
  expect(Number(now?.slice(5))).toBeGreaterThan(3);
  expect(Number(await moved.getAttribute("data-start"))).toBeGreaterThan(was);
  await expect(moved).toBeFocused();
  await expect(toolbar(page)).toContainText("Save · 1 change");
});

test("a box open in its editor stays drawn, scrolled far away; deleted, focus goes to the box beside it, drawn wherever it is", async ({ page, github: _ }) => {
  const focused = page.locator('[role="grid"] :focus');
  await cell(page, `box:${NOV}`).click();
  const editor = page.getByRole("dialog", { name: "Edit november" });
  await expect(editor).toBeVisible();
  await scrollTo(page, 1, 1);
  await expect.poll(() => onScreen(page)).not.toContain(`box:${NOV}`);
  await expect(cell(page, `box:${NOV}`)).toHaveCount(1);
  // Closed, focus is back on it, shown.
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(cell(page, `box:${NOV}`)).toBeFocused();
  await expect(cell(page, `box:${NOV}`)).toBeInViewport();

  // At weeks zoom, the January box, months before the next in its row, which isn't drawn: from
  // its lane's name at the very start, the box nearest the days on screen.
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  await scrollTo(page, 0, 0);
  await cell(page, `lane:${dept(1)}-8`).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(cell(page, `box:${JAN}`)).toBeFocused();
  await expect(cell(page, `box:${JAN}`)).toBeInViewport();
  const drawn = await page.locator("[data-cell]").evaluateAll((els) => els.map((el) => el.getAttribute("data-cell")));
  await page.keyboard.press("Delete");
  await expect(cell(page, `box:${JAN}`)).toHaveCount(0);
  await expect(focused).toHaveAttribute("data-cell", /^box:/);
  expect(drawn).not.toContain(await focused.getAttribute("data-cell"));
  await expect(focused).toBeInViewport();
  expect(await focused.evaluate((el) => el.closest("[data-row]")?.getAttribute("data-row"))).toBe(`lane:${dept(1)}-8`);
  await expect(toolbar(page)).toContainText("Save · 1 change");
});

test("a focused box someone else deleted gives focus to the box beside it, drawn wherever it is", async ({ page, github }) => {
  const focused = page.locator('[role="grid"] :focus');
  // The January box, at weeks zoom, months before the next in its row, which isn't drawn.
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  await scrollTo(page, 0, 0);
  await cell(page, `lane:${dept(1)}-8`).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(cell(page, `box:${JAN}`)).toBeFocused();
  const drawn = await page.locator("[data-cell]").evaluateAll((els) => els.map((el) => el.getAttribute("data-cell")));
  github.deploy(github.otherSave({ [boxFile(JAN)]: () => undefined }, "Sam Lee", "January dropped"));
  await pollNow(page);
  await expect(cell(page, `box:${JAN}`)).toHaveCount(0);
  // Not the lane's + or name, though they're drawn: the next box, as Delete would.
  await expect(focused).toHaveAttribute("data-cell", /^box:/);
  expect(drawn).not.toContain(await focused.getAttribute("data-cell"));
  await expect(focused).toBeInViewport();
  expect(await focused.evaluate((el) => el.closest("[data-row]")?.getAttribute("data-row"))).toBe(`lane:${dept(1)}-8`);
});

test("what the app focuses or shows is drawn wherever it is: from the warnings, from People, and after a delete in an editor", async ({ page, github: _ }) => {
  const focused = page.locator('[role="grid"] :focus');
  const away = () => page.locator(".dept-away").evaluateAll((els) => els.map((el) => el.getAttribute("data-reorder-id")));
  const drawn = () => page.locator("[data-cell]").evaluateAll((els) => els.map((el) => el.getAttribute("data-cell")));
  const deptOf = (el: Locator) => el.evaluate((e) => e.closest("[data-dept-id]")?.getAttribute("data-dept-id"));
  const warning = async (section: string) => {
    await page.getByRole("button", { name: /^\d+ warnings?$/ }).click();
    return page.getByRole("dialog", { name: /warning/ }).locator("section", { hasText: section }).getByRole("button");
  };

  // The last department over capacity, far down: its heading, drawn and shown, with focus.
  let before = await away();
  await (await warning("Over capacity")).last().click();
  await expect(focused).toHaveAttribute("data-cell", /^dept:/);
  await expect(focused).toBeInViewport();
  const over = (await focused.getAttribute("data-cell"))!.slice(5);
  expect(before).toContain(over);
  // Once focus has gone on, and the timeline's scrolled away, it isn't drawn any more.
  await page.keyboard.press("ControlOrMeta+ArrowUp");
  await expect(cell(page, `dept:${dept(1)}`)).toBeFocused();
  await expect(page.locator(`.dept-away[data-reorder-id="${over}"]`)).toHaveCount(1);

  // A box with a broken rule, away from the screen: drawn, scrolled to, open.
  before = await away();
  await (await warning("Broken rules")).first().click();
  const editor = page.getByRole("dialog", { name: /^Edit / });
  const selected = page.locator(".box.selected");
  await expect(editor).toBeVisible();
  await expect(selected).toBeInViewport();
  const home = await deptOf(selected);
  expect(before).toContain(home);
  // Scrolled far away, its editor going with it, and deleted from there by keyboard: focus goes to
  // the box after it in its department, which wasn't drawn, drawn and shown.
  await scrollTo(page, 1, 1);
  await expect.poll(() => onScreen(page)).not.toContain(await selected.getAttribute("data-cell"));
  let was = await drawn();
  await editor.getByRole("button", { name: "Delete" }).press("Enter");
  await expect(editor).toHaveCount(0);
  await expect(focused).toHaveAttribute("data-cell", /^box:/);
  await expect(focused).toBeInViewport();
  expect(was).not.toContain(await focused.getAttribute("data-cell"));
  expect(await deptOf(focused)).toBe(home);

  // From People, a PTO block in the last department: drawn, scrolled to, open.
  await page.getByRole("button", { name: "People", exact: true }).click();
  await page.locator(`tbody[data-dept-id="${dept(12)}"] .pto-list button`).first().click();
  const ptoEditor = page.getByRole("dialog", { name: /^Edit PTO for / });
  const pto = page.locator(".pto-block.selected");
  await expect(ptoEditor).toBeVisible();
  await expect(pto).toBeInViewport();
  expect(await deptOf(pto)).toBe(dept(12));
  // The same: focus goes to the next block in the department's PTO row.
  await scrollTo(page, 1, 0);
  await expect.poll(() => onScreen(page)).not.toContain(await pto.getAttribute("data-cell"));
  was = await drawn();
  await ptoEditor.getByRole("button", { name: "Delete" }).press("Enter");
  await expect(ptoEditor).toHaveCount(0);
  await expect(focused).toHaveAttribute("data-cell", /^pto:/);
  await expect(focused).toBeInViewport();
  expect(was).not.toContain(await focused.getAttribute("data-cell"));
  expect(await deptOf(focused)).toBe(dept(12));
  await expect(toolbar(page)).toContainText("Save · 2 changes");
});

test("a closed editor gives focus back to its box or PTO block, drawn and shown wherever it is", async ({ page, github: _ }) => {
  const editor = page.getByRole("dialog", { name: /^Edit / });
  const warning = async (section: string) => {
    await page.getByRole("button", { name: /^\d+ warnings?$/ }).click();
    return page.getByRole("dialog", { name: /warning/ }).locator("section", { hasText: section }).getByRole("button");
  };
  /** Closed with Esc: focus is on `key`, shown. */
  const closed = async (key: string) => {
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(cell(page, key)).toBeFocused();
    await expect(cell(page, key)).toBeInViewport();
  };

  // A box added with N after the long one, at weeks zoom: open at once, off screen, and closed.
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  await cell(page, `box:${LONG}`).focus();
  await page.keyboard.press("n");
  await expect(editor).toBeVisible();
  const added = (await page.locator(".box.selected").getAttribute("data-cell"))!;
  expect(added).not.toBe(`box:${LONG}`);
  await expect.poll(() => onScreen(page)).not.toContain(added);
  await closed(added);

  // A box with a broken rule, from the warnings: scrolled to and open, then scrolled far away.
  await (await warning("Broken rules")).first().click();
  await expect(editor).toBeVisible();
  const broken = (await page.locator(".box.selected").getAttribute("data-cell"))!;
  await expect(cell(page, broken)).toBeInViewport();
  await expect.poll(() => stopped(page)).not.toBeNull();
  await scrollTo(page, 1, 1);
  await expect.poll(() => onScreen(page)).not.toContain(broken);
  await closed(broken);

  // A PTO block in the last department, from People: the same.
  await page.getByRole("button", { name: "People", exact: true }).click();
  await page.locator(`tbody[data-dept-id="${dept(12)}"] .pto-list button`).first().click();
  await expect(editor).toBeVisible();
  const pto = (await page.locator(".pto-block.selected").getAttribute("data-cell"))!;
  await expect(cell(page, pto)).toBeInViewport();
  await expect.poll(() => stopped(page)).not.toBeNull();
  await scrollTo(page, 1, 0);
  await expect.poll(() => onScreen(page)).not.toContain(pto);
  await closed(pto);
});

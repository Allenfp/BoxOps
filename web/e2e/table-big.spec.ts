import type { Browser, Locator, Page } from "@playwright/test";
import { parse } from "yaml";
import { generateRoadmap } from "../scripts/gen-roadmap";
import type { FakeGitHub } from "./fake-github";
import { choose, expect, heard, openTab, pastPrintTable, test, toolbar } from "./helpers";

// A big roadmap's table draws only the rows near the screen
// (table/useWindowedRows.ts), and nothing on screen is ever missing from it:
// checked against the same table drawn whole in a second window (a smaller
// roadmap, so drawing it whole takes less time). 600 boxes and 360 PTO
// entries in 12 departments of 8 lanes (generated around the tests' today),
// about 1,000 rows. People has 120 engineers, fewer rows than are
// ever left out, so its tests have it draw only what's near the screen
// anyway (`virtualize`). Only the date is fixed, at today's: these tests
// never move the clock on, and the rows' measuring and what they wait for
// (settled) go by the browser's own frames, not a fake clock's timers.

const files = generateRoadmap(600, "2026-10-03");
test.use({ files, fakeClock: "fixed" });

/** Its engineers, and someone with PTO that's over (before the tests' today, 2026-10-03) and PTO that isn't. */
const { people } = parse(files["people.yaml"]) as { people: { id: string; name: string; department: string; pto: { start: string; end: string }[] }[] };
const someone = people.find((p) => p.pto.some((t) => t.end < "2026-10-03") && p.pto.some((t) => t.end >= "2026-10-03"))!;

const scroller = (page: Page) => page.locator(".table-scroll");
/** Rows with data in them: boxes, PTO, engineers. */
const dataRows = (page: Page) => page.locator("tr.box-row, tr.pto-table-row, tr.person-row");
const titleOf = (row: Locator) => row.getByLabel("Title").inputValue();

/** Scroll the table this fraction of the way down. */
const scrollTo = (page: Page, y: number) => scroller(page).evaluate((el, y) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * y), y);
/** A few frames on: the rows scrolled to are drawn and measured. */
const settled = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
/**
 * What the page hears as its window loses focus (⌘Tab, the address bar): a blur and focusout with nowhere they
 * went to, the field keeping focus; and as it gets it back (`back`), a focus and focusin from nowhere.
 */
const windowBlur = (page: Page, back = false) =>
  page.evaluate((back) => {
    const el = document.activeElement!;
    el.dispatchEvent(new FocusEvent(back ? "focus" : "blur", { relatedTarget: null }));
    el.dispatchEvent(new FocusEvent(back ? "focusin" : "focusout", { bubbles: true, relatedTarget: null }));
  }, back);

/** The rows on screen, below the sticky header: their aria-rowindex and first cell's text or field. */
const onScreen = (page: Page) =>
  scroller(page).evaluate((el) => {
    const view = el.getBoundingClientRect();
    const top = view.top + el.querySelector("thead")!.getBoundingClientRect().height;
    return [...el.querySelectorAll<HTMLElement>("tbody tr[aria-rowindex]")]
      .filter((r) => {
        const b = r.getBoundingClientRect();
        return b.bottom > top + 1 && b.top < view.top + el.clientHeight - 1;
      })
      .map((r) => `${r.getAttribute("aria-rowindex")} ${(r.querySelector("input, select, button") as HTMLInputElement | null)?.value ?? r.textContent}`);
  });

/**
 * The same roadmap in another window, its table drawn whole, however big. A
 * window of its own (a browser context): Chromium hides a tab behind another
 * in the same window, and slows its clock right down.
 */
async function wholeTab(browser: Browser, github: FakeGitHub): Promise<Page> {
  const { viewport, timezoneId } = test.info().project.use;
  const context = await browser.newContext({ viewport, timezoneId });
  await context.addInitScript(() => (window.__boxopsTest = { virtualize: false }));
  const tab = await openTab(context, github);
  await tab.getByRole("button", { name: "Table", exact: true }).click();
  // About 500 rows, every one drawn, while the other tests run: given time.
  await expect(tab.locator(".box-table")).toBeVisible({ timeout: 60_000 });
  return tab;
}

/** Where `el` is, against the table's view: under its sticky header, its department's heading stuck under that, or title column, or off screen. */
const placeIn = (el: Locator) =>
  el.evaluate((el) => {
    const s = el.closest(".table-scroll")!;
    const view = s.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const heading = el.closest("tr.group-row") ? null : el.closest("tbody")!.querySelector("tr.group-row");
    const head = view.top + s.querySelector("thead")!.getBoundingClientRect().height + (heading?.getBoundingClientRect().height ?? 0);
    const title = el.closest("td.col-title") ? view.left : (el.closest("tr")!.querySelector("td.col-title")?.getBoundingClientRect().right ?? view.left);
    return { clear: r.top >= head - 1 && r.bottom <= view.top + s.clientHeight + 1 && r.left >= title - 1 && r.right <= view.left + s.clientWidth + 1 };
  });

/** How tall each department's rows are, spacers included. */
const departmentHeights = (page: Page) => page.locator(".box-table [data-reorder-id]").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
/** Scroll the table so that this far down a department (0: its top, 1: its end) is in the middle of the view. */
const centre = (page: Page, dept: string, at: number) =>
  scroller(page).evaluate(
    (el, [dept, at]) => {
      const rows = el.querySelector(`[data-dept-id="${dept}"]`)!.getBoundingClientRect();
      const view = el.getBoundingClientRect();
      el.scrollTop += rows.top + rows.height * at - (view.top + view.height / 2);
    },
    [dept, at] as const,
  );
/** A density chosen in Settings: the rows drawn are another height. */
async function density(page: Page, name: "Comfortable" | "Compact") {
  const row = page.locator("tr.box-row").first();
  const was = await row.evaluate((r) => r.getBoundingClientRect().height);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog", { name: "Settings" }).getByRole("group", { name: "Density" }).getByRole("button", { name }).click();
  await page.keyboard.press("Escape");
  await expect.poll(() => row.evaluate((r) => r.getBoundingClientRect().height)).not.toBe(was);
}

test.beforeEach(async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.locator(".box-table")).toBeVisible();
});

test.describe("against the table drawn whole", () => {
  // 300 boxes and 180 PTO entries in 6 departments: about 500 rows, drawn whole in the other window.
  test.use({ files: generateRoadmap(300, "2026-10-03") });
  test.slow();

  test("only rows near the screen are drawn; the table counts every row, and spacers stand for the rest", async ({ page, github, browser }) => {
    const whole = await wholeTab(browser, github);
    const all = await whole.locator(".box-table tbody tr").count();
    expect(await dataRows(whole).count()).toBeGreaterThan(450);
    const drawn = await dataRows(page).count();
    expect(drawn).toBeGreaterThan(10);
    expect(drawn).toBeLessThanOrEqual(70);
    // A select with every lane in it lists only its chosen one until it's used.
    expect(await page.locator(".box-table option").count()).toBeLessThanOrEqual(drawn * 25);

    // Every row is counted; each one drawn says which it is, in order; spacers are hidden.
    const table = page.locator(".box-table");
    await expect(table).toHaveAttribute("aria-rowcount", String(all + 1));
    await expect(table.locator("thead tr")).toHaveAttribute("aria-rowindex", "1");
    const indexes = () => table.locator("tbody tr[aria-rowindex]").evaluateAll((els) => els.map((r) => Number(r.getAttribute("aria-rowindex"))));
    expect((await indexes())[0]).toBe(2);
    expect(await indexes()).toEqual((await indexes()).toSorted((a, b) => a - b));
    await expect(table.locator("tr.spacer").first()).toHaveAttribute("aria-hidden", "true");
    await scrollTo(page, 1);
    await expect.poll(async () => (await indexes()).at(-1)).toBe(all + 1);

    // Spacers are as tall as what they stand for: each department takes the same room as drawn whole.
    expect(await departmentHeights(page)).toEqual(await departmentHeights(whole));
  });

  test("in the compact density too, once each kind of row has been drawn, though none of some kinds is drawn now", async ({ page, github, browser }) => {
    const whole = await wholeTab(browser, github);
    for (const p of [page, whole]) await density(p, "Compact");
    // PTO, Add PTO and a heading drawn (the end of the first department, the start of the second); then only boxes,
    // and the heading of their department, stuck under the header (drawn though it's far above).
    await centre(page, "dept-01", 1);
    await expect(page.locator("tr.add-pto-row")).not.toHaveCount(0);
    await centre(page, "dept-03", 0.35);
    await settled(page);
    const others = page.locator("tr.pto-table-row, tr.add-pto-row");
    expect(await others.count()).toBe(0);
    const headings = () => page.locator("tr.group-row").evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.rowKey));
    expect(await headings()).toEqual(["g:dept-03"]);
    // The row in the middle of the view growing as it's edited, then as it was: drawn again, measured, while none of those is drawn.
    const middle = await scroller(page).evaluate((el) => {
      const view = el.getBoundingClientRect();
      return document.elementFromPoint(view.left + 300, view.top + view.height / 2)!.closest("tr")!.dataset.rowKey!;
    });
    await page.locator(`tr[data-row-key="${middle}"]`).getByLabel("Description").focus();
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.press("Shift+Enter");
    await settled(page);
    await page.keyboard.press("Escape");
    await page.locator(".table-search").focus();
    await settled(page);
    expect(await others.count()).toBe(0);
    expect(await headings()).toEqual(["g:dept-03"]);
    const same = async () => {
      const [drawn, all] = [await departmentHeights(page), await departmentHeights(whole)];
      expect(Math.max(...drawn.map((h, i) => Math.abs(h - all[i]))), `${drawn.join()} against ${all.join()}`).toBeLessThan(1);
    };
    await same();
    // Back to the comfortable density, still with only boxes drawn: the heights the compact density had are forgotten.
    for (const p of [page, whole]) await density(p, "Comfortable");
    await settled(page);
    expect(await others.count()).toBe(0);
    expect(await headings()).toEqual(["g:dept-03"]);
    await same();
  });
});

/** The fourth row with a description, by its key: which is fourth among the rows drawn can change once one has focus. */
const fourthWithDescription = async (page: Page) =>
  page.locator(`tr[data-row-key="${await dataRows(page).filter({ has: page.getByLabel("Description") }).nth(3).getAttribute("data-row-key")}"]`);

test("a row being edited stays drawn and keeps what's typed, scrolled away and back", async ({ page, github: _ }) => {
  const row = await fourthWithDescription(page);
  const title = await titleOf(row);
  const description = row.getByLabel("Description");
  await description.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Not saved yet.");
  const field = await description.elementHandle();
  await scrollTo(page, 0.9);
  await expect.poll(() => onScreen(page).then((rows) => rows.join())).not.toContain(title);
  expect(await field!.evaluate((el) => el.isConnected && el === document.activeElement)).toBe(true);
  await scrollTo(page, 0);
  await page.keyboard.press("Enter");
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await expect(description).toHaveValue(/ Not saved yet\./);
});

test("an edit draws again only the row it's in: a box's title, a PTO entry's note", async ({ page, github: _ }) => {
  /** The rows drawn again as this is done, by key. */
  const drawnAgain = async (edit: () => Promise<void>) => {
    await page.evaluate(() => (window.__boxopsTest = { ...window.__boxopsTest, renders: {} }));
    await edit();
    await settled(page);
    return page.evaluate(() => Object.keys(window.__boxopsTest!.renders!));
  };
  const box = page.locator("tr.box-row").nth(2);
  const boxKey = await box.getAttribute("data-row-key");
  const title = box.getByLabel("Title");
  await title.focus();
  expect(
    await drawnAgain(async () => {
      await title.fill("Renamed");
      await page.keyboard.press("Enter");
      await expect(toolbar(page)).toContainText("Save · 1 change");
    }),
  ).toEqual([boxKey]);
  // Every PTO entry is made again for a change to anyone's, but a row is drawn again only for its own.
  await centre(page, "dept-01", 0.8);
  await settled(page);
  const pto = page.locator("tr.pto-table-row").nth(3);
  const ptoKey = await pto.getAttribute("data-row-key");
  const note = pto.getByLabel("PTO note");
  await note.focus();
  expect(await page.locator("tr.pto-table-row").count()).toBeGreaterThan(5);
  expect(
    await drawnAgain(async () => {
      await note.fill("Dentist");
      await page.keyboard.press("Enter");
      await expect(toolbar(page)).toContainText("Save · 2 changes");
    }),
  ).toEqual([ptoKey]);
});

test("the window losing focus lets go of nothing: a row scrolled away keeps focus, and one edited out stays", async ({ page, github: _ }) => {
  const description = (await fourthWithDescription(page)).getByLabel("Description");
  await description.click();
  const field = await description.elementHandle();
  await scrollTo(page, 0.9);
  await settled(page);
  await windowBlur(page);
  await settled(page);
  expect(await field!.evaluate((el) => el.isConnected && el === document.activeElement)).toBe(true);
  // Back in the window, the table stays where it was scrolled to.
  const top = await scroller(page).evaluate((el) => el.scrollTop);
  await windowBlur(page, true);
  await settled(page);
  expect(await scroller(page).evaluate((el) => el.scrollTop)).toBe(top);

  // A row edited into the finished, with those hidden: still there, saying so, until focus goes elsewhere.
  await scrollTo(page, 0);
  await page.getByRole("switch", { name: /Hide finished boxes/ }).check();
  const row = page.locator('[data-dept-id="dept-01"] tr.box-row').nth(1);
  const title = await titleOf(row);
  const edited = page.locator("tr.box-row").filter({ has: page.locator(`input[aria-label="Title"][value="${title}"]`) });
  await row.getByLabel("End").fill("2026-09-04");
  await edited.getByLabel("Start").fill("2026-08-03");
  await expect(edited.locator(".held-note")).toBeVisible();
  await windowBlur(page);
  await settled(page);
  expect(await edited.locator(".held-note").count()).toBe(1);
  await expect(edited.getByLabel("Start")).toBeFocused();
  await page.locator(".table-search").focus();
  await expect(edited).toHaveCount(0);
});

test("Tab and Shift+Tab go on to the next row and back, from a row scrolled away, clear of the sticky header and column", async ({ page, github: _ }) => {
  const rows = page.locator("tr.box-row");
  const next = await titleOf(rows.nth(6));
  await rows.nth(5).getByLabel("Description").focus();
  await scrollTo(page, 0.8);
  await page.keyboard.press("Tab");
  // WebKit's Tab skips the Delete button, as Safari's does by default; the others stop on it first.
  if (await page.locator(".row-delete:focus").count()) await page.keyboard.press("Tab");
  const focused = page.locator(':focus[aria-label="Title"]');
  await expect(focused).toHaveValue(next);
  await expect.poll(() => placeIn(focused)).toEqual({ clear: true });
  // Shift+Tab back into the row before, scrolled away again; the description there is clear of the title column too.
  await scrollTo(page, 0);
  await scroller(page).evaluate((el) => (el.scrollLeft = 0));
  await page.keyboard.press("Shift+Tab");
  if (await page.locator(".row-delete:focus").count()) await page.keyboard.press("Shift+Tab");
  await expect(page.locator(':focus[aria-label="Description"]')).toHaveCount(1);
  await expect.poll(() => placeIn(page.locator(":focus"))).toEqual({ clear: true });
});

/**
 * Under the header, the heading of the department the rows at the top of the view are in, stuck there though it's far
 * above (drawn all the same), covering the rows that scroll under it; and the first row with data clear of it.
 */
const stuckHeading = (page: Page) =>
  scroller(page).evaluate((el) => {
    // The header's cells stick, not the header: where it is is as far down the view as it's tall.
    const head = el.getBoundingClientRect().top + el.querySelector("thead")!.getBoundingClientRect().height;
    const left = el.getBoundingClientRect().left + 120;
    const stuck = document.elementFromPoint(left, head + 5)?.closest("tr");
    const below = stuck && document.elementFromPoint(left, stuck.querySelector("td")!.getBoundingClientRect().bottom + 5)?.closest("tr");
    return {
      stuck: !!stuck?.classList.contains("group-row"),
      name: stuck?.querySelector(".dept-name")?.textContent,
      same: !!below && below.closest("tbody") === stuck!.closest("tbody"),
      // The row itself is above the view, where it is among the rows; its cell is stuck under the header.
      above: !!stuck && stuck.getBoundingClientRect().top < head - 1 && Math.abs(stuck.querySelector("td")!.getBoundingClientRect().top - head) < 1,
    };
  });

test("the department the rows at the top belong to says so: its heading sticks under the header, drawn though it's far above", async ({ page, github: _ }) => {
  const names = new Set<string>();
  for (const y of [0.15, 0.4, 0.65, 0.9]) {
    await scrollTo(page, y);
    await settled(page);
    const at = await stuckHeading(page);
    expect(at, `scrolled ${y} of the way`).toMatchObject({ stuck: true, same: true, above: true });
    names.add(at.name!);
  }
  expect(names.size).toBeGreaterThan(2);
  // Focus in a row scrolled under it is scrolled clear of it.
  await scrollTo(page, 0.5);
  await settled(page);
  const under = await scroller(page).evaluate((el) => {
    const head = el.getBoundingClientRect().top + el.querySelector("thead")!.getBoundingClientRect().height;
    const row = [...el.querySelectorAll<HTMLElement>("tr.box-row")].find((r) => r.getBoundingClientRect().top > head && r.getBoundingClientRect().top < head + 30);
    return row?.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.value ?? null;
  });
  if (under) {
    const field = page.locator(`tr.box-row input[aria-label="Title"][value="${under}"]`);
    await field.focus();
    await expect.poll(() => placeIn(field)).toEqual({ clear: true });
  }
});

test("a row moved to another department takes focus with it, and is shown there", async ({ page, github: _ }) => {
  const row = page.locator("tr.box-row").nth(2);
  const title = await titleOf(row);
  const lane = row.getByLabel("Lane");
  // Every lane of every department: listed once the select is used.
  await expect(lane.locator("option")).toHaveCount(1);
  await choose(lane, "dept-09-3");
  const focused = page.locator(':focus[aria-label="Lane"]');
  await expect(focused).toHaveValue("dept-09-3");
  await expect(focused.locator("xpath=ancestor::tr").getByLabel("Title")).toHaveValue(title);
  await expect(focused.locator("xpath=ancestor::tbody")).toHaveAttribute("data-dept-id", "dept-09");
  await expect.poll(() => placeIn(focused)).toEqual({ clear: true });
});

test("a row being edited keeps its place and stays shown until focus leaves it; a new sort puts it in its place", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: /^Start/ }).click();
  const first = page.locator('[data-dept-id="dept-01"] tr.box-row');
  const titles = () => first.evaluateAll((rows) => rows.slice(0, 4).map((r) => (r.querySelector('[aria-label="Title"]') as HTMLInputElement).value));
  const before = await titles();
  // The first box starts a year later: it would sort last, but stays first while it has focus.
  const start = first.first().getByLabel("Start");
  await start.fill("2027-10-04");
  await expect(start).toBeFocused();
  expect(await titles()).toEqual(before);
  await first.first().getByLabel("End").focus(); // still in the row
  expect(await titles()).toEqual(before);
  // Focus elsewhere: it goes where it sorts.
  await first.nth(2).getByLabel("Title").focus();
  await expect.poll(titles).toEqual([...before.slice(1), expect.any(String)]);

  // A search: a title changed so it no longer matches stays, saying so, until focus leaves it.
  await first.first().getByLabel("Title").fill("Zebra crossing");
  await page.keyboard.press("Enter");
  await page.locator(".table-search").fill("zebra");
  await expect(page.locator("tr.box-row")).toHaveCount(1);
  await page.locator("tr.box-row").getByLabel("Title").fill("Something else");
  await page.keyboard.press("Enter");
  await expect(page.locator("tr.box-row")).toHaveCount(1);
  await expect(page.locator("tr.box-row .held-note")).toBeVisible();
  await page.locator(".table-search").focus();
  await expect(page.locator("tr.box-row")).toHaveCount(0);
});

test("a sort button clicked lets go of the row being edited, for good", async ({ page, github: _ }) => {
  await page.getByLabel("From date").fill("2026-10-05");
  const row = page.locator('[data-dept-id="dept-01"] tr.box-row').nth(1);
  const title = await titleOf(row);
  const edited = page.locator("tr.box-row").filter({ has: page.locator(`input[aria-label="Title"][value="${title}"]`) });
  await row.getByLabel("End").fill("2026-09-04");
  await expect(edited.locator(".held-note")).toBeVisible();
  // (Chromium and Firefox focus the button; WebKit, like Safari, doesn't.)
  await page.getByRole("button", { name: /^Start/ }).click();
  await expect(edited).toHaveCount(0);
  // The table drawn again for some other reason (scrolled away and back): still gone.
  for (const y of [0.5, 0]) {
    await scrollTo(page, y);
    await settled(page);
  }
  expect(await page.locator(".held-note").count()).toBe(0);
  expect(await edited.count()).toBe(0);
});

test("a row edited out of the dates or into the finished stays, saying so, until focus leaves it", async ({ page, github: _ }) => {
  await page.getByRole("switch", { name: /Hide finished boxes/ }).check();
  await page.getByLabel("From date").fill("2026-10-05");
  const rows = page.locator('[data-dept-id="dept-02"] tr.box-row');
  await page.locator('[data-dept-id="dept-02"]').evaluate((el) => el.scrollIntoView());
  const row = rows.nth(1);
  const title = await titleOf(row);
  const edited = page.locator("tr.box-row").filter({ has: page.locator(`input[aria-label="Title"][value="${title}"]`) });
  // It ended last month now: before the dates, and finished.
  await row.getByLabel("Start").fill("2026-08-03");
  await edited.getByLabel("End").fill("2026-09-04");
  await expect(edited.getByLabel("End")).toBeFocused();
  await expect(edited.locator(".held-note")).toBeVisible();
  // The note isn't only seen: a screen reader hears it.
  await expect.poll(() => heard(page)).toContain("Doesn’t match the search or filters: hidden once you leave this row.");
  // Leaving it, it goes.
  await rows.first().getByLabel("Title").focus();
  await expect(edited).toHaveCount(0);
  await page.getByLabel("From date").fill("");
  // (New dates show the table from the top: back to the department.)
  await page.locator('[data-dept-id="dept-02"]').evaluate((el) => el.scrollIntoView());
  await settled(page);
  await expect(rows.first()).toBeVisible();
  expect(await edited.count()).toBe(0);
  await page.getByRole("switch", { name: /Hide finished boxes/ }).uncheck();
  await expect(edited).toHaveCount(1);
});

test("Add box, with the table scrolled to the end, a department collapsed and dates set: shown, scrolled to and focused", async ({ page, github: _ }) => {
  await page.locator(".group-toggle", { hasText: "Data 1" }).click();
  await page.getByLabel("From date").fill("2027-06-01");
  await scrollTo(page, 1);
  await page.getByRole("button", { name: "Add box" }).click();
  const title = page.locator(':focus[aria-label="Title"]');
  await expect(title).toHaveValue("New box");
  await expect(page.getByLabel("From date")).toHaveValue("");
  await expect(page.locator(".group-toggle", { hasText: "Data 1" })).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => placeIn(title)).toEqual({ clear: true });
  await page.keyboard.type("Hiring plan");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Lane");
  await expect(page.locator(':focus[aria-label="Lane"]').locator("xpath=ancestor::tr").getByLabel("Title")).toHaveValue("Hiring plan");
});

test("Add PTO with finished PTO hidden: the new week off is shown, scrolled to and focused, and stays shown", async ({ page, github: _ }) => {
  await page.getByRole("switch", { name: /Hide finished boxes/ }).check();
  await scrollTo(page, 1);
  const add = page.locator('[data-dept-id="dept-12"]').getByRole("button", { name: "Add PTO" });
  await add.click();
  // This week's Monday to Friday, already over on the tests' Saturday.
  const engineer = page.locator(':focus[aria-label="Engineer"]');
  await expect(engineer).toHaveCount(1);
  const row = page.locator(`tr[data-row-key="${await engineer.evaluate((el) => el.closest("tr")!.dataset.rowKey)}"]`);
  await expect(row.getByLabel("PTO start")).toHaveValue("2026-09-28");
  await expect.poll(() => placeIn(engineer)).toEqual({ clear: true });

  // Added this session, it stays shown: given a note and to someone else, and after the timeline and back.
  await row.getByLabel("PTO note").fill("Dentist");
  await page.keyboard.press("Enter");
  const other = people.filter((p) => p.department === "dept-12").toSorted((a, b) => a.name.localeCompare(b.name))[1];
  await choose(row.getByLabel("Engineer"), other.id);
  await expect(row.getByLabel("Engineer")).toHaveValue(other.id);
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.locator(".box-table")).toBeVisible();
  await scrollTo(page, 1);
  const kept = page.locator('[data-dept-id="dept-12"] tr.pto-table-row').filter({ has: page.locator('input[aria-label="PTO note"][value="Dentist"]') });
  await expect(kept).toHaveCount(1);
  await expect(kept.getByLabel("Engineer")).toHaveValue(other.id);
  await expect(kept.getByLabel("PTO end")).toHaveValue("2026-10-02");
});

test("deleting a row from the keyboard puts focus on the next row's Delete", async ({ page, github: _ }) => {
  const rows = page.locator('[data-dept-id="dept-03"] tr.box-row');
  await page.locator('[data-dept-id="dept-03"]').evaluate((el) => el.scrollIntoView());
  const next = await titleOf(rows.nth(1));
  await rows.first().locator(".row-delete").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".row-delete:focus")).toHaveAttribute("aria-label", `Delete ${next}`);
});

test("a PTO entry given to someone else keeps focus and its place; deleting one puts focus on the next row's Delete", async ({ page, github: _ }) => {
  await page.locator(".table-search").fill(someone.name);
  const rows = page.locator(`[data-dept-id="${someone.department}"] tr.pto-table-row`);
  const starts = () => rows.getByLabel("PTO start").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  await expect(rows).toHaveCount(someone.pto.length);
  const before = await starts();
  await rows.first().getByRole("button", { name: `Delete PTO for ${someone.name}` }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(starts).toEqual(before.slice(1));
  const deleteButton = page.locator(".row-delete:focus");
  await expect(deleteButton).toHaveAttribute("aria-label", `Delete PTO for ${someone.name}`);
  await expect(deleteButton.locator("xpath=ancestor::tr").getByLabel("PTO start")).toHaveValue(before[1]);

  // Given to someone else in the department: no longer matching the search, it stays, saying so, with focus.
  const other = people.find((p) => p.department === someone.department && p.name !== someone.name)!;
  await choose(rows.first().getByLabel("Engineer"), other.id);
  const engineer = page.locator(':focus[aria-label="Engineer"]');
  await expect(engineer).toHaveValue(other.id);
  await expect(engineer.locator("xpath=ancestor::tr").getByLabel("PTO start")).toHaveValue(before[1]);
  await expect(engineer.locator("xpath=ancestor::tr").locator(".held-note")).toBeVisible();
  await page.locator(".table-search").focus();
  await expect.poll(starts).toEqual(before.slice(2));
});

test("the search finds PTO by its dates", async ({ page, github: _ }) => {
  const { start, end } = someone.pto[0];
  await page.locator(".table-search").fill(start);
  const row = page.locator("tr.pto-table-row").filter({ has: page.locator(`select[aria-label="Engineer"] option[value="${someone.id}"]:checked`) });
  await expect(row.getByLabel("PTO start").first()).toHaveValue(start);
  await page.locator(".table-search").fill(end);
  await expect(row.getByLabel("PTO end").first()).toHaveValue(end);
});

test("Hide finished boxes and PTO hides PTO that's over, and shows it again", async ({ page, github: _ }) => {
  await page.locator(".table-search").fill(someone.name);
  const rows = page.locator(`[data-dept-id="${someone.department}"] tr.pto-table-row`);
  await expect(rows).toHaveCount(someone.pto.length);
  const ends = () => rows.getByLabel("PTO end").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  const all = await ends();
  await page.getByRole("switch", { name: "Hide finished boxes and PTO" }).check();
  await expect.poll(ends).toEqual(all.filter((end) => end >= "2026-10-03"));
  await page.getByRole("switch", { name: "Hide finished boxes and PTO" }).uncheck();
  await expect.poll(ends).toEqual(all);
});

test("the header's sort buttons, focused, tabbed to or clicked, leave the table scrolled where it was", async ({ page, github: _, browserName }) => {
  await scrollTo(page, 0.4);
  await settled(page);
  const top = () => scroller(page).evaluate((el) => el.scrollTop);
  const at = await top();
  for (const name of ["Title", "Department / lane", "Start", "End", "FTE"]) {
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).focus();
    expect(await top(), name).toBe(at);
  }
  // (WebKit's Tab skips buttons, as Safari's does by default.)
  if (browserName !== "webkit") {
    await page.getByRole("button", { name: /^Title/ }).focus();
    for (const name of ["Department / lane", "Start", "End"]) {
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus")).toHaveText(new RegExp(`^${name}`));
      expect(await top(), name).toBe(at);
    }
  }
  // A new sort: other rows where they were, rather than the view following the row that was at its top.
  const shown = await onScreen(page);
  await page.getByRole("button", { name: /^FTE/ }).click();
  await expect(page.locator("th.col-fte")).toHaveAttribute("aria-sort", "ascending");
  await expect.poll(() => onScreen(page)).not.toEqual(shown);
  await settled(page);
  expect(await top()).toBe(at);
});

test("a new search or new dates show their rows from the top; hiding finished rows keeps the view in place", async ({ page, github: _ }) => {
  const top = () => scroller(page).evaluate((el) => el.scrollTop);
  const first = async () => (await onScreen(page))[0];
  const scrolledDown = async () => {
    await scrollTo(page, 0.6);
    await settled(page);
    expect(await top()).toBeGreaterThan(0);
  };
  // Typed while scrolled down: the first match at the top, not the rows that happened to be where the view was.
  await scrolledDown();
  await page.locator(".table-search").fill("pto");
  await expect.poll(top).toBe(0);
  await expect.poll(first).toMatch(/^2 /);
  // Only PTO matches: that's said, not just that no box does (nor is that shown under its rows).
  const pto = people.reduce((n, p) => n + p.pto.length, 0);
  await expect.poll(() => heard(page)).toContain(`No boxes match “pto”; ${pto} PTO entries match.`);
  await expect(page.locator(".table-view p.empty")).toHaveCount(0);
  await scrolledDown();
  await page.locator(".table-search").fill("");
  await expect.poll(top).toBe(0);
  // Dates set and cleared, the same.
  await scrolledDown();
  await page.getByLabel("From date").fill("2026-11-02");
  await expect.poll(top).toBe(0);
  await expect.poll(first).toMatch(/^2 /);
  await scrolledDown();
  await page.getByRole("button", { name: "Clear dates" }).click();
  await expect.poll(top).toBe(0);

  // Hiding finished boxes takes rows away above the view: the heading at its top stays there.
  await page.locator('[data-dept-id="dept-07"]').evaluate((el) => el.scrollIntoView());
  await settled(page);
  const heading = page.locator('[data-dept-id="dept-07"] tr.group-row');
  const at = () => heading.evaluate((el) => Math.round(el.getBoundingClientRect().top - el.closest(".table-scroll")!.getBoundingClientRect().top));
  const was = await at();
  const scrolled = await top();
  await page.getByRole("switch", { name: "Hide finished boxes and PTO" }).check();
  await expect.poll(top).toBeLessThan(scrolled);
  await settled(page);
  await expect.poll(async () => Math.abs((await at()) - was)).toBeLessThanOrEqual(2);
});

test("rows above the view getting shorter (compact density) leave the row at its top where it was", async ({ page, github: _ }) => {
  await scrollTo(page, 0.5);
  await settled(page);
  // How far a row is below the sticky header (the toolbars above get shorter too).
  const below = (row: Element) => {
    const view = row.closest(".table-scroll")!;
    return row.getBoundingClientRect().top - view.getBoundingClientRect().top - view.querySelector("thead")!.getBoundingClientRect().height;
  };
  // The row at the top of the view.
  const key = await scroller(page).evaluate((el) => {
    const y = el.getBoundingClientRect().top + el.querySelector("thead")!.getBoundingClientRect().height + 1;
    return [...el.querySelectorAll<HTMLElement>("tbody tr[data-row-key]")].find((r) => r.getBoundingClientRect().bottom > y)!.dataset.rowKey!;
  });
  const row = page.locator(`tr[data-row-key="${key}"]`);
  const before = await row.evaluate(below);
  const boxHeight = () => page.locator("tr.box-row").first().evaluate((r) => r.getBoundingClientRect().height);
  const comfortable = await boxHeight();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog", { name: "Settings" }).getByRole("group", { name: "Density" }).getByRole("button", { name: "Compact" }).click();
  await page.keyboard.press("Escape");
  await expect.poll(boxHeight).toBeLessThan(comfortable);
  await settled(page);
  await expect.poll(async () => Math.abs((await row.evaluate(below)) - before)).toBeLessThanOrEqual(2);
});

test("the row at the top of the view sorted elsewhere by an edit: the view stays, not following it", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: /^Title/ }).click();
  await scrollTo(page, 0.5);
  await settled(page);
  /** How far a row is below the sticky header. */
  const below = (row: Element) => {
    const view = row.closest(".table-scroll")!;
    return row.getBoundingClientRect().top - view.getBoundingClientRect().top - view.querySelector("thead")!.getBoundingClientRect().height;
  };
  // A box on screen with a box above it in its department (a new first title sorts it there), and the row after it.
  const [key, next] = await scroller(page).evaluate((el) => {
    const top = el.getBoundingClientRect().top + el.querySelector("thead")!.getBoundingClientRect().height;
    const row = [...el.querySelectorAll<HTMLElement>("tr.box-row")].find(
      (r) => r.getBoundingClientRect().top > top + 100 && r.previousElementSibling?.matches("tr.box-row") && r.nextElementSibling?.matches("tr[data-row-key]"),
    )!;
    return [row.dataset.rowKey!, (row.nextElementSibling as HTMLElement).dataset.rowKey!];
  });
  const row = page.locator(`tr[data-row-key="${key}"]`);
  await row.getByLabel("Title").fill("Aaa first");
  await page.keyboard.press("Enter");
  // Still where it was while it's being edited; then scrolled till it's the row at the top, partly under the header.
  await scroller(page).evaluate((el, by) => (el.scrollTop += by), (await row.evaluate(below)) + 10);
  await settled(page);
  const after = page.locator(`tr[data-row-key="${next}"]`);
  const was = await after.evaluate(below);
  // Focus leaves it: it goes to the top of its department, out of sight above. The row after it stays put.
  await page.locator(".table-toolbar .hint").click();
  await expect.poll(() => row.evaluate((r) => r.nextElementSibling?.getAttribute("data-row-key")).catch(() => null)).not.toBe(next);
  await settled(page);
  await expect.poll(async () => Math.abs((await after.evaluate(below)) - was)).toBeLessThanOrEqual(2);
});

test("printing gives every row as shown, and leaves focus where it was", async ({ page, github: _, browserName }) => {
  const count = Number(await page.locator(".box-table").getAttribute("aria-rowcount"));
  await page.locator("tr.box-row").first().getByLabel("Title").focus();
  await page.emulateMedia({ media: "print" });
  // Every row but the add buttons' (Add PTO in each department, Add department).
  await expect(page.locator(".print-table tbody tr")).toHaveCount(count - 1 - 12 - 1);
  await expect(page.locator(".print-table")).toBeVisible();
  await expect(page.locator(".print-table tbody tr").nth(1)).toContainText(/\d{4}-\d{2}-\d{2}\s*\d{4}-\d{2}-\d{2}/);
  // The pages are as wide and long as the rows printed: the table on screen, which focus is kept in, takes no room.
  expect(await pastPrintTable(page)).toEqual({ across: 0, down: 0 });
  await page.emulateMedia({ media: "screen" });
  await expect(page.locator(".print-table")).toHaveCount(0);
  // (Playwright's Firefox drops focus whenever it emulates a medium, on any page.)
  if (browserName !== "firefox") await expect(page.locator(':focus[aria-label="Title"]')).toHaveCount(1);
});

test("on paper, a date is never broken across lines, however narrow the page", async ({ page, github: _ }) => {
  /** How many lines each element's text takes. */
  const lines = (els: Element[]) =>
    els.map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map((c) => Math.round(c.top))).size;
    });
  // About A4's width, upright.
  await page.setViewportSize({ width: 720, height: 900 });
  await page.emulateMedia({ media: "print" });
  // (Drawn once the page hears it's printing: wait for that.)
  await expect(page.locator(".print-table tbody tr").first()).toBeVisible();
  // Boxes' and PTO's start and end: the 4th and 5th columns.
  const table = await page.locator(".print-table tbody tr:not(.print-group) td:is(:nth-child(4), :nth-child(5))").evaluateAll(lines);
  expect(table.length).toBeGreaterThan(100);
  expect(table.filter((n) => n !== 1)).toEqual([]);
  // People's PTO, listed in a column of its own.
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "People", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-table .print-date").first()).toBeVisible();
  const people = await page.locator(".print-table .print-date").evaluateAll(lines);
  expect(people.length).toBeGreaterThan(100);
  expect(people.filter((n) => n !== 1)).toEqual([]);
});

test.describe("People", () => {
  test.use({ virtualize: true });
  const person = (page: Page, name: string) => page.locator("tr.person-row").filter({ has: page.locator(`input[aria-label="Name"][value="${name}"]`) });

  test.beforeEach(async ({ page }) => {
    await page.getByRole("button", { name: "People", exact: true }).click();
    await expect(page.locator(".people-table")).toBeVisible();
  });

  test("only rows near the screen are drawn, each one counted; PTO past two entries is \"+N more\"", async ({ page }) => {
    const table = page.locator(".people-table");
    await expect(table).toHaveAttribute("aria-rowcount", String(120 + 12 + 1 + 1));
    expect(await dataRows(page).count()).toBeLessThan(60);
    await scrollTo(page, 1);
    await expect(table.locator("tbody tr[aria-rowindex]").last()).toHaveAttribute("aria-rowindex", String(120 + 12 + 1 + 1));
    // Every row as tall as the next.
    const sizes = await page.locator("tr.person-row").evaluateAll((rows) => new Set(rows.map((r) => r.getBoundingClientRect().height)).size);
    expect(sizes).toBe(1);
    await scrollTo(page, 0);
    await expect(table.locator("tbody tr[aria-rowindex]").first()).toHaveAttribute("aria-rowindex", "2");
    const first = page.locator("tr.person-row").first().getByLabel("Name");
    const someone = person(page, await first.inputValue());
    const more = someone.locator(".pto-more");
    await expect(more).toHaveAccessibleName(/^\+2 more PTO for /);
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(someone.locator(".pto-list li")).toHaveCount(4);
    // Scrolled away, so it isn't drawn (focus in another row), and back: still all shown.
    await page.locator("tr.person-row").nth(6).getByLabel("Name").focus();
    await scrollTo(page, 1);
    await expect(someone).toHaveCount(0);
    await scrollTo(page, 0);
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(someone.locator(".pto-list li")).toHaveCount(4);
  });

  test("folded, PTO past two entries shows the first that hasn't finished, not the first of all, and the button", async ({ page }) => {
    // Their email has their id, which no one else's does.
    await page.getByLabel("Search engineers").fill(`${someone.id}@example.com`);
    const row = page.locator("tr.person-row");
    await expect(row).toHaveCount(1);
    const range = (t: { start: string; end: string }) => (t.start === t.end ? t.start : `${t.start} – ${t.end}`);
    const [over] = someone.pto; // in date order: the first is over
    const next = someone.pto.find((t) => t.end >= "2026-10-03")!;
    const items = row.locator(".pto-list li");
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText(range(next));
    await expect(row.locator(".pto-list")).not.toContainText(range(over));
    await expect(items.last().locator(".pto-more")).toHaveAccessibleName(`+${someone.pto.length - 1} more PTO for ${someone.name}`);
  });

  test("two new engineers in a row, the second sorted after the first, each keep their own row (#79)", async ({ page }) => {
    await scrollTo(page, 0.5);
    const add = page.getByRole("button", { name: "Add an engineer to Data 1" });
    await scrollTo(page, 0);
    await add.click();
    await page.keyboard.type("Aaron Able");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Department");
    await add.click();
    await expect(page.locator(':focus[aria-label="Name"]')).toHaveValue("New engineer");
    await page.keyboard.type("Aaron Zed");
    await page.keyboard.press("Tab");
    const department = page.locator(':focus[aria-label="Department"]');
    await expect(department.locator("xpath=ancestor::tr").getByLabel("Name")).toHaveValue("Aaron Zed");
    await choose(department, "dept-02");
    await expect(person(page, "Aaron Zed").locator("xpath=ancestor::tbody")).toHaveAttribute("data-dept-id", "dept-02");
    // Focus went with Aaron Zed to the department, and the row is on screen.
    await expect(department).toHaveValue("dept-02");
    await expect.poll(() => placeIn(department)).toEqual({ clear: true });
    await scrollTo(page, 0);
    await expect(person(page, "Aaron Able").locator("xpath=ancestor::tbody")).toHaveAttribute("data-dept-id", "dept-01");
  });

  test("Add engineer scrolls to and focuses the new row; removing one puts focus on the next one's Remove", async ({ page }) => {
    await scrollTo(page, 1);
    await page.getByRole("button", { name: "Add engineer" }).click();
    const name = page.locator(':focus[aria-label="Name"]');
    await expect(name).toHaveValue("New engineer");
    await expect.poll(() => placeIn(name)).toEqual({ clear: true });

    const rows = page.locator('[data-dept-id="dept-04"] tr.person-row');
    await page.locator('[data-dept-id="dept-04"]').evaluate((el) => el.scrollIntoView());
    const next = await rows.nth(1).getByLabel("Name").inputValue();
    page.once("dialog", (d) => d.accept());
    await rows.first().locator(".row-delete").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".row-delete:focus")).toHaveAttribute("aria-label", `Remove ${next}`);
  });

  test("the department the rows at the top belong to says so: its heading sticks under the header", async ({ page }) => {
    for (const y of [0.3, 0.7]) {
      await scrollTo(page, y);
      await settled(page);
      expect(await stuckHeading(page), `scrolled ${y} of the way`).toMatchObject({ stuck: true, same: true, above: true });
    }
  });

  test("a new search shows its matches from the top; PTO dates are searched too", async ({ page }) => {
    const top = () => scroller(page).evaluate((el) => el.scrollTop);
    await scrollTo(page, 0.6);
    await settled(page);
    expect(await top()).toBeGreaterThan(0);
    const name = people.at(-1)!.name;
    await page.getByLabel("Search engineers").fill(name);
    await expect.poll(top).toBe(0);
    await expect(page.locator("tr.person-row").first().getByLabel("Name")).toHaveValue(name);
    // Their PTO's dates are searched too.
    await page.getByLabel("Search engineers").fill(someone.pto[0].start);
    await expect(person(page, someone.name)).toHaveCount(1);
  });

  test("printing gives every engineer as shown", async ({ page }) => {
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".print-table tbody tr")).toHaveCount(120 + 12);
    await expect(page.locator(".print-table")).toBeVisible();
    expect(await pastPrintTable(page)).toEqual({ across: 0, down: 0 });
    await page.emulateMedia({ media: "screen" });
    await expect(page.locator(".print-table")).toHaveCount(0);
  });
});

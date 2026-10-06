import type { Locator, Page } from "@playwright/test";
import { DAGSTER, boxFile, expect, pastPrintTable, save, test, toolbar } from "./helpers";

const row = (page: Page, title: string) =>
  page.locator("tbody tr").filter({ has: page.locator(`input[aria-label="Title"][value="${title}"]`) });
const titles = (page: Page) =>
  page.locator('input[aria-label="Title"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

test.beforeEach(async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table" }).click();
  await expect(page.locator(".box-table")).toBeVisible();
});

test("edits cells and saves them", async ({ page, github }) => {
  await expect(page).toHaveURL(/view=table/);
  const title = row(page, "Dagster 2.x upgrade").getByLabel("Title");
  await title.fill("Dagster 2.x upgrade (phase 1)"); // the row's locator matches the old title, so…
  await page.keyboard.press("Enter"); // …press on whatever has focus

  const cdc = row(page, "CDC pipeline for orders DB").getByLabel("Title");
  await cdc.fill("SHOULD NOT SAVE");
  await page.keyboard.press("Escape");
  await expect(row(page, "CDC pipeline for orders DB")).toHaveCount(1);

  const r = row(page, "Dagster 2.x upgrade (phase 1)");
  await r.getByLabel("Flag").selectOption("blocked");
  await r.getByLabel("End").fill("2026-11-20");
  await r.getByLabel("Lane").selectOption("de-4");
  await r.getByLabel("Epic link").fill("not a url");
  await r.getByLabel("Epic link").press("Enter");
  await expect(r.getByLabel("Epic link")).toHaveAttribute("aria-invalid", "true");
  await r.getByLabel("Epic link").fill("https://example.atlassian.net/browse/DATA-7");
  await r.getByLabel("Epic link").press("Enter");
  await r.getByLabel("Tags").fill("platform, q4");
  await r.getByLabel("Tags").press("Enter");
  await r.getByLabel("FTE").selectOption("1.5");
  await expect(r.locator(".col-days")).toHaveText("50"); // working days, Sep 14 – Nov 20
  await r.getByRole("button", { name: "Engineers" }).click();
  await page.getByRole("checkbox", { name: "Alex Kim" }).click();
  await page.keyboard.press("Escape");
  await expect(r.getByRole("button", { name: "Engineers" })).toHaveText("Alex Kim");

  // A weekend end date snaps back to Friday.
  await row(page, "CDC pipeline for orders DB").getByLabel("End").fill("2027-02-28");
  await expect(row(page, "CDC pipeline for orders DB").getByLabel("End")).toHaveValue("2027-02-26");

  await page.getByRole("button", { name: "Timeline" }).click();
  await expect(page.locator(`[data-box-id="${DAGSTER}"] .box-name`)).toHaveText("Dagster 2.x upgrade (phase 1)");
  await page.getByRole("button", { name: "Table" }).click();

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toBe(
    [
      "id: bx-c93d-dagster-upgrade",
      "code: D9U",
      "title: Dagster 2.x upgrade (phase 1)",
      "lane: de-4",
      "start: 2026-09-14",
      "end: 2026-11-20",
      "type: maintenance",
      "status: blocked",
      "fte: 1.5",
      "engineers:",
      "  - alex-kim",
      "epic: https://example.atlassian.net/browse/DATA-7",
      "description: Blocked on sensor API changes.",
      "tags:",
      "  - platform",
      "  - q4",
      "",
    ].join("\n"),
  );
});

test("adds, deletes (undoably), searches and sorts", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Add box" }).click();
  await page.keyboard.type("Hiring plan");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Lane"); // focus survives the id change
  expect(await titles(page)).toContain("Hiring plan");

  const before = (await titles(page)).length;
  await row(page, "Fivetran cost review").hover();
  await row(page, "Fivetran cost review").locator(".row-delete").click();
  await expect(page.locator('input[aria-label="Title"]')).toHaveCount(before - 1);
  await page.locator(".table-toolbar .hint").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator('input[aria-label="Title"]')).toHaveCount(before);

  await page.locator(".table-search").fill("dagster");
  await expect(page.locator('input[aria-label="Title"]')).toHaveCount(1);
  await page.locator(".table-search").fill("");

  await page.getByRole("button", { name: /^Start/ }).click();
  const starts = await page.locator(".dept-group").first().getByLabel("Start").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(starts).toEqual([...starts].sort());
});

test("the search looks in every column's text: type and flag names, dates and epic links too", async ({ page, github: _ }) => {
  const search = async (text: string) => {
    await page.locator(".table-search").fill(text);
    return (await titles(page)).toSorted();
  };
  expect(await search("research")).toEqual(["Q2 platform planning", "Streaming ingestion spike"]);
  expect(await search("at risk")).toEqual(["Dagster 2.x upgrade"]);
  expect(await search("2026-10-23")).toEqual(["Dagster 2.x upgrade"]);
  expect(await search("github.com/allenfp")).toEqual(["Warehouse migration to Iceberg"]);
  // Not a flag's absence: "On track" is no flag at all.
  expect(await search("on track")).toEqual([]);
});

test("an epic link's ↗ sits beside its field, on the same line", async ({ page, github: _ }) => {
  const cell = row(page, "Warehouse migration to Iceberg").locator(".epic-cell");
  const field = (await cell.getByLabel("Epic link").boundingBox())!;
  const link = (await cell.locator(".open-link").boundingBox())!;
  expect(link.x).toBeGreaterThanOrEqual(field.x + field.width);
  expect(link.y + link.height / 2).toBeGreaterThan(field.y);
  expect(link.y + link.height / 2).toBeLessThan(field.y + field.height);
  // One line: the cell is no taller than its field, so the row is as tall as the others.
  expect((await cell.boundingBox())!.height).toBeLessThanOrEqual(field.height + 1);
});

test("a description shows two lines until it has focus, then every line; scrolled across, it goes under the titles", async ({ page, github: _ }) => {
  const first = page.locator("tr.box-row").first();
  const description = first.getByLabel("Description");
  await description.fill(`Phase one: the warehouse.\nPhase two: ${"the streaming jobs, one at a time, ".repeat(5)}\nPhase three: the dashboards.\nThen the clean-up.`);
  const size = () => description.evaluate((el) => ({ height: el.getBoundingClientRect().height, fits: el.scrollHeight <= el.clientHeight }));
  // With focus, every line shows, none cut off.
  const open = await size();
  expect(open.fits).toBe(true);
  expect(open.height).toBeGreaterThan(5 * 18);
  // Left, two lines (… says there's more), and the row is as tall as the next.
  await page.locator(".table-search").focus();
  await expect.poll(async () => (await size()).height).toBeLessThanOrEqual(2 * 18 + 10);
  const height = (row: Locator) => row.evaluate((r) => r.getBoundingClientRect().height);
  expect(await height(first)).toBe(await height(page.locator("tr.box-row").nth(1)));

  // In a narrow window, scrolled all the way across: the two lines go under the pinned title column, not over it.
  await page.setViewportSize({ width: 600, height: 700 });
  await page.locator(".table-scroll").evaluate((el) => (el.scrollLeft = el.scrollWidth));
  const covered = await first.evaluate((tr) => {
    const copy = tr.querySelector<HTMLElement>(".col-desc .grow-text")!;
    const [a, b] = [copy.getBoundingClientRect(), tr.querySelector("td.col-title")!.getBoundingClientRect()];
    const [left, right] = [Math.max(a.left, b.left), Math.min(a.right, b.right)];
    // What's drawn on top where they meet: the copy lets presses through to the field, so for a moment it doesn't.
    copy.style.pointerEvents = "auto";
    const top = document.elementFromPoint((left + right) / 2, (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2);
    copy.style.pointerEvents = "";
    return { overlap: right - left > 0, on: top?.closest("td")?.className };
  });
  expect(covered).toEqual({ overlap: true, on: "col-title" });
});

test("departments collapse, shared with the timeline", async ({ page, github: _ }) => {
  const group = (name: string) => page.locator(".group-toggle", { hasText: name });
  await expect(group("ML Platform")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('input[aria-label="Title"]')).toHaveCount(12);

  await group("Data Engineering").click();
  await expect(page.locator('input[aria-label="Title"]')).toHaveCount(4);
  await page.getByRole("button", { name: "Timeline" }).click();
  await expect(page.locator(".dept-label", { hasText: "Data Engineering" }).locator(".dept-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Table" }).click();

  await page.locator(".table-search").fill("dagster");
  await expect(group("Data Engineering")).toHaveAttribute("aria-expanded", "true");
  await expect(group("Data Engineering")).toContainText("1 of 8 boxes");
  await page.locator(".table-search").fill("");
  await expect(group("Data Engineering")).toHaveAttribute("aria-expanded", "false");

  await page.locator(".group-row", { hasText: "Analytics" }).hover();
  await page.locator(".group-row", { hasText: "Analytics" }).locator(".group-add").click();
  await page.keyboard.type("Analyst onboarding");
  await page.keyboard.press("Enter");
  await expect(row(page, "Analyst onboarding").getByLabel("Lane").locator("option:checked")).toHaveText("Analytics / FTE 1");

  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(page.locator('input[aria-label="Title"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(page.locator('input[aria-label="Title"]')).toHaveCount(16);
});

test("a date range and a Hide finished boxes switch filter the table", async ({ page, github: _ }) => {
  const titles = page.locator("tbody tr:not(.group-row) .col-title input[aria-label='Title']");
  const count = page.locator(".table-toolbar .hint");
  await expect(count).toHaveText("15 boxes");

  // Boxes overlapping 2026-12-01 – 2026-12-31.
  await page.getByLabel("From date").fill("2026-12-01");
  await page.getByLabel("To date").fill("2026-12-31");
  await expect(count).toHaveText(/^\d+ of 15 boxes$/);
  const shown = await titles.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(shown).toContain("CDC pipeline for orders DB"); // 2026-10-26 – 2027-02-26 overlaps
  for (const gone of ["Revenue mart v2", "Legacy ETL sunset", "Dagster 2.x upgrade"]) expect(shown).not.toContain(gone);
  await page.getByRole("button", { name: "Clear dates" }).click();
  await expect(count).toHaveText("15 boxes");

  // Finished = ended before today (2026-10-03): Legacy ETL sunset ended 2026-07-31.
  const legacy = page.locator("tbody tr").filter({ has: page.locator("input[value='Legacy ETL sunset']") });
  await expect(legacy).toHaveCount(1);
  await page.getByRole("switch", { name: "Hide finished boxes" }).click();
  await expect(legacy).toHaveCount(0);
  await expect(count).toHaveText(/^1[0-4] of 15 boxes$/);
  // It's the same preference as the timeline's.
  await page.getByRole("button", { name: "Timeline" }).click();
  await expect(page.locator(".box", { hasText: "Legacy ETL sunset" })).toHaveCount(0);
});

test("the calendar picks a date and closes; a click elsewhere or Esc closes it too", async ({ page, github: _ }) => {
  const calendar = page.getByRole("dialog", { name: "Choose date" });
  const from = page.getByRole("group", { name: "Dates" }).getByRole("button", { name: "Choose date" }).first();

  await from.click();
  await expect(calendar).toBeVisible();
  await expect(calendar).toContainText("Oct 2026");
  await calendar.getByRole("button", { name: "Next month" }).click();
  await calendar.getByRole("gridcell", { name: "2026-11-02, Monday" }).click();
  await expect(calendar).toHaveCount(0);
  await expect(page.getByLabel("From date")).toHaveValue("2026-11-02");

  await from.click();
  await expect(calendar.getByRole("gridcell", { name: "2026-11-02, Monday, selected" })).toHaveAttribute("aria-selected", "true");
  await page.locator(".table-toolbar .hint").click();
  await expect(calendar).toHaveCount(0);

  await from.click();
  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);
});

test("the Engineers list closes, name or not, once the table is scrolled till its button is under the header", async ({ page, github: _ }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  const button = row(page, "CDC pipeline for orders DB").getByRole("button", { name: /^Engineers/ });
  await button.click();
  const list = page.getByRole("dialog", { name: "Engineers" });
  await page.getByLabel("New engineer name").fill("Robin");
  const [head, at] = [(await page.locator(".box-table thead th").first().boundingBox())!, (await button.boundingBox())!];
  await page.locator(".table-scroll").evaluate((el, by) => (el.scrollTop += by), at.y + at.height / 2 - (head.y + head.height) + 4);
  await expect(list).toHaveCount(0);
});

test("printing gives every box, on pages no wider or longer than that", async ({ page, github: _ }) => {
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-table tbody tr").filter({ hasText: "Dagster 2.x upgrade" })).toHaveCount(1);
  expect(await pastPrintTable(page)).toEqual({ across: 0, down: 0 });
});

test("in the dark theme, the table, People and the timeline print in the light one, on white", async ({ page, github: _ }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  /** The page's and the view's backgrounds, and the colour of text in the view and the printed table. */
  const paper = (view: string) =>
    page.evaluate((view) => {
      const style = (sel: string) => getComputedStyle(document.querySelector(sel)!);
      return {
        backgrounds: [style("html").backgroundColor, style("body").backgroundColor, style(view).backgroundColor],
        text: style(view).color,
        printed: document.querySelector(".print-table td") && style(".print-table td").color,
      };
    }, view);
  const WHITE = "rgb(255, 255, 255)";
  const light = { backgrounds: [WHITE, WHITE, WHITE], text: "rgb(28, 35, 48)" };
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-table tbody tr").first()).toBeVisible();
  expect(await paper(".table-view")).toEqual({ ...light, printed: "rgb(0, 0, 0)" });
  await page.emulateMedia({ media: "screen" });
  expect((await paper(".table-view")).backgrounds[0]).toBe("rgb(15, 18, 24)"); // dark again on screen

  // (Shown before printing: WebKit can leave a view drawn as print media comes on in the theme it had.)
  await page.getByRole("button", { name: "People" }).click();
  await expect(page.locator(".people-table")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-table tbody tr").first()).toBeVisible();
  expect(await paper(".people-view")).toEqual({ ...light, printed: "rgb(0, 0, 0)" });

  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Timeline" }).click();
  await expect(page.locator(".timeline")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  expect(await paper(".timeline")).toEqual({ ...light, printed: null });
});

test("⌘S while typing in a cell saves what's being typed", async ({ page, github }) => {
  await row(page, "Dagster 2.x upgrade").getByLabel("Title").fill("Dagster 2.x upgrade (phase 1)");
  await page.keyboard.press("ControlOrMeta+s"); // still in the cell
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("title: Dagster 2.x upgrade (phase 1)\n");
  expect(github.headCommit().message.split("\n")[0]).toMatch(/^Dagster 2\.x upgrade \(phase 1\) \(DE-D9U\): renamed from/);
});

test("⌘S while typing in a people cell saves it too", async ({ page, github }) => {
  await page.getByRole("button", { name: "People" }).click();
  const name = page.locator('input[aria-label="Name"]').first();
  const before = await name.inputValue();
  await name.fill(`${before} Jr.`);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file("people.yaml")).toContain(`name: ${before} Jr.\n`);
});

import type { Page } from "@playwright/test";
import { DAGSTER, boxFile, expect, save, test, toolbar } from "./helpers";

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
  await r.getByLabel("Status").selectOption("blocked");
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
  await page.getByRole("option", { name: "Alex Kim" }).click();
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

test("a date range and a Hide completed switch filter the table", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table" }).click();
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

  // Completed = ended before today (2026-10-03): Legacy ETL sunset ended 2026-07-31.
  const legacy = page.locator("tbody tr").filter({ has: page.locator("input[value='Legacy ETL sunset']") });
  await expect(legacy).toHaveCount(1);
  await page.getByRole("switch", { name: "Hide completed" }).click();
  await expect(legacy).toHaveCount(0);
  await expect(count).toHaveText(/^1[0-4] of 15 boxes$/);
  // It's the same preference as the timeline's.
  await page.getByRole("button", { name: "Timeline" }).click();
  await expect(page.locator(".box", { hasText: "Legacy ETL sunset" })).toHaveCount(0);
});

test("the calendar picks a date and closes; a click elsewhere or Esc closes it too", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table" }).click();
  const calendar = page.getByRole("dialog", { name: "Choose a date" });
  const from = page.getByRole("group", { name: "Dates" }).getByRole("button", { name: "Pick a date" }).first();

  await from.click();
  await expect(calendar).toBeVisible();
  await expect(calendar).toContainText("Oct 2026");
  await calendar.getByRole("button", { name: "Next month" }).click();
  await calendar.getByRole("button", { name: "2026-11-02" }).click();
  await expect(calendar).toHaveCount(0);
  await expect(page.getByLabel("From date")).toHaveValue("2026-11-02");

  await from.click();
  await expect(calendar.getByRole("button", { name: "2026-11-02" })).toHaveAttribute("aria-pressed", "true");
  await page.locator(".table-toolbar .hint").click();
  await expect(calendar).toHaveCount(0);

  await from.click();
  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);
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

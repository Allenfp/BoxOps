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
  await r.getByLabel("Status").selectOption("in_progress");
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
  await expect(r.locator(".col-quarter")).toHaveText("Q3 2026 – Q4 2026");
  await r.getByRole("button", { name: "Engineers" }).click();
  await page.getByRole("option", { name: "Alex Kim" }).click();
  await page.keyboard.press("Escape");
  await expect(r.getByRole("button", { name: "Engineers" })).toHaveText("Alex Kim");

  // A weekend end date snaps back to Friday.
  await row(page, "CDC pipeline for orders DB").getByLabel("End").fill("2027-02-28");
  await expect(row(page, "CDC pipeline for orders DB").getByLabel("End")).toHaveValue("2027-02-26");

  await page.getByRole("button", { name: "Timeline" }).click();
  await expect(page.locator(`[data-box-id="${DAGSTER}"] .box-title`)).toHaveText("Dagster 2.x upgrade (phase 1)");
  await page.getByRole("button", { name: "Table" }).click();

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toBe(
    [
      "id: bx-c93d-dagster-upgrade",
      "title: Dagster 2.x upgrade (phase 1)",
      "lane: de-4",
      "start: 2026-09-14",
      "end: 2026-11-20",
      "type: maintenance",
      "status: in_progress",
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
  await page.getByRole("button", { name: "+ Add box" }).click();
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
  await expect(page.locator(".dept-label", { hasText: "Data Engineering" })).toHaveAttribute("aria-expanded", "false");
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

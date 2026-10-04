import type { Page } from "@playwright/test";
import { DAGSTER, expect, save, test, toolbar } from "./helpers";

const ptoRow = (page: Page, dept: string) => page.locator(`[data-pto-track="${dept}"]`);
const group = (page: Page, name: string) =>
  page.locator(".dept-group").filter({ has: page.locator(".dept-name", { hasText: new RegExp(`^${name}$`) }) });
const editor = (page: Page) => page.getByRole("dialog", { name: /Edit PTO/ });

test("PTO is added on the timeline, edited in its block and saved on the engineer", async ({ page, github }) => {
  const row = ptoRow(page, "data-eng");
  await row.scrollIntoViewIfNeeded();
  const r = (await row.boundingBox())!;
  await page.mouse.dblclick(r.x + r.width / 2, r.y + r.height / 2);

  // A week off for the department's first engineer, open for editing.
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByLabel("Engineer")).toHaveValue("alex-kim");
  await editor(page).getByLabel("Engineer").selectOption("sam-lee");
  await editor(page).getByLabel("Start").fill("2026-12-14");
  await editor(page).getByLabel("End").fill("2026-12-25");
  await editor(page).getByLabel("Note").fill("Holiday");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);

  const block = page.locator('[data-pto-key="sam-lee#0"]');
  await expect(block).toContainText("Sam Lee · Holiday");
  await expect(block).toHaveAttribute("title", /2026-12-14 – 2026-12-25 · 10 working days/);

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file("people.yaml")).toContain(
    "  - id: sam-lee\n    name: Sam Lee\n    department: data-eng\n    pto:\n      - start: 2026-12-14\n        end: 2026-12-25\n        note: Holiday\n",
  );
  expect(github.file("people.yaml")).not.toContain("alex-kim\n    name: Alex Kim\n    department: data-eng\n    pto");
  expect(github.headCommit().message.split("\n")[0]).toBe("PTO for Sam Lee: 2026-12-14 – 2026-12-25 (Holiday)");
});

test("PTO blocks drag like boxes, and Delete removes the selected one", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table" }).click();
  await group(page, "Analytics").getByRole("button", { name: "Add PTO" }).click();
  await page.getByRole("button", { name: "Timeline" }).click();

  const block = page.locator('[data-pto-key="morgan-chen#0"]');
  await block.scrollIntoViewIfNeeded();
  const before = await block.getAttribute("title");
  expect(before).toContain("2026-09-28 – 2026-10-02");
  const b = (await block.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 14.7 * 5, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(block).toHaveAttribute("title", /2026-10-05 – 2026-10-09/);
  await expect(editor(page)).toHaveCount(0); // a drag isn't a click

  await block.click();
  await expect(editor(page)).toBeVisible();
  await page.locator(".tl-corner").click();
  await expect(editor(page)).toHaveCount(0);
  await block.click();
  await page.keyboard.press("Escape");
  await block.click({ position: { x: 20, y: 6 } });
  await page.keyboard.press("Delete");
  await expect(block).toHaveCount(0);
  await expect(editor(page)).toHaveCount(0);
});

test("the table edits PTO; the People tab lists it and links to the block", async ({ page, github }) => {
  await page.getByRole("button", { name: "Table" }).click();
  const de = group(page, "Data Engineering");
  await de.getByRole("button", { name: "Add PTO" }).click();
  const row = de.locator(".pto-table-row");
  await expect(row).toHaveCount(1);
  await row.getByLabel("Engineer").selectOption("jordan-diaz");
  await row.getByLabel("PTO start").fill("2026-11-02");
  await row.getByLabel("PTO end").fill("2026-11-06");
  await row.getByLabel("PTO note").fill("Conference");
  await row.getByLabel("PTO note").press("Enter");
  await expect(row.locator(".col-days")).toHaveText("5");

  await page.locator(".table-search").fill("conference");
  await expect(page.locator(".pto-table-row")).toHaveCount(1);
  await page.locator(".table-search").fill("");

  await page.getByRole("button", { name: "People" }).click();
  const jordan = page.locator("tbody tr").filter({ has: page.locator('input[aria-label="Name"][value="Jordan Diaz"]') });
  await expect(jordan.locator(".col-pto")).toContainText("2026-11-02 – 2026-11-06 · Conference");
  await expect(jordan.locator(".col-pto input, .col-pto textarea")).toHaveCount(0); // read-only here
  await jordan.locator(".col-pto").getByRole("button").click();
  await expect(page).not.toHaveURL(/view=people/);
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByLabel("Note")).toHaveValue("Conference");
  await page.keyboard.press("Escape");

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file("people.yaml")).toContain(
    "  - id: jordan-diaz\n    name: Jordan Diaz\n    department: data-eng\n    pto:\n      - start: 2026-11-02\n        end: 2026-11-06\n        note: Conference\n",
  );
});

test("an engineer booked on a box during their PTO is a warning", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table" }).click();
  const de = group(page, "Data Engineering");
  await de.getByRole("button", { name: "Add PTO" }).click();
  await de.locator(".pto-table-row").getByLabel("PTO start").fill("2026-10-12");
  await de.locator(".pto-table-row").getByLabel("PTO end").fill("2026-10-16");

  await page.getByRole("button", { name: "Timeline" }).click();
  await page.locator(`[data-box-id="${DAGSTER}"]`).click();
  await page.getByRole("button", { name: "Engineers" }).click();
  await page.getByRole("option", { name: "Alex Kim" }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^\d+ warnings?$/ }).click();
  const warnings = page.getByRole("dialog", { name: /warning/ });
  await expect(warnings.locator("section", { hasText: "Booked during PTO" }).locator("li")).toHaveText([
    /Alex Kim is on PTO 2026-10-12 – 2026-10-16 but on Dagster 2.x upgrade/,
  ]);
});

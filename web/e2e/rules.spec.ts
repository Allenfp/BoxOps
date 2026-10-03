import type { Page } from "@playwright/test";
import { CDC, DAGSTER, box, boxFile, dragDays, expect, focusApp, save, test, toolbar } from "./helpers";

// Fixture codes: Dagster D9U (Sep 14 – Oct 23), CDC pipeline C4P (Oct 26 – Feb 26), both Data Engineering (DE).
const code = (page: Page, id: string) => box(page, id).locator(".box-code");
const editorFor = async (page: Page, id: string) => {
  await box(page, id).locator(".box-name").click();
  return page.getByRole("dialog", { name: /Edit/ });
};

test("every box shows its code; new boxes get a unique one; the prefix follows the department", async ({ page, github }) => {
  await expect(code(page, DAGSTER)).toHaveText("DE-D9U");
  await expect(code(page, "bx-1b8d-revenue-mart")).toHaveText("AN-R2M");

  // A new box gets a fresh, readable code.
  const lane = (await page.locator('[data-lane="an-3"]').boundingBox())!;
  await page.mouse.dblclick(740, lane.y + lane.height / 2);
  await page.keyboard.type("Hiring plan");
  await page.keyboard.press("Escape");
  const fresh = (await page.locator(".box.selected .box-code, .box:has(.box-name:text-is('Hiring plan')) .box-code").first().innerText()).trim();
  expect(fresh).toMatch(/^AN-[A-HJ-NP-Z2-9]{3}$/);
  const existing = Object.values(github.headCommit().files).map((t) => /^code: (\w+)$/m.exec(t)?.[1]);
  expect(existing).not.toContain(fresh.slice(3));

  // Moving Dagster to Analytics relabels it AN-D9U; the file keeps just D9U.
  const dialog = await editorFor(page, DAGSTER);
  await dialog.getByRole("combobox").nth(3).selectOption("an-3"); // Type, Status, FTE, Lane
  await page.keyboard.press("Escape");
  await expect(code(page, DAGSTER)).toHaveText("AN-D9U");
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toMatch(/^code: D9U$/m);

  // Table search finds boxes by code, with or without the prefix.
  await page.getByRole("button", { name: "Table" }).click();
  await page.locator(".table-search").fill("an-d9u");
  await expect(page.locator('input[aria-label="Title"]')).toHaveCount(1);
  await expect(page.locator('input[aria-label="Title"]')).toHaveValue("Dagster 2.x upgrade");
});

test("changing a department's code relabels its boxes", async ({ page, github }) => {
  await page.getByRole("button", { name: "Edit Data Engineering" }).click();
  const dialog = page.locator("dialog.dept-editor[open]");
  await dialog.getByLabel("Department code").fill("AN");
  await expect(dialog.locator(".field-error")).toContainText("Another department already uses this code");
  await dialog.getByLabel("Department code").fill("dat");
  await expect(dialog.getByLabel("Department code")).toHaveValue("DAT");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(code(page, DAGSTER)).toHaveText("DAT-D9U");
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file("departments/data-eng.yaml")).toMatch(/^code: DAT$/m);
  expect(github.file(boxFile(DAGSTER))).toMatch(/^code: D9U$/m); // box files untouched
});

test("a broken rule warns (popup, marks, list) but blocks nothing", async ({ page, github }) => {
  // Rule: Dagster finishes before CDC starts. Holds today (Oct 23 < Oct 26).
  let dialog = await editorFor(page, DAGSTER);
  await dialog.getByLabel("New rule").selectOption("before");
  await dialog.getByLabel("Add a rule with").selectOption("C4P");
  await expect(dialog.locator(".rule-list li")).toHaveCount(1);
  await expect(dialog.locator(".rule-warning")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".toast")).toHaveCount(0);

  // Drag Dagster a week later: now it ends after CDC starts.
  await dragDays(page, DAGSTER, 5);
  await expect(page.locator(".toast")).toContainText("That breaks a rule");
  await expect(page.locator(".toast")).toContainText(
    "DE-D9U Dagster 2.x upgrade should finish before DE-C4P CDC pipeline for orders DB starts, but it ends Oct 30, 2026 and the other starts Oct 26, 2026.",
  );
  await expect(box(page, DAGSTER)).toHaveClass(/rule-broken/);
  await expect(box(page, CDC)).toHaveClass(/rule-broken/);
  await page.getByRole("button", { name: "⚠ 1 rule warning" }).click();
  await expect(page.locator(".rules-list li")).toHaveCount(1);

  // From CDC's side the rule reads the other way round, and shows the warning.
  dialog = await editorFor(page, CDC);
  await expect(dialog.locator(".rule-list li.incoming")).toContainText("This box starts after DE-D9U Dagster 2.x upgrade finishes (set on DE-D9U)");
  await expect(dialog.locator(".rule-warning")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Nothing is blocked: it saves, rule and all.
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("relations:\n  - type: before\n    box: C4P\n");
  expect(github.headCommit().message).toContain("now finishes before CDC pipeline for orders DB (DE-C4P)");
});

test("removing a rule from the other box, and deleting a box, clean up rules", async ({ page, github }) => {
  for (const other of ["C4P", "W1M"]) {
    const dialog = await editorFor(page, DAGSTER);
    await dialog.getByLabel("New rule").selectOption("overlaps");
    await dialog.getByLabel("Add a rule with").selectOption(other);
    await page.keyboard.press("Escape");
  }
  // Remove the CDC rule from CDC's side.
  const dialog = await editorFor(page, CDC);
  await dialog.getByRole("button", { name: "Remove rule set on DE-D9U" }).click();
  await page.keyboard.press("Escape");
  // Delete the warehouse box: Dagster's rule pointing at it goes too.
  await box(page, "bx-a1f0-warehouse-migration").locator(".box-name").click();
  await page.getByRole("button", { name: "Delete" }).click();
  await focusApp(page);
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).not.toContain("relations");
});

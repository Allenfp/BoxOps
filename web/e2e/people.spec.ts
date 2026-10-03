import type { Page } from "@playwright/test";
import { DAGSTER, boxFile, expect, save, test, toolbar } from "./helpers";

const person = (page: Page, name: string) =>
  page.locator("tbody tr").filter({ has: page.locator(`input[aria-label="Name"][value="${name}"]`) });

test.beforeEach(async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "People" }).click();
  await expect(page.locator(".people-table")).toBeVisible();
  await expect(page).toHaveURL(/view=people/);
});

test("adds an engineer, fills in their details and saves them", async ({ page, github }) => {
  await page.locator(".group-row", { hasText: "ML Platform" }).hover();
  await page.locator(".group-row", { hasText: "ML Platform" }).locator(".group-add").click();
  await page.keyboard.type("Riley Nguyen");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Department"); // focus survives the id change

  const riley = person(page, "Riley Nguyen");
  await riley.getByLabel("Role").fill("ML Engineer");
  await riley.getByLabel("Role").press("Enter");
  await riley.getByLabel("Email").fill("riley@example");
  await riley.getByLabel("Email").press("Enter");
  await expect(riley.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  await riley.getByLabel("Email").fill("riley@example.com");
  await riley.getByLabel("Email").press("Enter");

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file("people.yaml")).toContain(
    "  - id: riley-nguyen\n    name: Riley Nguyen\n    department: ml-platform\n    role: ML Engineer\n    email: riley@example.com\n",
  );
});

test("shows each engineer's boxes and flags anyone over 1 FTE", async ({ page, github: _ }) => {
  // Assign Sam to two overlapping boxes from the box editor, then come back.
  await page.getByRole("button", { name: "Timeline" }).click();
  for (const id of [DAGSTER, "bx-a1f0-warehouse-migration"]) {
    await page.locator(`[data-box-id="${id}"] .box-title`).first().click();
    await page.getByRole("button", { name: "Engineers" }).click();
    await page.getByRole("option", { name: "Sam Lee" }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "People" }).click();
  const sam = person(page, "Sam Lee");
  await expect(sam.locator(".chip")).toHaveText(["Warehouse migration to Iceberg", "Dagster 2.x upgrade"]);
  await expect(sam.locator(".col-load")).toContainText("2 FTE Sep 14 – Oct 23, 2026");
  await expect(page.locator(".group-row", { hasText: "Data Engineering" })).toContainText("1 over 1 FTE");
});

test("removing an engineer unassigns them, and undo brings it all back", async ({ page, github }) => {
  await page.getByRole("button", { name: "Timeline" }).click();
  await page.locator(`[data-box-id="${DAGSTER}"]`).click();
  await page.getByRole("button", { name: "Engineers" }).click();
  await page.getByRole("option", { name: "Alex Kim" }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("engineers:\n  - alex-kim\n");

  await page.getByRole("button", { name: "People" }).click();
  page.once("dialog", (d) => d.accept());
  await person(page, "Alex Kim").hover();
  await person(page, "Alex Kim").locator(".row-delete").click();
  await expect(person(page, "Alex Kim")).toHaveCount(0);

  await page.locator(".table-toolbar .hint").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(person(page, "Alex Kim")).toHaveCount(1);
  await expect(toolbar(page)).toContainText("No changes");

  page.once("dialog", (d) => d.accept());
  await person(page, "Alex Kim").hover();
  await person(page, "Alex Kim").locator(".row-delete").click();
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file("people.yaml")).not.toContain("alex-kim");
  expect(github.file(boxFile(DAGSTER))).not.toContain("engineers");
});

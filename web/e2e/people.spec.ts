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

test("records a manager and wrapping notes", async ({ page, github }) => {
  const sam = person(page, "Sam Lee");
  await sam.getByLabel("Manager").fill("Dana Whitfield");
  await sam.getByLabel("Manager").press("Enter");
  const notes = sam.getByLabel("Notes");
  await notes.click();
  await page.keyboard.type("Owns the Dagster migration. Out for two weeks in December, so plan Fivetran work around that.");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Prefers async updates.");
  await page.keyboard.press("Enter");
  expect((await notes.boundingBox())!.height).toBeGreaterThan(40); // wrapped onto several lines

  await page.locator(".table-search").fill("dana");
  await expect(page.locator('input[aria-label="Name"]')).toHaveCount(1);
  await page.locator(".table-search").fill("");

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file("people.yaml")).toContain(
    "  - id: sam-lee\n    name: Sam Lee\n    department: data-eng\n    manager: Dana Whitfield\n    notes: |-\n",
  );
  expect(github.file("people.yaml")).toContain("so plan Fivetran work around that.\n      Prefers async updates.\n");
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

test("departments can be added and edited from the People tab", async ({ page, github }) => {
  await page.getByRole("button", { name: "People" }).click();
  const dialog = page.locator("dialog.dept-editor[open]");

  await page.getByRole("button", { name: "+ Add department" }).click();
  await dialog.getByLabel("Department name").fill("Platform");
  await dialog.getByRole("button", { name: "Add department" }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  const platform = page.locator(".group-row").filter({ has: page.locator(".dept-name", { hasText: /^Platform$/ }) });
  await expect(platform).toHaveCount(1);
  await expect(platform).toContainText("0 engineers");

  // Hire straight into it.
  await page.getByRole("button", { name: "Add an engineer to Platform" }).click();
  await page.keyboard.type("Robin Park");
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "Edit Analytics" }).click();
  await dialog.getByLabel("Department name").fill("Analytics & BI");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".group-row .dept-name", { hasText: "Analytics & BI" })).toHaveCount(1);

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file("departments/platform.yaml")).toContain("name: Platform\n");
  expect(github.file("departments/analytics.yaml")).toContain("name: Analytics & BI\n");
  expect(github.file("people.yaml")).toContain("  - id: robin-park\n    name: Robin Park\n    department: platform\n");
});

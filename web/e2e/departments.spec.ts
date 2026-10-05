import type { Page } from "@playwright/test";
import { DAGSTER, boxFile, expect, focusApp, save, test, toolbar } from "./helpers";

const editor = (page: Page) => page.locator("dialog.dept-editor[open]");
const deptNames = (page: Page) => page.locator(".dept-label .dept-name").allInnerTexts();

test("an editor whose department is undone away closes, and the next one still opens", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Add department" }).click();
  await editor(page).getByLabel("Department name").fill("Platform");
  await editor(page).getByRole("button", { name: "Add department" }).click();
  await editor(page).getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Edit Platform" }).click();
  await expect(editor(page).locator("h2")).toHaveText("Edit Platform");
  // ⌘Z with the focus on a button in it: Platform goes, and its editor with it.
  await editor(page).getByRole("button", { name: "Done" }).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor(page)).toHaveCount(0);
  await expect.poll(() => deptNames(page)).toEqual(["Data Engineering", "Analytics", "ML Platform"]);
  await page.getByRole("button", { name: "Add department" }).click();
  await expect(editor(page).locator("h2")).toHaveText("Add a department");
});

test("adds a department with lanes from the timeline and saves it", async ({ page, github }) => {
  await page.getByRole("button", { name: "Add department" }).click();
  await editor(page).getByLabel("Department name").fill("Platform");
  await editor(page).getByRole("button", { name: "Add department" }).click();
  await expect(editor(page).locator("h2")).toHaveText("Added Platform");

  // Two more lanes: rename one, make one half-time.
  await editor(page).getByRole("button", { name: "Add lane" }).click();
  await editor(page).getByRole("button", { name: "Add lane" }).click();
  await editor(page).getByLabel("Lane 3 name").fill("Contractor");
  await editor(page).getByLabel("Lane 3 FTE").selectOption("0.5");
  await editor(page).getByRole("button", { name: "Done" }).click();

  await expect.poll(() => deptNames(page)).toEqual(["Data Engineering", "Analytics", "ML Platform", "Platform"]);
  const platform = page.locator(".dept-label", { hasText: "Platform" }).last();
  await expect(platform).toContainText("2.5 FTE");
  await expect(page.locator('[data-lane="platform-3"]')).toHaveCount(1);
  await expect(page.locator(".lane-name", { hasText: "Contractor" })).toHaveCount(2); // Data Eng's and the new one

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file("departments/platform.yaml")).toBe(
    [
      "id: platform",
      "code: PL",
      "name: Platform",
      'color: "#e8913a"', // first colour no other department uses
      "order: 4",
      "lanes:",
      "  - id: platform-1",
      "  - id: platform-2",
      "  - id: platform-3",
      "    name: Contractor",
      "    fte: 0.5",
      "",
    ].join("\n"),
  );
  expect(github.headCommit().message).toContain("Added department Platform (3 lanes, 2.5 FTE)");
});

test("edits a department from the table: rename, recolour, reorder, add a lane", async ({ page, github }) => {
  await page.getByRole("button", { name: "Table" }).click();
  await page.getByRole("button", { name: "Edit Analytics" }).click();
  await editor(page).getByLabel("Department name").fill("Analytics & BI");
  await editor(page).getByRole("button", { name: "Colour #e8913a" }).click();
  await editor(page).getByRole("button", { name: "Move up" }).click();
  await editor(page).getByRole("button", { name: "Add lane" }).click();
  await editor(page).getByRole("button", { name: "Done" }).click();

  await expect(page.locator(".group-toggle .dept-name")).toHaveText(["Analytics & BI", "Data Engineering", "ML Platform"]);
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  const file = github.file("departments/analytics.yaml")!;
  expect(file).toContain("name: Analytics & BI\n");
  expect(file).toContain('color: "#e8913a"\n');
  expect(file).toContain("order: 1\n");
  expect(file).toContain("  - id: an-4\n");
  expect(github.file("departments/data-eng.yaml")).toContain("order: 2\n");
  const message = github.headCommit().message;
  expect(message).toContain("Renamed department Analytics to Analytics & BI");
  expect(message).toContain("Added lane FTE 4 (1 FTE) to Analytics & BI");
  expect(message).toContain("Reordered departments");
});

test("removing a lane with boxes moves them first", async ({ page, github }) => {
  await page.getByRole("button", { name: "Edit Data Engineering" }).click();
  await editor(page).getByRole("button", { name: "Remove lane 2" }).click(); // de-2: Dagster and CDC
  await expect(editor(page).locator(".remove-callout")).toContainText("2 boxes are in this lane");
  await expect(editor(page).getByRole("button", { name: "Move and remove lane" })).toBeDisabled();
  await editor(page).getByLabel("Move boxes to").selectOption("an-3");
  await editor(page).getByRole("button", { name: "Move and remove lane" }).click();
  await expect(editor(page).locator(".lane-edit-row")).toHaveCount(3);
  await editor(page).getByRole("button", { name: "Done" }).click();

  await expect(page.locator(`[data-box-id="${DAGSTER}"]`).locator("xpath=ancestor::*[@data-dept-track][1]")).toHaveAttribute(
    "data-dept-track",
    "analytics",
  );
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file("departments/data-eng.yaml")).not.toContain("de-2");
  expect(github.file(boxFile(DAGSTER))).toContain("lane: an-3\n");
});

test("deleting a department moves its boxes, and undo restores everything", async ({ page, github }) => {
  await page.getByRole("button", { name: "Edit ML Platform" }).click();
  await editor(page).getByRole("button", { name: "Delete department…" }).click();
  await expect(editor(page).locator(".remove-callout")).toContainText("Its 3 boxes will move to");
  await expect(editor(page).locator(".remove-callout")).toContainText("1 engineer in it will stay on the roster");
  await expect(editor(page).getByRole("button", { name: "Delete department", exact: true })).toBeDisabled();
  await editor(page).getByLabel("Move boxes to").selectOption("de-3");
  await editor(page).getByRole("button", { name: "Delete department", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect.poll(() => deptNames(page)).toEqual(["Data Engineering", "Analytics"]);

  await focusApp(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => deptNames(page)).toEqual(["Data Engineering", "Analytics", "ML Platform"]);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => deptNames(page)).toEqual(["Data Engineering", "Analytics"]);

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file("departments/ml-platform.yaml")).toBeUndefined();
  expect(github.file("boxes/bx-5f2b-feature-store.yaml")).toContain("lane: de-3\n");
  expect(github.file("people.yaml")).toMatch(/ {2}- id: taylor-brooks\n {4}name: Taylor Brooks\n$/); // kept, no department
  expect(github.headCommit().message).toContain("Deleted department ML Platform");
});

test("a lane can close on a date: hatched out after it, and capacity follows", async ({ page, github }) => {
  await page.getByRole("button", { name: "Edit Data Engineering" }).click();
  await expect(editor(page).getByText("Always open")).toHaveCount(4);
  await editor(page).getByRole("button", { name: "Set when lane 4 closes" }).click();
  await editor(page).getByLabel("Lane 4 closes").fill("2026-10-18"); // a Sunday: becomes Friday the 16th
  await expect(editor(page).getByLabel("Lane 4 closes")).toHaveValue("2026-10-16");
  await editor(page).getByRole("button", { name: "Done" }).click();

  const de = page.locator(".dept-label", { hasText: "Data Engineering" });
  await expect(de.locator(".dept-meta")).toHaveAttribute("title", /^3.5 FTE today/); // still open on Oct 3
  await expect(page.locator(".lane-label", { hasText: "Contractor" }).locator(".lane-dates")).toHaveText("until 2026-10-16");
  await expect(page.locator('[data-dept-track="data-eng"] .lane-closed')).toHaveCount(1);

  await page.getByRole("button", { name: "Table" }).click();
  await expect(page.locator(".dept-group").first().locator(".dept-meta").first()).toContainText("3.5 FTE today · 1 dated lane");
  await expect(page.locator('select[aria-label="Lane"] option', { hasText: "Contractor (until 2026-10-16)" }).first()).toBeAttached();

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file("departments/data-eng.yaml")).toContain("    name: Contractor\n    fte: 0.5\n    end: 2026-10-16\n");
  expect(github.headCommit().message.split("\n")[0]).toBe("Lane Contractor in Data Engineering now runs until 2026-10-16");

  // Clearing the date opens it up again.
  await page.getByRole("button", { name: "Edit Data Engineering" }).click();
  await editor(page).getByRole("button", { name: "Clear lane 4 closing date" }).click();
  await expect(editor(page).getByText("Always open")).toHaveCount(4);
});

/** Press on a heading and drag it so the pointer ends at `toY`. */
async function dragHeading(page: Page, heading: ReturnType<Page["locator"]>, toY: number) {
  const b = (await heading.boundingBox())!;
  const x = b.x + 120;
  await page.mouse.move(x, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, (b.y + b.height / 2 + toY) / 2, { steps: 4 });
  await page.mouse.move(x, toY, { steps: 4 });
}

test("departments are reordered by dragging their headings, on the timeline and in the table", async ({ page, github }) => {
  const label = (name: string) => page.locator(".dept-label", { hasText: name });
  const top = (await label("Data Engineering").boundingBox())!;

  // ML Platform (collapsed) to the top; it stays collapsed — the release isn't a click.
  await dragHeading(page, label("ML Platform"), top.y + 4);
  await expect(page.locator(".reorder-line")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".reorder-line")).toHaveCount(0);
  await expect.poll(() => deptNames(page)).toEqual(["ML Platform", "Data Engineering", "Analytics"]);
  await expect(label("ML Platform").locator(".dept-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(toolbar(page)).toContainText("1 change");

  // Esc cancels a drag.
  await dragHeading(page, label("Analytics"), top.y + 4);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => deptNames(page)).toEqual(["ML Platform", "Data Engineering", "Analytics"]);

  // A plain click still collapses.
  await label("Analytics").locator(".dept-toggle").click();
  await expect(label("Analytics").locator(".dept-toggle")).toHaveAttribute("aria-expanded", "false");

  // In the table: Analytics up above Data Engineering.
  await page.getByRole("button", { name: "Table" }).click();
  const group = (name: string) => page.locator(".group-head", { hasText: name });
  const de = (await group("Data Engineering").boundingBox())!;
  await dragHeading(page, group("Analytics"), de.y + 4);
  await page.mouse.up();
  await expect(page.locator(".group-toggle .dept-name")).toHaveText(["ML Platform", "Analytics", "Data Engineering"]);

  await focusApp(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".group-toggle .dept-name")).toHaveText(["ML Platform", "Data Engineering", "Analytics"]);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(".group-toggle .dept-name")).toHaveText(["ML Platform", "Analytics", "Data Engineering"]);

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file("departments/ml-platform.yaml")).toContain("order: 1\n");
  expect(github.file("departments/analytics.yaml")).toContain("order: 2\n");
  expect(github.file("departments/data-eng.yaml")).toContain("order: 3\n");
});

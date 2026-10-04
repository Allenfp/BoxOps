import type { Page } from "@playwright/test";
import { DAGSTER, box, expect, save, test, toolbar } from "./helpers";

const menu = (page: Page) => page.getByRole("dialog", { name: "Settings" });
const openMenu = async (page: Page) => {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(menu(page)).toBeVisible();
};
const toggle = (page: Page, name: string) => menu(page).getByRole("switch", { name });

test("what boxes show is a personal preference, remembered in this browser", async ({ page, github }) => {
  const dagster = box(page, DAGSTER);
  await expect(dagster.locator(".box-code")).toBeVisible();
  await expect(dagster.locator(".box-flag")).toHaveText("At risk");
  await expect(dagster.locator(".box-scale")).toBeVisible();

  await openMenu(page);
  await toggle(page, "Codes and Jira keys").click();
  await toggle(page, "Flags").click();
  await toggle(page, "Scale").click();
  await page.keyboard.press("Escape");
  await expect(dagster.locator(".box-code")).toHaveCount(0);
  await expect(dagster.locator(".box-flag")).toHaveCount(0);
  await expect(dagster.locator(".box-scale")).toHaveCount(0);

  await page.reload();
  await expect(box(page, DAGSTER).locator(".box-code")).toHaveCount(0);
  // Nothing about it reaches the repo.
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.head).toBe(github.root);

  await openMenu(page);
  await menu(page).getByRole("button", { name: "Reset" }).click();
  await expect(box(page, DAGSTER).locator(".box-code")).toBeVisible();
});

test("density, PTO rows, finished boxes, zoom and the opening view", async ({ page, github: _ }) => {
  const laneHeight = async () => (await page.locator(".lane-label").first().boundingBox())!.height;
  const comfortable = await laneHeight();
  await openMenu(page);
  await menu(page).getByRole("group", { name: "Density" }).getByRole("button", { name: "Compact" }).click();
  expect(await laneHeight()).toBeLessThan(comfortable);

  await expect(page.locator(".pto-row")).not.toHaveCount(0);
  await toggle(page, "Show PTO rows").click();
  await expect(page.locator(".pto-row")).toHaveCount(0);

  // Legacy ETL sunset ended 2026-07-31, before today (2026-10-03).
  const legacy = page.locator(".box", { hasText: "Legacy ETL sunset" });
  await expect(legacy).toHaveCount(1);
  await toggle(page, "Hide finished boxes").click();
  await expect(legacy).toHaveCount(0);

  await menu(page).getByLabel("Open at zoom").selectOption("quarters");
  await expect(page.getByRole("button", { name: "Quarters" })).toHaveAttribute("aria-pressed", "true");
  await menu(page).getByLabel("Open on").selectOption("table");
  await page.keyboard.press("Escape");

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".pto-table-row, .add-pto-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Timeline" }).click();
  await expect(page.getByRole("button", { name: "Quarters" })).toHaveAttribute("aria-pressed", "true");
});

test("the key and the keyboard shortcuts open from the menu", async ({ page, github: _ }) => {
  await openMenu(page);
  await menu(page).getByRole("button", { name: "Key…" }).click();
  const key = page.getByRole("dialog", { name: "Key" });
  await expect(key).toContainText("Over capacity");
  await page.keyboard.press("Escape");
  await expect(key).toHaveCount(0);

  await openMenu(page);
  await menu(page).getByRole("button", { name: "Keyboard shortcuts…" }).click();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText("Undo");
});

test("team settings are a change like any other, saved to settings.yaml for everyone", async ({ page, github }) => {
  await openMenu(page);
  await menu(page).getByRole("button", { name: "Team settings…" }).click();
  const dialog = page.getByRole("dialog", { name: "Team settings" });
  await dialog.getByLabel("Fiscal year starts in").selectOption("2");
  await dialog.getByLabel("Type 1 name").fill("Feature");
  // A type that boxes use can't be removed.
  await expect(dialog.getByRole("button", { name: "Remove Feature" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Add flag" }).click();
  await dialog.getByLabel(/^Flag \d name$/).last().fill("Needs review");
  await dialog.getByRole("button", { name: "Done" }).click();

  await expect(page.locator(".box-table, .timeline")).toBeVisible();
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await page.keyboard.press("Meta+z");
  await page.keyboard.press("Meta+Shift+z");

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  const yaml = github.file("settings.yaml");
  expect(yaml).toContain("fiscal_year_start_month: 2");
  expect(yaml).toContain("  - id: project\n    name: Feature\n");
  expect(yaml).toContain("  - id: needs_review\n    name: Needs review\n");
  expect(github.headCommit().message).toContain(
    "- Team settings: fiscal year starts in February (was January); renamed type Project to Feature; added flag Needs review\n",
  );
});

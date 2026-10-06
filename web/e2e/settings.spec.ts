import type { Page } from "@playwright/test";
import { DAGSTER, box, expect, openTab, save, test, toolbar } from "./helpers";

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
  await menu(page).getByLabel("Open at zoom").selectOption("quarters");
  await menu(page).getByRole("button", { name: "Reset" }).click();
  // The app's defaults: flags on; codes, scale and initials off; the team's zoom. Nothing is stored.
  await expect(box(page, DAGSTER).locator(".box-flag")).toHaveText("At risk");
  await expect(box(page, DAGSTER).locator(".box-code")).toHaveCount(0);
  await expect(box(page, DAGSTER).locator(".box-scale")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("boxops-prefs"))).toBeNull();
  await expect(menu(page).getByLabel("Open at zoom")).toHaveValue("");
});

test("only what you chose is stored, and a choice in another tab comes through", async ({ page, github }) => {
  await openMenu(page);
  await toggle(page, "Engineer initials").click();
  // The test setup chose codes, scale and initials; initials are off again, the default, so only two are stored.
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("boxops-prefs")))!)).toEqual({ version: 1, showCodes: true, showScale: true });

  // Another tab turns flags off: this one follows, and keeps its own choices when it next changes one.
  const other = await openTab(page.context(), github);
  await other.getByRole("button", { name: "Settings" }).click();
  await other.getByRole("dialog", { name: "Settings" }).getByRole("switch", { name: "Flags" }).click();
  await expect(box(page, DAGSTER).locator(".box-flag")).toHaveCount(0);
  await toggle(page, "Scale").click();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("boxops-prefs")))!)).toEqual({ version: 1, showCodes: true, showFlags: false });
});

test("density, PTO rows, finished boxes, zoom and the opening view", async ({ page, github: _ }) => {
  const laneHeight = async () => (await page.locator(".lane-label").first().boundingBox())!.height;
  const comfortable = await laneHeight();
  await openMenu(page);
  await menu(page).getByRole("group", { name: "Density" }).getByRole("button", { name: "Compact" }).click();
  await expect.poll(laneHeight).toBeLessThan(comfortable);

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

test("the menu's dialogs write apostrophes curly, as the rest of BoxOps does", async ({ page, github: _ }) => {
  for (const item of ["Keyboard shortcuts…", "Key…", "Team settings…"]) {
    await openMenu(page);
    await menu(page).getByRole("button", { name: item }).click();
    const dialog = page.getByRole("dialog", { name: item.slice(0, -1) });
    await expect(dialog).toBeVisible();
    const text = await dialog.innerText();
    expect(text, item).not.toMatch(/'/);
    if (item === "Keyboard shortcuts…") expect(text).toContain("department’s name");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
});

test("in team settings, a flag moved from the keyboard keeps the focus, place after place", async ({ page, github: _ }) => {
  await openMenu(page);
  await menu(page).getByRole("button", { name: "Team settings…" }).click();
  const dialog = page.getByRole("dialog", { name: "Team settings" });
  const flags = () => dialog.getByLabel(/^Flag \d name$/).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  await dialog.getByRole("button", { name: "Move At risk down" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(flags).toEqual(["Late", "At risk", "Blocked"]);
  await page.keyboard.press("Enter"); // the same button, still At risk's
  await expect.poll(flags).toEqual(["Late", "Blocked", "At risk"]);
});

test("in team settings, new flags keep rows of their own: moved place after place, one removed", async ({ page, github: _ }) => {
  await openMenu(page);
  await menu(page).getByRole("button", { name: "Team settings…" }).click();
  const dialog = page.getByRole("dialog", { name: "Team settings" });
  const flags = () => dialog.getByLabel(/^Flag \d name$/).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  // Each "New flag" starts with the id the one before had until it was renamed.
  await dialog.getByRole("button", { name: "Add flag" }).click();
  await dialog.getByLabel("Flag 4 name").fill("Waiting");
  await dialog.getByRole("button", { name: "Add flag" }).click();
  await dialog.getByLabel("Flag 5 name").fill("Parked");
  await dialog.getByRole("button", { name: "Add flag" }).click();
  await expect.poll(flags).toEqual(["At risk", "Late", "Blocked", "Waiting", "Parked", "New flag"]);

  const up = dialog.getByRole("button", { name: "Move Parked up" });
  await up.focus();
  for (const order of [
    ["At risk", "Late", "Blocked", "Parked", "Waiting", "New flag"],
    ["At risk", "Late", "Parked", "Blocked", "Waiting", "New flag"],
    ["At risk", "Parked", "Late", "Blocked", "Waiting", "New flag"],
  ]) {
    await page.keyboard.press("Enter");
    await expect.poll(flags).toEqual(order);
    await expect(up).toBeFocused();
  }

  // Remove takes its own row, and its focus doesn't pass to the next one's.
  await dialog.getByRole("button", { name: "Remove Waiting" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(flags).toEqual(["At risk", "Parked", "Late", "Blocked", "New flag"]);
  await expect(dialog.getByRole("button", { name: "Remove New flag" })).not.toBeFocused();
  const down = dialog.getByRole("button", { name: "Move Parked down" });
  await down.focus();
  await page.keyboard.press("Enter");
  await expect.poll(flags).toEqual(["At risk", "Late", "Parked", "Blocked", "New flag"]);
  await page.keyboard.press("Enter");
  await expect.poll(flags).toEqual(["At risk", "Late", "Blocked", "Parked", "New flag"]);
  await expect(down).toBeFocused();
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
  // Undo takes back the last edit (the new flag's name), and redo puts it back.
  const lastFlag = async () => {
    await openMenu(page);
    await menu(page).getByRole("button", { name: "Team settings…" }).click();
    const name = await dialog.getByLabel(/^Flag \d name$/).last().inputValue();
    await dialog.getByRole("button", { name: "Done" }).click();
    return name;
  };
  await page.keyboard.press("ControlOrMeta+z");
  expect(await lastFlag()).toBe("New flag");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await lastFlag()).toBe("Needs review");

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

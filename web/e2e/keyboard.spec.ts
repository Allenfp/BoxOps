import { DAGSTER, box, dragDays, expect, save, test } from "./helpers";

// Working by keyboard: where focus goes, and what keys do. WebKit's Tab, like
// Safari's by default, skips buttons and links unless they have a tabindex,
// so tests start from a focused element and check where focus lands.

test("the first Tab reaches “Skip to roadmap”, which moves focus to the roadmap", async ({ page, github: _ }) => {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to roadmap" })).toBeFocused();
  await expect(page.getByRole("link", { name: "Skip to roadmap" })).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  expect(page.url()).not.toContain("#main");
});

// Dialogs and menus: named, starting somewhere useful (never the Close button), closed by Escape,
// and handing focus back to what opened them, or the nearest thing that's still there.

test("the settings menu opened from the keyboard starts on its first control; Escape goes back to the gear", async ({ page, github: _ }) => {
  const gear = page.getByRole("button", { name: "Settings", exact: true });
  await gear.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("dialog", { name: "Settings" });
  await expect(menu.getByRole("button", { name: "Light" })).toBeFocused();
  await expect(gear).toHaveAttribute("aria-controls", (await menu.getAttribute("id"))!);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(gear).toBeFocused();
});

test("dialogs from the gear menu are named, start on themselves or their first field, and give focus back to the gear", async ({ page, github: _ }) => {
  const gear = page.getByRole("button", { name: "Settings", exact: true });
  for (const [item, name] of [
    ["Keyboard shortcuts…", "Keyboard shortcuts"],
    ["Key…", "Key"],
  ]) {
    await gear.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: item }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name, exact: true });
    await expect(dialog).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(gear).toBeFocused();
  }

  await gear.click();
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Team settings…" }).click();
  const team = page.getByRole("dialog", { name: "Team settings" });
  await expect(team.getByLabel("Roadmap title")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(team).toHaveCount(0);
  await expect(gear).toBeFocused();
});

test("the box editor keeps Tab inside, and Escape puts focus back on the box", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: "Edit Dagster 2.x upgrade" });
  await expect(editor).toHaveAttribute("aria-modal", "true");
  await expect(editor.getByRole("textbox", { name: "Title" })).toBeFocused();
  // Round from the first control to the last and back, buttons included, whatever Safari's Tab setting.
  await page.keyboard.press("Shift+Tab");
  await expect(editor.getByRole("button", { name: "Delete" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(editor.getByRole("textbox", { name: "Title" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(editor.getByRole("button", { name: "Close" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(box(page, DAGSTER)).toBeFocused();
});

test("the PTO editor starts on whose time off it is, and Escape puts focus back on the block", async ({ page, github: _ }) => {
  const add = page.getByRole("button", { name: "Add PTO in Data Engineering" });
  await add.focus();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: /^Edit PTO for / });
  await expect(editor.getByLabel("Engineer")).toBeFocused();
  const who = await editor.getByLabel("Engineer").inputValue();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(page.locator(`[data-pto-key="${who}#0"]`)).toBeFocused();
});

test("the department editor is named, and gives focus back to its ✎", async ({ page, github: _ }) => {
  const edit = page.getByRole("button", { name: "Edit Analytics" });
  await edit.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Edit Analytics" });
  await expect(dialog.getByLabel("Department name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
});

test.describe("signed out", () => {
  test.use({ signedIn: false });

  test("the save dialog is named and described, starts in the token field, and Escape goes back to Save", async ({ page, github: _ }) => {
    await dragDays(page, DAGSTER, 5);
    const saveButton = page.getByRole("button", { name: "Save · 1 change" });
    await saveButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Connect to GitHub to save" });
    await expect(dialog).toHaveAccessibleDescription(/^Saving writes your changes straight to main of acme\/roadmap/);
    await expect(dialog.getByRole("textbox", { name: "GitHub token", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(saveButton).toBeFocused();
  });
});

test("a failed save opens on Try again, with the reason as the dialog's description", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 5);
  github.inject("graphql", "rules");
  await save(page);
  const dialog = page.getByRole("dialog", { name: "GitHub’s rules blocked this save" });
  await expect(dialog.getByRole("button", { name: "Try again" })).toBeFocused();
  await expect(dialog).toHaveAccessibleDescription(/^GitHub’s rules for main blocked this save/);
});

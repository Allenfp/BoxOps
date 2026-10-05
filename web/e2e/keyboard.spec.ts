import { CDC, DAGSTER, box, dragDays, expect, focusApp, said, save, test, toolbar } from "./helpers";

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

test("a click away from the box editor closes it and leaves focus where the click put it", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  await page.locator(".tl-corner").click();
  await expect(page.getByRole("dialog", { name: /^Edit / })).toHaveCount(0);
  await page.waitForTimeout(100); // past the frame focus would have been put back in
  await expect(box(page, DAGSTER)).not.toBeFocused();
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

test("the Engineers list: its button says who's on the box; arrows, Space and Escape work it", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: "Edit Dagster 2.x upgrade" });
  await editor.getByRole("button", { name: "Engineers: unassigned" }).focus();
  await page.keyboard.press("Enter");
  const list = editor.getByRole("dialog", { name: "Engineers" });
  await expect(list.getByRole("group", { name: "Assigned engineers" })).toBeVisible();
  await expect(list.getByRole("checkbox", { name: "Alex Kim" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(list.getByRole("checkbox", { name: "Jordan Diaz" })).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await expect(list.getByRole("checkbox", { name: "Jordan Diaz" })).toBeChecked();
  await expect(list.getByRole("checkbox", { name: "Alex Kim" })).toBeChecked();
  await page.keyboard.press("Escape"); // closes the list, not the editor
  await expect(list).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "Engineers: Jordan Diaz, Alex Kim" })).toBeFocused();
  await expect(editor.getByRole("button", { name: "Engineers: Jordan Diaz, Alex Kim" })).toHaveText("Jordan Diaz, Alex Kim");

  // Enter closes it too, from the list, which opens on the first one ticked.
  await page.keyboard.press("Enter");
  await expect(list.getByRole("checkbox", { name: "Alex Kim" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(list).toHaveCount(0);
  await expect(editor.getByRole("button", { name: /^Engineers: / })).toBeFocused();
});

// Focus is never dropped on the page: after an action removes or disables what had it, it goes somewhere sensible.

test("Save from the keyboard: the button keeps focus while saving, then the saved banner has it", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 5);
  github.inject("graphql", "hang");
  const saveButton = page.getByRole("button", { name: "Save · 1 change" });
  await saveButton.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => github.calls("graphql")).toBe(1);
  await expect(page.getByRole("button", { name: "Saving…" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Saving…" })).toHaveAttribute("aria-disabled", "true");
  await page.clock.fastForward(31_000);
  await expect(page.locator(".banner.success [data-saved]")).toBeFocused();
  // Its Dismiss takes the banner, and focus goes to the roadmap rather than the page.
  await page.locator(".banner.success").getByRole("button", { name: "Dismiss" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".banner.success")).toHaveCount(0);
  await expect(page.getByRole("main")).toBeFocused();
});

test("in the table: Enter and Esc leave focus in the cell, and ⌘S there gives it back after saving", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const title = page.locator('input[aria-label="Title"][value="Dagster 2.x upgrade"]');
  await title.fill("Dagster 2.x upgrade (phase 1)");
  await page.keyboard.press("Enter");
  const cell = page.locator('input[aria-label="Title"]:focus');
  await expect(cell).toHaveValue("Dagster 2.x upgrade (phase 1)");
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await page.keyboard.type(" and more");
  await page.keyboard.press("Escape");
  await expect(cell).toHaveValue("Dagster 2.x upgrade (phase 1)");
  // Tab goes on to the next cell in the row, not back to the top of the page.
  await page.keyboard.press("Tab");
  await expect(page.locator('select[aria-label="Lane"]:focus')).toHaveCount(1);

  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("ArrowRight"); // to the end of the text Tab selected
  await page.keyboard.type("!");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(toolbar(page)).toContainText("No changes");
  await expect(page.locator('input[aria-label="Title"]:focus')).toHaveValue("Dagster 2.x upgrade (phase 1)!");
});

test("a date picked from the calendar leaves focus in its field", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("group", { name: "Dates" }).getByRole("button", { name: "Pick a date" }).first().click();
  await page.getByRole("dialog", { name: "Choose a date" }).getByRole("button", { name: "2026-10-12" }).click();
  await expect(page.getByLabel("From date")).toHaveValue("2026-10-12");
  await expect(page.getByLabel("From date")).toBeFocused();
});

test("deleting a table row puts focus on the next row's Delete; deleting from an editor, on the next box or block", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "Delete Dagster 2.x upgrade" }).click();
  await expect(page.getByRole("button", { name: "Delete CDC pipeline for orders DB" })).toBeFocused();

  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await box(page, CDC).click();
  await page.getByRole("dialog", { name: /^Edit / }).getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".box:focus")).toHaveCount(1);
  await expect.poll(() => said(page)).toContainEqual(expect.stringMatching(/^Deleted “CDC pipeline for orders DB”\. Undo with (⌘|Ctrl\+)Z\./));

  await page.getByRole("button", { name: "Add PTO in Data Engineering" }).click();
  await page.getByRole("dialog", { name: /^Edit PTO/ }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: "Add PTO in Data Engineering" })).toBeFocused();
});

test("renaming a lane leaves focus on its name, after Enter and after Esc", async ({ page, github: _ }) => {
  const name = page.locator(".lane-label .lane-name").nth(1);
  await name.click();
  await page.keyboard.type("Platform team");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lane-label .lane-name").nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Nope");
  await page.keyboard.press("Escape");
  await expect(page.locator(".lane-label .lane-name").nth(1)).toBeFocused();
  await expect(page.locator(".lane-label .lane-name").nth(1)).toContainText("Platform team");
});

test("removing a rule or a lane puts focus on the next one's ✕, else the one before's, else Add; a lane's date, on its +", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /^Edit / });
  await editor.getByRole("button", { name: "Rule", exact: true }).click();
  for (const other of ["C4P", "W1M"]) await editor.getByLabel("Add a rule with").selectOption(other);
  const remove = editor.getByRole("button", { name: "Remove rule" });
  await expect(remove).toHaveCount(2);
  await remove.first().focus();
  await page.keyboard.press("Enter");
  await expect(remove).toHaveCount(1);
  await expect(remove).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(remove).toHaveCount(0);
  await expect(editor.getByLabel("Add a rule with")).toBeFocused(); // the section stays
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Edit Data Engineering" }).click();
  const dialog = page.locator("dialog.dept-editor[open]");
  await dialog.getByRole("button", { name: "Remove lane 2" }).click();
  await dialog.getByLabel("Move boxes to").selectOption("an-3");
  await dialog.getByRole("button", { name: "Move and remove lane" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.locator(".lane-edit-row")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: "Remove lane 2" })).toBeFocused(); // the lane that was after it
  await dialog.getByRole("button", { name: "Add lane" }).click();
  await dialog.getByRole("button", { name: "Remove lane 4" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.locator(".lane-edit-row")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: "Remove lane 3" })).toBeFocused();

  await dialog.getByRole("button", { name: "Set when lane 1 opens" }).click();
  await dialog.getByLabel("Lane 1 opens").fill("2026-11-02");
  await dialog.getByRole("button", { name: "Clear lane 1 opening date" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Set when lane 1 opens" })).toBeFocused();
});

test("the broken-rule popup stays while focus is in it, and its Dismiss puts focus on the roadmap", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /^Edit / });
  await editor.getByRole("button", { name: "Rule", exact: true }).click();
  await editor.getByLabel("New rule").selectOption("before");
  await editor.getByLabel("Add a rule with").selectOption("C4P");
  await page.keyboard.press("Escape");
  const toast = page.locator(".toast");
  // Left alone, it goes after 10 s.
  await dragDays(page, DAGSTER, 5);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(11_000);
  await expect(toast).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await dragDays(page, DAGSTER, 5);
  await toast.getByRole("button", { name: "Dismiss" }).focus();
  await page.clock.fastForward(11_000);
  await expect(toast).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(toast).toHaveCount(0);
  await expect(page.getByRole("main")).toBeFocused();
});

test("a banner that goes while focus is elsewhere leaves focus alone", async ({ page, github: _ }) => {
  await dragDays(page, DAGSTER, 5);
  await save(page);
  const banner = page.locator(".banner.success");
  await expect(banner.locator("[data-saved]")).toBeFocused();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  // A click, as WebKit makes one: the button doesn't take focus.
  await banner.getByRole("button", { name: "Dismiss" }).dispatchEvent("click");
  await expect(banner).toHaveCount(0);
  await page.waitForTimeout(100); // past the frame focus would have been moved in
  await expect(page.getByRole("main")).not.toBeFocused();
});

test("a save that didn't go through doesn't leave its cell to send focus to after a later one", async ({ page, github }) => {
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.locator('input[aria-label="Title"][value="Dagster 2.x upgrade"]').fill("Dagster 2.x upgrade (phase 1)");
  github.inject("graphql", "rules");
  await page.keyboard.press("ControlOrMeta+s"); // from the cell
  const dialog = page.getByRole("dialog", { name: "GitHub’s rules blocked this save" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Save clicked as WebKit clicks: focus stays on the page.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.locator("[data-save-button]").dispatchEvent("click");
  await expect(toolbar(page)).toContainText("No changes");
  await expect(page.locator(".banner.success [data-saved]")).toBeFocused();
});

test("a department picked from the warnings gets focus", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: /^\d+ warnings?$/ }).click();
  await page.getByRole("dialog", { name: /warning/ }).getByRole("button", { name: /^Data Engineering: / }).click();
  await expect(page.locator('[data-dept-id="data-eng"] .dept-toggle')).toBeFocused();
});

// Shortcuts: only where they're meant, labelled for the platform, and matched whatever the keyboard layout.

test("Backspace and Delete never delete the box or PTO being edited", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /^Edit / });
  // Focus on the page itself, after a click on the editor's text…
  await editor.getByRole("heading", { name: "Schedule" }).click();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  // …or on one of its buttons.
  await editor.getByRole("button", { name: /^Engineers/ }).focus();
  await page.keyboard.press("Delete");
  await expect(editor).toBeVisible();
  await expect(box(page, DAGSTER)).toHaveCount(1);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Add PTO in Data Engineering" }).focus();
  await page.keyboard.press("Enter");
  const pto = page.getByRole("dialog", { name: /^Edit PTO/ });
  await pto.locator(".editor-foot .hint").click();
  await page.keyboard.press("Backspace");
  await expect(pto).toBeVisible();
  await expect(page.locator(".pto-block")).toHaveCount(1);
});

test("undo and save don't act behind a dialog or an open menu", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 5);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await page.getByRole("button", { name: "Keyboard shortcuts…" }).click();
  await page.keyboard.press("ControlOrMeta+z");
  // ⌘S saves nothing, nor opens the browser's Save Page.
  await page.evaluate(() => window.addEventListener("keydown", (e) => ((window as { taken?: boolean }).taken = e.defaultPrevented)));
  await page.keyboard.press("ControlOrMeta+s");
  expect(await page.evaluate(() => (window as { taken?: boolean }).taken)).toBe(true);
  await expect(toolbar(page)).toContainText("Save · 1 change");
  expect(github.calls("graphql")).toBe(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(toolbar(page)).toContainText("No changes");
});

test("in a table cell, ⌘Z after Enter undoes the edit; once something's typed, it's the field's", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.locator('input[aria-label="Title"][value="Dagster 2.x upgrade"]').fill("Dagster 2.x upgrade (phase 1)");
  await page.keyboard.press("Enter");
  const cell = page.locator('input[aria-label="Title"]:focus');
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(cell).toHaveValue("Dagster 2.x upgrade");
  await expect(toolbar(page)).toContainText("No changes");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(cell).toHaveValue("Dagster 2.x upgrade (phase 1)");
  await expect(toolbar(page)).toContainText("Save · 1 change");

  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.keyboard.press("ControlOrMeta+z"); // the field's own undo, whatever it does: the edit stays
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await expect(cell).not.toHaveValue("Dagster 2.x upgrade");
});

test("⌘Z and ⌘S work from a keyboard that doesn't type Latin letters (by the key's place)", async ({ page, github: _ }) => {
  await dragDays(page, DAGSTER, 5);
  await focusApp(page);
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "я", code: "KeyZ", ctrlKey: true, bubbles: true })));
  await expect(toolbar(page)).toContainText("No changes");
  const taken = await page.evaluate(() => !document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ы", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true })));
  expect(taken).toBe(true);
});

test("shortcuts are labelled ⌘ on Apple's platforms and Ctrl elsewhere, in tooltips and the list", async ({ page, github: _ }) => {
  // As the app tells: by the platform the browser reports (a Chromium made to look like Windows says Windows).
  const apple = await page.evaluate(() =>
    /mac|iphone|ipad/i.test((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform),
  );
  const [save, undo, redo] = apple ? ["⌘S", "⌘Z", "⇧⌘Z"] : ["Ctrl+S", "Ctrl+Z", "Ctrl+Shift+Z"];
  await expect(toolbar(page).getByRole("button", { name: "Undo" })).toHaveAttribute("title", `Undo (${undo})`);
  await expect(toolbar(page).getByRole("button", { name: "Redo" })).toHaveAttribute("title", `Redo (${redo})`);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Keyboard shortcuts…" }).click();
  const list = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(list.getByRole("table", { name: "Anywhere" }).getByRole("rowheader")).toHaveText([save, undo, `${redo}  or  ${apple ? "⌘Y" : "Ctrl+Y"}`, "Esc"]);
  await expect(list).not.toContainText(apple ? "Ctrl+" : "⌘");
});

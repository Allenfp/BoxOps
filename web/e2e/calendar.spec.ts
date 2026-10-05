import type { Locator, Page } from "@playwright/test";
import { DAGSTER, box, expect, heard, test, toolbar } from "./helpers";

// Date fields (DateInput.tsx): the calendar, an APG date-picker dialog (its
// button, keys, names, and where focus goes), Escape closing it alone, and
// typing in the field: clearing an optional date, and text that can't be a
// date. Today is Saturday 2026-10-03; Dagster 2.x upgrade runs 2026-09-14 –
// 2026-10-23.

const calendar = (page: Page) => page.getByRole("dialog", { name: "Choose date" });
const day = (page: Page, name: string) => calendar(page).getByRole("gridcell", { name, exact: true });
const focusedDay = (page: Page) => calendar(page).locator("td:focus");
/** Whether the day with focus shows the keyboard's ring. */
const ring = (page: Page) => focusedDay(page).evaluate((el) => el.matches(":focus-visible"));
const row = (page: Page, title: string) =>
  page.locator("tbody tr").filter({ has: page.locator(`input[aria-label="Title"][value="${title}"]`) });

/** Dagster's box editor, opened. */
async function editDagster(page: Page): Promise<Locator> {
  await box(page, DAGSTER).click();
  return page.getByRole("dialog", { name: /^Edit Dagster/ });
}

/** Dagster's editor with the calendar open on its start, focus on 2026-09-14. */
async function openStart(page: Page): Promise<Locator> {
  const editor = await editDagster(page);
  await editor.getByRole("button", { name: "Choose date" }).first().click();
  await expect(day(page, "2026-09-14, Monday, selected")).toBeFocused();
  return editor;
}

/** Press each key in turn; after each, the day with focus is named as given. */
async function walk(page: Page, steps: [key: string, name: string][]) {
  for (const [key, name] of steps) {
    await page.keyboard.press(key);
    await expect(focusedDay(page), `after ${key}`).toHaveAccessibleName(name);
  }
}

test("the button beside a date is “Choose date”, says the date, and opens the calendar on it", async ({ page, github: _ }) => {
  const editor = await editDagster(page);
  // The field is named by its label alone, not the button's name too.
  await expect(editor.getByRole("textbox", { name: "Start", exact: true })).toHaveValue("2026-09-14");
  const choose = editor.getByRole("button", { name: "Choose date" }).first();
  await expect(choose).toHaveAccessibleDescription("2026-09-14, Monday");
  await expect(choose).toHaveAttribute("aria-haspopup", "dialog");
  await expect(choose).toHaveAttribute("aria-expanded", "false");

  await choose.click();
  await expect(choose).toHaveAttribute("aria-expanded", "true");
  await expect(calendar(page)).toHaveAttribute("aria-modal", "true");
  const grid = calendar(page).getByRole("grid", { name: "Sep 2026" });
  await expect(grid).toBeVisible();
  await expect(calendar(page).getByRole("heading", { name: "Sep 2026" })).toHaveAttribute("aria-live", "polite");
  await expect(grid.getByRole("columnheader")).toHaveText(["MMonday", "TTuesday", "WWednesday", "TThursday", "FFriday", "SSaturday", "SSunday"]);
  await expect(grid.getByRole("columnheader").first()).toHaveAccessibleName("Monday");
  // The field's date has focus, and is the grid's one Tab stop.
  const selected = day(page, "2026-09-14, Monday, selected");
  await expect(selected).toBeFocused();
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await expect(grid.locator('[tabindex="0"]')).toHaveCount(1);
  await expect(grid.getByRole("gridcell", { name: /^2026-09-/ })).toHaveCount(30);
});

test("in the calendar, ← → move a working day, ↑ ↓ a week, Home and End to Monday and Friday", async ({ page, github: _ }) => {
  await openStart(page);
  await walk(page, [
    ["ArrowRight", "2026-09-15, Tuesday"],
    ["ArrowLeft", "2026-09-14, Monday, selected"],
    ["ArrowLeft", "2026-09-11, Friday"], // over the weekend
    ["ArrowRight", "2026-09-14, Monday, selected"],
    ["ArrowDown", "2026-09-21, Monday"],
    ["End", "2026-09-25, Friday"],
    ["ArrowUp", "2026-09-18, Friday"],
    ["Home", "2026-09-14, Monday, selected"],
  ]);
  await expect(calendar(page).locator('td[tabindex="0"]')).toHaveCount(1);
  expect(await ring(page)).toBe(true); // a key moved it (opened by a click, it had none)
});

test("Page Up and Page Down change the month, with Shift the year, and the heading follows", async ({ page, github: _ }) => {
  await openStart(page);
  const heading = calendar(page).getByRole("heading");
  await walk(page, [["ArrowLeft", "2026-09-11, Friday"]]);
  await walk(page, [["PageDown", "2026-10-12, Monday"]]); // 2026-10-11 is a Sunday
  await expect(heading).toHaveText("Oct 2026");
  await walk(page, [["Shift+PageDown", "2027-10-12, Tuesday"]]);
  await expect(heading).toHaveText("Oct 2027");
  await walk(page, [["Shift+PageUp", "2026-10-12, Monday"]]);
  await walk(page, [["PageUp", "2026-09-11, Friday"]]); // 2026-09-12 is a Saturday
  await expect(heading).toHaveText("Sep 2026");
  // Arrows into another month show it too.
  await walk(page, [
    ["ArrowDown", "2026-09-18, Friday"],
    ["ArrowDown", "2026-09-25, Friday"],
    ["ArrowDown", "2026-10-02, Friday"],
  ]);
  await expect(heading).toHaveText("Oct 2026");
  await expect(calendar(page).getByRole("grid", { name: "Oct 2026" })).toBeVisible();
});

test("the month buttons show the month before or after, and focus stays in the calendar", async ({ page, github: _ }) => {
  await openStart(page);
  const heading = calendar(page).getByRole("heading");
  // From the keyboard: the button keeps focus, and the day with the Tab stop moves with the month.
  await page.keyboard.press("Shift+Tab");
  const next = calendar(page).getByRole("button", { name: "Next month" });
  await expect(next).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(heading).toHaveText("Oct 2026");
  await expect(next).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(focusedDay(page)).toHaveAccessibleName("2026-10-14, Wednesday");
  // Clicked: focus is on the button, or (WebKit, which gives a clicked button none) the day.
  await calendar(page).getByRole("button", { name: "Previous month" }).click();
  await expect(heading).toHaveText("Sep 2026");
  await expect(calendar(page).locator(":focus")).toHaveCount(1);
  await expect(calendar(page).locator('td[tabindex="0"]')).toHaveAccessibleName("2026-09-14, Monday, selected");
});

test("Tab goes round the calendar's controls, Today's button too, and never out of it", async ({ page, github: _ }) => {
  await openStart(page);
  const today = calendar(page).getByRole("button", { name: "Next working day, 2026-10-05" });
  const previous = calendar(page).getByRole("button", { name: "Previous month" });
  const next = calendar(page).getByRole("button", { name: "Next month" });
  const selected = day(page, "2026-09-14, Monday, selected");
  for (const [key, to] of [
    ["Tab", today],
    ["Tab", previous],
    ["Tab", next],
    ["Tab", selected],
    ["Shift+Tab", next],
    ["Shift+Tab", previous],
    ["Shift+Tab", today],
    ["Shift+Tab", selected],
  ] as const) {
    await page.keyboard.press(key);
    await expect(to, `after ${key}`).toBeFocused();
  }
});

test("Enter or Space picks the day: the calendar closes, focus is back on its button, the editor stays", async ({ page, github: _ }) => {
  const editor = await openStart(page);
  const start = editor.getByRole("textbox", { name: "Start", exact: true });
  const choose = editor.getByRole("button", { name: "Choose date" }).first();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(calendar(page)).toHaveCount(0);
  await expect(start).toHaveValue("2026-09-15");
  await expect(choose).toBeFocused();
  await expect(choose).toHaveAccessibleDescription("2026-09-15, Tuesday");
  await expect(choose).toHaveAttribute("aria-expanded", "false");

  // Enter on the button opens it again; Space picks, once (the key coming up on the button opens nothing).
  await page.keyboard.press("Enter");
  await expect(day(page, "2026-09-15, Tuesday, selected")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press(" ");
  await expect(start).toHaveValue("2026-09-16");
  await expect(calendar(page)).toHaveCount(0);
  await expect(choose).toBeFocused();
  await expect(editor).toBeVisible();
  await expect(toolbar(page)).toContainText("Save · 1 change");

  // A click on a day picks it too.
  await choose.click();
  await day(page, "2026-09-22, Tuesday").click();
  await expect(start).toHaveValue("2026-09-22");
  await expect(calendar(page)).toHaveCount(0);
  await expect(choose).toBeFocused();
});

test("weekends show but can't be picked; today is said, and at a weekend Today picks the next working day", async ({ page, github: _ }) => {
  const editor = await openStart(page);
  await walk(page, [["PageDown", "2026-10-14, Wednesday"]]);
  const saturday = day(page, "2026-10-03, Saturday, today");
  await expect(saturday).toHaveAttribute("aria-current", "date");
  await expect(saturday).toHaveAttribute("aria-disabled", "true");
  // Oct 2026's 9 weekend days, none a Tab stop.
  await expect(calendar(page).locator('[aria-disabled="true"]')).toHaveCount(9);
  await expect(calendar(page).locator('[aria-disabled="true"][tabindex]')).toHaveCount(0);
  // A click on one does nothing, and leaves focus where it was.
  await day(page, "2026-10-10, Saturday").click({ force: true });
  await expect(calendar(page)).toBeVisible();
  await expect(focusedDay(page)).toHaveAccessibleName("2026-10-14, Wednesday");

  await calendar(page).getByRole("button", { name: "Next working day, 2026-10-05" }).click();
  await expect(calendar(page)).toHaveCount(0);
  await expect(editor.getByRole("textbox", { name: "Start", exact: true })).toHaveValue("2026-10-05");
});

test("Escape closes the calendar alone: not the box editor, the PTO editor, nor the department editor", async ({ page, github: _ }) => {
  // The box editor closes on Escape pressed anywhere.
  const editor = await openStart(page);
  const choose = editor.getByRole("button", { name: "Choose date" }).first();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await expect(calendar(page)).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("textbox", { name: "Start", exact: true })).toHaveValue("2026-09-14"); // nothing picked
  await expect(choose).toBeFocused();
  await expect(toolbar(page)).toContainText("No changes");
  await page.keyboard.press("Escape"); // and then the editor, as ever
  await expect(editor).toHaveCount(0);

  await page.getByRole("button", { name: "Add PTO in Data Engineering" }).click();
  const pto = page.getByRole("dialog", { name: /^Edit PTO/ });
  await pto.getByRole("button", { name: "Choose date" }).first().click();
  await expect(calendar(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(calendar(page)).toHaveCount(0);
  await expect(pto).toBeVisible();
  await expect(pto.getByRole("button", { name: "Choose date" }).first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pto).toHaveCount(0);

  // A native modal dialog, which Escape cancels unless that's prevented: opened from the field
  // with Option/Alt+↓, the calendar gives focus back to the field.
  await page.getByRole("button", { name: "Edit Data Engineering" }).click();
  const dept = page.getByRole("dialog", { name: "Edit Data Engineering" });
  await dept.getByRole("button", { name: "Until (set when lane 4 closes)" }).click();
  const until = dept.getByRole("textbox", { name: "Until (lane 4 closes)" });
  await expect(until).toBeFocused();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(day(page, "2026-10-05, Monday")).toBeFocused(); // no date yet: the next working day
  await page.keyboard.press("Escape");
  await expect(calendar(page)).toHaveCount(0);
  await expect(dept).toBeVisible();
  await expect(until).toBeFocused();
  // So does Escape putting back what's typed.
  await until.pressSequentially("2026-1");
  await page.keyboard.press("Escape");
  await expect(until).toHaveValue("");
  await expect(dept).toBeVisible();
});

test("in a table row, Option/Alt+↓ in a date opens the calendar, and focus comes back to the field", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const dagster = row(page, "Dagster 2.x upgrade");
  const start = dagster.getByRole("textbox", { name: "Start", exact: true });
  // Two more Tab stops a row would be too many: the field's keys open it.
  await expect(dagster.getByRole("button", { name: "Choose date" }).first()).toHaveAttribute("tabindex", "-1");
  await expect(start).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowDown");
  await start.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(day(page, "2026-09-14, Monday, selected")).toBeFocused();
  expect(await ring(page)).toBe(true); // opened by a key: shown at once
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(calendar(page)).toHaveCount(0);
  await expect(start).toHaveValue("2026-09-21");
  await expect(start).toBeFocused();

  await page.keyboard.press("Alt+ArrowDown");
  await expect(day(page, "2026-09-21, Monday, selected")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(calendar(page)).toHaveCount(0);
  await expect(start).toBeFocused();
  await expect(start).toHaveValue("2026-09-21");
});

test("typing: clearing an optional date's text clears it, the table's filter too, and text that can't be a date says why", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const count = page.locator(".table-toolbar .hint");
  const from = page.getByRole("textbox", { name: "From date" });
  await from.fill("2026-12-01");
  await expect(count).toHaveText(/^\d+ of 15 boxes$/);
  // Deleting the text clears the date at once, and it stays cleared once focus leaves.
  await from.fill("");
  await expect(count).toHaveText("15 boxes");
  await from.blur();
  await expect(from).toHaveValue("");
  await expect(count).toHaveText("15 boxes");

  // Half a date is fine while it's typed; what can't become one says why, under the field and tied to it.
  await from.fill("2026-1");
  await expect(from).not.toHaveAttribute("aria-invalid", /./);
  await from.fill("2026-13-01");
  await expect(from).toHaveAttribute("aria-invalid", "true");
  await expect(from).toHaveAccessibleDescription(/^2026-13-01 isn’t a date\. /);
  await expect.poll(() => heard(page)).toContain("2026-13-01 isn’t a date.");
  await from.fill("12/01/2026");
  await expect(from).toHaveAccessibleDescription(/^Dates are written YYYY-MM-DD\. /);
  await expect(page.locator(".table-toolbar").getByText("Dates are written YYYY-MM-DD.")).toBeVisible();
  await expect(count).toHaveText("15 boxes");
  // Leaving the field puts back what it had, and says so.
  await from.blur();
  await expect(from).toHaveValue("");
  await expect(from).not.toHaveAttribute("aria-invalid", /./);
  await expect(page.locator(".table-toolbar").getByText("Dates are written YYYY-MM-DD.")).toHaveCount(0);
  await expect.poll(() => heard(page)).toContain("“12/01/2026” isn’t a date, so the field is back to empty.");

  // The calendar's Clear does what deleting the text does; Tab reaches it.
  await from.fill("2026-12-01");
  await expect(count).toHaveText(/^\d+ of 15 boxes$/);
  const choose = page.getByRole("group", { name: "Dates" }).getByRole("button", { name: "Choose date" }).first();
  await choose.click();
  await expect(day(page, "2026-12-01, Tuesday, selected")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(calendar(page).getByRole("button", { name: "Clear" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(calendar(page)).toHaveCount(0);
  await expect(from).toHaveValue("");
  await expect(count).toHaveText("15 boxes");
  await expect(choose).toBeFocused();

  // A box's date can't be left out: deleted, its text comes back.
  const start = row(page, "Dagster 2.x upgrade").getByRole("textbox", { name: "Start", exact: true });
  await start.fill("");
  await start.blur();
  await expect(start).toHaveValue("2026-09-14");
  await expect.poll(() => heard(page)).toContain("A date is needed here, so the field is back to 2026-09-14.");
  await expect(toolbar(page)).toContainText("No changes");
});

test("a lane's date is cleared by deleting its text, or with the calendar's Clear", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Edit Data Engineering" }).click();
  const dept = page.getByRole("dialog", { name: "Edit Data Engineering" });
  await expect(dept.getByText("Always open")).toHaveCount(4);
  await dept.getByRole("button", { name: "Until (set when lane 4 closes)" }).click();
  const until = dept.getByRole("textbox", { name: "Until (lane 4 closes)" });
  await until.fill("2026-10-16");
  await expect(dept.getByText("Always open")).toHaveCount(3);
  await until.fill("");
  await expect(dept.getByText("Always open")).toHaveCount(4);
  await expect(until).toBeFocused(); // the field stays, empty, while it's being typed in
  await expect(toolbar(page)).toContainText("No changes");

  await until.fill("2026-10-16");
  await page.keyboard.press("Alt+ArrowDown");
  await calendar(page).getByRole("button", { name: "Clear" }).click();
  await expect(until).toHaveValue("");
  await expect(until).toBeFocused();
  await expect(dept.getByText("Always open")).toHaveCount(4);
});

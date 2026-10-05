import type { Page } from "@playwright/test";
import { CDC, DAGSTER, box, boxDates, boxFile, expect, heard, pollNow, said, test, toolbar } from "./helpers";

// Moving a box or PTO block from the keyboard: Space picks it up, the arrow
// keys move it (only what's drawn), Enter or Space drops it as one change,
// Escape or ⌘Z puts it back. Each step is said, with what it would do.

const dragDates = (page: Page) => page.locator(".drag-dates");
/** The last thing said to screen readers. */
const lastSaid = async (page: Page) => (await said(page)).at(-1) ?? "";
/** What was said last ends with `text` (messages asked for together are read together). */
const saysLast = (page: Page, text: string) =>
  expect.poll(() => lastSaid(page)).toMatch(new RegExp(`${text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`));
async function press(page: Page, ...keys: string[]) {
  for (const k of keys) await page.keyboard.press(k);
}

test("Space picks a box up; ← → move it a working day, Shift a week; Enter drops it, one change", async ({ page, github: _ }) => {
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Space");
  await expect.poll(() => lastSaid(page)).toMatch(
    /^Moving Dagster 2\.x upgrade, 2026-09-14 to 2026-10-23\. Left and Right move it a working day, Shift for a week\. (Option|Alt) with Left or Right changes the end date\. Up and Down change the lane\. Enter to drop, Escape to cancel\.$/,
  );
  await expect(box(page, DAGSTER)).toHaveClass(/dragging/);
  await expect(dragDates(page)).toContainText("← → dates");
  await page.keyboard.press("ArrowRight");
  await expect(dragDates(page)).toContainText("2026-09-15 – 2026-10-26 · 30 working days");
  // Its last day is now CDC's first: 5 FTE that day.
  await saysLast(page, "2026-09-15 to 2026-10-26. Data Engineering is over capacity then: 5 FTE against 3.5, 2026-10-26.");
  await page.keyboard.press("Shift+ArrowRight");
  await saysLast(page, "2026-09-22 to 2026-11-02.");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(dragDates(page)).toContainText("2026-09-21 – 2026-10-30");
  // Nothing is changed yet, and focus stayed on the box throughout.
  await expect(toolbar(page)).toContainText("No changes");
  await expect(box(page, DAGSTER)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-21 – 2026-10-30");
  await expect.poll(() => lastSaid(page)).toMatch(/^Dropped: Dagster 2\.x upgrade, 2026-09-21 to 2026-10-30, Data Engineering \/ FTE 2\. Undo with (⌘|Ctrl\+)Z\.$/);
  await expect(box(page, DAGSTER)).toBeFocused();
  await expect(box(page, DAGSTER)).not.toHaveClass(/dragging/);
  // One undo puts it back: the whole move was one step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-14 – 2026-10-23");
  await expect(toolbar(page)).toContainText("No changes");

  // The second time, the keys aren't said again; Space drops too.
  await page.keyboard.press("Space");
  await saysLast(page, "Moving Dagster 2.x upgrade.");
  await press(page, "ArrowLeft", "Space");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-11 – 2026-10-22");
});

test("Option or Alt with ← → moves the end date, never before the start; Escape and ⌘Z put it back", async ({ page, github: _ }) => {
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Alt+ArrowRight");
  await saysLast(page, "Ends 2026-10-26, 31 working days. Data Engineering is over capacity then: 5 FTE against 3.5, 2026-10-26.");
  for (let i = 0; i < 7; i++) await page.keyboard.press("Alt+Shift+ArrowLeft");
  await expect(dragDates(page)).toContainText("2026-09-14 – 2026-09-14 · 1 working day");
  await page.keyboard.press("Alt+ArrowLeft");
  await saysLast(page, "It can’t end before it starts.");
  expect(page.url()).toContain("zoom=months"); // Alt+← is no Back
  await page.keyboard.press("Escape");
  await saysLast(page, "Move cancelled: Dagster 2.x upgrade is back at 2026-09-14 to 2026-10-23.");
  await expect(box(page, DAGSTER)).not.toHaveClass(/dragging/);
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-14 – 2026-10-23");
  await expect(toolbar(page)).toContainText("No changes");
  await expect(toolbar(page).getByRole("button", { name: "Undo" })).toHaveAttribute("aria-disabled", "true");

  // ⌘Z cancels too, and undoes nothing else.
  await page.keyboard.press("Space");
  await press(page, "ArrowRight", "ArrowRight", "ArrowRight", "ControlOrMeta+z");
  await expect.poll(() => lastSaid(page)).toMatch(/^Move cancelled/);
  await expect(toolbar(page)).toContainText("No changes");
  await expect(box(page, DAGSTER)).toBeFocused();
});

test("Alt+← and Alt+→ are the move's, never the browser's Back and Forward", async ({ page, github: _ }) => {
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Space");
  await page.evaluate(() => {
    const w = window as unknown as { kept: boolean[] };
    w.kept = [];
    window.addEventListener("keydown", (e) => e.key.startsWith("Arrow") && w.kept.push(e.defaultPrevented), true);
  });
  await press(page, "Alt+ArrowLeft", "Alt+ArrowRight", "Alt+Shift+ArrowLeft");
  expect(await page.evaluate(() => (window as unknown as { kept: boolean[] }).kept)).toEqual([true, true, true]);
  await page.keyboard.press("Escape");
});

test("↑ ↓ change the lane, into the next department, saying when it's busy then; dropped, its lane is saved", async ({ page, github }) => {
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await saysLast(page, "Data Engineering / FTE 3. Busy then: it will be drawn in the nearest free space.");
  await expect(page.locator('.lane-row.drop-target [data-lane="de-3"]')).toHaveCount(1);
  await expect(box(page, DAGSTER)).toBeFocused(); // drawn in that lane's row now
  await page.keyboard.press("ArrowDown");
  await saysLast(page, "Data Engineering / Contractor. Busy then: it will be drawn in the nearest free space.");
  // Into Analytics: a new code; Data Engineering is no longer over capacity while it runs.
  await page.keyboard.press("ArrowDown");
  await saysLast(page, "Analytics / FTE 1. Code now AN-D9U. Busy then: it will be drawn in the nearest free space. Data Engineering is within capacity again.");
  await press(page, "ArrowDown", "ArrowDown");
  await saysLast(page, "Analytics / Open req (Q1).");
  await page.keyboard.press("ArrowDown");
  await saysLast(page, "It’s in the bottom lane.");
  await page.keyboard.press("Enter");
  await expect(box(page, DAGSTER).locator("xpath=ancestor::*[@data-dept-track][1]")).toHaveAttribute("data-dept-track", "analytics");
  await expect(box(page, DAGSTER)).toHaveAccessibleName(/^Dagster 2\.x upgrade, AN-D9U, /);
  await expect(box(page, DAGSTER)).toBeFocused();
  // ⌘S saves it.
  await page.keyboard.press("ControlOrMeta+s");
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("lane: an-3\n");
});

test("⌘S during a move saves it dropped where it is", async ({ page, github }) => {
  await box(page, DAGSTER).focus();
  await press(page, "Space", "ArrowRight");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-15\nend: 2026-10-26\n");
  await expect(box(page, DAGSTER)).not.toHaveClass(/dragging/);
});

test("Tab, a click, or another view drops it where it is", async ({ page, github: _ }) => {
  await box(page, DAGSTER).focus();
  await press(page, "Space", "ArrowRight", "Tab");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-15 – 2026-10-26");
  await expect(box(page, DAGSTER)).not.toBeFocused();

  await box(page, DAGSTER).focus();
  await press(page, "Space", "ArrowRight");
  await page.locator(".tl-corner").click();
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-16 – 2026-10-27");

  // A press on another box drops this one first, then drags that one.
  await box(page, DAGSTER).focus();
  await press(page, "Space", "ArrowRight");
  const cdc = (await box(page, CDC).boundingBox())!;
  await page.mouse.move(cdc.x + 30, cdc.y + 10);
  await page.mouse.down();
  await page.mouse.move(cdc.x + 30 + 14.7 * 5, cdc.y + 10, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-17 – 2026-10-28");
  await expect.poll(() => boxDates(page, CDC)).toBe("2026-11-02 – 2027-03-05");

  await box(page, DAGSTER).focus();
  await press(page, "Space", "ArrowRight");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-18 – 2026-10-29");
  await expect(toolbar(page)).toContainText("Save · 2 changes");
});

test("each step says what it would do: a rule broken or kept again; the popup waits for the drop", async ({ page, github: _ }) => {
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: /^Edit / });
  await editor.getByRole("button", { name: "Rule", exact: true }).click();
  await editor.getByLabel("New rule").selectOption("before");
  await editor.getByLabel("Add a rule with").selectOption("C4P");
  await page.keyboard.press("Escape");
  await expect(box(page, DAGSTER)).toBeFocused();

  await press(page, "Space", "ArrowRight");
  await expect.poll(() => lastSaid(page)).toMatch(
    /2026-09-15 to 2026-10-26\. Data Engineering is over capacity then: 5 FTE against 3\.5, 2026-10-26\. Breaks a rule: DE-D9U Dagster 2\.x upgrade should finish before DE-C4P CDC pipeline for orders DB starts, but it ends 2026-10-26 and the other starts 2026-10-26\.$/,
  );
  await expect(page.locator(".toast")).toHaveCount(0);
  await page.keyboard.press("ArrowLeft");
  await saysLast(page, "2026-09-14 to 2026-10-23. Data Engineering is over capacity then: 4 FTE against 3.5, 2026-10-01 to 2026-11-27. Keeps the rule again: DE-D9U Dagster 2.x upgrade should finish before DE-C4P CDC pipeline for orders DB starts.");
  // A key held down: only where it ends up is said, with what changed since what was read.
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  await expect.poll(() => lastSaid(page)).toMatch(/^2026-09-16 to 2026-10-27\. Data Engineering is over capacity then: 5 FTE against 3\.5, 2026-10-26 to 2026-10-27\. Breaks a rule: /);
  expect((await said(page)).filter((m) => m.includes("2026-09-15 to"))).toHaveLength(1); // the first step only
  await page.keyboard.press("Enter");
  await expect(page.locator(".toast")).toBeVisible();
  await expect.poll(() => heard(page)).toContain("That breaks a rule");
});

test("others' saves wait while a box is moved, and come in after", async ({ page, github }) => {
  await box(page, DAGSTER).focus();
  await press(page, "Space", "ArrowRight");
  github.deploy(github.otherSave({ [boxFile(CDC)]: (t) => t.replace("CDC pipeline for orders DB", "CDC pipeline v2") }, "Sam Lee", "CDC renamed"));
  await pollNow(page);
  await page.waitForTimeout(300);
  await expect(page.locator(".banner", { hasText: "Sam Lee saved" })).toHaveCount(0);
  await expect(box(page, CDC)).toHaveAccessibleName(/^CDC pipeline for orders DB,/);
  await page.keyboard.press("Enter");
  await pollNow(page);
  await expect(page.locator(".banner", { hasText: "Sam Lee saved" })).toBeVisible();
  await expect(box(page, CDC)).toHaveAccessibleName(/^CDC pipeline v2,/);
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-15 – 2026-10-26");
});

test("PTO moves only in time; a 2-FTE box at quarters zoom moves a working day at a time, inside its department", async ({ page, github }) => {
  await page.getByRole("button", { name: "Add PTO in Data Engineering" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /^Edit PTO/ }).getByLabel("Engineer")).toBeFocused();
  await page.keyboard.press("Escape");
  const block = page.locator('[data-pto-key="alex-kim#0"]');
  await expect(block).toBeFocused();
  await page.keyboard.press("Space");
  await expect.poll(() => lastSaid(page)).toMatch(/^Moving PTO for Alex Kim, 2026-10-05 to 2026-10-09\.|^Moving PTO for Alex Kim\.$/);
  await page.keyboard.press("ArrowUp");
  await saysLast(page, "PTO moves only in time; change whose it is in its editor.");
  await press(page, "Shift+ArrowRight", "Alt+ArrowRight");
  await saysLast(page, "Ends 2026-10-19, 6 working days.");
  await page.keyboard.press("Enter");
  await expect(block).toHaveAccessibleName("PTO, Alex Kim, 2026-10-12 to 2026-10-19, 6 working days");
  await expect(block).toBeFocused();

  // Exec dashboards needs 2 FTE, with the lane below it free.
  github.deploy(
    github.otherSave({
      [boxFile("bx-2c9e-exec-dashboards")]: (t) => t.replace("type: project\n", "type: project\nfte: 2\n"),
      [boxFile("bx-3d0f-attribution-model")]: (t) => t.replace("start: 2026-09-07\nend: 2027-03-26", "start: 2027-04-05\nend: 2027-06-25"),
    }),
  );
  await pollNow(page);
  await page.getByRole("button", { name: "Quarters" }).click();
  const dashboards = box(page, "bx-2c9e-exec-dashboards");
  await dashboards.focus();
  await press(page, "Space", "ArrowRight", "ArrowDown", "ArrowDown");
  await saysLast(page, "Analytics / Open req (Q1). Busy then: it will be drawn in the nearest free space.");
  // Drawn inside the department, though its lane is the last.
  const lanes = (await page.locator('[data-dept-track="analytics"]').boundingBox())!;
  const drawn = (await dashboards.boundingBox())!;
  expect(drawn.y + drawn.height).toBeLessThanOrEqual(lanes.y + lanes.height);
  await press(page, "ArrowUp", "Enter");
  await expect.poll(() => boxDates(page, "bx-2c9e-exec-dashboards")).toBe("2026-10-20 – 2027-02-01");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile("bx-2c9e-exec-dashboards"))).toContain("lane: an-2\n");
});

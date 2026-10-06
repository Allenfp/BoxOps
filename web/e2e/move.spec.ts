import type { ElementHandle, Page } from "@playwright/test";
import type { Bundle } from "../src/model/bundle";
import { CDC, DAGSTER, MONTH_PX, box, boxDates, boxFile, expect, heard, pollNow, said, test, toolbar } from "./helpers";

// Moving a box or PTO block from the keyboard: Space picks it up, the arrow
// keys move it (only what's drawn), Enter or Space drops it as one change,
// Escape or ⌘Z puts it back. Each step is said, with what it would do.

const dragDates = (page: Page) => page.locator(".drag-dates");
/** The site rebuilt by a later BoxOps. */
const newerApp = (b: Bundle): Bundle => ({ ...b, app: { version: "0.2.0", build: "0.2.0+0123456789ab", time: "2099-01-01T00:00:00Z" } });
/** The last thing said to screen readers. */
const lastSaid = async (page: Page) => (await said(page)).at(-1) ?? "";
/** What was said last ends with `text` (messages asked for together are read together). */
const saysLast = (page: Page, text: string) =>
  expect.poll(() => lastSaid(page)).toMatch(new RegExp(`${text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`));
async function press(page: Page, ...keys: string[]) {
  for (const k of keys) await page.keyboard.press(k);
}

test("Space picks a box up; ← → move it a working day, Shift a week; Enter drops it, one change", async ({ page, github: _ }) => {
  // Nothing else moves while it does: CDC stays the same element, in the same place.
  const cdc = await box(page, CDC).elementHandle();
  const cdcAt = await box(page, CDC).boundingBox();
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
  expect(await cdc!.evaluate((el) => el.isConnected)).toBe(true);
  expect(await box(page, CDC).boundingBox()).toEqual(cdcAt);
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
  // What's said about it beyond its name follows it.
  await expect(box(page, DAGSTER)).toHaveAccessibleDescription(/^Data Engineering \/ FTE 2\. Scale 31 \(1 FTE × 31 working days\)/);
  for (let i = 0; i < 7; i++) await page.keyboard.press("Alt+Shift+ArrowLeft");
  await expect(dragDates(page)).toContainText("2026-09-14 – 2026-09-14 · 1 working day");
  await page.keyboard.press("Alt+ArrowLeft");
  await saysLast(page, "It can’t end before it starts.");
  expect(page.url()).toContain("zoom=months"); // Alt+← is no Back
  await page.keyboard.press("Escape");
  await saysLast(page, "Move cancelled: Dagster 2.x upgrade is back at 2026-09-14 to 2026-10-23.");
  await expect(box(page, DAGSTER)).toHaveAccessibleDescription(/^Data Engineering \/ FTE 2\. Scale 30 \(1 FTE × 30 working days\)/);
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

test("Alt+← and Alt+→ (⌘← and ⌘→ too) are the move's, never the browser's Back and Forward, nor before it's picked up", async ({ page, github: _ }) => {
  await box(page, DAGSTER).focus();
  // Not picked up yet: they say how, and move nothing.
  await page.evaluate(() => {
    const w = window as unknown as { early: boolean[] };
    w.early = [];
    window.addEventListener("keydown", (e) => e.key.startsWith("Arrow") && w.early.push(e.defaultPrevented));
  });
  await press(page, "Alt+ArrowLeft", "Alt+ArrowRight");
  expect(await page.evaluate(() => (window as unknown as { early: boolean[] }).early)).toEqual([true, true]);
  await expect.poll(() => lastSaid(page)).toMatch(/^Press Space to pick it up first; then (Option|Alt) with Left or Right changes the end date\.$/);
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-14 – 2026-10-23");
  expect(page.url()).toContain("zoom=months");
  // Nor on any other cell: a lane's name, its +, a department's heading or its pencil, and they stay put.
  for (const key of ["lane:de-2", "lane-add:de-2", "dept:data-eng", "dept-edit:data-eng", "pto-add:data-eng"]) {
    await page.locator(`[data-cell="${key}"]`).focus();
    await press(page, "Alt+ArrowLeft", "Alt+ArrowRight");
    await expect(page.locator(`[data-cell="${key}"]`)).toBeFocused();
  }
  expect(await page.evaluate(() => (window as unknown as { early: boolean[] }).early)).toEqual(Array(12).fill(true));
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Space");
  await page.evaluate(() => {
    const w = window as unknown as { kept: boolean[] };
    w.kept = [];
    window.addEventListener("keydown", (e) => e.key.startsWith("Arrow") && w.kept.push(e.defaultPrevented), true);
  });
  await press(page, "Alt+ArrowLeft", "Alt+ArrowRight", "Alt+Shift+ArrowLeft");
  expect(await page.evaluate(() => (window as unknown as { kept: boolean[] }).kept)).toEqual([true, true, true]);
  // ⌘← and ⌘→ (Back and Forward in Chrome and Firefox on a Mac), Home and End move nothing; they say what does.
  await press(page, "ControlOrMeta+ArrowLeft", "ControlOrMeta+ArrowRight");
  expect(await page.evaluate(() => (window as unknown as { kept: boolean[] }).kept)).toEqual([true, true, true, true, true]);
  await saysLast(page, "Moving Dagster 2.x upgrade: Enter to drop, Escape to cancel.");
  await press(page, "Home", "ControlOrMeta+End");
  await expect(dragDates(page)).toContainText("2026-09-14 – 2026-10-16"); // where Alt+Shift+← left it
  expect(page.url()).toContain("zoom=months");
  await page.keyboard.press("Escape");
});

test("↑ ↓ change the lane, into the next department, saying when it's busy then; dropped, its lane is saved", async ({ page, github }) => {
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await saysLast(page, "Data Engineering / FTE 3. Busy then: it will be drawn in the nearest free space.");
  await expect(page.locator('.lane-row.drop-target [data-lane="de-3"]')).toHaveCount(1);
  await expect(box(page, DAGSTER)).toBeFocused(); // drawn in that lane's row now
  await expect(box(page, DAGSTER)).toHaveAccessibleDescription(/^Data Engineering \/ FTE 3\. /);
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
  await expect(box(page, DAGSTER)).toHaveAccessibleDescription(/^Analytics \/ Open req \(Q1\)\. /);
  // ⌘S saves it.
  await page.keyboard.press("ControlOrMeta+s");
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("lane: an-3\n");
});

test("dropped past another box or block in its row, it keeps focus, from the keyboard or a drag", async ({ page, github }) => {
  // Dagster and CDC a week each, a week apart, in the same lane; two engineers' PTO likewise.
  github.deploy(
    github.otherSave({
      [boxFile(DAGSTER)]: (t) => t.replace("start: 2026-09-14\nend: 2026-10-23", "start: 2026-10-05\nend: 2026-10-09"),
      [boxFile(CDC)]: (t) => t.replace("start: 2026-10-26\nend: 2027-02-26", "start: 2026-10-19\nend: 2026-10-23"),
      "people.yaml": (t) =>
        t
          .replace("    name: Alex Kim\n    department: data-eng\n", "    name: Alex Kim\n    department: data-eng\n    pto:\n      - start: 2026-10-05\n        end: 2026-10-09\n")
          .replace("    name: Jordan Diaz\n    department: data-eng\n", "    name: Jordan Diaz\n    department: data-eng\n    pto:\n      - start: 2026-10-19\n        end: 2026-10-23\n"),
    }),
  );
  await pollNow(page);
  await expect.poll(() => boxDates(page, CDC)).toBe("2026-10-19 – 2026-10-23");
  /** `a` is the same element still, now after `b` on the page: moved there, which takes focus from it for a moment. */
  const movedPast = (a: ElementHandle | null, b: ElementHandle | null) =>
    a!.evaluate((el, other) => el.isConnected && !!(other!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING), b);
  const dagster = await box(page, DAGSTER).elementHandle();
  await box(page, DAGSTER).focus();
  await press(page, "Space", "Shift+ArrowRight", "Shift+ArrowRight", "Shift+ArrowRight", "Enter");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-10-26 – 2026-10-30");
  expect(await movedPast(dagster, await box(page, CDC).elementHandle())).toBe(true);
  await expect(box(page, DAGSTER)).toBeFocused();
  // Its undo moves it back before CDC; redo past it again.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-10-05 – 2026-10-09");
  await expect(box(page, DAGSTER)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-10-26 – 2026-10-30");
  await expect(box(page, DAGSTER)).toBeFocused();

  const alex = page.locator('[data-pto-key="alex-kim#0"]');
  const jordan = page.locator('[data-pto-key="jordan-diaz#0"]');
  const alexBlock = await alex.elementHandle();
  await alex.focus();
  await press(page, "Space", "Shift+ArrowRight", "Shift+ArrowRight", "Shift+ArrowRight", "Enter");
  await expect(alex).toHaveAccessibleName("PTO, Alex Kim, 2026-10-26 to 2026-10-30, 5 working days");
  expect(await movedPast(alexBlock, await jordan.elementHandle())).toBe(true);
  await expect(alex).toBeFocused();
  // Dragged past Alex's: Jordan's block keeps focus too.
  const b = (await jordan.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + MONTH_PX * 10, b.y + b.height / 2, { steps: 6 }); // 10 working days
  await page.mouse.up();
  await expect(jordan).toHaveAccessibleName("PTO, Jordan Diaz, 2026-11-02 to 2026-11-06, 5 working days");
  await expect(jordan).toBeFocused();
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

test("going read-only (a newer BoxOps deployed) drops it where it is", async ({ page, github }) => {
  // A check for others' saves already under way when the move starts: its answer comes mid-move.
  let answer!: () => void;
  const held = new Promise<void>((r) => (answer = r));
  let asked!: () => void;
  const asking = new Promise<void>((r) => (asked = r));
  await page.route("**/roadmap.json*", async (route) => {
    asked();
    await held;
    await route.fallback();
  });
  github.patchBundle = newerApp;
  await pollNow(page);
  await asking;
  await box(page, DAGSTER).focus();
  await press(page, "Space", "ArrowRight");
  await expect(dragDates(page)).toContainText("2026-09-15 – 2026-10-26");
  answer();
  await expect(page.locator(".tl-corner > span")).toHaveText("Read-only");
  await expect(box(page, DAGSTER)).not.toHaveClass(/dragging/);
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-15 – 2026-10-26");
  await expect.poll(() => heard(page)).toContain("Dropped: Dagster 2.x upgrade, 2026-09-15 to 2026-10-26, Data Engineering / FTE 2.");
  await expect(page.locator(".banner", { hasText: "BoxOps was updated" })).toContainText("Your unsaved changes are kept in this browser.");
  // Nor can it be picked up again.
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Space");
  await expect.poll(() => said(page)).toContainEqual("Read-only: changes can’t be made here.");
  await expect(box(page, DAGSTER)).not.toHaveClass(/dragging/);
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
  // The check is skipped while it's moved: nothing is fetched.
  let fetches = 0;
  page.on("request", (r) => r.url().includes("roadmap.json") && fetches++);
  await pollNow(page);
  // A request would be reported a moment later: give it a frame or two before counting none.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.waitForTimeout(200);
  expect(fetches).toBe(0);
  await expect(page.locator(".banner", { hasText: "Sam Lee saved" })).toHaveCount(0);
  await expect(box(page, CDC)).toHaveAccessibleName(/^CDC pipeline for orders DB,/);
  await page.keyboard.press("Enter");
  await pollNow(page);
  await expect(page.locator(".banner", { hasText: "Sam Lee saved" })).toBeVisible();
  expect(fetches).toBe(1);
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

import type { Locator, Page } from "@playwright/test";
import { CDC, DAGSTER, box, boxFile, dragDays, expect, heard, pollNow, said, save, test, toolbar } from "./helpers";

// The timeline from the keyboard: a grid with one Tab stop, the arrow keys
// between its cells, Enter to open a box and focus back on it after. Start
// from a focused element (WebKit's Tab, like Safari's, skips buttons).

const cell = (page: Page, key: string) => page.locator(`[data-cell="${key}"]`);
/** Press keys one after another. */
async function press(page: Page, ...keys: string[]) {
  for (const k of keys) await page.keyboard.press(k);
}
const isFocusVisible = (l: Locator) => l.evaluate((el) => el.matches(":focus-visible"));

test("the timeline is a grid of rows and cells with full names, and one Tab stop", async ({ page, github: _ }) => {
  const grid = page.getByRole("grid", { name: "Timeline" });
  await expect(grid).toHaveAccessibleDescription(/^Arrow keys move between lanes, boxes and PTO\./);
  await expect(grid.getByRole("gridcell", { name: "Dagster 2.x upgrade, DE-D9U, 2026-09-14 to 2026-10-23, 1 FTE, no engineer assigned, At risk" })).toHaveCount(1);
  await expect(grid.getByRole("rowheader", { name: /^Contractor\s+0\.5 FTE$/ })).toHaveCount(1);
  await expect(grid.getByRole("gridcell", { name: /^PTO, / })).toHaveCount(0);
  await expect(grid.getByRole("button", { name: "Add a box to Data Engineering / FTE 2" })).toHaveCount(1);
  await expect(grid.getByRole("row")).toHaveCount(13); // ML Platform starts collapsed
  // Rows have short names, not one made of every box in them.
  for (const name of ["Data Engineering", "Data Engineering / FTE 2", "Data Engineering / Over capacity", "Analytics / PTO"]) {
    await expect(grid.getByRole("row", { name, exact: true })).toHaveCount(1);
  }
  // Only one of its cells is in the Tab order.
  await expect(grid.locator('[tabindex="0"]')).toHaveCount(1);

  // In from what's before it, on its first cell; out again with one more Tab.
  await page.getByRole("button", { name: "Collapse all" }).focus();
  await page.keyboard.press("Tab");
  await expect(cell(page, "dept:data-eng")).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="grid"]'))).toBe(false);
  // Back in, on the cell it left from.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, "lane:de-1")).toBeFocused();
  await page.getByRole("button", { name: "Collapse all" }).focus();
  await page.keyboard.press("Tab");
  await expect(cell(page, "lane:de-1")).toBeFocused();
});

test("a lane's row header says when it's open, and its size, if not always and 1 FTE", async ({ page, github }) => {
  github.deploy(
    github.otherSave({ "departments/analytics.yaml": (t) => t.replace("name: Open req (Q1)\n    fte: 1\n", "name: Open req (Q1)\n    fte: 1\n    start: 2027-01-04\n") }),
  );
  await pollNow(page);
  const grid = page.getByRole("grid", { name: "Timeline" });
  await expect(grid.getByRole("rowheader", { name: /^Open req \(Q1\)\s+from 2027-01-04$/ })).toHaveCount(1);
  await expect(grid.getByRole("rowheader", { name: /^Contractor\s+0\.5 FTE$/ })).toHaveCount(1);
  // Its name, focused, is read with them.
  await cell(page, "lane:an-3").focus();
  await expect(cell(page, "lane:an-3")).toHaveAccessibleDescription("from 2027-01-04");
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });
  test("each lane's + and each PTO row's are always shown, with no hover to find them by", async ({ page, github: _ }) => {
    await expect(page.getByRole("button", { name: "Add a box to Data Engineering / FTE 2" })).toHaveCSS("opacity", "1");
    await expect(page.getByRole("button", { name: "Add PTO in Data Engineering" })).toHaveCSS("opacity", "1");
    await page.getByRole("button", { name: "Add a box to Data Engineering / Contractor" }).tap();
    await expect(page.getByRole("dialog", { name: /^Edit / })).toBeVisible();
    await expect.poll(() => heard(page)).toContain("Added a box to Data Engineering / Contractor, 2026-10-05 to 2026-10-16.");
  });
});

test("arrows go along a row and to the nearest box in time above and below; Home, End, Page Up and Down jump", async ({ page, github: _ }) => {
  // From a lane's labels into its boxes: the one nearest what's on screen, not the earliest.
  await cell(page, "lane:de-3").focus();
  await press(page, "ArrowRight", "ArrowRight");
  await expect(box(page, "bx-0a7c-terraform-cleanup")).toBeFocused();

  await box(page, DAGSTER).focus();
  await press(page, "ArrowRight");
  await expect(box(page, CDC)).toBeFocused();
  await expect(box(page, CDC)).toHaveAttribute("tabindex", "0");
  await expect(box(page, DAGSTER)).toHaveAttribute("tabindex", "-1");
  await press(page, "ArrowRight"); // the end of the row: nowhere further
  await expect(box(page, CDC)).toBeFocused();
  await press(page, "ArrowLeft", "ArrowLeft");
  await expect(page.getByRole("button", { name: "Add a box to Data Engineering / FTE 2" })).toBeFocused();
  await press(page, "End");
  await expect(box(page, CDC)).toBeFocused();
  await press(page, "Home");
  await expect(cell(page, "lane:de-2")).toBeFocused();

  // Up and down keep to Dagster's dates: the boxes running then.
  await box(page, DAGSTER).focus();
  await press(page, "ArrowUp");
  await expect(box(page, "bx-a1f0-warehouse-migration")).toBeFocused();
  await press(page, "ArrowDown", "ArrowDown");
  await expect(box(page, "bx-0a7c-terraform-cleanup")).toBeFocused();
  // A lane with nothing in it: its name. Then the extra area's box, the PTO row's +, the next heading.
  await press(page, "ArrowDown");
  await expect(cell(page, "lane:de-4")).toBeFocused();
  await press(page, "ArrowDown");
  await expect(box(page, "bx-e5a2-on-call-q4")).toBeFocused();
  await press(page, "ArrowDown");
  await expect(page.getByRole("button", { name: "Add PTO in Data Engineering" })).toBeFocused();
  await press(page, "ArrowDown");
  await expect(cell(page, "dept:analytics")).toBeFocused();
  // Labels go down the label column.
  await press(page, "ArrowRight", "ArrowDown");
  await expect(cell(page, "lane-add:an-1")).toBeFocused();

  await press(page, "PageDown");
  await expect(cell(page, "dept:ml-platform")).toBeFocused();
  await press(page, "PageUp", "PageUp");
  await expect(cell(page, "dept:data-eng")).toBeFocused();
  const across = await page.evaluate(() => document.querySelector(".timeline")!.scrollLeft);
  await press(page, "ControlOrMeta+ArrowDown");
  await expect(cell(page, "chart:ml-platform")).toBeFocused();
  // The chart is as wide as the timeline: it's shown without scrolling back to its start.
  expect(across).toBeGreaterThan(500);
  expect(await page.evaluate(() => document.querySelector(".timeline")!.scrollLeft)).toBe(across);
  await press(page, "ControlOrMeta+ArrowUp");
  await expect(cell(page, "dept:data-eng")).toBeFocused();
  await press(page, "ArrowDown", "ControlOrMeta+ArrowRight");
  await expect(box(page, "bx-b27c-fivetran-cost-review")).toBeFocused();
  await press(page, "ControlOrMeta+ArrowLeft");
  await expect(cell(page, "lane:de-1")).toBeFocused();
  expect(await isFocusVisible(cell(page, "lane:de-1"))).toBe(true);
});

test("at quarters zoom too, and a collapsed department's chart says when it's over capacity", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Quarters" }).click();
  await box(page, "bx-1b8d-revenue-mart").focus();
  await press(page, "ArrowRight");
  await expect(box(page, "bx-2c9e-exec-dashboards")).toBeFocused();
  await press(page, "ArrowDown");
  await expect(box(page, "bx-3d0f-attribution-model")).toBeFocused();
  await press(page, "PageUp", "Enter"); // collapse Analytics
  await expect(cell(page, "dept:analytics")).toHaveAttribute("aria-expanded", "false");
  await press(page, "PageUp", "Enter"); // and Data Engineering: its chart says when it's over
  await press(page, "End");
  const chart = cell(page, "chart:data-eng");
  await expect(chart).toBeFocused();
  await expect(chart).toHaveAccessibleName(/^Data Engineering: capacity used by week, peak \d+%$/);
  await expect(chart).toHaveAccessibleDescription(/^Over capacity: 4 FTE planned against 3\.5, 2026-10-01 – 2026-11-27/);
});

test("Enter opens a box or PTO block, and closing puts focus back on it; so does a click, or a screen reader's press", async ({ page, github: _ }) => {
  await box(page, DAGSTER).focus();
  await expect(box(page, DAGSTER)).toHaveAccessibleDescription(/^Data Engineering \/ FTE 2\. Scale 30 \(1 FTE × 30 working days\): about 6 weeks/);
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: "Edit Dagster 2.x upgrade" });
  await expect(editor.getByRole("textbox", { name: "Title" })).toBeFocused();
  await expect(box(page, DAGSTER)).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('.box[aria-expanded], .pto-block[aria-expanded]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(box(page, DAGSTER)).toBeFocused();
  // Closed, it's said to be nothing: not "collapsed", like every other box.
  await expect(page.locator('.box[aria-expanded], .pto-block[aria-expanded]')).toHaveCount(0);
  expect(await isFocusVisible(box(page, DAGSTER))).toBe(true);

  // A screen reader's "press" sends a click, not the pointer's press and release.
  await box(page, CDC).dispatchEvent("click");
  await expect(page.getByRole("dialog", { name: "Edit CDC pipeline for orders DB" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box(page, CDC)).toBeFocused();
  // A click opens it too; afterwards focus is on the box.
  await box(page, DAGSTER).click({ position: { x: 20, y: 10 } });
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box(page, DAGSTER)).toBeFocused();

  // PTO: the block's editor starts on whose it is, and gives focus back to the block.
  await page.getByRole("button", { name: "Add PTO in Data Engineering" }).click();
  const pto = page.getByRole("dialog", { name: "Edit PTO for Alex Kim" });
  await expect(pto.getByLabel("Engineer")).toBeFocused();
  await page.keyboard.press("Escape");
  const block = page.locator(".pto-block").first();
  await expect(block).toBeFocused();
  await expect(block).toHaveAccessibleName("PTO, Alex Kim, 2026-10-05 to 2026-10-09, 5 working days");
  await page.keyboard.press("Enter");
  await expect(pto.getByLabel("Engineer")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(block).toBeFocused();
});

test("closed with ✕ or deleted with a click, an editor gives focus back without scrolling the timeline", async ({ page, github: _ }) => {
  const timeline = page.locator(".timeline");
  const scroll = () => timeline.evaluate((el) => [el.scrollLeft, el.scrollTop]);
  /** The timeline scrolled across till `x` px into `cell` is at the label column's edge. */
  const scrollTo = async (cell: Locator, x: number) => {
    const [b, view] = [(await cell.boundingBox())!, (await timeline.boundingBox())!];
    await timeline.evaluate((el, dx) => (el.scrollLeft += dx), b.x + x - (view.x + 240));
  };
  /** Click `cell` 40 px clear of the label column, where it shows. */
  const clickShown = async (cell: Locator) => {
    const [b, view] = [(await cell.boundingBox())!, (await timeline.boundingBox())!];
    await cell.click({ position: { x: view.x + 240 + 40 - b.x, y: 10 } });
  };
  /** The timeline is where it was, and stays there. */
  const stays = async (at: number[]) => {
    await page.waitForTimeout(300);
    expect(await scroll()).toEqual(at);
  };
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  const editor = page.getByRole("dialog", { name: /^Edit / });

  // A long box, its start scrolled away to the left, its title typed in (a key: no longer the pointer's), then ✕.
  const warehouse = box(page, "bx-a1f0-warehouse-migration");
  await scrollTo(warehouse, 400);
  await clickShown(warehouse);
  await editor.getByRole("textbox", { name: "Title", exact: true }).press("End");
  await page.keyboard.type(" v2");
  let at = await scroll();
  await editor.getByRole("button", { name: "Close" }).click();
  await expect(editor).toHaveCount(0);
  await expect(warehouse).toBeFocused();
  expect(await isFocusVisible(warehouse)).toBe(false);
  await stays(at);

  // Deleted: focus goes to the department's next box by start, off screen to the right, and it's left there.
  await scrollTo(box(page, "bx-0a7c-terraform-cleanup"), 0);
  await box(page, "bx-e5a2-on-call-q4").click({ position: { x: 20, y: 10 } });
  at = await scroll();
  await editor.getByRole("button", { name: "Delete" }).click();
  await expect(box(page, CDC)).toBeFocused();
  await expect(box(page, CDC)).not.toBeInViewport();
  await stays(at);

  // A PTO block the same, its start under the label column.
  await page.getByRole("button", { name: "Add PTO in Data Engineering" }).click();
  const pto = page.getByRole("dialog", { name: /^Edit PTO for / });
  await expect(pto.getByLabel("Engineer")).toBeFocused();
  await page.keyboard.press("Escape");
  const block = page.locator(".pto-block").first();
  await expect(block).toBeFocused();
  await scrollTo(block, 100);
  await clickShown(block);
  await pto.getByLabel("Note").fill("Conference");
  at = await scroll();
  await pto.getByRole("button", { name: "Close" }).click();
  await expect(pto).toHaveCount(0);
  await expect(block).toBeFocused();
  await stays(at);
});

test.describe("in a small window", () => {
  test.use({ viewport: { width: 900, height: 420 } });

  test("focus is never hidden under the header, the label column or the broken-rule popup", async ({ page, github: _ }) => {
    const timeline = page.locator(".timeline");
    /** The focused cell lies inside what's on screen of the timeline, clear of its sticky parts and the popup. */
    const inView = async () => {
      const r = (await page.evaluate(() => {
        const b = document.activeElement!.getBoundingClientRect();
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      }))!;
      const t = (await timeline.boundingBox())!;
      const head = (await page.locator(".tl-head").boundingBox())!;
      expect(r.top).toBeGreaterThanOrEqual(head.y + head.height);
      expect(r.bottom).toBeLessThanOrEqual(t.y + t.height);
      const toast = (await page.locator(".toast").count()) ? await page.locator(".toast").boundingBox() : null;
      if (toast && r.right > toast.x && r.left < toast.x + toast.width) expect(r.bottom).toBeLessThanOrEqual(toast.y);
      return r;
    };

    // Dagster's start scrolled under the labels: moving to it brings it out.
    await box(page, CDC).focus();
    await timeline.evaluate((el) => (el.scrollLeft += 900));
    await page.keyboard.press("ArrowLeft");
    await expect(box(page, DAGSTER)).toBeFocused();
    const r = await inView();
    expect(r.left).toBeGreaterThanOrEqual((await timeline.boundingBox())!.x + 240);

    // Down the grid, past what fits: each cell scrolled into view.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("ArrowDown");
      await inView();
    }
    await expect(cell(page, "dept:ml-platform")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+ArrowUp");
    await inView();

    // With the broken-rule popup up: a box under it is scrolled clear of it.
    await box(page, DAGSTER).click({ position: { x: 20, y: 10 } });
    const editor = page.getByRole("dialog", { name: /^Edit / });
    await editor.getByRole("button", { name: "Rule", exact: true }).click();
    await editor.getByLabel("New rule").selectOption("after");
    await editor.getByLabel("Add a rule with").selectOption("C4P");
    await page.keyboard.press("Escape");
    await expect(page.locator(".toast")).toBeVisible();
    await box(page, DAGSTER).focus();
    for (const key of ["PageDown", "ArrowDown", "ArrowDown", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowDown", "ArrowDown"]) {
      await page.keyboard.press(key);
      await inView();
    }
  });
});

test("lane rows are exactly as tall as their lanes: a box's slot is where the maths says", async ({ page, github: _ }) => {
  const tops = await page
    .locator('[data-dept-track="data-eng"] .lane-row')
    .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().top - r.parentElement!.getBoundingClientRect().top));
  // 1, 1, 1 and 0.5 FTE: 44, 44, 44 and 22 px, then the extra area.
  expect(tops).toEqual([0, 44, 88, 132, 154]);
});

test("N or a lane's + adds a box there, after the focused box or near today; focus comes back to it", async ({ page, github: _ }) => {
  // On a lane's name: near today (2026-10-03 is a Saturday), two working weeks at months zoom.
  await cell(page, "lane:de-4").focus();
  await page.keyboard.press("n");
  const editor = page.getByRole("dialog", { name: /^Edit / });
  await expect(editor.getByRole("textbox", { name: "Title" })).toBeFocused();
  await expect.poll(() => heard(page)).toContain("Added a box to Data Engineering / Contractor, 2026-10-05 to 2026-10-16.");
  await page.keyboard.type("Kafka spike");
  await page.keyboard.press("Escape");
  // Its id changed with its title: focus is on it all the same.
  const added = page.locator('[data-box-id$="-kafka-spike"]');
  await expect(added).toBeFocused();
  await expect(added).toHaveAccessibleName(/^Kafka spike, DE-\w{3}, 2026-10-05 to 2026-10-16, 1 FTE/);
  await expect(toolbar(page)).toContainText("Save · 1 change");

  // On a box: in its lane, from the working day after it ends (Dagster ends Friday 2026-10-23).
  await box(page, DAGSTER).focus();
  await page.keyboard.press("n");
  await expect.poll(() => heard(page)).toContain("Added a box to Data Engineering / FTE 2, 2026-10-26 to 2026-11-06.");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-box-id$="-new-box"]')).toBeFocused();

  // The + with Enter, at weeks zoom: a working week.
  await page.getByRole("button", { name: "Weeks" }).click();
  await page.getByRole("button", { name: "Add a box to Analytics / Open req (Q1)" }).focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();
  await expect.poll(() => heard(page)).toContain("Added a box to Analytics / Open req (Q1), 2026-10-05 to 2026-10-09.");
  await page.keyboard.press("Escape");

  // N in a PTO row: a week off.
  await page.getByRole("button", { name: "Add PTO in Analytics" }).focus();
  await page.keyboard.press("n");
  await expect(page.getByRole("dialog", { name: /^Edit PTO for / })).toBeVisible();
  await expect.poll(() => heard(page)).toContain("Added PTO in Analytics, 2026-10-05 to 2026-10-09.");
});

test("Delete deletes the focused box or PTO block, once however long it's held, and says how to undo it", async ({ page, github, cull }) => {
  // Data Engineering / FTE 2 holds Dagster then CDC: deleting Dagster puts focus on CDC.
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Delete");
  await expect(box(page, DAGSTER)).toHaveCount(0);
  await expect(box(page, CDC)).toBeFocused();
  await expect.poll(() => said(page)).toContainEqual(expect.stringMatching(/^Deleted “Dagster 2\.x upgrade”\. Undo with (⌘|Ctrl\+)Z\./));
  // Held down (the Mac's delete key is Backspace): the second press repeats, and deletes nothing
  // more, though focus has gone on to the cell beside it.
  await page.keyboard.down("Backspace");
  await page.keyboard.down("Backspace");
  await page.keyboard.up("Backspace");
  await expect(box(page, CDC)).toHaveCount(0);
  await expect(page.locator('[role="grid"] [data-cell]:focus')).toHaveCount(1);
  await expect(toolbar(page)).toContainText("Save · 2 changes");
  // Every box is counted, so not when the timeline draws only what's near the screen (`cull`).
  if (!cull) await expect(page.locator(".box")).toHaveCount(10);
  expect(page.url()).toContain("zoom=months"); // not the browser's Back

  await page.keyboard.press("ControlOrMeta+z");
  await expect(box(page, CDC)).toHaveCount(1);
  await expect(toolbar(page)).toContainText("Save · 1 change");

  // PTO: Morgan's two blocks; deleting the first puts focus on the second, whose place in the list moved up.
  github.deploy(
    github.otherSave({
      "people.yaml": (t) =>
        t.replace(
          "  - id: morgan-chen\n    name: Morgan Chen\n    department: analytics\n",
          "  - id: morgan-chen\n    name: Morgan Chen\n    department: analytics\n    pto:\n      - start: 2026-10-05\n        end: 2026-10-09\n      - start: 2026-10-19\n        end: 2026-10-23\n",
        ),
    }),
  );
  await pollNow(page);
  await cell(page, "pto:morgan-chen#0").focus();
  await page.keyboard.press("Backspace");
  await expect(cell(page, "pto:morgan-chen#0")).toBeFocused();
  await expect(cell(page, "pto:morgan-chen#0")).toHaveAccessibleName("PTO, Morgan Chen, 2026-10-19 to 2026-10-23, 5 working days");
  await expect.poll(() => heard(page)).toMatch(/Deleted PTO for Morgan Chen, 2026-10-05 – 2026-10-09\. Undo with/);
});

test("Delete on a PTO block whose owner's next one comes after someone else's puts focus on the block beside it", async ({ page, github }) => {
  // Morgan's first and second weeks off, with Priya's between them.
  github.deploy(
    github.otherSave({
      "people.yaml": (t) =>
        t
          .replace(
            "    name: Morgan Chen\n    department: analytics\n",
            "    name: Morgan Chen\n    department: analytics\n    pto:\n      - start: 2026-10-05\n        end: 2026-10-09\n      - start: 2026-10-26\n        end: 2026-10-30\n",
          )
          .replace("    name: Priya Shah\n    department: analytics\n", "    name: Priya Shah\n    department: analytics\n    pto:\n      - start: 2026-10-19\n        end: 2026-10-23\n"),
    }),
  );
  await pollNow(page);
  await cell(page, "pto:morgan-chen#0").focus();
  // Morgan's second block takes the first's key, and so its element, drawn after Priya's now.
  await page.keyboard.press("Delete");
  await expect(cell(page, "pto:priya-shah#0")).toBeFocused();
  await expect(cell(page, "pto:morgan-chen#0")).toHaveAccessibleName("PTO, Morgan Chen, 2026-10-26 to 2026-10-30, 5 working days");
  // Undone, it's back before Priya's; focus stays where it is.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(cell(page, "pto:morgan-chen#1")).toHaveCount(1);
  await expect(cell(page, "pto:priya-shah#0")).toBeFocused();
});

test("an editor whose box or PTO block someone else deleted gives focus to what was beside it", async ({ page, github }) => {
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: /^Edit / });
  await expect(editor.getByRole("textbox", { name: "Title" })).toBeFocused();
  github.deploy(github.otherSave({ [boxFile(DAGSTER)]: () => undefined }, "Sam Lee", "Dagster dropped"));
  await pollNow(page);
  await expect(editor).toHaveCount(0);
  await expect(box(page, DAGSTER)).toHaveCount(0);
  // The next box in Data Engineering by start, as the editor's Delete would.
  await expect(box(page, "bx-e5a2-on-call-q4")).toBeFocused();

  github.deploy(
    github.otherSave({
      "people.yaml": (t) =>
        t.replace(
          "    name: Morgan Chen\n    department: analytics\n",
          "    name: Morgan Chen\n    department: analytics\n    pto:\n      - start: 2026-10-05\n        end: 2026-10-09\n      - start: 2026-10-19\n        end: 2026-10-23\n",
        ),
    }),
  );
  await pollNow(page);
  await cell(page, "pto:morgan-chen#1").focus();
  await page.keyboard.press("Enter");
  const pto = page.getByRole("dialog", { name: /^Edit PTO/ });
  await expect(pto.getByLabel("Engineer")).toBeFocused();
  github.deploy(github.otherSave({ "people.yaml": (t) => t.replace("      - start: 2026-10-19\n        end: 2026-10-23\n", "") }));
  await pollNow(page);
  await expect(pto).toHaveCount(0);
  await expect(cell(page, "pto:morgan-chen#0")).toBeFocused();
});

test("Delete on the only box in a department's extra area keeps focus in that department, wherever it is", async ({ page, github: _ }) => {
  // Data Engineering second: its extra area's one box has no cell beside it in its row.
  await cell(page, "dept:data-eng").focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.locator(".dept-label .dept-name")).toHaveText(["Analytics", "Data Engineering", "ML Platform"]);
  const oncall = box(page, "bx-e5a2-on-call-q4");
  await expect(oncall.locator("xpath=ancestor::*[@role='row'][1]")).toHaveClass(/overflow-row/);
  await oncall.focus();
  await page.keyboard.press("Delete");
  await expect(oncall).toHaveCount(0);
  // The nearest cell in the row above: the Contractor lane, empty then, so its name. Not Analytics' heading.
  await expect(cell(page, "lane:de-4")).toBeFocused();
  await expect.poll(() => heard(page)).toMatch(/Deleted “On-call rotation Q4”\. Undo with/);
});

test.describe("a branch preview", () => {
  test("can be looked around, and what would change something says it can't", async ({ page, github, cull }) => {
    const main = github.head;
    github.branches.feature = github.otherSave({ [boxFile(CDC)]: (t) => t.replace("CDC pipeline for orders DB", "CDC pipeline v2") });
    github.head = main;
    await page.goto("./?ref=feature&zoom=months");
    await expect(page.getByRole("grid", { name: "Timeline" })).toHaveAttribute("aria-readonly", "true");
    await box(page, DAGSTER).focus();
    await page.keyboard.press("ArrowRight");
    await expect(box(page, CDC)).toBeFocused();
    for (const key of ["Enter", "Delete", "n", " "]) await page.keyboard.press(key);
    await expect(box(page, CDC)).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => said(page)).toContainEqual(expect.stringContaining("Read-only preview: changes can’t be made here."));
    await page.keyboard.press("Home");
    await expect(cell(page, "lane:de-2")).toBeFocused(); // the lane's name is still a cell, as text
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("button", { name: "Add a box to Data Engineering / FTE 2" })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    // No box added. Every box is counted, so not when the timeline draws only what's near the screen (`cull`).
    if (!cull) await expect(page.locator(".box")).toHaveCount(12);
    // Nor do departments move, here or in the table, which says why the same way.
    await page.keyboard.press("PageUp");
    await page.keyboard.press("Alt+ArrowDown");
    await expect(page.locator(".dept-label .dept-name")).toHaveText(["Data Engineering", "Analytics", "ML Platform"]);
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await page.locator('.box-table [data-dept-id="data-eng"] .group-toggle').focus();
    const before = (await said(page)).length;
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(async () => (await said(page)).slice(before)).toEqual(["Read-only preview: changes can’t be made here."]);
    await expect(page.locator(".group-toggle .dept-name")).toHaveText(["Data Engineering", "Analytics", "ML Platform"]);
  });
});

test("Option or Alt with ↑ ↓ on a department's heading moves it, keeping focus, on the timeline and in the table", async ({ page, github }) => {
  const names = page.locator(".dept-label .dept-name");
  const analytics = cell(page, "dept:analytics");
  await analytics.focus();
  await expect(analytics).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
  await page.keyboard.press("Alt+ArrowUp");
  await expect(names).toHaveText(["Analytics", "Data Engineering", "ML Platform"]);
  await expect(analytics).toBeFocused();
  await expect.poll(() => heard(page)).toContain("Analytics moved up, 1 of 3.");
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => heard(page)).toContain("Analytics is already first.");
  // Down twice: the heading that moves is the one with focus, and keeps it.
  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.press("Alt+ArrowDown");
  await expect(names).toHaveText(["Data Engineering", "ML Platform", "Analytics"]);
  await expect(analytics).toBeFocused();
  await expect.poll(() => heard(page)).toContain("Analytics moved down, 3 of 3.");
  // Each move is a step to undo.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(names).toHaveText(["Data Engineering", "Analytics", "ML Platform"]);

  // In the table: Data Engineering down a place.
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const toggle = page.locator('.box-table [data-dept-id="data-eng"] .group-toggle');
  await toggle.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.locator(".group-toggle .dept-name")).toHaveText(["Analytics", "Data Engineering", "ML Platform"]);
  await expect(toggle).toBeFocused();
  await expect.poll(() => heard(page)).toContain("Data Engineering moved down, 2 of 3.");
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file("departments/analytics.yaml")).toContain("order: 1\n");
  expect(github.file("departments/data-eng.yaml")).toContain("order: 2\n");
});

test("a box's scale card can be hovered, shows while the box has keyboard focus, and Escape puts it away", async ({ page, github: _ }) => {
  const pop = page.getByRole("tooltip");
  // The pointer can go from the number onto the card, and the card stays.
  const number = box(page, DAGSTER).locator(".box-scale");
  await number.hover();
  await expect(pop).toContainText("Scale 30");
  const card = (await pop.boundingBox())!;
  await page.mouse.move(card.x + 20, card.y + card.height / 2, { steps: 5 });
  await page.waitForTimeout(300);
  await expect(pop).toBeVisible();
  // Escape puts it away, and nothing else happens.
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await page.mouse.move(5, 5);

  // Keyboard focus on a box shows its card; Escape puts it away, focus staying on the box.
  await cell(page, "lane:de-2").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(box(page, DAGSTER)).toBeFocused();
  await expect(pop).toContainText("29% of Data Engineering while it runs");
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(box(page, DAGSTER)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(pop).toContainText("Scale");
  // Picking it up puts the card away.
  await page.keyboard.press("Space");
  await expect(pop).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The card covers the lane below: a click on a box there, the pointer on the card, reaches the box (the card
  // lets it through), and the card goes.
  await number.hover();
  await expect(pop).toContainText("Scale 30");
  const under = await page.evaluate(({ x, y, width, height }) => {
    for (let dy = 10; dy < height; dy += 10) {
      for (let dx = 10; dx < width; dx += 10) {
        const el = document.elementsFromPoint(x + dx, y + dy).find((e) => !e.closest(".scale-pop"));
        const hit = el?.closest<HTMLElement>("[data-box-id]");
        if (hit && el === document.elementFromPoint(x + dx, y + dy)) return { x: x + dx, y: y + dy, title: hit.querySelector(".box-name")!.textContent! };
      }
    }
    return null;
  }, (await pop.boundingBox())!);
  expect(under).not.toBeNull();
  await page.mouse.move(under!.x, under!.y, { steps: 5 });
  await page.waitForTimeout(300);
  await expect(pop).toBeVisible();
  await page.mouse.down();
  await expect(pop).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: `Edit ${under!.title}` })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("⌘S with focus on a lane's name keeps focus there, though it's only text while saving", async ({ page, github: _ }) => {
  await dragDays(page, DAGSTER, 5);
  await cell(page, "lane:de-1").focus();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(toolbar(page)).toContainText("No changes");
  await expect(cell(page, "lane:de-1")).toBeFocused();
  await expect(cell(page, "lane:de-1")).toHaveJSProperty("tagName", "BUTTON");
});

test("? on the timeline lists the keys, and closing the list puts focus back", async ({ page, github: _ }) => {
  await box(page, DAGSTER).focus();
  await page.keyboard.press("?");
  const list = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(list.getByRole("table", { name: "On the timeline" })).toContainText("Pick the box or PTO up, to move it");
  await expect(list.getByRole("table", { name: "Moving a box or PTO" })).toContainText("Put it back");
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(box(page, DAGSTER)).toBeFocused();
});

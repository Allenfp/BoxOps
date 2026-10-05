import type { Locator, Page } from "@playwright/test";
import { CDC, DAGSTER, box, expect, test } from "./helpers";

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
  await press(page, "ControlOrMeta+ArrowDown");
  await expect(cell(page, "chart:ml-platform")).toBeFocused();
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
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(box(page, DAGSTER)).toBeFocused();
  expect(await isFocusVisible(box(page, DAGSTER))).toBe(true);

  // A screen reader's "press" sends a click, not the pointer's press and release.
  await box(page, CDC).dispatchEvent("click");
  await expect(page.getByRole("dialog", { name: "Edit CDC pipeline for orders DB" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box(page, CDC)).toBeFocused();
  // A click opens it too; afterwards focus is on the box, without a ring.
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

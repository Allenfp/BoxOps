import type { Page } from "@playwright/test";
import { PX_PER_DAY } from "../src/timeline/scale";
import type { FakeGitHub } from "./fake-github";
import { CDC, DAGSTER, MONTH_PX, box, boxDates, boxFile, expect, pollNow, save, test, toolbar } from "./helpers";

// Dragging boxes, PTO blocks and department headings: which pointer counts,
// how a drag ends, the lane a tall box lands in, and what stays put meanwhile.

const DASHBOARDS = "bx-2c9e-exec-dashboards";

/** Exec dashboards (an-1, from 2026-10-19) needs 2 FTE, with the lane below it free (someone else's save). */
async function twoFteDashboards(page: Page, github: FakeGitHub) {
  github.deploy(
    github.otherSave({
      [boxFile(DASHBOARDS)]: (t) => t.replace("type: project\n", "type: project\nfte: 2\n"),
      [boxFile("bx-3d0f-attribution-model")]: (t) => t.replace("start: 2026-09-07\nend: 2027-03-26", "start: 2027-04-05\nend: 2027-06-25"),
    }),
  );
  await pollNow(page);
  await expect.poll(async () => (await box(page, DASHBOARDS).boundingBox())!.height).toBeGreaterThan(80);
}

/** Press on a box at `fy` of its height (and 60 px in), and move by dx, dy, holding on. */
async function hold(page: Page, id: string, dx: number, dy: number, fy = 0.5) {
  const b = (await box(page, id).boundingBox())!;
  const x = b.x + Math.min(b.width / 2, 60);
  const y = b.y + b.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
}

test("a 2-FTE box dragged sideways keeps its lane, held by either half; dragged down, its top picks the lane", async ({ page, github }) => {
  await twoFteDashboards(page, github);
  // Held in the middle, which is the lane below its top.
  await hold(page, DASHBOARDS, MONTH_PX * 5, 0);
  await expect(page.locator('.lane-row.drop-target [data-lane="an-1"]')).toHaveCount(1);
  await page.mouse.up();
  // Held low down.
  await hold(page, DASHBOARDS, MONTH_PX * 5, 5, 0.85);
  await page.mouse.up();
  await expect.poll(() => boxDates(page, DASHBOARDS)).toBe("2026-11-02 – 2027-02-12");
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DASHBOARDS))).toContain("lane: an-1\n");
  expect(github.headCommit().message).not.toContain("moved from");

  // One lane down: its top is in the second lane. Further down, it's drawn inside the department still.
  const lanes = page.locator('[data-dept-track="analytics"]');
  await hold(page, DASHBOARDS, 0, 44);
  await expect(page.locator('.lane-row.drop-target [data-lane="an-2"]')).toHaveCount(1);
  await page.mouse.move(700, (await lanes.boundingBox())!.y + (await lanes.boundingBox())!.height - 5, { steps: 4 });
  const dragged = (await page.locator(".box.dragging").boundingBox())!;
  const area = (await lanes.boundingBox())!;
  expect(dragged.y + dragged.height).toBeLessThanOrEqual(area.y + area.height);
  await page.mouse.up();
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DASHBOARDS))).toContain("lane: an-2\n");
});

test("dragging a box in the extra area leaves its department as tall as it was", async ({ page, github: _ }) => {
  const lanes = page.locator('[data-dept-track="data-eng"]');
  const before = (await lanes.boundingBox())!.height;
  const analytics = (await page.locator(".dept-label", { hasText: "Analytics" }).boundingBox())!.y;
  const overflowing = await page.locator(".box.overflowing").getAttribute("data-box-id");
  await hold(page, overflowing!, MONTH_PX * 3, 0);
  await expect(page.locator(".box.dragging")).toHaveCount(1);
  expect((await lanes.boundingBox())!.height).toBe(before);
  expect((await page.locator(".dept-label", { hasText: "Analytics" }).boundingBox())!.y).toBe(analytics);
  await expect(page.locator('[data-dept-track="data-eng"] .overflow-label')).toContainText("Over capacity");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(toolbar(page)).toContainText("No changes");
});

/** The id of the pointer the mouse presses with, as the page sees it. */
async function pointerId(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { pid?: number }).pid ?? -1);
}
const watchPointer = (page: Page) =>
  page.evaluate(() => window.addEventListener("pointerdown", (e) => ((window as unknown as { pid: number }).pid = e.pointerId), true));

test("only the pointer that pressed drags, and a drag whose release is missed is cancelled", async ({ page, github: _ }) => {
  await watchPointer(page);
  // Another pointer's moves and release (a second finger) change nothing.
  await hold(page, DAGSTER, MONTH_PX * 5, 0);
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 999, clientX: 1300, clientY: 400, buttons: 1, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 999, clientX: 1300, clientY: 400, bubbles: true }));
  });
  await expect(page.locator(".drag-dates")).toContainText("2026-09-21 – 2026-10-30");
  await page.mouse.up();
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-21 – 2026-10-30");

  // A move with no button held (the release went elsewhere): the drag is over, nothing moved.
  await hold(page, DAGSTER, MONTH_PX * 5, 0);
  const id = await pointerId(page);
  await page.evaluate((pointerId) => window.dispatchEvent(new PointerEvent("pointermove", { pointerId, clientX: 900, clientY: 300, buttons: 0, bubbles: true })), id);
  await expect(page.locator(".box.dragging")).toHaveCount(0);
  await page.mouse.move(1200, 300, { steps: 3 });
  await page.mouse.up();
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-21 – 2026-10-30");

  // The window losing focus mid-drag (⌘Tab) cancels it too; so does a department heading's.
  await hold(page, DAGSTER, MONTH_PX * 5, 0);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator(".box.dragging")).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-21 – 2026-10-30");
  const heading = (await page.locator(".dept-label", { hasText: "ML Platform" }).boundingBox())!;
  await page.mouse.move(heading.x + 120, heading.y + 10);
  await page.mouse.down();
  await page.mouse.move(heading.x + 120, heading.y - 300, { steps: 6 });
  await expect(page.locator(".reorder-line")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator(".reorder-line")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator(".dept-label .dept-name")).toHaveText(["Data Engineering", "Analytics", "ML Platform"]);
  await expect(toolbar(page)).toContainText("Save · 1 change");
});

test("Escape cancels a drag, and doesn't also close an editor open beside it", async ({ page, github: _ }) => {
  await box(page, CDC).click({ position: { x: 20, y: 10 } });
  const editor = page.getByRole("dialog", { name: /^Edit CDC/ });
  await expect(editor).toBeVisible();
  await hold(page, DAGSTER, MONTH_PX * 5, 0);
  await expect(page.locator(".box.dragging")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".box.dragging")).toHaveCount(0);
  await expect(editor).toBeVisible();
  await page.mouse.up();
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-14 – 2026-10-23");
  await expect(toolbar(page)).toContainText("No changes");
});

const scrollLeft = (page: Page) => page.evaluate(() => document.querySelector(".timeline")!.scrollLeft);

test("scrolling mid-drag carries the box along, and near an edge the timeline scrolls by itself", async ({ page, github: _ }) => {
  // A trackpad or wheel scroll while holding the box: it stays under the pointer.
  await hold(page, DAGSTER, MONTH_PX * 5, 0);
  await page.evaluate((px) => (document.querySelector(".timeline")!.scrollLeft += px), MONTH_PX * 10);
  await expect(page.locator(".drag-dates")).toContainText("2026-10-05 – 2026-11-13");
  await page.mouse.up();
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-10-05 – 2026-11-13");

  // Resting near the right edge, it scrolls on, and the box goes with it.
  const before = await scrollLeft(page);
  const view = (await page.locator(".timeline").boundingBox())!;
  await hold(page, DAGSTER, 0, 0);
  await page.mouse.move(view.x + view.width - 30, view.y + 200, { steps: 5 });
  await expect.poll(() => scrollLeft(page)).toBeGreaterThan(before + 300);
  await page.mouse.move(view.x + view.width / 2, view.y + 200, { steps: 2 }); // off the edge: it stops
  const after = await scrollLeft(page);
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(await scrollLeft(page)).toBe(after);
  const moved = (await boxDates(page, DAGSTER)).split(" – ")[0];
  expect(moved > "2026-11-01").toBe(true);
  await expect(toolbar(page)).toContainText("Save · 1 change");
});

test("a PTO block dragged at quarters zoom moves whole weeks", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Quarters" }).click();
  await page.getByRole("button", { name: "Add PTO in Data Engineering" }).click();
  await page.keyboard.press("Escape");
  const block = page.locator(".pto-block").first();
  await expect(block).toHaveAttribute("title", /2026-10-05 – 2026-10-09/);
  const b = (await block.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + PX_PER_DAY.quarters * 8, b.y + b.height / 2, { steps: 6 }); // 8 days: 2 weeks
  await page.mouse.up();
  await expect(block).toHaveAttribute("title", /2026-10-19 – 2026-10-23/);
});

import type { Locator, Page } from "@playwright/test";
import { PX_PER_DAY } from "../src/timeline/scale";
import type { FakeGitHub } from "./fake-github";
import { CDC, DAGSTER, MONTH_PX, box, boxDates, boxFile, expect, pollNow, save, test, toolbar } from "./helpers";

// Dragging boxes, PTO blocks and department headings: which pointer counts,
// how a drag ends, the lane a tall box lands in, and what stays put meanwhile.

const DASHBOARDS = "bx-2c9e-exec-dashboards";

const REVENUE = "bx-1b8d-revenue-mart";

/**
 * Exec dashboards (an-1, from 2026-10-19) needs 2 FTE, and Revenue mart (an-1, until 2026-10-09)
 * 1.5, with the lane below them free (someone else's save).
 */
async function twoFteDashboards(page: Page, github: FakeGitHub) {
  github.deploy(
    github.otherSave({
      [boxFile(DASHBOARDS)]: (t) => t.replace("type: project\n", "type: project\nfte: 2\n"),
      [boxFile(REVENUE)]: (t) => t.replace("type: project\n", "type: project\nfte: 1.5\n"),
      [boxFile("bx-3d0f-attribution-model")]: (t) => t.replace("start: 2026-09-07\nend: 2027-03-26", "start: 2027-04-05\nend: 2027-06-25"),
    }),
  );
  await pollNow(page);
  await expect.poll(async () => (await box(page, DASHBOARDS).boundingBox())!.height).toBeGreaterThan(80);
}

/** Press on a box at `fy` of its height (and up to 60 px into what's on screen of it, clear of the labels), and move by dx, dy, holding on. */
async function hold(page: Page, id: string, dx: number, dy: number, fy = 0.5) {
  const b = (await box(page, id).boundingBox())!;
  const left = Math.max(b.x, 340); // clear of the labels, and of the edge where a drag scrolls
  const x = left + Math.min((b.x + b.width - left) / 2, 60);
  const y = b.y + b.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
}

test("a 2- or 1.5-FTE box dragged sideways keeps its lane, wherever it's held; dragged down, its top picks the lane", async ({ page, github }) => {
  await twoFteDashboards(page, github);
  // Held in the middle, which is the lane below its top.
  await hold(page, DASHBOARDS, MONTH_PX * 5, 0);
  await expect(page.locator('.lane-row.drop-target [data-lane="an-1"]')).toHaveCount(1);
  await page.mouse.up();
  // Held low down.
  await hold(page, DASHBOARDS, MONTH_PX * 5, 5, 0.85);
  await page.mouse.up();
  await expect.poll(() => boxDates(page, DASHBOARDS)).toBe("2026-11-02 – 2027-02-12");
  // A 1.5-FTE box held in its bottom third, which is over the lane below.
  await hold(page, REVENUE, -MONTH_PX * 5, 0, 0.9);
  await expect(page.locator('.lane-row.drop-target [data-lane="an-1"]')).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(() => boxDates(page, REVENUE)).toBe("2026-07-06 – 2026-10-02");
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DASHBOARDS))).toContain("lane: an-1\n");
  expect(github.file(boxFile(REVENUE))).toContain("lane: an-1\n");
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

test("a finger drags a box or a PTO block, though what it pressed loses the pointer to the timeline", async ({ page, github: _, browserName }) => {
  if (browserName === "chromium") {
    // Real touches, which only Chromium takes from Playwright (through its DevTools protocol).
    // The browser captures a touch to what it pressed; once the drag starts, the timeline takes it.
    await page.getByRole("button", { name: "Add PTO in Data Engineering" }).click();
    await expect(page.getByRole("dialog", { name: /Edit PTO/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const block = page.locator(".pto-block").first();
    await expect(block).toHaveAttribute("title", /2026-10-05 – 2026-10-09/);
    const cdp = await page.context().newCDPSession(page);
    const swipe = async (el: Locator, dx: number) => {
      const b = (await el.boundingBox())!;
      const left = Math.max(b.x, 340); // clear of the labels
      const x = left + Math.min((b.x + b.width - left) / 2, 40);
      const y = b.y + b.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
      for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * i) / 10, y, id: 1 }] });
      await expect(page.locator(".dragging")).toHaveCount(1);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await swipe(box(page, DAGSTER), MONTH_PX * 5);
    await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-21 – 2026-10-30");
    await swipe(block, MONTH_PX * 5);
    await expect(block).toHaveAttribute("title", /2026-10-12 – 2026-10-16/);
    await expect(toolbar(page)).toContainText("Save · 2 changes");
    return;
  }
  // Elsewhere, a mouse drag told that what it pressed lost the pointer, as a touch's would be,
  // carries on. The timeline itself losing it ends the drag, cancelled.
  await watchPointer(page);
  await hold(page, DAGSTER, MONTH_PX * 5, 0);
  const id = await pointerId(page);
  const lose = (el: Locator) => el.evaluate((t, pointerId) => t.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId, bubbles: true })), id);
  await lose(box(page, DAGSTER).locator(".box-name"));
  await expect(page.locator(".box.dragging")).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-21 – 2026-10-30");
  await hold(page, DAGSTER, MONTH_PX * 5, 0);
  await lose(page.locator(".timeline"));
  await expect(page.locator(".box.dragging")).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-21 – 2026-10-30");
  await expect(toolbar(page)).toContainText("Save · 1 change");
});

test("a drag lost with no release to come leaves the keyboard's next click alone", async ({ page, github: _ }) => {
  // Pressed and dragged, then the window left (⌘Tab): the button comes up in another app, so no click follows.
  await box(page, DAGSTER).evaluate((el) => {
    const at = el.getBoundingClientRect();
    const down = { pointerId: 7, isPrimary: true, button: 0, buttons: 1, clientX: at.x + 30, clientY: at.y + 10, bubbles: true };
    el.dispatchEvent(new PointerEvent("pointerdown", down));
    window.dispatchEvent(new PointerEvent("pointermove", { ...down, clientX: down.clientX + 100 }));
  });
  await expect(page.locator(".box.dragging")).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator(".box.dragging")).toHaveCount(0);
  // Enter on a button still presses it.
  await page.getByRole("button", { name: "Weeks" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.url()).toContain("zoom=weeks");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-14 – 2026-10-23");
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

test("a box or PTO block pressed and dragged has focus, but not the keyboard's ring, nor the box its scale card", async ({ page, github }) => {
  const card = page.getByRole("tooltip");
  const ring = (l: Locator) => l.evaluate((el) => el.matches(":focus-visible"));
  /** Released, and the pointer gone elsewhere. */
  const release = async () => {
    await page.mouse.up();
    await page.mouse.move(1300, 850);
    await page.waitForTimeout(300);
  };
  // Sideways: focus stays on it, with no ring and no card.
  await hold(page, DAGSTER, -MONTH_PX * 5, 0);
  await expect(card).toHaveCount(0);
  await release();
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-07 – 2026-10-16");
  await expect(box(page, DAGSTER)).toBeFocused();
  expect(await ring(box(page, DAGSTER))).toBe(false);
  await expect(card).toHaveCount(0);
  // The keyboard's next cell has both; and back, so has the box.
  await page.keyboard.press("ArrowRight");
  await expect(box(page, CDC)).toBeFocused();
  expect(await ring(box(page, CDC))).toBe(true);
  await expect(card).toContainText("Scale");
  await page.keyboard.press("ArrowLeft");
  await expect(box(page, DAGSTER)).toBeFocused();
  expect(await ring(box(page, DAGSTER))).toBe(true);
  await expect(card).toContainText("Scale 30");
  // Pressed, both go.
  await hold(page, DAGSTER, MONTH_PX * 5, 0);
  await expect(card).toHaveCount(0);
  expect(await ring(box(page, DAGSTER))).toBe(false);
  await release();
  await expect(box(page, DAGSTER)).toBeFocused();
  expect(await ring(box(page, DAGSTER))).toBe(false);
  await expect(card).toHaveCount(0);

  // A 2-FTE box dragged down a lane is drawn in another row, a new element: focus is put back on it, still with neither.
  await twoFteDashboards(page, github);
  const before = await box(page, DASHBOARDS).elementHandle();
  await hold(page, DASHBOARDS, 0, 44);
  await release();
  await expect(page.locator(`[data-row="lane:an-2"] [data-box-id="${DASHBOARDS}"]`)).toHaveCount(1);
  expect(await before!.evaluate((el) => el.isConnected)).toBe(false);
  await expect(box(page, DASHBOARDS)).toBeFocused();
  expect(await ring(box(page, DASHBOARDS))).toBe(false);
  await expect(card).toHaveCount(0);

  // A PTO block, focused from the keyboard, then dragged.
  await page.getByRole("button", { name: "Add PTO in Data Engineering" }).click();
  await expect(page.getByRole("dialog", { name: /Edit PTO/ })).toBeVisible();
  await page.keyboard.press("Escape");
  const block = page.locator(".pto-block").first();
  await expect(block).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await expect(block).toBeFocused();
  expect(await ring(block)).toBe(true);
  const b = (await block.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + MONTH_PX * 5, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(block).toHaveAttribute("title", /2026-10-12 – 2026-10-16/);
  await expect(block).toBeFocused();
  expect(await ring(block)).toBe(false);
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
  await expect(page.getByRole("dialog", { name: /Edit PTO/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const block = page.locator(".pto-block").first();
  await expect(block).toHaveAttribute("title", /2026-10-05 – 2026-10-09/);
  const b = (await block.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + PX_PER_DAY.quarters * 8, b.y + b.height / 2, { steps: 6 }); // 8 days: 2 weeks
  await page.mouse.up();
  await expect(block).toHaveAttribute("title", /2026-10-19 – 2026-10-23/);
});

test.describe("in a short window", () => {
  test.use({ viewport: { width: 1440, height: 560 } });

  /** Press at x, y and drag sideways by dx at a person's pace: ten moves, 40 ms apart. */
  async function slowDrag(page: Page, x: number, y: number, dx: number) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x + (dx * i) / 10, y);
      await page.waitForTimeout(40);
    }
  }

  test("a box pressed near an edge scrolls nothing dragged along it or away, only towards it", async ({ page, github: _ }) => {
    const timeline = page.locator(".timeline");
    const scroll = () => timeline.evaluate((el) => [el.scrollLeft, el.scrollTop]);
    // The timeline scrolled down so Dagster is just under the header: dragged sideways, it keeps its lane.
    const head = (await page.locator(".tl-head").boundingBox())!;
    const start = (await box(page, DAGSTER).boundingBox())!;
    await timeline.evaluate((el, dy) => (el.scrollTop += dy), start.y - (head.y + head.height) - 6);
    const before = await scroll();
    expect(before[1]).toBeGreaterThan(0);
    let b = (await box(page, DAGSTER).boundingBox())!;
    expect(b.y + b.height / 2 - (head.y + head.height)).toBeLessThan(40); // pressed in the top edge's zone
    await slowDrag(page, Math.max(b.x, 400) + 30, b.y + b.height / 2, MONTH_PX * 5);
    await page.mouse.up();
    await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-21 – 2026-10-30");
    expect(await scroll()).toEqual(before);
    await expect(page.locator(`[data-row="lane:de-2"] [data-box-id="${DAGSTER}"]`)).toHaveCount(1);

    // Pressed just right of the labels (in the left edge's zone) and dragged right: the days dragged.
    const view = (await timeline.boundingBox())!;
    b = (await box(page, DAGSTER).boundingBox())!;
    await timeline.evaluate((el, dx) => ((el.scrollTop = 0), (el.scrollLeft += dx)), b.x - (view.x + 240) + 200);
    const across = await scroll();
    b = (await box(page, DAGSTER).boundingBox())!;
    expect(b.x).toBeLessThan(view.x + 240); // it runs on under the labels
    await slowDrag(page, view.x + 240 + 20, b.y + b.height / 2, MONTH_PX * 5);
    await page.mouse.up();
    await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-28 – 2026-11-06");
    expect(await scroll()).toEqual(across);

    // Pressed there and dragged on towards the labels, it scrolls.
    await slowDrag(page, view.x + 240 + 20, b.y + b.height / 2, -30);
    await expect.poll(async () => (await scroll())[0]).toBeLessThan(across[0] - 100);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-28 – 2026-11-06");
    await expect(toolbar(page)).toContainText("Save · 1 change");
  });
});

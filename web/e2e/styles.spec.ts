import type { Locator, Page } from "@playwright/test";
import { DAGSTER, box, expect, test } from "./helpers";

// What the stylesheet (src/styles/) must keep doing, checked from computed
// styles rather than screenshots: rules a broader selector used to override,
// layouts that mustn't clip or overflow, and colours that must stay readable.

/** These computed style properties of `el`. */
const css = (el: Locator, ...props: string[]) =>
  el.evaluate((e, ps) => Object.fromEntries(ps.map((p) => [p, getComputedStyle(e).getPropertyValue(p)])), props);

test("the box editor's title is its own: big and borderless, a field only when pointed at or focused", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /^Edit / });
  const title = editor.getByRole("textbox", { name: "Title", exact: true });
  const start = editor.getByRole("textbox", { name: "Start", exact: true });
  await start.focus();
  const { "border-top-color": focused } = await css(start, "border-top-color");
  expect(await css(title, "font-size", "font-weight", "border-top-color", "background-color")).toEqual({
    "font-size": "16px",
    "font-weight": "600",
    "border-top-color": "rgba(0, 0, 0, 0)",
    "background-color": "rgba(0, 0, 0, 0)",
  });
  // Focused, it has the ring every field has.
  await title.focus();
  expect(await css(title, "border-top-color", "outline-style")).toEqual({ "border-top-color": focused, "outline-style": "solid" });
});

test("the Engineers list's names are list items, not the editor's field labels", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  await page.getByRole("dialog", { name: /^Edit / }).getByRole("button", { name: /^Engineers/ }).click();
  const option = page.getByRole("dialog", { name: "Engineers" }).locator(".picker-option").first();
  expect(await css(option, "flex-direction", "font-size", "font-weight")).toEqual({
    "flex-direction": "row",
    "font-size": "13px",
    "font-weight": "400",
  });
});

test("the Engineers list isn't cut off by the box editor's scrolling fields: the last name and the add field show", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  await page.getByRole("dialog", { name: /^Edit / }).getByRole("button", { name: /^Engineers/ }).click();
  const list = page.getByRole("dialog", { name: "Engineers" });
  for (const el of [list.getByRole("checkbox").last(), list.getByRole("textbox", { name: "New engineer name" })]) {
    // What's drawn at its middle is itself, not what's around a box that clips it.
    expect(
      await el.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e && r.bottom <= innerHeight;
      }),
    ).toBe(true);
  }
});

test("team settings: colour swatches fill their 28px button, and names read as fields, not labels", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Team settings…" }).click();
  const dialog = page.getByRole("dialog", { name: "Team settings" });
  expect(await css(dialog.getByLabel("Project colour"), "width", "padding-left", "padding-top")).toEqual({
    width: "28px",
    "padding-left": "2px",
    "padding-top": "2px",
  });
  expect(await css(dialog.getByLabel("Type 1 name"), "font-size", "font-weight")).toEqual({ "font-size": "13px", "font-weight": "400" });
});

test("the department editor's own colour is a field like team settings' colours, filled by its swatch", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Edit Analytics" }).click();
  const custom = page.getByRole("dialog", { name: "Edit Analytics" }).getByLabel("Custom colour");
  expect(await css(custom, "width", "height", "padding-left")).toEqual({ width: "28px", height: "28px", "padding-left": "2px" });
});

test("a warning longer than the warnings menu wraps, read in full rather than cut off", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: /^\d+ warnings?$/ }).click();
  const panel = page.getByRole("dialog", { name: /^\d+ warnings?$/ });
  await expect(panel.locator(".link-button").first()).toBeVisible();
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("in a high-contrast theme, what only colour showed stays: the chosen view, Today, progress, switches, the picked day", async ({ page, browserName, github: _ }) => {
  test.skip(browserName !== "chromium", "only Chromium emulates Windows' contrast themes (forced colours)");
  await page.emulateMedia({ forcedColors: "active" });
  const views = page.getByRole("group", { name: "View" });
  const bg = async (el: Locator, pseudo?: string) => el.evaluate((e, p) => getComputedStyle(e, p).backgroundColor, pseudo);
  expect(await bg(views.getByRole("button", { name: "Timeline" }))).not.toEqual(await bg(views.getByRole("button", { name: "Table" })));
  expect(await bg(page.locator(".today-line"))).not.toEqual(await bg(page.locator(".timeline")));
  // Dagster is under way: half its ring is filled.
  expect(await css(box(page, DAGSTER).locator(".status-mark"), "background-image")).toEqual({
    "background-image": expect.stringContaining("linear-gradient"),
  });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const on = page.locator(".settings-menu .toggle input:checked").first();
  const off = page.locator(".settings-menu .toggle input:not(:checked)").first();
  expect(await css(off, "border-top-style", "border-top-width")).toEqual({ "border-top-style": "solid", "border-top-width": "1px" });
  expect(await bg(on)).not.toEqual(await bg(off));
  expect(await bg(on, "::after")).not.toEqual(await bg(off, "::after"));
  await page.keyboard.press("Escape");

  await box(page, DAGSTER).click();
  await page.getByRole("dialog", { name: /^Edit / }).getByRole("button", { name: "Choose date" }).first().click();
  const calendar = page.getByRole("dialog", { name: "Choose date" });
  expect(await bg(calendar.locator(".calendar-day.selected"))).not.toEqual(await bg(calendar.locator(".calendar-day:not(.selected, .weekend)").first()));
});

test.describe("with less motion asked for", () => {
  test.use({ reducedMotion: "reduce" });

  test("nothing slides: switches and chevrons change at once, and Today is a jump, not a scroll", async ({ page, github: _ }) => {
    expect(await css(page.locator(".chevron").first(), "transition-duration")).toEqual({ "transition-duration": "0s" });
    const timeline = page.locator(".timeline");
    await timeline.evaluate((el) => {
      el.scrollLeft = 0;
      (window as { seen?: number[] }).seen = [];
      el.addEventListener("scroll", () => (window as { seen?: number[] }).seen!.push(el.scrollLeft));
    });
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect.poll(() => timeline.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    // A smooth scroll passes through many places on the way (0 is the scroll to the start, above).
    const seen = await page.evaluate(() => (window as { seen?: number[] }).seen!);
    expect(new Set(seen.filter((x) => x > 0)).size).toBe(1);
  });
});

test.describe("at 1280 px wide", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a long roadmap title is cut short (whole in its tooltip), and Save and the gear stay on screen", async ({ page, github: _ }) => {
    const title = "Enterprise Data Platform Engineering Roadmap 2026–2027";
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Team settings…" }).click();
    await page.getByLabel("Roadmap title").fill(title);
    await page.keyboard.press("Escape");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText(title);
    await expect(h1).toHaveAttribute("title", title);
    expect(await h1.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Save · 1 change" })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test.describe("at 320 px wide (a phone, or a window zoomed to 400%)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("nothing runs off the side: the toolbar wraps, and the box editor is as wide as the window", async ({ page, github: _ }) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const name of ["People", "Quarters", "Today", "Undo", "Settings"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
    }
    await box(page, DAGSTER).focus();
    await page.keyboard.press("Enter");
    const editor = page.getByRole("dialog", { name: /^Edit / });
    await expect(editor).toBeInViewport({ ratio: 1 });
    expect(await editor.locator(".editor-body").evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  });
});

test.describe("at 1024 px wide", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("People's names stay put while the table scrolls sideways", async ({ page, github: _ }) => {
    await page.getByRole("button", { name: "People", exact: true }).click();
    const scroller = page.locator(".table-scroll");
    const name = page.locator(".people-table td.col-name").first();
    const x = (await name.boundingBox())!.x;
    await scroller.evaluate((el) => (el.scrollLeft = el.scrollWidth));
    expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(300);
    expect((await name.boundingBox())!.x).toBe(x);
  });
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("what otherwise shows only on hover is always there: ✎, +, a row's Delete, a date's calendar button", async ({ page, browserName, github: _ }) => {
    test.skip(browserName === "firefox", "Firefox can't emulate a screen without hover");
    expect(await css(page.locator(".dept-edit").first(), "opacity")).toEqual({ opacity: "1" });
    expect(await css(page.locator(".pto-add").first(), "opacity")).toEqual({ opacity: "1" });
    expect(await css(page.locator(".lane-name .edit-icon").first(), "opacity")).toEqual({ opacity: "1" });
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await expect(page.locator(".box-table")).toBeVisible();
    expect(await css(page.locator(".row-delete").first(), "opacity")).toEqual({ opacity: "1" });
    expect(await css(page.locator(".box-table .date-pick").first(), "opacity")).toEqual({ opacity: "0.75" });
  });
});

/**
 * Controls on screen too small for WCAG 2.5.8 (24 by 24 px) and too close to another: a 24 px circle round
 * their middle reaches another control (where it shows: not one under a panel) or another small one's circle.
 * A box's resize handles and a collapsed department's compact boxes are small by design (docs/architecture.md),
 * and aren't looked at.
 */
async function crowded(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const on = (el: Element, x: number, y: number) => {
      const top = document.elementFromPoint(x, y);
      return !!top && (el.contains(top) || top.contains(el));
    };
    const controls = [...document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex], [data-cell]")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && on(el, r.x + r.width / 2, r.y + r.height / 2);
    });
    const rects = controls.map((el) => el.getBoundingClientRect());
    const centre = (r: DOMRect) => [r.x + r.width / 2, r.y + r.height / 2];
    const small = (r: DOMRect) => r.width < 24 || r.height < 24;
    const name = (el: Element) => el.getAttribute("aria-label") || el.textContent!.trim().slice(0, 30) || el.className;
    return controls.flatMap((el, i) => {
      if (!small(rects[i])) return [];
      const [cx, cy] = centre(rects[i]);
      const near = controls.filter((other, j) => {
        if (i === j || el.contains(other) || other.contains(el)) return false;
        const q = rects[j];
        const [x, y] = [Math.min(Math.max(cx, q.left), q.right - 0.5), Math.min(Math.max(cy, q.top), q.bottom - 0.5)];
        if (Math.hypot(x - cx, y - cy) < 12 && on(other, x, y)) return true;
        const [ox, oy] = centre(q);
        return small(q) && Math.hypot(ox - cx, oy - cy) < 24;
      });
      return near.length ? [`${name(el)} (${Math.round(rects[i].width)}×${Math.round(rects[i].height)}) is close to ${near.map(name).join(", ")}`] : [];
    });
  });
}

test("every control is 24 px or has room round it (WCAG 2.5.8), in each view, editor, dialog and menu", async ({ page, github: _ }) => {
  expect(await crowded(page)).toEqual([]);
  await box(page, DAGSTER).click();
  await expect(page.getByRole("dialog", { name: /^Edit / })).toBeVisible();
  expect(await crowded(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit Analytics" }).click();
  const dept = page.getByRole("dialog", { name: "Edit Analytics" });
  await expect(dept.getByRole("button", { name: "Add lane" })).toBeVisible();
  expect(await crowded(page)).toEqual([]);
  await dept.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Team settings…" })).toBeVisible();
  expect(await crowded(page)).toEqual([]);
  await page.getByRole("button", { name: "Team settings…" }).click();
  await expect(page.getByRole("dialog", { name: "Team settings" }).getByRole("button", { name: "Add type" })).toBeVisible();
  expect(await crowded(page)).toEqual([]);
  await page.keyboard.press("Escape");
  for (const view of ["Table", "People"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(page.getByRole("main", { name: view }).locator("tbody tr").first()).toBeVisible();
    expect(await crowded(page)).toEqual([]);
  }
});

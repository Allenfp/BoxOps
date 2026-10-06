import type { Locator } from "@playwright/test";
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

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

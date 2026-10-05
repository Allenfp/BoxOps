import type { Page } from "@playwright/test";
import { DAGSTER, dragDays, expect, save, test, toolbar } from "./helpers";

// Code fetched when it's first needed: what saving needs (with the yaml
// library) once someone starts editing, never just to show the roadmap.

/** The app's JavaScript files the page has asked for, by name without the hash: "index", "parse", "saving"… */
function scripts(page: Page): string[] {
  const names: string[] = [];
  page.on("request", (r) => {
    const m = /\/assets\/([\w-]+)-[\w-]{8}\.js$/.exec(new URL(r.url()).pathname);
    if (m) names.push(m[1]);
  });
  return names;
}

test("the deployed copy shows without the YAML parser; an edit fetches what saving needs", async ({ page, github }) => {
  const asked = scripts(page);
  await page.reload();
  await expect(page.locator(".box").first()).toBeVisible();
  await expect.poll(() => github.calls("ref")).toBe(2); // the check for newer saves is done too
  expect(asked).toEqual(["index"]);
  await dragDays(page, DAGSTER, 10);
  await expect.poll(() => asked.toSorted()).toEqual(["index", "parse", "saving"]);
  await save(page);
  await expect(page.locator(".banner.success")).toContainText("Saved to main");
});

test("a save made before saving's code arrives waits for it, and saves once", async ({ page, github }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/assets\/saving-[\w-]+\.js$/, async (route) => {
    await held;
    await route.fallback();
  });
  await dragDays(page, DAGSTER, 10);
  await save(page);
  await save(page);
  await page.waitForTimeout(200);
  expect(github.calls("graphql")).toBe(0);
  release();
  await expect(page.locator(".banner.success")).toContainText("Saved to main");
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.calls("graphql")).toBe(1);
});

test("saving's code that can't load (a deploy replaced it): the save says so, and the changes stay", async ({ page, github }) => {
  await page.route(/\/assets\/saving-[\w-]+\.js$/, (route) => route.abort("connectionreset"));
  await dragDays(page, DAGSTER, 10);
  await save(page);
  const dialog = page.locator(".save-dialog[open]");
  await expect(dialog).toContainText("Part of BoxOps couldn’t load, so nothing was saved");
  await expect(dialog).toContainText("reload it, then save");
  await dialog.locator(".dialog-foot").getByRole("button", { name: "Close" }).click();
  await expect(toolbar(page)).toContainText("Save · 1 change");
  expect(github.calls("graphql")).toBe(0);
});

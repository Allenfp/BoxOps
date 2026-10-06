import type { Page, Route } from "@playwright/test";
import { REPO, TOKEN } from "./fake-github";
import { DAGSTER, dragDays, expect, heard, save, test, toolbar } from "./helpers";

// Code fetched when it's first needed: what saving needs (with the yaml
// library) once someone starts editing, never just to show the roadmap; a
// view when the pointer reaches its tab; editors once the roadmap is up; the
// GitHub client once the roadmap shows.

/** The app's JavaScript files the page has asked for, by name without the hash: "index", "parse", "saving", "TableView"… */
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
  expect(asked[0]).toBe("index");
  expect(asked).not.toContain("parse");
  expect(asked).not.toContain("saving");
  await dragDays(page, DAGSTER, 10);
  await expect.poll(() => asked).toEqual(expect.arrayContaining(["parse", "saving", "SaveDialog"]));
  await save(page);
  await expect(page.locator(".banner.success")).toContainText("Saved to main");
});

/** Hold the app's file `name` back until the returned function is called. */
async function holdBack(page: Page, name: string): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(new RegExp(`/assets/${name}-[\\w-]+\\.js$`), async (route) => {
    await held;
    await route.fallback();
  });
  return release;
}

test.describe("a private repository, a token pasted later", () => {
  test.use({ signedIn: false, visibility: "private" });

  test("the timeline shows without the GitHub client, which then checks for newer saves", async ({ page, github }) => {
    // No token: no call to GitHub, and so no GitHub client fetched.
    const asked = scripts(page);
    expect(github.calls("ref")).toBe(0);
    const release = await holdBack(page, "remote");
    await page.evaluate(([key, token]) => sessionStorage.setItem(key, token), [`boxops-github-token:${REPO}`, TOKEN]);
    await page.reload();
    await expect(page.locator(".box").first()).toBeVisible();
    await expect.poll(() => asked).toContain("remote");
    await page.waitForTimeout(200);
    expect(github.calls("ref")).toBe(0);
    release();
    await expect.poll(() => github.calls("ref")).toBe(1);
  });
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

/** Route `url` to fail, once `drop()` is called: so a fetch started ahead and the one that shows the part fail as one. */
async function failLater(page: Page, url: RegExp) {
  let drop!: () => void;
  const dropped = new Promise<void>((resolve) => (drop = resolve));
  const fail = async (route: Route) => {
    await dropped;
    await route.abort("connectionreset");
  };
  await page.route(url, fail);
  return { drop, restore: () => page.unroute(url, fail) };
}

test("saving's code that can't load (offline, or a deploy replaced it): the save says so, the changes stay; then Try again or Reload", async ({ page, github, browserName }) => {
  const saving = await failLater(page, /\/assets\/saving-[\w-]+\.js$/);
  await dragDays(page, DAGSTER, 10);
  await save(page);
  saving.drop();
  const dialog = page.locator(".save-dialog[open]");
  const foot = dialog.locator(".dialog-foot");
  await expect(dialog.locator(".callout.error")).toContainText("Part of BoxOps couldn’t load, so nothing was saved");
  await expect(dialog.locator(".callout.error")).toContainText(
    "Check your connection and try again; if the site was updated since this page opened, reload, then save.",
  );
  await expect(foot.getByRole("button", { name: "Reload" })).toBeVisible();
  expect(github.calls("graphql")).toBe(0);

  await saving.restore();
  await foot.getByRole("button", { name: "Try again" }).click();
  if (browserName === "firefox") {
    // Fetched again.
    await expect(toolbar(page)).toContainText("No changes");
    expect(github.calls("graphql")).toBe(1);
  } else {
    // WebKit and Chromium keep a module file that failed to load until the page reloads: so the dialog says.
    await expect(dialog.locator(".callout.error")).toContainText("Once you’re connected, reload the page, then save.");
    await expect(foot.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(foot.getByRole("button", { name: "Reload" })).toHaveClass(/primary/);
    await foot.getByRole("button", { name: "Close" }).click();
    await expect(toolbar(page)).toContainText("Save · 1 change");
    expect(github.calls("graphql")).toBe(0);
  }
});

test("a view's code is fetched when the pointer reaches its tab", async ({ page, github: _ }) => {
  const asked = scripts(page);
  await page.getByRole("button", { name: "People", exact: true }).hover();
  await expect.poll(() => asked).toContain("PeopleView");
  expect(asked).not.toContain("TableView");
  await page.getByRole("button", { name: "Table", exact: true }).focus();
  await expect.poll(() => asked).toContain("TableView");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.locator(".box-table")).toBeVisible();
});

/** What a part that couldn't load says, the first time, and once trying again in this page may not help. */
const FIRST = "This part of BoxOps couldn’t load. Check your connection and try again; if the site was updated since this page opened, reload.";
const AGAIN = "This part of BoxOps couldn’t load. Once you’re connected, reload the page.";

test("a view whose code can't load (offline, or a deploy replaced it) says so; Try again fetches it again, or says to reload", async ({ page, github: _, browserName }) => {
  const table = await failLater(page, /\/assets\/TableView-[\w-]+\.js$/);
  const tab = page.getByRole("button", { name: "Table", exact: true });
  await tab.click();
  table.drop();
  const banner = page.locator(".banner", { hasText: "This part of BoxOps couldn’t load" });
  await expect(banner).toContainText(FIRST);
  await expect(banner.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect.poll(() => heard(page)).toContain(FIRST);

  await table.restore();
  await banner.getByRole("button", { name: "Try again" }).focus();
  await page.keyboard.press("Enter");
  if (browserName === "firefox") {
    await expect(page.locator(".box-table")).toBeVisible();
    await expect(banner).toHaveCount(0);
  } else {
    // WebKit and Chromium keep a module file that failed to load until the page reloads.
    await expect(banner).toContainText(AGAIN);
    await expect(banner.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(banner.getByRole("button", { name: "Reload" })).toBeVisible();
    await expect.poll(() => heard(page)).toContain(AGAIN);
  }
  // The banner it was in has gone: focus is on the roadmap, not the page.
  await expect(page.getByRole("main")).toBeFocused();
  // The other views work either way.
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.locator(".box").first()).toBeVisible();
});

test("a view fetched ahead while offline: showing it fetches it again where the browser can, or says to reload", async ({ page, github: _, browserName }) => {
  const asked = scripts(page);
  const table = await failLater(page, /\/assets\/TableView-[\w-]+\.js$/);
  await page.getByRole("button", { name: "Table", exact: true }).hover();
  await expect.poll(() => asked).toContain("TableView");
  table.drop();
  await page.waitForTimeout(100);
  await table.restore();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  if (browserName === "firefox") {
    await expect(page.locator(".box-table")).toBeVisible();
    await expect(page.locator(".banner")).toHaveCount(0);
  } else {
    // WebKit and Chromium keep the failure until the page reloads: so it says.
    await expect(page.locator(".banner")).toContainText(AGAIN);
  }
});

test("a view's tab says it's loading until its code is here, the view on screen staying meanwhile", async ({ page, github: _ }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/assets\/PeopleView-[\w-]+\.js$/, async (route) => {
    await held;
    await route.fallback();
  });
  const people = page.getByRole("button", { name: "People", exact: true });
  await people.click();
  await expect(people).toHaveAttribute("aria-busy", "true");
  await expect(people).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".box").first()).toBeVisible();
  release();
  await expect(people).toHaveAttribute("aria-pressed", "true");
  await expect(people).not.toHaveAttribute("aria-busy", /./);
});

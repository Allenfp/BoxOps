import type { Page, Route } from "@playwright/test";
import { REPO, TOKEN } from "./fake-github";
import { DAGSTER, box, boxDates, dragDays, expect, heard, save, test, toolbar } from "./helpers";

// Code fetched when it's first needed: what saving needs (with the yaml
// library) once someone starts editing, never just to show the roadmap; a
// view when the pointer reaches its tab; editors once the roadmap is up; the
// GitHub client once the roadmap shows; a keyboard move once the timeline
// has focus; the key and the shortcuts when they first open.

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

test("Space on a box before a keyboard move's code is here picks the box up once it is, and the keys pressed meanwhile move it", async ({
  page,
  github: _,
}) => {
  const asked = scripts(page);
  const release = await holdBack(page, "keyMove");
  await page.reload();
  await expect(page.locator(".box").first()).toBeVisible();
  expect(asked).not.toContain("keyMove");
  // Fetched once the timeline has focus.
  await box(page, DAGSTER).focus();
  await expect.poll(() => asked).toContain("keyMove");
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(box(page, DAGSTER)).not.toHaveClass(/dragging/);
  await expect(box(page, DAGSTER)).toBeFocused(); // the arrow went nowhere else
  release();
  await expect(box(page, DAGSTER)).toHaveClass(/dragging/);
  await expect(page.locator(".drag-dates")).toContainText("2026-09-22 – 2026-11-02");
  await expect(box(page, DAGSTER)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-22 – 2026-11-02");
});

test("a key pressed just as a keyboard move's code arrives, before the move is drawn, is the move's", async ({ page, github: _ }) => {
  // The code is held back, then served with lines that press Enter on what has focus once the app's own
  // callbacks for its arrival have run, but before any later task (as React's drawing of the move is).
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/assets\/keyMove-[\w-]+\.js$/, async (route) => {
    await held;
    const response = await route.fetch();
    const enter = `;(() => {
      let after = Promise.resolve();
      for (let i = 0; i < 30; i++) after = after.then(() => {});
      after.then(() => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true })));
    })();`;
    await route.fulfill({ response, body: (await response.text()) + enter });
  });
  await page.reload();
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  release();
  // Moved a day, and dropped by that Enter.
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await expect(box(page, DAGSTER)).not.toHaveClass(/dragging/);
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-15 – 2026-10-26");
  await expect(box(page, DAGSTER)).toBeFocused();
});

test("a keyboard move's code that hasn't come 4 seconds after Space: the keys are the timeline's again", async ({ page, github: _ }) => {
  const release = await holdBack(page, "keyMove");
  await page.reload();
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight"); // held for the move
  await expect(box(page, DAGSTER)).toBeFocused();
  await page.clock.fastForward(4_000);
  await expect.poll(() => heard(page)).toContain("Moving from the keyboard is taking a while to load. Press Space again to pick the box up.");
  await page.keyboard.press("ArrowRight");
  await expect(box(page, DAGSTER)).not.toBeFocused();
  // Its arrival then picks nothing up; Space does, once it's here.
  release();
  await page.waitForTimeout(300);
  await expect(page.locator(".dragging")).toHaveCount(0);
  await page.keyboard.press("ArrowLeft");
  await expect(box(page, DAGSTER)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(box(page, DAGSTER)).toHaveClass(/dragging/);
  await page.keyboard.press("Escape");
  await expect(toolbar(page)).toContainText("No changes");
});

test("Tab before a keyboard move's code is here goes on, as it does mid-move: the box is moved once it's here, and dropped", async ({
  page,
  github: _,
}) => {
  const release = await holdBack(page, "keyMove");
  await page.reload();
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Tab");
  await expect(box(page, DAGSTER)).not.toBeFocused();
  release();
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-15 – 2026-10-26");
  await expect(page.locator(".dragging")).toHaveCount(0);
});

test("a press before a keyboard move's code is here leaves the box where it is", async ({ page, github: _ }) => {
  const release = await holdBack(page, "keyMove");
  await page.reload();
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Space");
  await page.mouse.click(5, 300); // the label column
  release();
  await page.waitForTimeout(300);
  await expect(box(page, DAGSTER)).not.toHaveClass(/dragging/);
  await expect(toolbar(page)).toContainText("No changes");
});

test("the key and the keyboard shortcuts are fetched when they first open", async ({ page, github: _ }) => {
  const asked = scripts(page);
  await page.reload();
  await expect(page.locator(".box").first()).toBeVisible();
  await page.waitForTimeout(1500); // the editors are fetched a second after the roadmap shows; these aren't
  expect(asked).not.toContain("KeyContent");
  expect(asked).not.toContain("SettingsPanel");
  await box(page, DAGSTER).focus();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText("Undo");
  expect(asked).toContain("SettingsPanel");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Key…" }).click();
  await expect(page.getByRole("dialog", { name: "Key" })).toContainText("Over capacity");
  expect(asked).toContain("KeyContent");
});

test("keys pressed while the shortcuts are on their way: undo waits, and Esc takes the list back", async ({ page, github: _ }) => {
  await dragDays(page, DAGSTER, 5);
  const release = await holdBack(page, "SettingsPanel");
  await box(page, DAGSTER).focus();
  await page.keyboard.press("?");
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(200);
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await page.keyboard.press("Escape");
  release();
  await page.waitForTimeout(300);
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
  await expect(box(page, DAGSTER)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(toolbar(page)).toContainText("No changes");
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

import type { Page, Route } from "@playwright/test";
import { REPO, TOKEN } from "./fake-github";
import { DAGSTER, box, boxDates, boxFile, dragDays, expect, heard, save, test, toolbar } from "./helpers";

// Code fetched when it's first needed: what saving needs (with the yaml
// library) once someone starts editing, never just to show the roadmap; a
// view when the pointer reaches its tab; editors once the roadmap is up; the
// GitHub client once the roadmap shows; a keyboard move once the timeline
// is drawn; the key and the shortcuts when they first open.

/** The app's JavaScript files the page has asked for, by name without the hash: "index", "parse", "saving", "TableView"… */
function scripts(page: Page): string[] {
  const names: string[] = [];
  page.on("request", (r) => {
    const m = /\/assets\/([\w-]+)-[\w-]{8}\.js$/.exec(new URL(r.url()).pathname);
    if (m) names.push(m[1]);
  });
  return names;
}
/**
 * The app opened again, from another page of the site (its licences: so nothing the app had open
 * before is still fetching what it fetches ahead), and the JavaScript files it asks for (scripts()).
 */
async function openedAfresh(page: Page): Promise<string[]> {
  await page.goto("./licenses.txt");
  const asked = scripts(page);
  await page.goto("./?zoom=months");
  return asked;
}

test("the deployed copy shows without the YAML parser; an edit fetches what saving needs", async ({ page, github }) => {
  const asked = await openedAfresh(page);
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

test("a keyboard move's code is fetched once the timeline is drawn, with nothing pressed or focused", async ({ page, github: _ }) => {
  const asked = await openedAfresh(page);
  await expect(page.locator(".box").first()).toBeVisible();
  await expect.poll(() => asked).toContain("keyMove");
  expect(await page.evaluate(() => !document.activeElement?.closest("[role=grid]"))).toBe(true);
});

/** A keyboard move's code held back: the page's request for it waits until `release()`, and is then answered by `serve`. */
interface HeldMoveCode {
  release(): void;
  serve(route: Route): Promise<void>;
}
const heldCode = new WeakMap<Page, HeldMoveCode>();
/**
 * The tests below hold a keyboard move's code back from the page's first load, which fetches it
 * once the timeline is drawn: once fetched, WebKit may take it from its memory cache after a
 * reload, which no route sees.
 */
const moveHeld = test.extend<{ moveCode: HeldMoveCode }>({
  page: async ({ page }, use) => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const held: HeldMoveCode = { release, serve: (route) => route.fallback() };
    await page.route(/\/assets\/keyMove-[\w-]+\.js$/, async (route) => {
      await released;
      await held.serve(route);
    });
    heldCode.set(page, held);
    await use(page);
  },
  moveCode: async ({ page }, use) => use(heldCode.get(page)!),
});

moveHeld.describe("a keyboard move before its code is here", () => {
  moveHeld("Space on a box picks the box up once it's here, and the keys pressed meanwhile move it", async ({ page, github: _, moveCode }) => {
    await box(page, DAGSTER).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(box(page, DAGSTER)).not.toHaveClass(/dragging/);
    await expect(box(page, DAGSTER)).toBeFocused(); // the arrow went nowhere else
    moveCode.release();
    await expect(box(page, DAGSTER)).toHaveClass(/dragging/);
    await expect(page.locator(".drag-dates")).toContainText("2026-09-22 – 2026-11-02");
    await expect(box(page, DAGSTER)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toolbar(page)).toContainText("Save · 1 change");
    await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-22 – 2026-11-02");
  });

  moveHeld("a key pressed just as the code arrives, before the move is drawn, is the move's", async ({ page, github: _, moveCode }) => {
    // Served with lines that press Enter on what has focus once the app's own callbacks for its
    // arrival have run, but before any later task (as React's drawing of the move is).
    moveCode.serve = async (route) => {
      const response = await route.fetch();
      const enter = `;(() => {
        let after = Promise.resolve();
        for (let i = 0; i < 30; i++) after = after.then(() => {});
        after.then(() => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true })));
      })();`;
      await route.fulfill({ response, body: (await response.text()) + enter });
    };
    await box(page, DAGSTER).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    moveCode.release();
    // Moved a day, and dropped by that Enter.
    await expect(toolbar(page)).toContainText("Save · 1 change");
    await expect(box(page, DAGSTER)).not.toHaveClass(/dragging/);
    await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-15 – 2026-10-26");
    await expect(box(page, DAGSTER)).toBeFocused();
  });

  moveHeld("code that hasn't come 4 seconds after Space: the keys are the timeline's again", async ({ page, github: _, moveCode }) => {
    await box(page, DAGSTER).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight"); // held for the move
    await expect(box(page, DAGSTER)).toBeFocused();
    await page.clock.fastForward(4_000);
    await expect.poll(() => heard(page)).toContain("Moving from the keyboard is taking a while to load. Press Space again to pick the box up.");
    await page.keyboard.press("ArrowRight");
    await expect(box(page, DAGSTER)).not.toBeFocused();
    // Its arrival then picks nothing up; Space does, once it's here.
    moveCode.release();
    await page.waitForTimeout(300);
    await expect(page.locator(".dragging")).toHaveCount(0);
    await page.keyboard.press("ArrowLeft");
    await expect(box(page, DAGSTER)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(box(page, DAGSTER)).toHaveClass(/dragging/);
    await page.keyboard.press("Escape");
    await expect(toolbar(page)).toContainText("No changes");
  });

  moveHeld("a press before it's here leaves the box where it is", async ({ page, github: _, moveCode }) => {
    await box(page, DAGSTER).focus();
    await page.keyboard.press("Space");
    await page.mouse.click(5, 300); // the label column
    moveCode.release();
    await page.waitForTimeout(300);
    await expect(box(page, DAGSTER)).not.toHaveClass(/dragging/);
    await expect(toolbar(page)).toContainText("No changes");
  });
});

// Every key pressed after Space is held till the code is here (none reaches the grid or the app
// before), then goes where it would have gone had the code been here: each once, in order. Each
// test waits for what only that can do.
moveHeld.describe("keys pressed before a keyboard move's code is here", () => {
  /**
   * Press `keys` with the code held back: each is held for it, so none has done anything yet,
   * nor reached the grid early: focus is still on Dagster, nothing is picked up, opened, added
   * or changed.
   */
  async function pressHeld(page: Page, ...keys: string[]) {
    const boxes = await page.locator("[data-box-id]").count();
    await box(page, DAGSTER).focus();
    for (const key of keys) await page.keyboard.press(key);
    await expect(box(page, DAGSTER)).toBeFocused();
    await expect(page.locator(".dragging")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(toolbar(page)).toContainText("No changes");
    expect(await page.locator("[data-box-id]").count()).toBe(boxes);
  }
  /** How many times the app has said `text` so far (messages asked for together are read as one). */
  const times = async (page: Page, text: string) => (await heard(page)).split(text).length - 1;

  moveHeld("Space, →, →, →, Enter: moved three working days, once each, and dropped", async ({ page, github: _, moveCode }) => {
    await pressHeld(page, "Space", "ArrowRight", "ArrowRight", "ArrowRight", "Enter");
    moveCode.release();
    await expect.poll(() => heard(page)).toContain("Dropped: Dagster 2.x upgrade, 2026-09-17 to 2026-10-28, Data Engineering / FTE 2.");
    await expect(toolbar(page)).toContainText("Save · 1 change");
    await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-17 – 2026-10-28");
    await expect(box(page, DAGSTER)).toBeFocused();
    await expect(page.locator(".dragging")).toHaveCount(0);
  });

  moveHeld("Space, ←, Enter: moved a day earlier and dropped; ← never reached the grid, so Enter added no box with its lane's +", async ({
    page,
    github: _,
    moveCode,
  }) => {
    const boxes = await page.locator("[data-box-id]").count();
    await pressHeld(page, "Space", "ArrowLeft", "Enter");
    moveCode.release();
    await expect.poll(() => heard(page)).toContain("Dropped: Dagster 2.x upgrade, 2026-09-11 to 2026-10-22, Data Engineering / FTE 2.");
    await expect(toolbar(page)).toContainText("Save · 1 change");
    await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-11 – 2026-10-22");
    await expect(box(page, DAGSTER)).toBeFocused();
    expect(await page.locator("[data-box-id]").count()).toBe(boxes);
  });

  moveHeld("Space, →, ←, →, Enter: each step in order, and dropped a day later", async ({ page, github: _, moveCode }) => {
    await pressHeld(page, "Space", "ArrowRight", "ArrowLeft", "ArrowRight", "Enter");
    moveCode.release();
    await expect.poll(() => heard(page)).toContain("Dropped: Dagster 2.x upgrade, 2026-09-15 to 2026-10-26, Data Engineering / FTE 2.");
    await expect(toolbar(page)).toContainText("Save · 1 change");
    await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-15 – 2026-10-26");
  });

  moveHeld("Space, →, ⌘S: the box moved, dropped and saved, once, as mid-move", async ({ page, github, moveCode }) => {
    const saves = github.calls("graphql");
    await pressHeld(page, "Space", "ArrowRight", "ControlOrMeta+s");
    moveCode.release();
    await expect.poll(() => github.file(boxFile(DAGSTER))).toContain("start: 2026-09-15\nend: 2026-10-26\n");
    await expect(toolbar(page)).toContainText("No changes");
    await expect(page.locator(".dragging")).toHaveCount(0);
    expect(github.calls("graphql") - saves).toBe(1);
  });

  moveHeld("Space, Tab: Tab goes on at once, as it does mid-move; the box is dropped where it was once the code is here", async ({
    page,
    github: _,
    moveCode,
  }) => {
    await box(page, DAGSTER).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(box(page, DAGSTER)).not.toBeFocused();
    const focused = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80));
    moveCode.release();
    await expect.poll(() => heard(page)).toContain("Dropped where it was: Dagster 2.x upgrade.");
    await expect(page.locator(".dragging")).toHaveCount(0);
    await expect(toolbar(page)).toContainText("No changes");
    // Focus stayed where Tab took it.
    expect(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))).toBe(focused);
  });

  moveHeld("Space, →, Tab: Tab goes on at once; the box is moved once the code is here, and dropped", async ({ page, github: _, moveCode }) => {
    await box(page, DAGSTER).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Tab");
    await expect(box(page, DAGSTER)).not.toBeFocused();
    moveCode.release();
    await expect.poll(() => heard(page)).toContain("Dropped: Dagster 2.x upgrade, 2026-09-15 to 2026-10-26, Data Engineering / FTE 2.");
    await expect(toolbar(page)).toContainText("Save · 1 change");
    await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-15 – 2026-10-26");
    await expect(page.locator(".dragging")).toHaveCount(0);
    await expect(box(page, DAGSTER)).not.toBeFocused();
  });

  moveHeld("Space, →, Escape: put back where it was once the code is here", async ({ page, github: _, moveCode }) => {
    await pressHeld(page, "Space", "ArrowRight", "Escape");
    moveCode.release();
    await expect.poll(() => heard(page)).toContain("Move cancelled: Dagster 2.x upgrade is back at 2026-09-14 to 2026-10-23.");
    await expect(page.locator(".dragging")).toHaveCount(0);
    await expect(toolbar(page)).toContainText("No changes");
    await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-14 – 2026-10-23");
    await expect(box(page, DAGSTER)).toBeFocused();
  });

  moveHeld("keys after a drop are the grid's: Space, →, Enter, Space, ←, Enter moves it a day and back, two steps", async ({
    page,
    github: _,
    moveCode,
  }) => {
    await pressHeld(page, "Space", "ArrowRight", "Enter", "Space", "ArrowLeft", "Enter");
    moveCode.release();
    await expect.poll(() => times(page, "Dropped: Dagster 2.x upgrade")).toBe(2);
    await expect(toolbar(page)).toContainText("No changes");
    await expect(box(page, DAGSTER)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(toolbar(page)).toContainText("Save · 1 change");
    await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-15 – 2026-10-26");
  });

  moveHeld("keys after a drop are the grid's: Space, ←, Enter, →, Enter drops it, then opens the box after it", async ({ page, github: _, moveCode }) => {
    await pressHeld(page, "Space", "ArrowLeft", "Enter", "ArrowRight", "Enter");
    moveCode.release();
    await expect(page.getByRole("dialog", { name: "Edit CDC pipeline for orders DB" })).toBeVisible();
    await expect(toolbar(page)).toContainText("Save · 1 change");
    await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-11 – 2026-10-22");
  });

  moveHeld("released part way, Space, →, Enter, Space held, then ← and Enter as it's picked up again: moved and back, no box added", async ({
    page,
    github: _,
    moveCode,
  }) => {
    const boxes = await page.locator("[data-box-id]").count();
    await pressHeld(page, "Space", "ArrowRight", "Enter", "Space");
    moveCode.release();
    // Dropped, then picked up again by the Space after it: ← is the move's, not the grid's.
    await expect.poll(() => times(page, "Dropped: Dagster 2.x upgrade")).toBe(1);
    await expect(box(page, DAGSTER)).toHaveClass(/dragging/);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await expect.poll(() => times(page, "Dropped: Dagster 2.x upgrade")).toBe(2);
    await expect(toolbar(page)).toContainText("No changes");
    await expect(box(page, DAGSTER)).toBeFocused();
    expect(await page.locator("[data-box-id]").count()).toBe(boxes);
  });

  moveHeld("the browser's own shortcuts aren't held: ⌘F or Ctrl+F reaches the page as pressed", async ({ page, github: _, moveCode }) => {
    await page.evaluate(() => {
      const w = window as unknown as { found?: boolean };
      document.addEventListener("keydown", (e) => (w.found ||= e.key === "f" && (e.metaKey || e.ctrlKey) && e.isTrusted));
    });
    await box(page, DAGSTER).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ControlOrMeta+f");
    expect(await page.evaluate(() => (window as unknown as { found?: boolean }).found)).toBe(true);
    moveCode.release();
    await expect(box(page, DAGSTER)).toHaveClass(/dragging/);
  });
});

/** In the page: count each import of the app's code that fails, which Vite's loader says (vite:preloadError). */
function countFailedImports() {
  const w = window as unknown as { failedImports: number };
  w.failedImports = 0;
  addEventListener("vite:preloadError", () => w.failedImports++);
}
/** How many have failed since countFailedImports(). */
const failedImports = (page: Page) => page.evaluate(() => (window as unknown as { failedImports: number }).failedImports);

/**
 * A keyboard move's code that can't be fetched the first `fails` times (the first once the
 * timeline is drawn), and can be after; `fetches`, the query of each fetch of it. Failed imports
 * are counted from the page's first load.
 */
const moveFetches = new WeakMap<Page, string[]>();
const moveFails = test.extend<{ fails: number; fetches: string[] }>({
  fails: [1, { option: true }],
  page: async ({ page, fails }, use) => {
    const fetches: string[] = [];
    await page.route(/\/assets\/keyMove-[\w-]+\.js(\?.*)?$/, (route) => {
      fetches.push(new URL(route.request().url()).search);
      return fetches.length > fails ? route.fallback() : route.abort("connectionreset");
    });
    await page.addInitScript(countFailedImports);
    moveFetches.set(page, fetches);
    await use(page);
  },
  fetches: async ({ page }, use) => use(moveFetches.get(page)!),
});

moveFails("a keyboard move's code that couldn't load is fetched again under another address, which works where the browser keeps the failure", async ({
  page,
  github: _,
  fetches,
}) => {
  await expect.poll(() => failedImports(page)).toBe(1); // once the timeline was drawn
  await box(page, DAGSTER).focus();
  await page.keyboard.press("Space");
  await expect(box(page, DAGSTER)).toHaveClass(/dragging/);
  // WebKit and Chromium keep a module that failed to load for its address until the page reloads.
  expect(fetches).toEqual(["", "?try=1"]);
  await page.keyboard.press("Escape");
  await expect(box(page, DAGSTER)).not.toHaveClass(/dragging/);
  await expect(toolbar(page)).toContainText("No changes");
});

moveFails.describe("failing again", () => {
  moveFails.use({ fails: 3 });

  moveFails("a keyboard move's code that couldn't load when Space asked for it: Space again picks the box up", async ({ page, github: _, fetches }) => {
    await expect.poll(() => failedImports(page)).toBe(1); // once the timeline was drawn
    await box(page, DAGSTER).focus();
    await expect.poll(() => failedImports(page)).toBe(2); // once it had focus
    await page.keyboard.press("Space");
    await expect.poll(() => heard(page)).toContain(
      "Moving from the keyboard couldn’t load. Check your connection, then press Space again; if the site was updated since this page opened, reload.",
    );
    await expect(box(page, DAGSTER)).not.toHaveClass(/dragging/);
    await page.keyboard.press("Space");
    await expect(box(page, DAGSTER)).toHaveClass(/dragging/);
    expect(fetches).toEqual(["", "?try=1", "?try=2", "?try=3"]);
  });
});

/**
 * The box and PTO editors' code held back from the page's first load (which fetches it a second
 * after the roadmap shows) until `release()`. `arrived()`: it has come, and had the time to show an
 * editor asked for meanwhile, were one still to show (React shows a part that comes within 300 ms
 * of its fallback once those 300 ms are up).
 */
interface HeldEditors {
  release(): void;
  arrived(): Promise<void>;
}
const heldEditors = new WeakMap<Page, HeldEditors>();
const editorsHeld = test.extend<{ editors: HeldEditors }>({
  page: async ({ page }, use) => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const code = /\/assets\/(BoxEditor|PtoEditor)-[\w-]+\.js$/;
    const finished = new Set<string>();
    page.on("requestfinished", (r) => void (code.test(r.url()) && finished.add(new URL(r.url()).pathname)));
    await page.route(code, async (route) => {
      await released;
      await route.fallback();
    });
    const arrived = async () => {
      await expect.poll(() => finished.size).toBe(2);
      await page.waitForTimeout(500);
    };
    heldEditors.set(page, { release, arrived });
    await use(page);
  },
  editors: async ({ page }, use) => use(heldEditors.get(page)!),
});

editorsHeld.describe("a box or PTO block opened before its editor's code is here", () => {
  const editor = (page: Page) => page.getByRole("dialog", { name: /^Edit / });

  editorsHeld("a click away takes the opening back: the editor doesn't open when its code comes", async ({ page, github: _, editors }) => {
    await box(page, DAGSTER).click();
    await page.locator(".tl-corner").click();
    editors.release();
    await editors.arrived();
    await expect(editor(page)).toHaveCount(0);
    // Here now: a click opens it at once.
    await box(page, DAGSTER).click();
    await expect(page.getByRole("dialog", { name: "Edit Dagster 2.x upgrade" })).toBeVisible();
  });

  editorsHeld("Esc takes the opening back, and focus stays on the box", async ({ page, github: _, editors }) => {
    await box(page, DAGSTER).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    editors.release();
    await editors.arrived();
    await expect(editor(page)).toHaveCount(0);
    await expect(box(page, DAGSTER)).toBeFocused();
  });

  editorsHeld("a second click on the box doesn't: the editor opens when its code comes, once", async ({ page, github: _, editors }) => {
    await box(page, DAGSTER).click();
    await box(page, DAGSTER).click();
    editors.release();
    await expect(page.getByRole("dialog", { name: "Edit Dagster 2.x upgrade" })).toBeVisible();
    await editors.arrived();
    await expect(editor(page)).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: "Edit Dagster 2.x upgrade" })).toBeVisible();
  });

  editorsHeld("a click away takes a new PTO block's opening back; the block stays", async ({ page, github: _, editors }) => {
    const row = page.locator('[data-pto-track="data-eng"]');
    await row.scrollIntoViewIfNeeded();
    const r = (await row.boundingBox())!;
    await page.mouse.dblclick(r.x + r.width / 2, r.y + r.height / 2);
    await expect(page.locator("[data-pto-key]")).toHaveCount(1);
    await page.locator(".tl-corner").click();
    editors.release();
    await editors.arrived();
    await expect(editor(page)).toHaveCount(0);
    await expect(page.locator("[data-pto-key]")).toHaveCount(1);
    await expect(toolbar(page)).toContainText("Save · 1 change");
  });
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

test("a view whose code can't load keeps Try again though a preload fails after its own fetch began", async ({ page, github: _ }) => {
  await page.evaluate(countFailedImports);
  const table = await failLater(page, /\/assets\/TableView-[\w-]+\.js$/);
  const tab = page.getByRole("button", { name: "Table", exact: true });
  await tab.click();
  table.drop();
  const banner = page.locator(".banner", { hasText: "This part of BoxOps couldn’t load" });
  await expect(banner).toContainText(FIRST);
  // The pointer leaves the tab and comes back: its preload fails too, as one begun the moment the
  // view's own fetch failed can, before the banner is drawn (seen once in Firefox).
  const failed = await failedImports(page);
  await page.mouse.move(700, 600);
  await tab.hover();
  await expect.poll(() => failedImports(page)).toBe(failed + 1);
  // Drawn again, the banner is still the view's own fetch's: the first failure, with Try again.
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.locator(".box").first()).toBeVisible();
  await tab.click();
  await expect(banner).toContainText(FIRST);
  await expect(banner.getByRole("button", { name: "Try again" })).toBeVisible();
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

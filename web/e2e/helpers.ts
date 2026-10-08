import { type BrowserContext, type Locator, type Page, test as base, expect } from "@playwright/test";
import { PX_PER_DAY } from "../src/timeline/scale";
import { FakeGitHub, REPO, TOKEN } from "./fake-github";

/**
 * The moment it's 09:00 on 2026-10-03 in this time zone, the browser's (each
 * project sets one): every test runs then, so "today" and the sample boxes
 * line up wherever the test runs and whatever zone Node is in.
 */
export function morningIn(timeZone = "UTC"): Date {
  const at = Date.UTC(2026, 9, 3, 9);
  const wall = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(at)
      .map((p) => [p.type, Number(p.value)]),
  );
  // How far the zone's clock is ahead of UTC's then.
  const ahead = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - at;
  return new Date(at - ahead);
}

/** "Today" in the default project, which runs in UTC. */
export const TODAY = morningIn();

export const DAGSTER = "bx-c93d-dagster-upgrade";
export const CDC = "bx-d4e1-cdc-pipeline";
export const REVENUE = "bx-1b8d-revenue-mart";
export const boxFile = (id: string) => `boxes/${id}.yaml`;

/**
 * `page` comes with the clock pinned, the fake GitHub installed, and the app
 * open. `visibility` makes the repository public (the default) or private;
 * `files` are the roadmap's, in place of the fixture's. `fakeClock: false`
 * leaves the browser's own clock, and with it the navigation timing that
 * Playwright's fake one hides (it says no page is a reload); `"fixed"`
 * fixes the date and time at today's 09:00 and fakes nothing else, for
 * tests that never move the clock on and wait on the browser's own frames
 * (Playwright's clock, setFixedTime too, makes requestAnimationFrame a
 * 16 ms timer, out of step with ResizeObserver and drawing). `cull: true`
 * has the timeline draw only what's near the screen, as it does for a big
 * roadmap, whatever the roadmap's size (false: all of it, always);
 * `virtualize` does the same for the table's and People's rows. Every
 * page of every test, tabs it opens later included, is watched: an uncaught
 * error or a Content-Security-Policy violation (`csp` lists them) fails the
 * test.
 */
export const test = base.extend<{
  github: FakeGitHub;
  signedIn: boolean;
  visibility: "public" | "private";
  files: Record<string, string> | undefined;
  fakeClock: boolean | "fixed";
  cull: boolean | undefined;
  virtualize: boolean | undefined;
  watched: { errors: string[]; csp: string[] };
  csp: string[];
}>({
  signedIn: [true, { option: true }],
  visibility: ["public", { option: true }],
  files: [undefined, { option: true }],
  fakeClock: [true, { option: true }],
  cull: [undefined, { option: true }],
  virtualize: [undefined, { option: true }],
  watched: [
    async ({ context }, use) => {
      const watched = { errors: [] as string[], csp: [] as string[] };
      await context.addInitScript(() =>
        document.addEventListener("securitypolicyviolation", (e) =>
          console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || "inline code"} (${e.sourceFile}:${e.lineNumber})`),
        ),
      );
      context.on("console", (m) => {
        if (m.type() === "error" && m.text().startsWith("CSP violation")) watched.csp.push(m.text());
      });
      context.on("weberror", (e) => watched.errors.push(e.error().message));
      await use(watched);
      expect(watched.errors, "uncaught page errors").toEqual([]);
      expect(watched.csp, "Content-Security-Policy violations").toEqual([]);
    },
    { auto: true },
  ],
  csp: async ({ watched }, use) => use(watched.csp),
  github: async ({ page, signedIn, visibility, files, fakeClock, cull, virtualize, timezoneId }, use) => {
    const github = await FakeGitHub.create(files, { visibility });
    if (fakeClock === "fixed") await page.addInitScript(fixDate, morningIn(timezoneId).getTime());
    else if (fakeClock) await page.clock.install({ time: morningIn(timezoneId) });
    if (cull !== undefined) await page.context().addInitScript((c) => (window.__boxopsTest = { ...window.__boxopsTest, cull: c }), cull);
    if (virtualize !== undefined) await page.context().addInitScript((v) => (window.__boxopsTest = { ...window.__boxopsTest, virtualize: v }), virtualize);
    await page.context().addInitScript(countSiteFetches);
    await page.context().addInitScript(recordAnnouncements);
    await github.install(page);
    if (signedIn) {
      await page.addInitScript(([key, token]) => sessionStorage.setItem(key, token), [`boxops-github-token:${REPO}`, TOKEN]);
    }
    // Boxes show codes, scale and initials by default here, since most tests check them
    // (the app's own default hides them). Only set once, so a reload keeps what a test chose.
    await page.addInitScript(() => {
      if (!localStorage.getItem("boxops-prefs")) {
        localStorage.setItem("boxops-prefs", JSON.stringify({ showCodes: true, showScale: true, showInitials: true }));
      }
    });
    await page.goto("./?zoom=months");
    // However long it takes: a big roadmap on a busy machine can take more than an assertion's
    // 5 s to show. The test's own time limit is the only one.
    await page.locator(".box, .empty-roadmap").first().waitFor();
    // The deployed copy is painted first; then the app asks GitHub for newer saves (when it
    // may: with a token, or a public repository), giving up 4 s from just before it painted
    // (App's FRESHNESS_MS). Let that call start, so it can't take a failure a test sets up for
    // its save; or, should the GitHub client's code come later than that (a very busy machine),
    // let the 4 s pass and the page's timers catch up: then it's never made.
    if (signedIn || visibility === "public") {
      const painted = await page.evaluate(() => performance.now());
      const late = () => page.evaluate((painted) => performance.now() > painted + 4000, painted);
      await expect.poll(async () => github.calls("ref") === 1 || (await late()), { timeout: 0 }).toBe(true);
      await page.evaluate(() => new Promise((caughtUp) => setTimeout(caughtUp)));
    }
    await use(github);
    expect(github.forbidden, "calls GitHub would refuse, or a correct app never makes").toEqual([]);
  },
});
export { expect };

export const box = (page: Page, id: string) => page.locator(`[data-box-id="${id}"]`).first();
/** A box's title text (boxes also show engineers' initials). */
export const boxTitle = (page: Page, id: string) => box(page, id).locator(".box-name");
export const toolbar = (page: Page) => page.locator(".draft-status");

/** "2026-09-14 – 2026-10-23" from a box's tooltip. */
export async function boxDates(page: Page, id: string): Promise<string> {
  const title = (await box(page, id).getAttribute("title")) ?? "";
  return title.split("\n").find((l) => l.includes(" – ")) ?? "";
}

/** Pixels per working day at months zoom, where tests run. */
export const MONTH_PX = PX_PER_DAY.months;

/** Drag a box (or one of its edge handles) by dx/dy pixels. */
export async function drag(page: Page, id: string, dx: number, dy = 0, grip: "middle" | "start" | "end" = "middle") {
  const b = (await box(page, id).boundingBox())!;
  const x = grip === "start" ? b.x + 3 : grip === "end" ? b.x + b.width - 3 : b.x + Math.min(b.width / 2, 60);
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

/** Drag a box by a number of working days at months zoom (and optionally dy pixels). */
export const dragDays = (page: Page, id: string, days: number, dy = 0, grip: "middle" | "start" | "end" = "middle") =>
  drag(page, id, days * MONTH_PX, dy, grip);

/**
 * Choose `value` in a select: focused first, as a person's choice would be.
 * A select with a long list (components/LazySelect.tsx) has only its chosen
 * option until it's used, and Playwright's selectOption doesn't focus it.
 */
export async function choose(select: Locator, value: string) {
  await select.focus();
  await select.selectOption(value);
}

/**
 * With print media emulated on the table or People: how far the page goes
 * past the printed table, across and down, beyond the window's own size.
 * None either way unless something else takes room on paper, as the
 * interactive table (kept, clipped, for focus) mustn't: the pages would be
 * shrunk to its width, with blank ones after the rows.
 */
export const pastPrintTable = (page: Page): Promise<{ across: number; down: number }> =>
  page.evaluate(() => {
    const doc = document.documentElement;
    const table = document.querySelector(".print-table")!.getBoundingClientRect();
    return {
      across: Math.max(0, doc.scrollWidth - Math.max(doc.clientWidth, Math.ceil(table.right + scrollX))),
      // (Give or take the page's own edge, a pixel or two.)
      down: Math.max(0, doc.scrollHeight - Math.max(doc.clientHeight, Math.ceil(table.bottom + scrollY) + 2)),
    };
  });

/**
 * How many pixels of what has focus in a dialog are hidden: under its title bar (which stays put as it
 * scrolls) or More below while that shows, or past its foot. 0 when it's all in sight (WCAG 2.4.11), or
 * focus is on the dialog itself, its title bar or outside it.
 */
export const focusHidden = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const el = document.activeElement!;
    const d = el.closest("dialog");
    if (!d || el === d || el.closest(".dialog-head")) return 0;
    const r = el.getBoundingClientRect();
    const head = d.querySelector(".dialog-head")!.getBoundingClientRect();
    const more = d.querySelector(".more-below:not(.done)");
    const bottom = more ? more.getBoundingClientRect().top : d.getBoundingClientRect().top + d.clientTop + d.clientHeight;
    return Math.max(0, head.bottom - r.top) + Math.max(0, r.bottom - bottom);
  });

/** Tab through what's in the open dialog, then Shift+Tab back: what has focus is never hidden (focusHidden). */
export async function tabThroughDialog(page: Page, presses = 30) {
  const d = page.locator("dialog[open]");
  // Taller than the window: it scrolls, by the keys.
  expect(await d.evaluate((d) => d.scrollHeight > d.clientHeight + 50)).toBe(true);
  let scrolled = 0;
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press(key);
      await expect.poll(() => focusHidden(page), { message: `${key} ${i + 1}`, timeout: 2000 }).toBe(0);
      scrolled = Math.max(scrolled, await d.evaluate((d) => d.scrollTop));
    }
  }
  expect(scrolled).toBeGreaterThan(50);
}

/** Click somewhere neutral so keyboard shortcuts reach the app, not a field. */
export async function focusApp(page: Page) {
  await page.locator(".tl-corner, .table-toolbar .hint").first().click();
}

export async function save(page: Page) {
  await focusApp(page);
  await page.keyboard.press("ControlOrMeta+s");
}

/** Press ⌘S (Ctrl+S) as save() does; whether the app kept it from the browser, whose Save Page dialog it would open. */
export async function saveKeyTaken(page: Page): Promise<boolean> {
  type Seen = { saveKeyTaken?: boolean };
  await page.evaluate(() =>
    // After the app's own listener, on the same target: it has had its say.
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "s") (window as Seen).saveKeyTaken = e.defaultPrevented;
    }),
  );
  await save(page);
  return page.evaluate(() => (window as Seen).saveKeyTaken === true);
}

/**
 * Fixes `Date` at `at` (ms): `new Date()` and `Date.now()` are always then.
 * Timers, animation frames and performance.now() are the browser's own.
 */
function fixDate(at: number) {
  const RealDate = Date;
  window.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [at], newTarget),
    apply: () => new RealDate(at).toString(),
    get: (target, key, receiver) => (key === "now" ? () => at : Reflect.get(target, key, receiver)),
  });
}

/**
 * Counts this page's fetches of roadmap.json under way, body included
 * (`__boxopsSiteFetches`): the clock mustn't jump past one's deadline (20 s)
 * while it's still coming in, which would fail it. In every page of a test.
 */
function countSiteFetches() {
  const w = window as unknown as { __boxopsSiteFetches: number };
  const fetch = window.fetch.bind(window);
  w.__boxopsSiteFetches = 0;
  window.fetch = async (input, init) => {
    if (!String(input instanceof Request ? input.url : input).includes("roadmap.json")) return fetch(input, init);
    w.__boxopsSiteFetches++;
    try {
      const res = await fetch(input, init);
      await res.clone().arrayBuffer().catch(() => {});
      return res;
    } finally {
      w.__boxopsSiteFetches--;
    }
  };
}

/**
 * Records what the app says to screen readers, every message its live
 * regions ([data-live], a11y/announce.tsx) are given, in order
 * (`__boxopsSaid`): a message is there for a moment before the next. In
 * every page of a test.
 */
function recordAnnouncements() {
  const w = window as unknown as { __boxopsSaid: string[] };
  w.__boxopsSaid = [];
  new MutationObserver((records) => {
    for (const r of records) {
      const region = (r.target instanceof Element ? r.target : r.target.parentElement)?.closest("[data-live]");
      if (region?.textContent) w.__boxopsSaid.push(region.textContent);
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
}

/** Every message the app has given screen readers so far, in order (those asked for together come as one). */
export const said = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __boxopsSaid: string[] }).__boxopsSaid);
/** All the app has said to screen readers so far, as one text. */
export const heard = async (page: Page): Promise<string> => (await said(page)).join(" ");

/**
 * Text lying straight in a banner, outside any element. A banner is a flex
 * row, so such text, a <code> and a link beside it become items of their
 * own, spaced apart ("disk ( npm run dev , or …"): its text belongs in one
 * <span>. Should be none.
 */
export function looseBannerText(page: Page): Promise<string[]> {
  return page
    .locator(".banner")
    .evaluateAll((banners) => banners.flatMap((b) => [...b.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()).map((n) => n.textContent!)));
}

/** Make the app's 2-minute check for others' saves happen now, once the last one has finished. */
export async function pollNow(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __boxopsSiteFetches?: number }).__boxopsSiteFetches ?? 0)).toBe(0);
  await page.clock.fastForward(2 * 60_000 + 1000);
}

/**
 * Another tab on the roadmap in the same browser (the same localStorage, its
 * own sessionStorage), with its own clock starting at `at` (by default, today
 * in the default project's zone), the fake GitHub and a token. `session` adds
 * to its sessionStorage (a duplicated tab starts with a copy of the original's).
 */
export async function openTab(context: BrowserContext, github: FakeGitHub, at = TODAY, session: Record<string, string> = {}): Promise<Page> {
  const tab = await context.newPage();
  await tab.clock.install({ time: at });
  await github.install(tab);
  await tab.addInitScript(
    (entries) => {
      for (const [k, v] of Object.entries(entries)) sessionStorage.setItem(k, v);
    },
    { [`boxops-github-token:${REPO}`]: TOKEN, ...session },
  );
  await tab.goto("./?zoom=months");
  await tab.locator(".box").first().waitFor(); // however long it takes, as the first tab
  return tab;
}

/** The unsaved drafts stored in this browser: key → what's stored. */
export const storedDrafts = (page: Page): Promise<Record<string, { items: Record<string, unknown>; alive: number }>> =>
  page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((k) => k.startsWith("boxops-draft:"))
        .map((k) => [k, JSON.parse(localStorage.getItem(k)!)]),
    ),
  );

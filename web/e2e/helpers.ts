import { type BrowserContext, type Page, test as base, expect } from "@playwright/test";
import { FakeGitHub, REPO, TOKEN } from "./fake-github";

/** Every test runs on 2026-10-03 so "today" and the sample boxes line up. */
export const TODAY = new Date("2026-10-03T09:00:00");

export const DAGSTER = "bx-c93d-dagster-upgrade";
export const CDC = "bx-d4e1-cdc-pipeline";
export const REVENUE = "bx-1b8d-revenue-mart";
export const boxFile = (id: string) => `boxes/${id}.yaml`;

/**
 * `page` comes with the clock pinned, the fake GitHub installed, and the app
 * open. `visibility` makes the repository public (the default) or private.
 * `csp` collects Content-Security-Policy violations; any left at the end
 * fails the test (every test has it, through `github`).
 */
export const test = base.extend<{ github: FakeGitHub; signedIn: boolean; visibility: "public" | "private"; csp: string[] }>({
  signedIn: [true, { option: true }],
  visibility: ["public", { option: true }],
  csp: async ({ page }, use) => {
    const violations: string[] = [];
    await page.addInitScript(() =>
      document.addEventListener("securitypolicyviolation", (e) =>
        console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || "inline code"} (${e.sourceFile}:${e.lineNumber})`),
      ),
    );
    page.on("console", (m) => {
      if (m.type() === "error" && m.text().startsWith("CSP violation")) violations.push(m.text());
    });
    await use(violations);
    expect(violations, "Content-Security-Policy violations").toEqual([]);
  },
  github: async ({ page, signedIn, visibility, csp: _ }, use) => {
    const github = await FakeGitHub.create(undefined, { visibility });
    await page.clock.install({ time: TODAY });
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
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("./?zoom=months");
    await expect(page.locator(".box").first()).toBeVisible();
    // The deployed copy is painted first; then the app asks GitHub for newer saves (when it
    // may: with a token, or a public repository). Let that start, so it can't take a failure
    // a test sets up for its save.
    if (signedIn || visibility === "public") await expect.poll(() => github.calls("ref")).toBe(1);
    await use(github);
    expect(errors, "uncaught page errors").toEqual([]);
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
export const MONTH_PX = 14.7;

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

/** Click somewhere neutral so keyboard shortcuts reach the app, not a field. */
export async function focusApp(page: Page) {
  await page.locator(".tl-corner, .table-toolbar .hint").first().click();
}

export async function save(page: Page) {
  await focusApp(page);
  await page.keyboard.press("ControlOrMeta+s");
}

/** Make the app's 2-minute check for others' saves happen now. */
export async function pollNow(page: Page) {
  await page.clock.fastForward(2 * 60_000 + 1000);
}

/**
 * Another tab on the roadmap in the same browser (the same localStorage, its
 * own sessionStorage), with its own clock starting at `at`, the fake GitHub
 * and a token.
 */
export async function openTab(context: BrowserContext, github: FakeGitHub, at = TODAY): Promise<Page> {
  const tab = await context.newPage();
  await tab.clock.install({ time: at });
  await github.install(tab);
  await tab.addInitScript(([key, token]) => sessionStorage.setItem(key, token), [`boxops-github-token:${REPO}`, TOKEN]);
  await tab.goto("./?zoom=months");
  await expect(tab.locator(".box").first()).toBeVisible();
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

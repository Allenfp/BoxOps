import { readFile } from "node:fs/promises";
import { DAGSTER, dragDays, expect, test, toolbar } from "./helpers";

// The page around the app: what happens when the app itself fails.

test("a stored draft that crashes the app can be downloaded and discarded", async ({ page, github: _ }) => {
  await dragDays(page, DAGSTER, 10);
  await expect(toolbar(page)).toContainText("Save · 1 change");
  // Stored once editing pauses.
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("boxops-draft:")).length)).toBe(1);
  // A stored draft the app can't render (a bug, or a draft from another version), and
  // another roadmap's draft on the same origin (project sites on <owner>.github.io share one).
  await page.evaluate((id) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("boxops-draft:"))!;
    const draft = JSON.parse(localStorage.getItem(key)!);
    draft.items[`box:${id}`].now.engineers = 5;
    localStorage.setItem(key, JSON.stringify(draft));
    localStorage.setItem("boxops-draft:acme/other@main:0000abcd", JSON.stringify({ v: 2, format: 1, items: {} }));
  }, DAGSTER);
  await page.reload();
  const crash = page.locator(".crash");
  await expect(crash).toContainText("Something went wrong");
  await expect(crash).toContainText("Your unsaved changes are kept in this browser.");
  await expect(crash.getByRole("button", { name: "Download unsaved changes" })).toHaveCount(0);

  // The same crash after reloading: the draft is the likely cause.
  await crash.getByRole("button", { name: "Reload" }).click();
  await expect(crash).toContainText("It happened again after reloading. Your unsaved changes to acme/roadmap, kept in this browser,");
  const downloading = page.waitForEvent("download");
  await crash.getByRole("button", { name: "Download unsaved changes" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("boxops-unsaved-changes-2026-10-03.json");
  const saved = JSON.parse(await readFile(await download.path(), "utf8"));
  // This tab's draft only: `boxops-draft:<repo>@<branch>:<tab id>`.
  expect(Object.keys(saved)).toEqual([expect.stringMatching(/^boxops-draft:acme\/roadmap@main:[0-9a-f]{8}$/)]);
  expect(Object.values<{ items: Record<string, { now: { engineers: unknown } }> }>(saved)[0].items[`box:${DAGSTER}`].now.engineers).toBe(5);

  await crash.getByRole("button", { name: "Discard unsaved changes and reload" }).click();
  await expect(page.locator(".box").first()).toBeVisible();
  await expect(toolbar(page)).toContainText("No changes");
  expect(await page.evaluate(() => localStorage.getItem("boxops-draft:acme/other@main:0000abcd"))).not.toBeNull();
});

test("once the app has run a few seconds, an earlier crash is forgotten: a later one isn't \"again\"", async ({ page, github: _ }) => {
  await dragDays(page, DAGSTER, 10);
  await page.evaluate(() => sessionStorage.setItem("boxops-crashed-at", String(Date.now())));
  await page.clock.fastForward(6_000);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("boxops-crashed-at"))).toBeNull();
});

test("the built page enforces a strict Content-Security-Policy, and tests catch violations", async ({ page, csp, github: _ }) => {
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("connect-src 'self' https://api.github.com https://raw.githubusercontent.com;");
  // A script that tried to send data elsewhere is stopped, and the fixture sees it.
  const sent = await page.evaluate(() => fetch("https://example.com/collect").then(() => true, () => false));
  expect(sent).toBe(false);
  await expect.poll(() => csp.length).toBe(1);
  expect(csp[0]).toContain("connect-src blocked https://example.com/collect");
  csp.length = 0; // expected here; any other test with a violation fails
});

test("the theme is applied before the app's JavaScript runs", async ({ page, github: _ }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.route("**/assets/*.js", () => {}); // never answered
  await page.reload({ waitUntil: "commit" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#root")).toHaveText("Loading…");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(15, 18, 24)");
});

test("an app file that fails to load (a stale cached page) reloads once from a fresh URL", async ({ page, github: _ }) => {
  let failed = 0;
  await page.route("**/assets/*.js", (route) => {
    if (failed++) return route.fallback();
    return route.fulfill({ status: 404, contentType: "text/html", body: "<h1>404</h1>" });
  });
  const navigations: string[] = [];
  page.on("request", (r) => r.isNavigationRequest() && navigations.push(r.url()));
  await page.reload();
  await expect(page.locator(".box").first()).toBeVisible();
  expect(navigations).toHaveLength(2);
  expect(new URL(navigations[1]).searchParams.get("boxops-reload")).toBeTruthy();
  expect(new URL(navigations[1]).searchParams.get("zoom")).toBe("months"); // other parameters kept
  expect(new URL(page.url()).searchParams.has("boxops-reload")).toBe(false); // removed again
});

test("if the app still can't load after that reload, the page says so", async ({ page, github: _ }) => {
  await page.route("**/assets/*.js", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<h1>404</h1>" }));
  await page.reload();
  await expect(page.locator("#root")).toContainText("BoxOps couldn’t start: part of the app didn’t load.");
  await expect(page.locator("#root").getByRole("link", { name: "Try again" })).toBeVisible();
});

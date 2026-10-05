import { readFile } from "node:fs/promises";
import { withContentSecurityPolicy } from "../cli/csp";
import { FakeGitHub, REPO, TOKEN } from "./fake-github";
import { CDC, DAGSTER, REVENUE, TODAY, boxFile, dragDays, expect, looseBannerText, pollNow, test, toolbar } from "./helpers";

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

test("a crash says unsaved changes are kept only if this tab has some, whatever other tabs and sites keep", async ({ page, github }) => {
  // Another tab's draft of this roadmap, and another roadmap's, on the same origin.
  await page.evaluate(() => {
    localStorage.setItem("boxops-draft:acme/roadmap@main:0000abcd", JSON.stringify({ v: 2, format: 1, alive: Date.now(), items: {} }));
    localStorage.setItem("boxops-draft:acme/other@main:0000abcd", JSON.stringify({ v: 2, format: 1, items: {} }));
  });
  // A roadmap the app can't render (a bug): the build's parse of a box, spoiled.
  github.patchBundle = (b) => {
    for (const f of Object.values(b.parsed!.files)) if (f.kind === "box" && f.box?.id === DAGSTER) Object.assign(f.box, { title: { text: "?" } });
    return b;
  };
  await page.reload();
  const crash = page.locator(".crash");
  await expect(crash).toContainText("Something went wrong");
  await expect(crash).not.toContainText("unsaved changes");
  await crash.getByRole("button", { name: "Reload" }).click();
  await expect(crash).toContainText("Something went wrong");
  await expect(crash).not.toContainText("unsaved changes");
  await expect(crash.getByRole("button", { name: "Download unsaved changes" })).toHaveCount(0);
});

test("a crash once this browser stopped keeping the draft says only an older copy is kept", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 10);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("boxops-draft:")).length)).toBe(1);
  // Storage fills up: the draft of one change was kept, one of two no longer fits.
  await page.evaluate(() => {
    const kept = Object.keys(localStorage).find((k) => k.startsWith("boxops-draft:"))!;
    const limit = localStorage.getItem(kept)!.length + 100;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("boxops-draft:") && value.length > limit) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await dragDays(page, CDC, 5);
  await expect(page.locator(".banner", { hasText: "This browser isn’t keeping your unsaved changes" })).toBeVisible();
  // Then a save comes in that the app can't render (a bug): the build's parse of a box, spoiled.
  github.patchBundle = (b) => {
    for (const f of Object.values(b.parsed!.files)) if (f.kind === "box" && f.box?.id === REVENUE) Object.assign(f.box, { title: { text: "?" } });
    return b;
  };
  github.deploy(github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") }, "Sam Lee", "Revenue mart: v3"));
  await pollNow(page);
  const crash = page.locator(".crash");
  await expect(crash).toContainText("Something went wrong");
  await expect(crash).toContainText("An older copy of your unsaved changes is kept in this browser; the latest edits weren’t.");
  await expect(crash).not.toContainText("Your unsaved changes are kept");
});

test("once the app has run a few seconds, an earlier crash is forgotten: a later one isn't \"again\"", async ({ page, github: _ }) => {
  await dragDays(page, DAGSTER, 10);
  await page.evaluate(() => sessionStorage.setItem("boxops-crashed-at", String(Date.now())));
  await page.clock.fastForward(6_000);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("boxops-crashed-at"))).toBeNull();
});

test("the built page enforces a strict Content-Security-Policy, and tests catch violations", async ({ page, csp, github: _ }) => {
  // Straight after <meta charset>, which must come first, and before anything it governs.
  await expect(page.locator("head > :first-child")).toHaveAttribute("charset", "UTF-8");
  await expect(page.locator("head > :nth-child(2)")).toHaveAttribute("http-equiv", "Content-Security-Policy");
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

test("an index.html with CRLF line ends (a Windows checkout) still runs its inline scripts under the policy", async ({ page, csp: _ }) => {
  const html = withContentSecurityPolicy('<!doctype html>\r\n<html>\r\n<head>\r\n<meta charset="UTF-8" />\r\n<script>\r\n  window.ran = true;\r\n</script>\r\n</head>\r\n</html>\r\n');
  await page.route("**/crlf.html", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("./crlf.html");
  expect(await page.evaluate(() => (window as unknown as { ran?: boolean }).ran)).toBe(true);
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

test("an empty roadmap says where to start; nothing offers to collapse, or to add a box nobody could see", async ({ page }) => {
  const github = await FakeGitHub.create({ "settings.yaml": "format: 1\n", "people.yaml": "people: []\n" });
  await page.clock.install({ time: TODAY });
  await github.install(page);
  await page.addInitScript(([key, token]) => sessionStorage.setItem(key, token), [`boxops-github-token:${REPO}`, TOKEN]);
  await page.goto("./");
  await expect(page.getByText("This roadmap has no departments yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Expand|Collapse) all$/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Table" }).click();
  await expect(page.getByRole("button", { name: "Add box" })).toBeDisabled();
  await expect(page.locator(".table-toolbar")).toContainText("Add a department first");
  await expect(page.getByRole("button", { name: /^(Expand|Collapse) all$/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Timeline" }).click();
  await page.locator(".empty-roadmap").getByRole("button", { name: "Add department" }).click();
  const editor = page.locator("dialog.dept-editor[open]");
  await editor.getByLabel("Department name").fill("Platform");
  await editor.getByRole("button", { name: "Add department" }).click();
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".empty-roadmap")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Collapse all" })).toBeVisible();
  await page.getByRole("button", { name: "Table" }).click();
  await expect(page.getByRole("button", { name: "Add box" })).toBeEnabled();
});

test("a roadmap without settings.yaml opens read-only, saying the file is missing", async ({ page }) => {
  const github = await FakeGitHub.create({ "people.yaml": "people: []\n" });
  await page.clock.install({ time: TODAY });
  await github.install(page);
  await page.goto("./");
  const banner = page.locator(".banner", { hasText: "Read-only" });
  await expect(banner).toContainText("the roadmap has no roadmap/settings.yaml");
  await expect(banner).toContainText("Add one holding format: 1");
  expect(await looseBannerText(page)).toEqual([]);
});

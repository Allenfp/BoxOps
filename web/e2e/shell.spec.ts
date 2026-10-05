import { readFile } from "node:fs/promises";
import { DAGSTER, dragDays, expect, test, toolbar } from "./helpers";

// The page around the app: what happens when the app itself fails.

test("a stored draft that crashes the app can be downloaded and discarded", async ({ page, github: _ }) => {
  await dragDays(page, DAGSTER, 10);
  await expect(toolbar(page)).toContainText("Save · 1 change");
  // A stored draft the app can't render (a bug, or a draft from another version).
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("boxops-draft:"))!;
    const draft = JSON.parse(localStorage.getItem(key)!);
    draft.boxes[0].engineers = 5;
    localStorage.setItem(key, JSON.stringify(draft));
  });
  await page.reload();
  const crash = page.locator(".crash");
  await expect(crash).toContainText("Something went wrong");
  await expect(crash).toContainText("Your unsaved changes are kept in this browser.");
  await expect(crash.getByRole("button", { name: "Download unsaved changes" })).toHaveCount(0);

  // The same crash after reloading: the draft is the likely cause.
  await crash.getByRole("button", { name: "Reload" }).click();
  await expect(crash).toContainText("It happened again after reloading");
  const downloading = page.waitForEvent("download");
  await crash.getByRole("button", { name: "Download unsaved changes" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("boxops-unsaved-changes-2026-10-03.json");
  const saved = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(Object.keys(saved)).toEqual(["boxops-draft:acme/roadmap@main"]);
  expect(saved["boxops-draft:acme/roadmap@main"].boxes[0].engineers).toBe(5);

  await crash.getByRole("button", { name: "Discard unsaved changes and reload" }).click();
  await expect(page.locator(".box").first()).toBeVisible();
  await expect(toolbar(page)).toContainText("No changes");
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

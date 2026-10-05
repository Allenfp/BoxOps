import type { Bundle } from "../src/model/bundle";
import { DAGSTER, dragDays, expect, pollNow, save, test, toolbar } from "./helpers";

// A tab left open while BoxOps itself is upgraded: older code never writes.

/** The site rebuilt by a later BoxOps (the files served are this build's still). */
const newerApp = (b: Bundle): Bundle => ({ ...b, app: { version: "0.2.0", build: "0.2.0+0123456789ab", time: "2099-01-01T00:00:00Z" } });

test("a new BoxOps makes the tab read-only; Reload loads it from a fresh URL and keeps the draft", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 10);
  await page.evaluate(() => (location.hash = "#here"));
  github.patchBundle = newerApp;
  await pollNow(page);
  const banner = page.locator(".banner", { hasText: "BoxOps was updated" });
  await expect(banner).toContainText("BoxOps was updated to 0.2.0 — Reload to keep editing. Your unsaved changes are kept in this browser.");
  await expect(toolbar(page)).toHaveCount(0);

  const navigations: string[] = [];
  page.on("request", (r) => r.isNavigationRequest() && navigations.push(r.url()));
  await banner.getByRole("button", { name: "Reload" }).click();
  await expect.poll(() => navigations.length).toBe(1);
  const url = new URL(navigations[0]);
  expect(url.searchParams.get("boxops-reload")).toBe("0.2.0+0123456789ab");
  expect(url.searchParams.get("zoom")).toBe("months");
  await expect(page.locator(".box").first()).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.has("boxops-reload")).toBe(false);
  expect(new URL(page.url()).hash).toBe("#here");

  // The fake's "new" BoxOps is still this build, so the tab stays read-only until the site
  // serves this build again; then the draft is there to save.
  await expect(banner).toBeVisible();
  github.patchBundle = undefined;
  await page.reload();
  await expect(toolbar(page)).toContainText("Save · 1 change");
});

test("saving first checks for a new BoxOps the poll hasn't seen, and then writes nothing", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 10);
  github.patchBundle = newerApp;
  await save(page);
  await expect(page.locator(".banner", { hasText: "BoxOps was updated" })).toBeVisible();
  await expect(page.locator(".save-dialog[open]")).toHaveCount(0);
  expect(github.calls("graphql")).toBe(0);
  expect(github.head).toBe(github.root);
});

test("an older BoxOps behind roadmap.json (a CDN catching up) doesn't stop this tab", async ({ page, github }) => {
  github.patchBundle = (b) => ({ ...b, app: { version: "0.0.9", build: "0.0.9+fedcba987654", time: "2020-01-01T00:00:00Z" } });
  await pollNow(page);
  await dragDays(page, DAGSTER, 10);
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  await expect(page.locator(".banner", { hasText: "BoxOps was updated" })).toHaveCount(0);
});

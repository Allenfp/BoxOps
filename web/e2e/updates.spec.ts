import type { Bundle } from "../src/model/bundle";
import { DAGSTER, boxFile, dragDays, expect, pollNow, save, test, toolbar } from "./helpers";

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

test("a roadmap.json that stalls when saving holds the save up a few seconds at most", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 10);
  await page.route("**/roadmap.json*", () => {}); // never answered
  await save(page);
  await expect(page.locator(".save-progress")).toHaveText("Checking for newer saves…");
  await page.clock.fastForward(5_000);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
});

test("an older BoxOps behind roadmap.json (a CDN catching up) doesn't stop this tab", async ({ page, github }) => {
  github.patchBundle = (b) => ({ ...b, app: { version: "0.0.9", build: "0.0.9+fedcba987654", time: "2020-01-01T00:00:00Z" } });
  await pollNow(page);
  await dragDays(page, DAGSTER, 10);
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  await expect(page.locator(".banner", { hasText: "BoxOps was updated" })).toHaveCount(0);
});

test("a save while an upgrade to a newer data format deploys is refused, nothing written", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 10);
  const upgrade = github.otherSave({ "settings.yaml": (t) => t.replace(/^format: 1 /m, "format: 2 ") }, "Ada Admin", "Upgrade BoxOps to 0.2.0");
  await save(page);
  const dialog = page.locator(".save-dialog[open]");
  await expect(dialog.locator("h2")).toHaveText("BoxOps is being upgraded");
  await expect(dialog).toContainText("BoxOps is being upgraded; reload in a minute.");
  await expect(dialog).toContainText("data format 2");
  expect(github.head).toBe(upgrade);
  expect(github.calls("graphql")).toBe(0);
  expect(github.file(boxFile(DAGSTER))).not.toContain("start: 2026-09-28");
});

test("the site's notices show as plain text, and can be put away", async ({ page, github }) => {
  const text = "BoxOps v0.1.1 fixes a security problem; this site runs v0.1.0. <b>Ask an admin</b> to merge the upgrade.";
  github.patchBundle = (b) => ({ ...b, notices: [{ level: "security", text }] });
  await page.reload();
  const notice = page.locator(".banner.notice-security");
  await expect(notice).toHaveText(text);
  await expect(notice.locator("b")).toHaveCount(0);
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
  await pollNow(page);
  await expect(page.locator(".box").first()).toBeVisible();
  await expect(notice).toHaveCount(0);
});

import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import type { Bundle } from "../src/model/bundle";
import { DAGSTER, boxFile, dragDays, expect, pollNow, save, test, toolbar } from "./helpers";

// A tab left open while BoxOps itself is upgraded: older code never writes.

/** The site rebuilt by a later BoxOps (the files served are this build's still). */
const newerApp = (b: Bundle): Bundle => ({ ...b, app: { version: "0.2.0", build: "0.2.0+0123456789ab", time: "2099-01-01T00:00:00Z" } });

/** Site data blocked, or storage full: this browser keeps no draft. */
async function refuseDrafts(page: Page) {
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("boxops-draft:")) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
}

/** The JSON file a Download unsaved changes button gives: this tab's draft, by its key. */
async function downloaded(page: Page, button: ReturnType<Page["getByRole"]>): Promise<Record<string, { items: Record<string, Moved> }>> {
  const downloading = page.waitForEvent("download");
  await button.click();
  return JSON.parse(await readFile(await (await downloading).path(), "utf8"));
}
/** A box's item in a stored draft: what it was changed from, and to (its start as a day number). */
type Moved = { old: { start: number }; now: { start: number } };
/** Days a box in a downloaded draft was moved by. */
const movedBy = (saved: Record<string, { items: Record<string, Moved> }>, id: string) => {
  const item = Object.values(saved)[0].items[`box:${id}`];
  return item.now.start - item.old.start;
};

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

test("a tab gone read-only for a new BoxOps, whose draft this browser isn't keeping: download it, and Reload asks", async ({ page, github }) => {
  await refuseDrafts(page);
  await dragDays(page, DAGSTER, 10);
  const warning = page.locator(".banner", { hasText: "This browser isn’t keeping your unsaved changes" });
  await expect(warning).toContainText("Save soon.");
  github.patchBundle = newerApp;
  await pollNow(page);
  const banner = page.locator(".banner", { hasText: "BoxOps was updated" });
  await expect(banner).toContainText(
    "BoxOps was updated to 0.2.0 — Reload to keep editing. This browser isn’t keeping your 1 unsaved change: download it first, or reloading loses it.",
  );
  await expect(warning).toHaveCount(0); // the update banner says it
  const saved = await downloaded(page, banner.getByRole("button", { name: "Download unsaved changes" }));
  expect(Object.keys(saved)).toEqual([expect.stringMatching(/^boxops-draft:acme\/roadmap@main:[0-9a-f]{8}$/)]);
  expect(movedBy(saved, DAGSTER)).toBe(14); // 10 working days

  const navigations: string[] = [];
  page.on("request", (r) => r.isNavigationRequest() && navigations.push(r.url()));
  const asked: string[] = [];
  page.once("dialog", (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await banner.getByRole("button", { name: "Reload" }).click();
  await expect.poll(() => asked).toEqual(["Reload and lose 1 unsaved change? This browser isn’t keeping it."]);
  await page.waitForTimeout(100);
  expect(navigations).toEqual([]);
  page.once("dialog", (d) => void d.accept());
  await banner.getByRole("button", { name: "Reload" }).click();
  await expect.poll(() => navigations.length).toBe(1);
});

test("a tab gone read-only for a newer data format, whose draft this browser isn't keeping, offers it as a download", async ({ page, github }) => {
  await refuseDrafts(page);
  await dragDays(page, DAGSTER, 10);
  github.deploy(github.otherSave({ "settings.yaml": (t) => t.replace(/^format: 1 /m, "format: 2 ") }, "Ada Admin", "Upgrade BoxOps to 0.2.0"));
  await pollNow(page);
  await expect(toolbar(page)).toHaveCount(0);
  const warning = page.locator(".banner", { hasText: "This browser isn’t keeping your unsaved changes" });
  await expect(warning).toContainText("This tab can’t save them: download them to keep them.");
  await expect(warning).not.toContainText("Save soon");
  const saved = await downloaded(page, warning.getByRole("button", { name: "Download unsaved changes" }));
  expect(movedBy(saved, DAGSTER)).toBe(14); // 10 working days
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

test("a save dialog left open when a new BoxOps arrives closes, and nothing is written", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 10);
  github.inject("graphql", "rules");
  await save(page);
  const dialog = page.locator(".save-dialog[open]");
  await expect(dialog.locator("h2")).toHaveText("GitHub’s rules blocked this save");
  github.patchBundle = newerApp;
  await pollNow(page);
  await expect(page.locator(".banner", { hasText: "BoxOps was updated" })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(github.calls("graphql")).toBe(1);
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
  // The upgraded BoxOps won't open changes made in this format.
  await expect(dialog).toContainText(
    "Your changes are still saved in this browser, but the upgraded BoxOps can’t open them: after reloading, it offers them as a download (JSON), so you can make them again.",
  );
  const saved = await downloaded(page, dialog.getByRole("button", { name: "Download unsaved changes" }));
  expect(movedBy(saved, DAGSTER)).toBe(14);
  expect(github.head).toBe(upgrade);
  expect(github.calls("graphql")).toBe(0);
  expect(github.file(boxFile(DAGSTER))).not.toContain("start: 2026-09-28");
});

test("a newer data format before its BoxOps deploys says an upgrade is likely under way; then edits come only as a download", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 10);
  github.deploy(github.otherSave({ "settings.yaml": (t) => t.replace(/^format: 1 /m, "format: 2 ") }, "Ada Admin", "Upgrade BoxOps to 0.2.0"));
  await pollNow(page);
  const format = page.locator(".banner", { hasText: "data format 2" });
  await expect(format).toContainText(
    "Read-only: the roadmap now uses data format 2, newer than this BoxOps reads (1), so BoxOps is probably being upgraded. Reload in a few " +
      "minutes; if it stays like this, ask whoever looks after the site. Your unsaved changes were made in the old format: the upgraded " +
      "BoxOps offers them only as a download (JSON).",
  );
  expect(movedBy(await downloaded(page, format.getByRole("button", { name: "Download unsaved changes" })), DAGSTER)).toBe(14);
  // Then the site is rebuilt by the BoxOps that reads format 2: its banner says it all.
  github.patchBundle = (b) => ({ ...newerApp(b), format: 2 });
  await pollNow(page);
  const banner = page.locator(".banner", { hasText: "BoxOps was updated" });
  await expect(banner).toContainText(
    "Your unsaved changes can’t come along: the new BoxOps uses another data format, so after reloading it offers them only as a download (JSON).",
  );
  await expect(format).toHaveCount(0);
  const saved = await downloaded(page, banner.getByRole("button", { name: "Download unsaved changes" }));
  expect(movedBy(saved, DAGSTER)).toBe(14);
});

test("the site's notices show as plain text, and can be put away", async ({ page, github }) => {
  const text = "BoxOps v0.1.1 fixes a security problem; this site runs v0.1.0. <b>Ask an admin</b> to merge the upgrade.";
  const info = "The roadmap moves to a new repository on 2026-10-09.";
  // The same notice twice (a site's notices file, say, and its default) is shown once.
  github.patchBundle = (b) => ({ ...b, notices: [{ level: "security", text }, { level: "info", text: info }, { level: "security", text }] });
  await page.reload();
  const notice = page.locator(".banner.notice-security");
  await expect(notice).toHaveText(text);
  await expect(notice.locator("b")).toHaveCount(0);
  await expect(page.locator(".banner.notice-info")).toHaveText(info);
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
  await pollNow(page);
  await expect(page.locator(".box").first()).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(page.locator(".banner.notice-info")).toHaveText(info);
});

import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { CDC, DAGSTER, REVENUE, TODAY, box, boxDates, boxFile, boxTitle, dragDays, expect, openTab, pollNow, save, storedDrafts, test, toolbar } from "./helpers";

// Unsaved drafts are kept per tab: other tabs never take, overwrite or remove
// them, and one left by a tab that's gone is offered, never taken silently.

const MINUTE = 60_000;
/** Drafts are written once editing pauses: wait until this tab's is. */
const stored = async (page: Page, n = 1) => expect.poll(async () => Object.keys(await storedDrafts(page)).length).toBe(n);

test("each tab keeps its own draft: another tab polling, saving and discarding leaves it alone", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 10);
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await stored(page);
  const [key] = Object.keys(await storedDrafts(page));
  const items = (await storedDrafts(page))[key].items;

  const other = await openTab(page.context(), github);
  const notice = other.locator(".banner", { hasText: "This roadmap has unsaved changes in another tab." });
  await expect(notice).toBeVisible();
  await expect(toolbar(other)).toContainText("No changes"); // never taken over

  // Someone else saves; the other tab polls, then saves an edit of its own, then discards another.
  github.deploy(github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") }));
  await pollNow(other);
  await expect(boxTitle(other, REVENUE)).toHaveText("Revenue mart v3");
  await dragDays(other, CDC, 5);
  await save(other);
  await expect(toolbar(other)).toContainText("No changes");
  const cdc = await boxDates(other, CDC);
  await dragDays(other, CDC, 5);
  await other.getByRole("button", { name: "More save options" }).click();
  other.once("dialog", (d) => d.accept());
  await other.getByRole("button", { name: "Discard this change…" }).click();
  await expect(toolbar(other)).toContainText("No changes");

  // The first tab's draft is as it was, and survives a reload, carried onto the newer saves.
  const after = await storedDrafts(page);
  expect(Object.keys(after)).toEqual([key]);
  expect(after[key].items).toEqual(items);
  await page.reload();
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await expect.poll(() => boxDates(page, CDC)).toBe(cdc);
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-28 – 2026-11-06");

  // Once it's saved, the other tab's notice goes.
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
  await expect(notice).toHaveCount(0);
  expect(await storedDrafts(page)).toEqual({});
});

/** A tab edits, then closes without a trace of closing; returns another tab opened 10 minutes later. */
async function leaveDraft(page: Page, github: Parameters<typeof openTab>[1]): Promise<Page> {
  await dragDays(page, DAGSTER, 10);
  await stored(page);
  const context = page.context();
  await page.close();
  return openTab(context, github, new Date(TODAY.getTime() + 10 * MINUTE));
}

test("a draft left by a tab that's no longer open is offered to restore, never taken without asking", async ({ page, github }) => {
  const later = await leaveDraft(page, github);
  const offer = later.locator(".banner", { hasText: "Restore unsaved changes from another tab?" });
  await expect(offer).toContainText("1 change, last changed 2026-10-03 09:00, in a tab that’s no longer open.");
  await expect(toolbar(later)).toContainText("No changes");
  await expect.poll(() => boxDates(later, DAGSTER)).toBe("2026-09-14 – 2026-10-23");

  await offer.getByRole("button", { name: "Restore" }).click();
  await expect(offer).toHaveCount(0);
  await expect(toolbar(later)).toContainText("Save · 1 change");
  await expect.poll(() => boxDates(later, DAGSTER)).toBe("2026-09-28 – 2026-11-06");
  // Now this tab's own: the one left behind is gone, and a reload restores it without asking.
  await stored(later);
  await later.reload();
  await expect(toolbar(later)).toContainText("Save · 1 change");
  await expect(offer).toHaveCount(0);
});

test("a draft on offer is counted again when others' saves come in: what they saved isn't offered", async ({ page, github }) => {
  await dragDays(page, CDC, 5);
  const later = await leaveDraft(page, github);
  const offer = later.locator(".banner", { hasText: "Restore unsaved changes from another tab?" });
  await expect(offer).toContainText("2 changes");
  // Someone saves the same new dates for Dagster.
  github.deploy(github.otherSave({ [boxFile(DAGSTER)]: (t) => t.replace("start: 2026-09-14\nend: 2026-10-23", "start: 2026-09-28\nend: 2026-11-06") }));
  await pollNow(later);
  await expect.poll(() => boxDates(later, DAGSTER)).toBe("2026-09-28 – 2026-11-06");
  await expect(offer).toContainText("1 change,");
  await offer.getByRole("button", { name: "Restore" }).click();
  await expect(toolbar(later)).toContainText("Save · 1 change");
});

test("unsaved edits that can't be read are said to be unreadable, to download or discard", async ({ page, github: _ }) => {
  await page.evaluate(() => localStorage.setItem("boxops-draft:acme/roadmap@main:0000abcd", "{ not JSON"));
  await page.reload();
  const offer = page.locator(".banner", { hasText: "Unsaved edits kept in this browser can’t be read" });
  await expect(offer).toHaveText("Unsaved edits kept in this browser can’t be read, so they can’t be opened.Download my unsaved edits (JSON)Discard…");
  page.once("dialog", (d) => d.accept());
  await offer.getByRole("button", { name: "Discard…" }).click();
  await expect(offer).toHaveCount(0);
  expect(await storedDrafts(page)).toEqual({});
});

test("a duplicated tab, opened before the original had changes, never touches the original's draft", async ({ page, github }) => {
  // Duplicating a tab copies its sessionStorage, tab id and all: both start with one key.
  const id = (tab: Page) => tab.evaluate(() => sessionStorage.getItem("boxops-tab"));
  const original = await id(page);
  const duplicate = await openTab(page.context(), github, TODAY, { "boxops-tab": original! });
  await dragDays(page, DAGSTER, 10);
  await stored(page);
  const [key] = Object.keys(await storedDrafts(page));
  // The duplicate sees the original write that key, and takes one of its own.
  await expect.poll(() => id(duplicate)).not.toBe(original);
  await expect(duplicate.locator(".banner", { hasText: "This roadmap has unsaved changes in another tab." })).toBeVisible();

  // The original closes. The duplicate, with nothing of its own to keep, polls in someone's save.
  await page.close();
  github.deploy(github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") }));
  await pollNow(duplicate);
  await expect(boxTitle(duplicate, REVENUE)).toHaveText("Revenue mart v3");
  expect(Object.keys(await storedDrafts(duplicate))).toEqual([key]);

  // Once the original has been gone a while, the duplicate offers its changes, without a reload.
  await duplicate.clock.fastForward(5 * MINUTE);
  const offer = duplicate.locator(".banner", { hasText: "Restore unsaved changes from another tab?" });
  await expect(offer).toContainText("1 change, last changed 2026-10-03 09:00, in a tab that’s no longer open.");
  await offer.getByRole("button", { name: "Restore" }).click();
  await expect(toolbar(duplicate)).toContainText("Save · 1 change");
  await expect.poll(() => boxDates(duplicate, DAGSTER)).toBe("2026-09-28 – 2026-11-06");
  // Moved into the duplicate's own draft: the one left behind goes once that's written.
  await expect.poll(async () => Object.keys(await storedDrafts(duplicate))).toEqual([expect.not.stringMatching(key)]);
});

test("a reload the page didn't see coming (after a crash) restores the tab's own draft", async ({ page, github: _ }) => {
  await dragDays(page, DAGSTER, 10);
  await stored(page);
  // A crashed page never hears pagehide, so its draft is still marked alive.
  await page.evaluate(() => window.addEventListener("pagehide", (e) => e.stopImmediatePropagation(), { capture: true }));
  // Playwright's fake clock hides the browser's navigation timing, which says a page is a reload.
  await page.addInitScript(() => {
    performance.getEntriesByType = (type: string) => (type === "navigation" ? [{ type: "reload" } as PerformanceNavigationTiming] : []);
  });
  await page.reload();
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-28 – 2026-11-06");
  await expect(page.locator(".banner", { hasText: "unsaved changes in another tab" })).toHaveCount(0);
  expect(Object.keys(await storedDrafts(page))).toHaveLength(1);
});

test("unsaved edits kept over a reload after someone else saved: theirs come in, a box both changed clashes", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 10);
  await stored(page);
  github.deploy(
    github.otherSave(
      {
        [boxFile(DAGSTER)]: (t) => t.replace("status: at_risk", "status: blocked"),
        [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3"),
      },
      "Priya Shah",
      "Two boxes",
    ),
  );
  await page.reload();
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-28 – 2026-11-06");
  await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
  await expect(box(page, DAGSTER)).toHaveClass(/conflict/);
  await page.getByRole("button", { name: /^\d+ warnings?$/ }).click();
  await expect(page.getByRole("dialog", { name: /warning/ }).locator("section", { hasText: "Clashes with someone else’s save" })).toContainText(
    "Box “Dagster 2.x upgrade”: you’ll choose whose version to keep when you save",
  );
});

test("a draft left by a tab that's no longer open can be discarded for good", async ({ page, github }) => {
  const later = await leaveDraft(page, github);
  const offer = later.locator(".banner", { hasText: "Restore unsaved changes from another tab?" });
  later.once("dialog", (d) => d.accept());
  await offer.getByRole("button", { name: "Discard…" }).click();
  await expect(offer).toHaveCount(0);
  expect(await storedDrafts(later)).toEqual({});
  await later.reload();
  await expect(later.locator(".box").first()).toBeVisible();
  await expect(offer).toHaveCount(0);
  await expect(toolbar(later)).toContainText("No changes");
});

test("unsaved edits another data format wrote can be downloaded or discarded, never opened", async ({ page, github: _ }) => {
  const key = "boxops-draft:acme/roadmap@main:0000abcd";
  const draft = {
    v: 2,
    format: 2,
    build: "0.2.0+0123456789ab",
    baseCommit: "",
    savedAt: "2026-10-02T14:05:00.000Z", // 14:05 in the browser's zone, UTC
    alive: 0,
    items: { "box:bx-0000-x": { now: { id: "bx-0000-x", title: "X", effort: "large" } } },
    conflicts: [],
  };
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(draft)]);
  await page.reload();
  const offer = page.locator(".banner", { hasText: "Unsaved edits made with another version of BoxOps" });
  await expect(offer).toContainText("(last changed 2026-10-02 14:05) can’t be opened here.");
  await expect(toolbar(page)).toContainText("No changes");

  const downloading = page.waitForEvent("download");
  await offer.getByRole("button", { name: "Download my unsaved edits (JSON)" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("boxops-unsaved-changes-2026-10-03.json");
  expect(JSON.parse(await readFile(await download.path(), "utf8"))).toEqual({ [key]: draft });

  page.once("dialog", (d) => d.accept());
  await offer.getByRole("button", { name: "Discard…" }).click();
  await expect(offer).toHaveCount(0);
  expect(await storedDrafts(page)).toEqual({});
});

test("a browser that won't keep the draft (full or blocked storage) says so, once", async ({ page, github: _ }) => {
  await dragDays(page, DAGSTER, 10);
  await stored(page);
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
  const warning = page.locator(".banner", { hasText: "This browser isn’t keeping your unsaved changes" });
  await expect(warning).toHaveCount(0);
  await dragDays(page, CDC, 5);
  await expect(warning).toContainText("so they’d be lost if this tab closed. Save soon.");
  // A minute on, the heartbeat tries again: it doesn't vouch for the older copy still stored.
  await page.clock.fastForward(MINUTE + 1000);
  await page.getByRole("button", { name: "More save options" }).click();
  const note = page.locator(".menu-note");
  await expect(note).toHaveText("This browser isn’t keeping unsaved changes right now: save before you close the tab.");
  await page.keyboard.press("Escape");
  await expect(warning).toBeVisible();

  await warning.getByRole("button", { name: "Dismiss" }).click();
  await dragDays(page, DAGSTER, 5);
  await page.waitForTimeout(600); // long enough to try to write it again
  await expect(warning).toHaveCount(0);
  await page.getByRole("button", { name: "More save options" }).click();
  await expect(note).toHaveText("This browser isn’t keeping unsaved changes right now: save before you close the tab.");
});

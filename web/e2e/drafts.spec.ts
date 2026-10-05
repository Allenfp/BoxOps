import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { CDC, DAGSTER, REVENUE, TODAY, boxDates, boxFile, boxTitle, dragDays, expect, openTab, pollNow, save, storedDrafts, test, toolbar } from "./helpers";

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
    savedAt: new Date(2026, 9, 2, 14, 5).toISOString(),
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
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("boxops-draft:")) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await dragDays(page, DAGSTER, 10);
  const warning = page.locator(".banner", { hasText: "This browser isn’t keeping your unsaved changes" });
  await expect(warning).toContainText("so they’d be lost if this tab closed. Save soon.");
  await warning.getByRole("button", { name: "Dismiss" }).click();
  await dragDays(page, DAGSTER, 5);
  await page.waitForTimeout(600); // long enough to try to write it again
  await expect(warning).toHaveCount(0);
  await page.getByRole("button", { name: "More save options" }).click();
  await expect(page.locator(".menu-note")).toHaveText("This browser isn’t keeping unsaved changes right now: save before you close the tab.");
});

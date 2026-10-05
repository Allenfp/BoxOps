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

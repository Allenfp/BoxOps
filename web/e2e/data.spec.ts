import type { Page } from "@playwright/test";
import type { FakeGitHub } from "./fake-github";
import { DAGSTER, boxFile, dragDays, expect, pollNow, save, test, toolbar } from "./helpers";

let edits = 0;

/** Someone pushes a hand edit and the site redeploys; this tab picks it up. */
async function handEdit(page: Page, github: FakeGitHub, path: string, edit: (text: string) => string) {
  const message = `Hand edit ${++edits}`;
  github.deploy(github.otherSave({ [path]: edit }, "Sam Lee", message));
  await pollNow(page);
  await expect(page.locator(".banner", { hasText: "Sam Lee saved" })).toContainText(`“${message}”`);
}

test("a file the app couldn't fully read is never written; other edits still save", async ({ page, github }) => {
  await handEdit(page, github, "people.yaml", (t) => `${t}  - name: Somebody without an id\n`);
  const edited = github.head;

  await dragDays(page, DAGSTER, 10);
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.headCommit().parent).toBe(edited);
  expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28\n");
  const saved = github.head;

  await page.getByRole("button", { name: "People" }).click();
  const role = page.locator("tbody tr").filter({ has: page.locator('input[aria-label="Name"][value="Sam Lee"]') }).getByLabel("Role");
  await role.fill("Staff Engineer");
  await role.press("Enter");
  await save(page);
  const dialog = page.locator(".save-dialog[open]");
  await expect(dialog.locator("h2")).toHaveText("Can’t save yet");
  await expect(dialog).toContainText("roadmap/people.yaml");
  await expect(dialog).toContainText("id: required text is missing");
  expect(github.head).toBe(saved); // nothing written
  await dialog.getByRole("button", { name: "Back to editing" }).click();
  await expect(toolbar(page)).toContainText("Save · 1 change");
});

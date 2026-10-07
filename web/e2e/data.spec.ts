import type { Page } from "@playwright/test";
import type { Bundle } from "../src/model/bundle";
import type { FakeGitHub } from "./fake-github";
import { DAGSTER, REVENUE, boxFile, boxTitle, dragDays, expect, pollNow, save, test, toolbar } from "./helpers";

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

test("a roadmap in another data format opens read-only", async ({ page, github }) => {
  await handEdit(page, github, "settings.yaml", (t) => t.replace("format: 1", "format: 2"));
  await expect(page.locator(".banner", { hasText: "Read-only" })).toContainText("uses data format 2");
  await expect(page.locator(".draft-status")).toHaveCount(0);

  await handEdit(page, github, "settings.yaml", (t) => t.replace(/^format: .*\n/m, ""));
  await expect(page.locator(".banner", { hasText: "Read-only" })).toContainText("doesn’t say which data format");
  await expect(page.locator(".draft-status")).toHaveCount(0);

  await handEdit(page, github, "settings.yaml", (t) => `format: 1\n${t}`);
  await expect(page.locator(".banner", { hasText: "Read-only" })).toHaveCount(0);
  await expect(toolbar(page)).toContainText("No changes");
});

test("a roadmap.json from before bundle schema 1 still opens", async ({ page, github }) => {
  const c = github.headCommit();
  await page.route("**/roadmap.json*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ files: c.files, source: { repo: "acme/roadmap", branch: "main", commit: github.head, author: c.author, subject: c.message } }),
    }),
  );
  await page.reload();
  await expect(page.locator(".box").first()).toBeVisible();
  await expect(toolbar(page)).toContainText("No changes");
});

test("the files as the build parsed them are used by that build only; another parses them itself", async ({ page, github }) => {
  // The parsed files say something the files don't, so the title shows which the app read.
  const stamped = (parser: (b: Bundle) => string) => (b: Bundle): Bundle => ({
    ...b,
    parsed: b.parsed && {
      parser: parser(b),
      files: Object.fromEntries(
        Object.entries(b.parsed.files).map(([path, f]) => [path, f.kind === "box" && f.box?.id === REVENUE ? { ...f, box: { ...f.box, title: "As parsed" } } : f]),
      ),
    },
  });
  github.patchBundle = stamped((b) => b.app.build);
  await page.reload();
  await expect(boxTitle(page, REVENUE)).toHaveText("As parsed");
  github.patchBundle = stamped(() => "0.0.1+0123456789ab");
  await page.reload();
  await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v2");
});

test("other files in the roadmap folder are reported, from a deploy and on load", async ({ page, github }) => {
  github.deploy(github.otherSave({ "README.md": () => "# Notes\n" }, "Sam Lee", "Add a README"));
  const reported = async () => {
    await page.getByRole("button", { name: /^\d+ warnings?$/ }).click();
    await expect(page.getByRole("dialog", { name: /warning/ }).locator("section", { hasText: "Problems in the roadmap files" })).toContainText(
      "roadmap/README.md: unexpected file",
    );
    await page.keyboard.press("Escape");
  };
  await pollNow(page);
  await expect(page.locator(".banner", { hasText: "Sam Lee saved" })).toContainText("“Add a README”");
  await reported();
  await page.reload();
  await expect(page.locator(".box").first()).toBeVisible();
  await reported();
});

// `github` keeps the app off the network: the build's own roadmap.json would send it to api.github.com.
// A release candidate's tree, which a release run's CI tests, has a pre-release tag: 0.1.0-rc.1+….
test("index.html names the build", async ({ page, github: _github }) => {
  await expect(page.locator('meta[name="boxops-build"]')).toHaveAttribute("content", /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?\+([0-9a-f]{12}|unknown)(\.dirty)?$/);
  await expect(page.locator('meta[name="boxops-build-time"]')).toHaveAttribute("content", /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)?$/);
});

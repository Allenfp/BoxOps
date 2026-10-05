import { type Route } from "@playwright/test";
import { type FakeGitHub, OTHER_OWNER_TOKEN, REPO, TOKEN } from "./fake-github";
import { DAGSTER, REVENUE, box, boxTitle, boxFile, dragDays, expect, pollNow, save, test, toolbar } from "./helpers";

// Opening the site: the deployed copy at once, then any newer saves from
// GitHub; branch previews; and what happens when loading fails.

/** A branch beside main, one commit ahead of it, renaming Revenue mart. */
function featureBranch(github: FakeGitHub): string {
  const main = github.head;
  const commit = github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") }, "Priya Shah", "Try v3");
  github.head = main;
  github.branches.feature = commit;
  return commit;
}

for (const visibility of ["public", "private"] as const) {
  test.describe(`${visibility} repository`, () => {
    test.use({ visibility });

    test("a reload paints the deployed copy at once, then brings in saves it doesn't have yet", async ({ page, github }) => {
      github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") }, "Sam Lee", "Revenue mart: v3");
      let answer!: () => void;
      const held = new Promise<void>((resolve) => (answer = resolve));
      await page.route(/^https:\/\/api\.github\.com\/repos\/acme\/roadmap\/git\/ref\//, async (route) => {
        await held;
        await route.fallback();
      });
      await page.reload();
      await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v2"); // while GitHub hasn't answered
      answer();
      await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
      await expect(page.locator(".banner")).toContainText("Sam Lee saved “Revenue mart: v3”");
      await expect(box(page, REVENUE)).toHaveClass(/updated/);
      expect(github.calls("blob")).toBe(1); // only the file that changed
    });

    test("a GitHub that doesn't answer doesn't hold the page up; saving still checks first", async ({ page, github }) => {
      github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") }, "Sam Lee", "Revenue mart: v3");
      github.inject("ref", "hang");
      await page.reload();
      await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v2");
      // The check gives up after a few seconds, well before the call's own timeout and retry.
      await page.clock.fastForward(5_000);
      await page.clock.fastForward(20_000);
      await page.clock.fastForward(2_000);
      await page.waitForTimeout(300); // time for a retry that shouldn't happen
      await expect(page.locator(".banner")).toHaveCount(0);
      await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v2");
      expect(github.calls("ref")).toBe(2); // the first load's, and the one that hung

      await dragDays(page, DAGSTER, 10);
      await save(page);
      await expect(page.locator(".save-dialog[open] h2")).toHaveText("The roadmap changed since you opened it");
      await expect(page.locator(".save-dialog[open] .save-list")).toContainText("Sam Lee saved “Revenue mart: v3”");
    });
  });
}

test.describe("branch previews (?ref=)", () => {
  test("show a branch read-only, with a way back to the live roadmap", async ({ page, github }) => {
    featureBranch(github);
    await page.goto("./?ref=feature&zoom=months");
    await expect(page.locator(".banner")).toContainText("Previewing branch feature (read-only).");
    await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
    await expect(toolbar(page)).toHaveCount(0);
    await page.getByRole("link", { name: "Back to the live roadmap" }).click();
    await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v2");
    expect(new URL(page.url()).searchParams.has("ref")).toBe(false);
  });

  test("a branch that isn't there: a plain message, Try again, and a way back", async ({ page, github: _ }) => {
    await page.goto("./?ref=nope&zoom=months");
    const problem = page.locator(".load-problem");
    await expect(problem.locator("h1")).toHaveText("Couldn’t show branch “nope”");
    await expect(problem.locator("p").first()).toHaveText("acme/roadmap has no branch “nope”.");
    await expect(problem.getByRole("button", { name: "Try again" })).toBeVisible();
    await problem.getByRole("link", { name: "Back to the live roadmap" }).click();
    await expect(page.locator(".box").first()).toBeVisible();
  });
});

test.describe("private repository, signed out", () => {
  test.use({ visibility: "private", signedIn: false });

  test("a branch preview asks for a token, then shows the branch", async ({ page, github }) => {
    featureBranch(github);
    await page.goto("./?ref=feature&zoom=months");
    const form = page.locator(".load-token");
    await expect(form.locator("h2")).toHaveText("Connect to GitHub to preview");
    await expect(form).toContainText("feature is a branch of acme/roadmap, a private repository");
    expect(github.calls()).toBe(0);
    await form.locator('input[type="password"]').fill(TOKEN);
    await form.getByRole("button", { name: "Preview" }).click();
    await expect(page.locator(".banner")).toContainText("Previewing branch feature (read-only).");
    await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
  });

  test("a branch preview whose kept token can't see the repository offers a different token", async ({ page, github }) => {
    featureBranch(github);
    await page.evaluate(([key, token]) => sessionStorage.setItem(key, token), [`boxops-github-token:${REPO}`, OTHER_OWNER_TOKEN]);
    await page.goto("./?ref=feature&zoom=months");
    const problem = page.locator(".load-problem");
    await expect(problem.locator("h1")).toHaveText("Couldn’t show branch “feature”");
    await expect(problem).toContainText("This token can’t see acme/roadmap.");
    await problem.getByRole("button", { name: "Use a different token" }).click();

    const form = page.locator(".load-token");
    await expect(form.locator("h2")).toHaveText("Connect to GitHub to preview");
    // Read access is all a preview needs, and the link asks for no more.
    await expect(form.getByRole("link", { name: `Create a fine-grained token for ${REPO}` })).toHaveAttribute("href", /&contents=read$/);
    await expect(form.locator(".token-help")).toContainText("Contents → Read-only");
    await form.locator('input[type="password"]').fill(TOKEN);
    await form.getByRole("button", { name: "Preview" }).click();
    await expect(page.locator(".banner")).toContainText("Previewing branch feature (read-only).");
    await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
  });
});

test("a roadmap.json that won't load: a plain message and Try again", async ({ page, github: _ }) => {
  const down = (route: Route) => route.fulfill({ status: 503, body: "Service unavailable" });
  await page.route("**/roadmap.json*", down);
  await page.reload();
  const problem = page.locator(".load-problem");
  await expect(problem.locator("h1")).toHaveText("Couldn’t load the roadmap");
  await expect(problem).toContainText("The site answered with an error (HTTP 503). Try again in a minute.");
  await expect(problem.getByRole("link", { name: "Back to the live roadmap" })).toHaveCount(0);
  await page.unroute("**/roadmap.json*", down);
  await problem.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".box").first()).toBeVisible();
});

test("a roadmap.json that arrives but can't be opened: a plain message and Try again, never Loading… for good", async ({ page, github }) => {
  // A bundle from before schema 1 (no blob SHAs) in a browser without WebCrypto (an insecure origin).
  github.patchBundle = (b) => ({ ...b, blobs: {} });
  await page.addInitScript(() => Object.defineProperty(crypto, "subtle", { configurable: true, get: () => undefined }));
  await page.reload();
  const problem = page.locator(".load-problem");
  await expect(problem.locator("h1")).toHaveText("Couldn’t load the roadmap");
  await expect(problem).toContainText("The roadmap arrived, but BoxOps couldn’t open it.");
  await expect(problem.locator("details")).toContainText("TypeError");
  github.patchBundle = undefined;
  await problem.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".box").first()).toBeVisible();
});

test("a copy built from files on disk is read-only and asks GitHub nothing", async ({ page, github }) => {
  github.patchBundle = (b) => ({ ...b, source: { ...b.source, local: true } });
  await page.reload();
  await expect(page.locator(".banner")).toContainText("Read-only: this copy was built from the files on disk");
  await expect(toolbar(page)).toHaveCount(0);
  const calls = github.calls();
  await pollNow(page);
  await page.reload();
  await expect(page.locator(".box").first()).toBeVisible();
  // A branch preview would read from GitHub: it says so instead.
  featureBranch(github);
  await page.goto("./?ref=feature");
  await expect(page.locator(".load-problem")).toContainText("can’t preview a branch");
  expect(github.calls()).toBe(calls);
});

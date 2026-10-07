import { type Route } from "@playwright/test";
import { EXECUTABLE } from "../src/model/paths";
import { type FakeGitHub, OTHER_OWNER_TOKEN, REPO, TOKEN } from "./fake-github";
import { DAGSTER, REVENUE, box, boxTitle, boxFile, dragDays, expect, looseBannerText, pollNow, save, saveKeyTaken, test, toolbar } from "./helpers";

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
      // The first load's call, and this load's, which hangs: made once GitHub's code has come, so
      // waited for before the clock moves on.
      await expect.poll(() => github.calls("ref")).toBe(2);
      // The check gives up after a few seconds, well before the call's own timeout and retry.
      await page.clock.fastForward(5_000);
      await page.clock.fastForward(20_000);
      await page.clock.fastForward(2_000);
      await page.waitForTimeout(300); // time for a retry that shouldn't happen
      await expect(page.locator(".banner")).toHaveCount(0);
      await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v2");
      expect(github.calls("ref")).toBe(2); // no more

      await dragDays(page, DAGSTER, 10);
      await save(page);
      await expect(page.locator(".save-dialog[open] h2")).toHaveText("The roadmap changed since you opened it");
      await expect(page.locator(".save-dialog[open] .save-list")).toContainText("Sam Lee saved “Revenue mart: v3”");
    });
  });
}

test("newer saves too many to read: the deployed copy stays, with a notice", async ({ page, github }) => {
  github.otherSave(Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`boxes/bx-${i}.yaml`, () => `id: bx-${i}\n`])), "Sam Lee", "Import");
  await page.reload();
  const notice = page.locator(".banner.notice-warning");
  await expect(notice).toContainText(
    "Newer saves aren’t shown: 301 roadmap files changed since this copy was loaded, more than BoxOps reads at once (300). Reload once the site has redeployed.",
  );
  await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v2");
  expect(github.calls("blob") + github.calls("raw")).toBe(0);
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
});

test("newer saves in a folder that breaks the build's rules: the deployed copy stays, with a notice", async ({ page, github }) => {
  github.otherSave({ "boxes/link.yaml": () => "../../.git/config" }, "Sam Lee", "Link");
  github.modes = { "roadmap/boxes/link.yaml": "120000" };
  await page.reload();
  await expect(page.locator(".banner.notice-warning")).toHaveText(
    "Newer saves aren’t shown, and saving won’t work, until the roadmap folder on GitHub is fixed: roadmap/boxes/link.yaml: is a symlink; a roadmap folder holds plain files only.",
  );
  await expect(page.locator(".box").first()).toBeVisible();
  // Once a fixed deploy arrives, the notice goes with the copy it was about.
  github.modes = {};
  const fixed = { "boxes/link.yaml": () => undefined, [boxFile(REVENUE)]: (t: string) => t.replace("Revenue mart v2", "Revenue mart v3") };
  github.deploy(github.otherSave(fixed, "Sam Lee", "Unlink; Revenue mart v3"));
  await pollNow(page);
  await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
  await expect(page.locator(".banner.notice-warning")).toHaveCount(0);
});

test("a newer save that makes a roadmap file executable is read all the same, with a warning in the console", async ({ page, github }) => {
  github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") }, "Sam Lee", "Revenue mart: v3");
  github.modes = { [`roadmap/${boxFile(REVENUE)}`]: "100755" };
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning") warnings.push(m.text());
  });
  await page.reload();
  await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
  await expect(page.locator(".banner.notice-warning")).toHaveCount(0);
  expect(warnings).toContain(`roadmap/${boxFile(REVENUE)} ${EXECUTABLE}`);
});

test.describe("branch previews (?ref=)", () => {
  test("show a branch read-only, with a way back to the live roadmap", async ({ page, github }) => {
    featureBranch(github);
    await page.goto("./?ref=feature&zoom=months");
    await expect(page.locator(".banner")).toContainText("Previewing branch feature (read-only).");
    await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
    await expect(toolbar(page)).toHaveCount(0);
    await expect(page.locator(".tl-corner > span")).toHaveText("Read-only preview");
    expect(await looseBannerText(page)).toEqual([]);
    // ⌘S never opens the browser's Save Page dialog.
    expect(await saveKeyTaken(page)).toBe(true);
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

  test("a branch too different to read says to check it out, not to wait for a deploy", async ({ page, github }) => {
    const main = github.head;
    github.branches.big = github.otherSave(Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`boxes/bx-${i}.yaml`, () => `id: bx-${i}\n`])));
    github.head = main;
    await page.goto("./?ref=big&zoom=months");
    const problem = page.locator(".load-problem");
    await expect(problem.locator("h1")).toHaveText("Couldn’t show branch “big”");
    await expect(problem.locator("p").first()).toHaveText(
      "“big” differs from the deployed roadmap in 301 files, more than BoxOps reads at once (300). Check the branch out to see it.",
    );
    expect(github.calls("blob") + github.calls("raw")).toBe(0);
  });
});

test.describe("private repository, signed out", () => {
  test.use({ visibility: "private", signedIn: false });

  test("a branch preview asks for a token, then shows the branch; the gear menu can forget the token", async ({ page, github }) => {
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

    // The tab can't save, but the token it keeps can be forgotten here, as the form said.
    await expect(form).toHaveCount(0);
    const menu = page.getByRole("dialog", { name: "Settings" });
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(menu.getByRole("heading", { name: "GitHub" })).toBeVisible();
    await expect(menu.getByRole("button", { name: /unsaved change|Team settings/ })).toHaveCount(0);
    await menu.getByRole("button", { name: "Forget token" }).click();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), `boxops-github-token:${REPO}`)).toBeNull();
    // With none kept, a read-only tab has nothing to say about tokens.
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(menu.getByText("GitHub token")).toHaveCount(0);
  });

  test("a branch preview whose kept token no header can carry asks for another, sending nothing", async ({ page, github }) => {
    featureBranch(github);
    await page.evaluate(([key, token]) => sessionStorage.setItem(key, token), [`boxops-github-token:${REPO}`, `${TOKEN}\u200B`]);
    await page.goto("./?ref=feature&zoom=months");
    const form = page.locator(".load-token");
    await expect(form.locator("h2")).toHaveText("Connect to GitHub to preview");
    await expect(form.locator(".callout.error")).toContainText("rejected that token");
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
  await expect(problem.locator("h1")).toBeFocused();
  await expect(problem).toContainText("The site answered with an error (HTTP 503). Try again in a minute.");
  await expect(problem.getByRole("link", { name: "Back to the live roadmap" })).toHaveCount(0);
  await page.unroute("**/roadmap.json*", down);
  await problem.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".box").first()).toBeVisible();
});

test("a roadmap.json that never comes: a plain message and Try again, never Loading… for good", async ({ page, github: _ }) => {
  const stalled = () => {}; // never answered
  await page.route("**/roadmap.json*", stalled);
  await page.reload();
  await expect(page.locator(".splash")).toHaveText("Loading roadmap…");
  await page.clock.fastForward(20_000);
  const problem = page.locator(".load-problem");
  await expect(problem).toContainText("The site didn’t answer in time. Check your connection, then try again.");
  await expect(problem.locator("details")).toContainText("roadmap.json: no answer within 20 s");
  await page.unroute("**/roadmap.json*", stalled);
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

test("a copy built from files on disk shows a saved file within a second, and no notice", async ({ page, github }) => {
  // What `boxops preview` serves: the working tree, at HEAD's commit, made afresh on each fetch (and said to be).
  const head = github.head;
  github.patchBundle = (b) => ({ ...b, source: { ...b.source, commit: head, history: [head], local: true } });
  github.live = true;
  await page.reload();
  await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v2");
  const calls = github.calls();
  // A file saved on disk: the next look, within a second, brings it in.
  github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") });
  github.deploy();
  await page.clock.runFor(1000);
  await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
  expect(await looseBannerText(page)).toEqual([]);
  // Unchanged files on the next look: nothing redrawn, still nothing asked of GitHub.
  await page.clock.runFor(1000);
  await page.waitForTimeout(300); // time for the look to land, and a call to GitHub that shouldn't come
  await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
  expect(github.calls()).toBe(calls);
});

test("a copy built from files on disk and hosted as files looks once, then stops", async ({ page, github }) => {
  // A local build's site (`build --worktree`) put on a server: its roadmap.json can't change, and isn't said to.
  const head = github.head;
  github.patchBundle = (b) => ({ ...b, source: { ...b.source, commit: head, history: [head], local: true } });
  await page.reload();
  await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v2");
  const fetches = github.siteFetches;
  github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") });
  github.deploy();
  // One look, a moment after loading, shows what's there; then no more.
  await page.clock.runFor(1000);
  await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
  expect(github.siteFetches).toBe(fetches + 1);
  github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v3", "Revenue mart v4") });
  github.deploy();
  await page.clock.runFor(10_000);
  await page.waitForTimeout(300); // time for a look that shouldn't come
  await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
  expect(github.siteFetches).toBe(fetches + 1);
});

test("a copy built from files on disk is read-only and asks GitHub nothing", async ({ page, github }) => {
  github.patchBundle = (b) => ({ ...b, source: { ...b.source, local: true } });
  await page.reload();
  await expect(page.locator(".banner")).toContainText("Read-only: this copy was built from the files on disk");
  expect(await looseBannerText(page)).toEqual([]);
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

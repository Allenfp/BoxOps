import { CLASSIC_TOKEN, REPO, TOKEN } from "./fake-github";
import { CDC, DAGSTER, REVENUE, box, boxTitle, boxDates, boxFile, dragDays, expect, pollNow, save, test, toolbar } from "./helpers";

// Saving works the same on a public and on a private repository; on a private
// one, everything goes through the API with the token.
for (const visibility of ["public", "private"] as const) {
  test.describe(`${visibility} repository`, () => {
    test.use({ visibility });

    test.describe("first save", () => {
      test.use({ signedIn: false });

      test("asks for a token once, rejects a bad one, then commits to main", async ({ page, github }) => {
        // Signed out, a private repository is never asked anything; a public one, for its head.
        expect(github.calls()).toBe(visibility === "private" ? 0 : 1);
        await dragDays(page, DAGSTER, 10);
        await page.getByRole("button", { name: /^Save · \d+ changes?$/ }).click();

        const dialog = page.locator(".save-dialog[open]");
        await expect(dialog.locator("h2")).toHaveText("Connect to GitHub to save");
        await dialog.locator('input[type="password"]').fill("wrong");
        await dialog.getByRole("button", { name: "Save" }).click();
        await expect(page.locator(".save-dialog[open] .callout.error")).toContainText("rejected that token");

        await page.locator('.save-dialog[open] input[type="password"]').fill(TOKEN);
        await page.locator(".save-dialog[open]").getByRole("button", { name: "Save" }).click();
        await expect(page.locator(".banner.success")).toContainText("Saved to main");
        await expect(page.locator(".banner.success")).toContainText("The site picks it up in about a minute.");
        await expect(toolbar(page)).toContainText("No changes");

        const head = github.headCommit();
        expect(head.parent).toBe(github.root);
        expect(head.signed).toBe(true); // one createCommitOnBranch, which GitHub signs
        expect(github.calls("graphql")).toBe(1);
        expect(head.message.split("\n")[0]).toBe("Dagster 2.x upgrade (DE-D9U): rescheduled to 2026-09-28 – 2026-11-06");
        expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28\nend: 2026-11-06\n");

        // Next save: no dialog at all.
        await dragDays(page, DAGSTER, 5);
        await save(page);
        await expect(toolbar(page)).toContainText("No changes");
        await expect(page.locator(".save-dialog[open]")).toHaveCount(0);
        expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-10-05\n");
      });

      test("someone saved since the deploy: the first save takes a token, then shows their saves for review", async ({ page, github }) => {
        await dragDays(page, DAGSTER, 10);
        const sam = github.otherSave(
          { [boxFile(CDC)]: (t) => t.replace("CDC pipeline for orders DB", "CDC pipeline (orders + payments)") },
          "Sam Lee",
          "CDC pipeline: renamed",
        );
        await page.getByRole("button", { name: /^Save · \d+ changes?$/ }).click();
        const dialog = page.locator(".save-dialog[open]");
        await dialog.locator('input[type="password"]').fill(TOKEN);
        await dialog.getByRole("button", { name: "Save" }).click();
        await expect(dialog.locator("h2")).toHaveText("The roadmap changed since you opened it");
        await expect(dialog.locator(".save-list")).toContainText("Sam Lee saved “CDC pipeline: renamed”");
        await expect(boxTitle(page, CDC)).toHaveText("CDC pipeline (orders + payments)");
        expect(github.head).toBe(sam); // nothing written yet

        await dialog.getByRole("button", { name: "Save now" }).click();
        await expect(toolbar(page)).toContainText("No changes");
        expect(github.headCommit().parent).toBe(sam);
        expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
        expect(github.file(boxFile(CDC))).toContain("orders + payments");
      });

      test("Keep mine, then the token: the choice carries through and the save goes on top of theirs", async ({ page, github }) => {
        await dragDays(page, DAGSTER, 10);
        const theirs = github.otherSave({ [boxFile(DAGSTER)]: (t) => t.replace("status: at_risk", "status: blocked") });
        github.deploy();
        await pollNow(page);
        await expect(box(page, DAGSTER)).toHaveClass(/conflict/);

        await page.getByRole("button", { name: /^Save · \d+ changes?$/ }).click();
        const dialog = page.locator(".save-dialog[open]");
        await expect(dialog.locator("h2")).toHaveText("Someone else changed the same items");
        await dialog.getByRole("button", { name: "Keep mine" }).click();
        await expect(dialog.locator("h2")).toHaveText("Connect to GitHub to save");
        await dialog.locator('input[type="password"]').fill(TOKEN);
        await dialog.getByRole("button", { name: "Save" }).click();
        await expect(page.locator(".banner.success")).toContainText("Saved to main");
        await expect(toolbar(page)).toContainText("No changes");
        expect(github.headCommit().parent).toBe(theirs);
        expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
        expect(github.file(boxFile(DAGSTER))).toContain("status: at_risk");
        expect(github.calls("graphql")).toBe(1);
      });

      test("a clash that comes in while the token form is open: the token is kept, Keep mine saves", async ({ page, github }) => {
        await dragDays(page, DAGSTER, 10);
        await page.getByRole("button", { name: /^Save · \d+ changes?$/ }).click();
        const dialog = page.locator(".save-dialog[open]");
        await expect(dialog.locator("h2")).toHaveText("Connect to GitHub to save");

        // Making a token on GitHub takes a while; meanwhile a colleague's save to the same box deploys.
        const theirs = github.otherSave({ [boxFile(DAGSTER)]: (t) => t.replace("status: at_risk", "status: blocked") });
        github.deploy();
        await pollNow(page);
        await expect(box(page, DAGSTER)).toHaveClass(/conflict/);

        await dialog.locator('input[type="password"]').fill(TOKEN);
        await dialog.getByRole("button", { name: "Save" }).click();
        await expect(dialog.locator("h2")).toHaveText("Someone else changed the same items");
        expect(await page.evaluate((key) => sessionStorage.getItem(key), `boxops-github-token:${REPO}`)).toBe(TOKEN);
        await dialog.getByRole("button", { name: "Keep mine" }).click();
        await expect(page.locator(".banner.success")).toContainText("Saved to main");
        await expect(toolbar(page)).toContainText("No changes");
        await expect(page.locator(".save-dialog[open]")).toHaveCount(0);
        expect(github.headCommit().parent).toBe(theirs);
        expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
        expect(github.file(boxFile(DAGSTER))).toContain("status: at_risk");
        expect(github.calls("graphql")).toBe(1);
      });

      test("a classic token works, with a note that a fine-grained one is safer", async ({ page, github }) => {
        await dragDays(page, DAGSTER, 10);
        await page.getByRole("button", { name: /^Save · \d+ changes?$/ }).click();
        const dialog = page.locator(".save-dialog[open]");
        await expect(dialog.getByRole("link", { name: `Create a fine-grained token for ${REPO}` })).toHaveAttribute(
          "href",
          "https://github.com/settings/personal-access-tokens/new?name=BoxOps+acme%2Froadmap&description=Saves+from+BoxOps+to+acme%2Froadmap&target_name=acme&contents=write",
        );
        await expect(dialog.locator(".token-help")).toContainText("Resource owner shows acme");
        await expect(dialog.locator(".token-help")).toContainText("If acme limits how long tokens may last, choose an expiration within that limit.");
        await dialog.locator('input[type="password"]').fill(CLASSIC_TOKEN);
        await expect(dialog.locator(".broad-token")).toContainText("classic token");
        await dialog.getByRole("button", { name: "Save" }).click();
        await expect(toolbar(page)).toContainText("No changes");
        expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
      });

      test("a token kept under the old tab-wide key still works, and moves to this repository's key", async ({ page, github }) => {
        await page.addInitScript((token) => {
          if (!sessionStorage.getItem("boxops-github-token:acme/roadmap")) sessionStorage.setItem("boxops-github-token", token);
        }, TOKEN);
        await page.reload();
        await dragDays(page, DAGSTER, 10);
        await save(page);
        await expect(toolbar(page)).toContainText("No changes");
        expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
        expect(await page.evaluate(() => [sessionStorage.getItem("boxops-github-token"), sessionStorage.getItem("boxops-github-token:acme/roadmap")])).toEqual([null, TOKEN]);
      });
    });

    test("pre-save check: newer saves are shown for review before anything is written", async ({ page, github }) => {
      await dragDays(page, DAGSTER, 10);
      github.otherSave({ [boxFile(CDC)]: (t) => t.replace("CDC pipeline for orders DB", "CDC pipeline (orders + payments)") }, "Sam Lee", "CDC pipeline: renamed");
      const priya = github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace(/^type: (\w+)$/m, "type: $1\nstatus: at_risk") }, "Priya Shah", "Revenue mart: at risk");

      await save(page);
      const dialog = page.locator(".save-dialog[open]");
      await expect(dialog.locator("h2")).toHaveText("The roadmap changed since you opened it");
      await expect(dialog.locator(".save-list")).toContainText("Sam Lee saved “CDC pipeline: renamed”");
      await expect(dialog.locator(".save-list")).toContainText("Priya Shah saved “Revenue mart: at risk”");
      await expect(dialog.locator(".change-list")).toContainText("flag On track → At risk");
      expect(github.head).toBe(priya); // nothing written yet

      await dialog.getByRole("button", { name: "Review changes" }).click();
      await expect(boxTitle(page, CDC)).toHaveText("CDC pipeline (orders + payments)");
      await expect(page.locator(".box.updated")).toHaveCount(2);
      await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-28 – 2026-11-06"); // my edit kept

      await save(page);
      await expect(toolbar(page)).toContainText("No changes");
      expect(github.headCommit().parent).toBe(priya);
      expect(github.file(boxFile(CDC))).toContain("orders + payments");
      await expect(page.locator(".box.updated")).toHaveCount(0);
    });

    for (const keep of ["mine", "theirs"] as const) {
      test(`same box edited by both: keep ${keep}`, async ({ page, github }) => {
        await box(page, DAGSTER).click();
        await page.locator(".editor-title").fill("Dagster (mine)");
        await page.keyboard.press("Escape");
        await dragDays(page, CDC, 10); // a second, unrelated edit
        github.otherSave({ [boxFile(DAGSTER)]: (t) => t.replace(/title: .*/, "title: Dagster (theirs)") });

        await save(page);
        const dialog = page.locator(".save-dialog[open]");
        await expect(dialog.locator(".callout.warn")).toContainText("Box “Dagster (mine)”");
        await dialog.getByRole("button", { name: keep === "mine" ? "Keep mine & save" : "Keep theirs & save" }).click();

        await expect(toolbar(page)).toContainText("No changes");
        expect(github.file(boxFile(DAGSTER))).toContain(`title: Dagster (${keep})`);
        expect(github.file(boxFile(CDC))).toContain("start: 2026-11-09"); // unrelated edit saved either way
        await expect(boxTitle(page, DAGSTER)).toHaveText(`Dagster (${keep})`);
      });
    }

    test("a save that races another goes on top of it", async ({ page, github }) => {
      await dragDays(page, DAGSTER, 10);
      let theirs = "";
      github.beforeRefUpdate = () => {
        theirs = github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") });
      };
      await save(page);
      await expect(toolbar(page)).toContainText("No changes");
      expect(github.headCommit().parent).toBe(theirs);
      expect(github.file(boxFile(REVENUE))).toContain("Revenue mart v3");
      expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
    });

    test("a racing save to the same box asks whose version to keep", async ({ page, github }) => {
      await dragDays(page, DAGSTER, 10);
      github.beforeRefUpdate = () => {
        github.otherSave({ [boxFile(DAGSTER)]: (t) => t.replace("status: at_risk", "status: blocked") });
      };
      await save(page);
      const dialog = page.locator(".save-dialog[open]");
      await expect(dialog.locator(".conflict-list")).toContainText("Dagster 2.x upgrade");
      await dialog.getByRole("button", { name: "Keep mine" }).click();
      await expect(toolbar(page)).toContainText("No changes");
      expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
    });

    test("a commit outside the roadmap folder doesn't stop a save for review", async ({ page, github }) => {
      await dragDays(page, DAGSTER, 10);
      const readme = github.outsideSave("README.md", "# Notes\n");
      await save(page);
      await expect(toolbar(page)).toContainText("No changes");
      await expect(page.locator(".save-dialog[open]")).toHaveCount(0);
      expect(github.headCommit().parent).toBe(readme);
      expect(github.calls("blob") + github.calls("raw")).toBe(0); // the roadmap folder's tree hadn't changed
    });

    test("a save whose answer never arrives is recognised as saved, with one commit", async ({ page, github }) => {
      await dragDays(page, DAGSTER, 10);
      github.inject("graphql", "lost-response");
      await save(page);
      await expect(page.locator(".banner.success")).toContainText("Saved to main");
      await expect(toolbar(page)).toContainText("No changes");
      expect(github.headCommit().parent).toBe(github.root);
      expect(github.calls("graphql")).toBe(1);
    });

    test("a save GitHub doesn't answer times out, then goes through once", async ({ page, github }) => {
      await dragDays(page, DAGSTER, 10);
      github.inject("graphql", "hang");
      await save(page);
      await expect.poll(() => github.calls("graphql")).toBe(1);
      await expect(page.locator(".save-progress")).toHaveText("Writing the commit…");
      await page.clock.fastForward(31_000);
      await expect(page.locator(".banner.success")).toContainText("Saved to main");
      expect(github.headCommit().parent).toBe(github.root);
      expect(github.calls("graphql")).toBe(2);
    });

    test("a ruleset that blocks the save is explained, and Try again keeps the draft", async ({ page, github }) => {
      await dragDays(page, DAGSTER, 10);
      github.inject("graphql", "rules");
      await save(page);
      const error = page.locator(".save-dialog[open] .callout.error");
      await expect(error).toContainText("GitHub’s rules for main blocked this save");
      await expect(error).toContainText("Always allow");
      await expect(error).toContainText("only accepts signed commits");
      expect(github.head).toBe(github.root);
      await page.locator(".save-dialog[open]").getByRole("button", { name: "Try again" }).click();
      await expect(toolbar(page)).toContainText("No changes");
      expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
    });
  });
}

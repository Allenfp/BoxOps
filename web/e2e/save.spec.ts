import { type Page } from "@playwright/test";
import { CLASSIC_TOKEN, type FakeGitHub, REPO, TOKEN } from "./fake-github";
import { CDC, DAGSTER, REVENUE, box, boxTitle, boxDates, boxFile, dragDays, expect, heard, looseBannerText, pollNow, save, test, toolbar } from "./helpers";

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
        expect(await looseBannerText(page)).toEqual([]);
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

    test("a save that races another goes on top of it, and says theirs came in", async ({ page, github }) => {
      await dragDays(page, DAGSTER, 10);
      let theirs = "";
      github.beforeRefUpdate = () => {
        theirs = github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") }, "Priya Shah", "Revenue mart: v3");
      };
      await save(page);
      await expect(toolbar(page)).toContainText("No changes");
      expect(github.headCommit().parent).toBe(theirs);
      expect(github.file(boxFile(REVENUE))).toContain("Revenue mart v3");
      expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
      // Their save is on screen now: announced and outlined like a poll's. Ours isn't outlined.
      await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
      await expect(page.locator(".banner", { hasText: "Priya Shah" })).toHaveText(/^Priya Shah saved “Revenue mart: v3”\. The roadmap has been updated\./);
      await expect(box(page, REVENUE)).toHaveClass(/updated/);
      await expect(box(page, DAGSTER)).not.toHaveClass(/updated/);
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
      await page.clock.fastForward(6_000);
      // The seconds show once it's slow; only the step is announced, not every second.
      await expect(page.locator(".save-progress")).toHaveText("Writing the commit… 6 s");
      expect(await heard(page)).toContain("Writing the commit…");
      expect(await heard(page)).not.toMatch(/\d s/);
      await page.clock.fastForward(25_000);
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

test("someone else's save to another engineer in people.yaml, racing ours: no question, both kept", async ({ page, github }) => {
  await page.getByRole("button", { name: "People" }).click();
  const sam = page.locator("tbody tr").filter({ has: page.locator('input[aria-label="Name"][value="Sam Lee"]') });
  await sam.getByLabel("Role").fill("Tech lead");
  await sam.getByLabel("Role").press("Enter");
  // The same file, someone else's engineer: a clash for the file, none for the items.
  github.beforeRefUpdate = () => {
    github.otherSave({ "people.yaml": (t) => t.replace("    name: Priya Shah\n", "    name: Priya Shah\n    role: Analyst\n") });
  };
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  await expect(page.locator(".save-dialog[open]")).toHaveCount(0);
  const people = github.file("people.yaml")!;
  expect(people).toContain("    name: Sam Lee\n    department: data-eng\n    role: Tech lead\n");
  expect(people).toContain("    name: Priya Shah\n    role: Analyst\n");
});

test("a commit GitHub doesn't sign, or can't say it signed, is saved all the same, and nothing claims a signature", async ({ page, github }) => {
  // Where GitHub doesn't sign (GitHub Enterprise Server without signing set up, say), the answer's signature is null.
  github.signCommits = false;
  await dragDays(page, DAGSTER, 10);
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  const banner = page.locator(".banner.success");
  await expect(banner).toContainText(`Saved to main as commit ${github.head.slice(0, 7)}.`);
  const first = github.head;
  expect(github.headCommit()).toMatchObject({ parent: github.root, signed: false });

  // GitHub makes the commit, then fails to load its signature, so the commit comes back null: the head says it's saved.
  github.inject("graphql", "field-error");
  await dragDays(page, DAGSTER, 5);
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  await expect(banner).toContainText(`Saved to main as commit ${github.head.slice(0, 7)}.`);
  await expect(page.locator(".save-dialog[open]")).toHaveCount(0);
  expect(github.headCommit()).toMatchObject({ parent: first, signed: false });
  expect(github.calls("graphql")).toBe(2); // checked, not written twice
  expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-10-05\n");
  await expect(banner).not.toContainText(/sign|verif/i);
});

test("a head GitHub still names from before this tab's last save stops the save, rolling nothing back", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 10);
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  const saved = github.head;
  // GitHub's answer for the head lags behind the save this tab just made.
  const ref = /^https:\/\/api\.github\.com\/repos\/acme\/roadmap\/git\/ref\//;
  await page.route(ref, (route) =>
    route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ object: { sha: github.root } }) }),
  );
  await dragDays(page, CDC, 5);
  await save(page);
  const dialog = page.locator(".save-dialog[open]");
  await expect(dialog.locator(".callout.error")).toHaveText("GitHub’s answer is behind; try again in a few seconds.");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-28 – 2026-11-06");
  await expect(toolbar(page)).toContainText("Save · 1 change");
  expect(github.head).toBe(saved);

  await page.unroute(ref);
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.headCommit().parent).toBe(saved);
  expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
});

test("a box with no title can't be saved: the problem is shown, and nothing is written", async ({ page, github }) => {
  await page.getByRole("button", { name: "Table" }).click();
  await page.locator("tbody tr").filter({ has: page.locator('input[aria-label="Title"][value="Dagster 2.x upgrade"]') }).getByLabel("Title").fill("");
  await page.keyboard.press("Enter"); // the row's locator matched the old title, so on whatever has focus
  await save(page);
  const dialog = page.locator(".save-dialog[open]");
  await expect(dialog.locator("h2")).toHaveText("Can’t save yet");
  await expect(dialog.locator(".callout.error")).toContainText(`roadmap/${boxFile(DAGSTER)}`);
  await expect(dialog.locator(".callout.error")).toContainText("title: required text is missing");
  await dialog.getByRole("button", { name: "Back to editing" }).click();
  expect(github.head).toBe(github.root);
});

test("a roadmap folder on GitHub that breaks the build's rules stops the save: each problem listed, to fix there", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 10);
  github.otherSave({ "boxes/link.yaml": () => "../../.git/config", "boxes/link2.yaml": () => "../people.yaml" }, "Sam Lee", "Links");
  github.modes = { "roadmap/boxes/link.yaml": "120000", "roadmap/boxes/link2.yaml": "120000" };
  await save(page);
  const dialog = page.locator(".save-dialog[open]");
  await expect(dialog.locator("h2")).toHaveText("The roadmap folder on GitHub needs fixing");
  await expect(dialog.locator(".callout.error li")).toHaveText([
    "roadmap/boxes/link.yaml: is a symlink; a roadmap folder holds plain files only",
    "roadmap/boxes/link2.yaml: is a symlink; a roadmap folder holds plain files only",
  ]);
  // Trying again fails the same way until someone fixes the folder.
  await expect(dialog.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await dialog.locator(".dialog-foot").getByRole("button", { name: "Close" }).click();
  await expect(toolbar(page)).toContainText("Save · 1 change");
  expect(github.calls("graphql")).toBe(0);
});

test("newer saves too many to read stop the save, with Reload rather than Try again", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 10);
  github.otherSave(Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`boxes/bx-${i}.yaml`, () => `id: bx-${i}\n`])), "Sam Lee", "Import");
  await save(page);
  const dialog = page.locator(".save-dialog[open]");
  await expect(dialog.locator(".callout.error")).toHaveText(
    "301 roadmap files changed since this copy was loaded, more than BoxOps reads at once (300). Reload once the site has redeployed.",
  );
  await expect(dialog.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Reload" })).toHaveClass(/primary/);
  expect(github.calls("graphql")).toBe(0);
});

/** Someone removes the Contractor lane (de-4), moving its boxes to the lane above. */
const removeContractor = (github: FakeGitHub) =>
  github.otherSave(
    {
      "departments/data-eng.yaml": (t) => t.replace("  - id: de-4\n    name: Contractor\n    fte: 0.5\n", ""),
      [boxFile("bx-0a7c-terraform-cleanup")]: (t) => t.replace("lane: de-4", "lane: de-3"),
      [boxFile("bx-8c5e-legacy-sunset")]: (t) => t.replace("lane: de-4", "lane: de-3"),
    },
    "Sam Lee",
    "Removed lane Contractor from Data Engineering",
  );

/** Move Dagster into the Contractor lane, in its editor. */
async function toContractor(page: Page) {
  await box(page, DAGSTER).click();
  await page.getByRole("dialog", { name: /Edit/ }).getByLabel("Lane").selectOption("de-4");
  await page.keyboard.press("Escape");
}

test("a save someone else's racing save would leave invalid brings theirs in for review, writing nothing", async ({ page, github }) => {
  await toContractor(page);
  let theirs = "";
  github.beforeRefUpdate = () => {
    theirs = removeContractor(github);
  };
  await save(page);
  const dialog = page.locator(".save-dialog[open]");
  await expect(dialog.locator("h2")).toHaveText("The roadmap changed since you opened it");
  await expect(dialog.locator(".save-list")).toContainText("Sam Lee saved “Removed lane Contractor from Data Engineering”");
  // Dagster goes where the lane's boxes went, for a second look.
  await expect(dialog.locator(".callout.warn")).toContainText("Box “Dagster 2.x upgrade”");
  expect(github.head).toBe(theirs);

  await dialog.getByRole("button", { name: "Keep mine & save" }).click();
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.headCommit().parent).toBe(theirs);
  expect(github.file(boxFile(DAGSTER))).toContain("lane: de-3");
});

test("a save with whose version to keep chosen, that newer saves would leave invalid, brings them in for review", async ({ page, github }) => {
  await toContractor(page);
  // Someone flags Dagster: a clash, once it's deployed and polled in.
  github.otherSave({ [boxFile(DAGSTER)]: (t) => t.replace("status: at_risk", "status: blocked") });
  github.deploy();
  await pollNow(page);
  await expect(box(page, DAGSTER)).toHaveClass(/conflict/);
  // Then someone removes the lane Dagster moves into; that hasn't deployed.
  const theirs = removeContractor(github);

  await save(page);
  const dialog = page.locator(".save-dialog[open]");
  await expect(dialog.locator("h2")).toHaveText("Someone else changed the same items");
  // Saving again with the same choice would only fail again: their roadmap comes in for review.
  await dialog.getByRole("button", { name: "Keep mine" }).click();
  await expect(dialog.locator("h2")).toHaveText("The roadmap changed since you opened it");
  await expect(dialog.locator(".save-list")).toContainText("Sam Lee saved “Removed lane Contractor from Data Engineering”");
  await expect(dialog.locator(".callout.warn")).toContainText("Box “Dagster 2.x upgrade”");
  expect(github.head).toBe(theirs);

  await dialog.getByRole("button", { name: "Keep mine & save" }).click();
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.headCommit().parent).toBe(theirs);
  expect(github.file(boxFile(DAGSTER))).toContain("lane: de-3");
  expect(github.file(boxFile(DAGSTER))).toContain("status: at_risk");
});

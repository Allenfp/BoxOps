import type { Route } from "@playwright/test";
import { CDC, DAGSTER, REVENUE, box, boxTitle, boxDates, boxFile, dragDays, expect, pollNow, save, test, toolbar } from "./helpers";

for (const visibility of ["public", "private"] as const) {
  test.describe(`${visibility} repository`, () => {
    test.use({ visibility });

    test("other people's saves appear without a refresh", async ({ page, github }) => {
      const scroll = await page.locator(".timeline").evaluate((e) => e.scrollLeft);

      // Nothing new: no notice.
      await pollNow(page);
      await expect(page.locator(".banner")).toHaveCount(0);

      // Sam saves and the site redeploys.
      github.deploy(
        github.otherSave(
          { [boxFile(CDC)]: (t) => t.replace("CDC pipeline for orders DB", "CDC pipeline (orders + payments)") },
          "Sam Lee",
          "CDC pipeline: renamed",
        ),
      );
      await pollNow(page);
      await expect(boxTitle(page, CDC)).toHaveText("CDC pipeline (orders + payments)");
      await expect(page.locator(".banner")).toContainText("Sam Lee saved “CDC pipeline: renamed”");
      await expect(box(page, CDC)).toHaveClass(/updated/);
      expect(await page.locator(".timeline").evaluate((e) => e.scrollLeft)).toBe(scroll);
    });

    test("incoming saves merge with unsaved edits and flag clashes", async ({ page, github }) => {
      await dragDays(page, DAGSTER, 10);
      github.deploy(
        github.otherSave({
          [boxFile(DAGSTER)]: (t) => t.replace("status: at_risk", "status: blocked"),
          [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3"),
        }),
      );
      await pollNow(page);
      await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
      await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-28 – 2026-11-06");
      await expect(box(page, DAGSTER)).toHaveClass(/conflict/);
      await page.getByRole("button", { name: /^\d+ warnings?$/ }).click();
      await expect(page.getByRole("dialog", { name: /warning/ }).locator("section", { hasText: "Clashes" }).locator("li")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(page.locator(".banner")).toContainText("your unsaved changes were kept");

      await save(page);
      await page.locator(".save-dialog[open]").getByRole("button", { name: "Keep mine" }).click();
      await expect(toolbar(page)).toContainText("No changes");

      // The site still serves the older deploy: that must not roll this tab back.
      await pollNow(page);
      await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-28 – 2026-11-06");
      await expect(toolbar(page)).toContainText("No changes");
    });

    test("a deploy older than what's on screen never rolls the tab back", async ({ page, github }) => {
      const sam = github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") }, "Sam Lee", "Revenue mart: v3");
      const priya = github.otherSave(
        { [boxFile(CDC)]: (t) => t.replace("CDC pipeline for orders DB", "CDC pipeline (orders + payments)") },
        "Priya Shah",
        "CDC pipeline: renamed",
      );
      // The deployed copy, then both saves straight from GitHub.
      await page.reload();
      await expect(page.locator(".banner")).toContainText("Priya Shah saved “CDC pipeline: renamed”");
      await page.locator(".banner").getByRole("button", { name: "Dismiss" }).click();

      // Sam's deploy finishes after the tab read Priya's save: it's behind, so it's ignored.
      github.deploy(sam);
      const polled = page.waitForResponse((r) => r.url().includes("roadmap.json"));
      await pollNow(page);
      await polled;
      await page.waitForTimeout(300); // time to (wrongly) apply it
      await expect(boxTitle(page, CDC)).toHaveText("CDC pipeline (orders + payments)");
      await expect(page.locator(".banner")).toHaveCount(0);

      // Priya's deploy is what's on screen already; the next save after it comes in.
      github.deploy(priya);
      await pollNow(page);
      github.deploy(github.otherSave({ [boxFile(DAGSTER)]: (t) => t.replace("status: at_risk", "status: blocked") }, "Sam Lee", "Dagster: blocked"));
      await pollNow(page);
      await expect(page.locator(".banner")).toContainText("Sam Lee saved “Dagster: blocked”");
      await expect(boxTitle(page, CDC)).toHaveText("CDC pipeline (orders + payments)");
      await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
    });

    test("hidden tabs don't poll, and check as soon as they're visible", async ({ page, github }) => {
      let fetches = 0;
      page.on("request", (r) => r.url().includes("roadmap.json") && fetches++);
      await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => true }));
      await pollNow(page);
      expect(fetches).toBe(0);

      github.deploy(github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") }));
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
      expect(fetches).toBe(1);
    });

  });
}

test.describe("private repository, signed out", () => {
  test.use({ visibility: "private", signedIn: false });

  test("loading and polling ask GitHub nothing", async ({ page, github }) => {
    github.deploy(github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") }));
    await pollNow(page);
    await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
    github.otherSave({ [boxFile(CDC)]: (t) => t.replace("CDC pipeline for orders DB", "CDC pipeline (orders + payments)") });
    await page.reload();
    await expect(boxTitle(page, REVENUE)).toHaveText("Revenue mart v3");
    await expect(boxTitle(page, CDC)).toHaveText("CDC pipeline for orders DB"); // not deployed yet, and not asked for
    await expect(page.locator(".site-copy")).toHaveText("Deployed copy");
    await expect(page.locator(".site-copy")).toHaveAttribute("title", /^acme\/roadmap is private, so without a GitHub token this tab shows the site’s copy/);
    expect(github.calls()).toBe(0);
  });
});

test("checks that keep failing say the site is lost, back off, and recover; saving still works", async ({ page, github }) => {
  let fetches = 0;
  const down = (route: Route) => {
    fetches++;
    return route.abort("connectionrefused");
  };
  await page.route("**/roadmap.json*", down);
  await pollNow(page);
  await expect.poll(() => fetches).toBe(1);
  await expect(page.locator(".banner")).toHaveCount(0); // one failure says nothing

  // The next check waits twice as long.
  await pollNow(page);
  expect(fetches).toBe(1);
  await page.clock.fastForward(2 * 60_000);
  await expect.poll(() => fetches).toBe(2);
  const lost = page.locator(".banner", { hasText: "Lost the connection to the site" });
  await expect(lost).toBeVisible();
  await expect(lost.getByRole("button", { name: "Reload" })).toBeVisible();

  // A failed check never stops a save.
  await dragDays(page, DAGSTER, 10);
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");

  await page.unroute("**/roadmap.json*", down);
  await page.clock.fastForward(8 * 60_000 + 1000);
  await expect(lost).toHaveCount(0);
});

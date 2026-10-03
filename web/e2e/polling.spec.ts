import { CDC, DAGSTER, REVENUE, box, boxDates, boxFile, drag, expect, pollNow, save, test, toolbar } from "./helpers";

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
  await expect(box(page, CDC)).toHaveText("CDC pipeline (orders + payments)");
  await expect(page.locator(".banner")).toContainText("Sam Lee saved “CDC pipeline: renamed”");
  await expect(box(page, CDC)).toHaveClass(/updated/);
  expect(await page.locator(".timeline").evaluate((e) => e.scrollLeft)).toBe(scroll);
});

test("incoming saves merge with unsaved edits and flag clashes", async ({ page, github }) => {
  await drag(page, DAGSTER, 70);
  github.deploy(
    github.otherSave({
      [boxFile(DAGSTER)]: (t) => t.replace("status: at_risk", "status: done"),
      [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3"),
    }),
  );
  await pollNow(page);
  await expect(box(page, REVENUE)).toHaveText("Revenue mart v3");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("Sep 24, 2026 – Nov 2, 2026");
  await expect(box(page, DAGSTER)).toHaveClass(/conflict/);
  await expect(toolbar(page)).toContainText("1 clash");
  await expect(page.locator(".banner")).toContainText("your unsaved changes were kept");

  await save(page);
  await page.locator(".save-dialog[open]").getByRole("button", { name: "Keep mine" }).click();
  await expect(toolbar(page)).toContainText("No changes");

  // The site still serves the older deploy: that must not roll this tab back.
  await pollNow(page);
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("Sep 24, 2026 – Nov 2, 2026");
  await expect(toolbar(page)).toContainText("No changes");
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
  await expect(box(page, REVENUE)).toHaveText("Revenue mart v3");
  expect(fetches).toBe(1);
});

test("a reload shows saves the site hasn't redeployed yet", async ({ page, github }) => {
  github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("Revenue mart v2", "Revenue mart v3") });
  await page.reload();
  await expect(box(page, REVENUE)).toHaveText("Revenue mart v3");
});

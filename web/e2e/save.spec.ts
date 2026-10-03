import { TOKEN } from "./fake-github";
import { CDC, DAGSTER, REVENUE, box, boxTitle, boxDates, boxFile, dragDays, expect, save, test, toolbar } from "./helpers";

test.describe("first save", () => {
  test.use({ signedIn: false });

  test("asks for a token once, rejects a bad one, then commits to main", async ({ page, github }) => {
    await dragDays(page, DAGSTER, 10);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const dialog = page.locator(".save-dialog[open]");
    await expect(dialog.locator("h2")).toHaveText("Connect to GitHub to save");
    await dialog.locator('input[type="password"]').fill("wrong");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".save-dialog[open] .callout.error")).toContainText("rejected that token");

    await page.locator('.save-dialog[open] input[type="password"]').fill(TOKEN);
    await page.locator(".save-dialog[open]").getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".banner.success")).toContainText("Saved to main");
    await expect(toolbar(page)).toContainText("No changes");

    const head = github.headCommit();
    expect(head.parent).toBe(github.root);
    expect(head.message.split("\n")[0]).toBe("Dagster 2.x upgrade: rescheduled to Sep 28, 2026 – Nov 6, 2026");
    expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28\nend: 2026-11-06\n");

    // Next save: no dialog at all.
    await dragDays(page, DAGSTER, 5);
    await save(page);
    await expect(toolbar(page)).toContainText("No changes");
    await expect(page.locator(".save-dialog[open]")).toHaveCount(0);
    expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-10-05\n");
  });
});

test("pre-save check: newer saves are shown for review before anything is written", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 10);
  github.otherSave({ [boxFile(CDC)]: (t) => t.replace("CDC pipeline for orders DB", "CDC pipeline (orders + payments)") }, "Sam Lee", "CDC pipeline: renamed");
  const priya = github.otherSave({ [boxFile(REVENUE)]: (t) => t.replace("status: in_progress", "status: at_risk") }, "Priya Shah", "Revenue mart: at risk");

  await save(page);
  const dialog = page.locator(".save-dialog[open]");
  await expect(dialog.locator("h2")).toHaveText("The roadmap changed since you opened it");
  await expect(dialog.locator(".save-list")).toContainText("Sam Lee saved “CDC pipeline: renamed”");
  await expect(dialog.locator(".save-list")).toContainText("Priya Shah saved “Revenue mart: at risk”");
  await expect(dialog.locator(".change-list")).toContainText("status In progress → At risk");
  expect(github.head).toBe(priya); // nothing written yet

  await dialog.getByRole("button", { name: "Review changes" }).click();
  await expect(boxTitle(page, CDC)).toHaveText("CDC pipeline (orders + payments)");
  await expect(page.locator(".box.updated")).toHaveCount(2);
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("Sep 28, 2026 – Nov 6, 2026"); // my edit kept

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
    github.otherSave({ [boxFile(DAGSTER)]: (t) => t.replace("status: at_risk", "status: done") });
  };
  await save(page);
  const dialog = page.locator(".save-dialog[open]");
  await expect(dialog.locator(".conflict-list")).toContainText("Dagster 2.x upgrade");
  await dialog.getByRole("button", { name: "Keep mine" }).click();
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
});

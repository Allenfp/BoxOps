import { DAGSTER, box, boxDates, drag, expect, focusApp, test, toolbar } from "./helpers";

test("shows departments, lanes, boxes and today", async ({ page, github: _ }) => {
  await expect(page.locator(".box:not(.compact)")).toHaveCount(12); // ML Platform starts collapsed
  await expect(page.locator(".dept-label")).toHaveText([/Data Engineering/, /Analytics/, /ML Platform/]);
  await expect(page.locator(".today-flag")).toBeVisible();
  await expect(page.locator(".lane-row.over .lane-name")).toHaveText([/^FTE 3/]); // overlapping boxes

  await page.getByRole("button", { name: "Quarters" }).click();
  await expect(page.locator(".band-0")).toContainText("Q4 2026");
  await page.getByRole("button", { name: "Weeks" }).click();
  await expect(page.locator(".band-0")).toContainText("Oct 2026");

  await page.locator(".dept-label", { hasText: "ML Platform" }).click();
  await expect(page.locator(".box:not(.compact)")).toHaveCount(15);
  await expect(page).toHaveURL(/collapsed=(&|$)/);
});

test("drag moves a box in time and across lanes; edges resize", async ({ page, github: _ }) => {
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("Sep 14, 2026 – Oct 23, 2026");
  await drag(page, DAGSTER, 70); // 10 days at months zoom (7px/day)
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("Sep 24, 2026 – Nov 2, 2026");

  const contractor = (await page.locator('[data-lane="de-4"]').boundingBox())!;
  const b = (await box(page, DAGSTER).boundingBox())!;
  await drag(page, DAGSTER, 0, contractor.y + 10 - (b.y + b.height / 2));
  await expect(box(page, DAGSTER).locator("xpath=ancestor::*[@data-lane][1]")).toHaveAttribute("data-lane", "de-4");

  await drag(page, DAGSTER, 35, 0, "end"); // +5 days
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("Sep 24, 2026 – Nov 7, 2026");
  await expect(toolbar(page)).toContainText("1 unsaved change");
});

test("clicking a box opens the editor; edits apply live", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /Edit/ });
  await expect(editor.locator(".editor-title")).toHaveValue("Dagster 2.x upgrade");
  await editor.locator(".editor-title").fill("Dagster upgrade, phase 1");
  await editor.getByPlaceholder("https://…").fill("https://example.atlassian.net/browse/DATA-42");
  await expect(editor.getByRole("link", { name: "Open ↗" })).toBeVisible();
  await editor.locator("select").nth(1).selectOption("in_progress");
  await expect(box(page, DAGSTER)).toHaveText("Dagster upgrade, phase 1");
  await expect(box(page, DAGSTER)).toHaveClass(/status-in_progress/);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
});

test("double-click creates a box; undo steps back", async ({ page, github: _ }) => {
  const lane = (await page.locator('[data-lane="an-3"]').boundingBox())!;
  await page.mouse.dblclick(740, lane.y + lane.height / 2);
  await expect(page.locator(".editor-title")).toBeFocused();
  await page.keyboard.type("Hiring plan");
  await expect(page.locator(".box.selected")).toHaveAttribute("data-box-id", /^bx-[0-9a-f]{4}-hiring-plan$/);
  await page.keyboard.press("Escape");
  await expect(toolbar(page)).toContainText("1 unsaved change");

  await focusApp(page);
  await page.keyboard.press("ControlOrMeta+z"); // the typing
  await expect(page.locator('[data-box-id$="-new-box"]')).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z"); // the creation
  await expect(page.locator('[data-box-id$="-new-box"]')).toHaveCount(0);
  await expect(toolbar(page)).toContainText("No changes");
});

test("unsaved edits survive a reload", async ({ page, github: _ }) => {
  await drag(page, DAGSTER, 70);
  await expect(toolbar(page)).toContainText("1 unsaved change");
  await page.reload();
  await expect(toolbar(page)).toContainText("1 unsaved change");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("Sep 24, 2026 – Nov 2, 2026");
});

test("lanes can be renamed in place", async ({ page, github: _ }) => {
  const names = page.locator(".lane-label .lane-name");
  await names.nth(1).click();
  await page.keyboard.type("Platform team");
  await page.keyboard.press("Enter");
  await expect(names.nth(1)).toContainText("Platform team");
  await expect(toolbar(page)).toContainText("1 unsaved change");

  await names.nth(0).click();
  await page.keyboard.type("Nope");
  await page.keyboard.press("Escape");
  await expect(names.nth(0)).toContainText("FTE 1");

  await names.nth(1).click();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await expect(names.nth(1)).toContainText("FTE 2");
  await expect(toolbar(page)).toContainText("No changes");
});

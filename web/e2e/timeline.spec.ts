import { CDC, DAGSTER, box, boxTitle, boxDates, boxFile, drag, dragDays, expect, focusApp, pollNow, save, test, toolbar } from "./helpers";

test("shows departments, lanes, boxes and today", async ({ page, github: _, cull }) => {
  await expect(page.locator(".box:not(.compact)")).toHaveCount(12); // ML Platform starts collapsed
  await expect(page.locator(".dept-label")).toHaveText([/Data Engineering/, /Analytics/, /ML Platform/]);
  // Today is 2026-10-03 wherever the browser is (each project has its own time zone).
  await expect(page.locator(".today-flag")).toHaveAttribute("title", "2026-10-03");
  // Progress comes from the dates; flags are set by hand.
  await expect(box(page, DAGSTER)).toHaveClass(/progress-underway/); // Sep 14 – Oct 23
  await expect(box(page, CDC)).toHaveClass(/progress-upcoming/); // from Oct 26
  await expect(page.locator(".box-flag")).toHaveText(["At risk"]);
  // Fixture has overlaps in FTE 3 and 1-FTE boxes in the 0.5-FTE Contractor lane.
  await expect(page.locator(".overflow-label")).toHaveCount(1);
  // 4 FTE running at once (around Oct 1) against 3.5 FTE of lanes.
  await expect(page.locator(".dept-label", { hasText: "Data Engineering" }).locator(".dept-meta")).toHaveText("3.5 FTE");
  await expect(page.locator(".dept-label", { hasText: "Data Engineering" }).locator(".dept-over")).toHaveText("4 planned");
  // The heading says what the warnings say: the worst stretch from today on, against the lanes open then.
  await expect(page.locator(".dept-label", { hasText: "Data Engineering" }).locator(".dept-toggle")).toHaveAttribute(
    "title",
    "Over capacity: 4 FTE planned against 3.5, 2026-10-01 – 2026-11-27, and 1 more stretch",
  );
  await expect(page.locator(".box.overflowing")).toHaveCount(1);
  await expect(page.locator(".overflow-label")).toContainText("Over capacity");
  await expect(page.locator(".dept-label", { hasText: "Analytics" })).not.toContainText("planned");

  await page.getByRole("button", { name: "Quarters" }).click();
  await expect(page.locator(".band-0")).toContainText("Q4 2026");
  await page.getByRole("button", { name: "Weeks" }).click();
  await expect(page.locator(".band-0")).toContainText("Oct 2026");

  await page.locator(".dept-label", { hasText: "ML Platform" }).click();
  // Every box, at weeks zoom: not when the timeline draws only what's near the screen (`cull`).
  if (!cull) await expect(page.locator(".box:not(.compact)")).toHaveCount(15);
  await expect(page).toHaveURL(/collapsed=(&|$)/);
});

test("the timeline says over capacity when the warnings do: by a lane's dates, not for the past or boxes that don't fit side by side", async ({
  page,
  github,
}) => {
  const ANALYTICS = "departments/analytics.yaml";
  const HIRE = boxFile("bx-4e1a-onboarding-hire");
  const analytics = page.locator('[data-dept-id="analytics"]');
  const warnings = async () => {
    await page.getByRole("button", { name: /^\d+ warnings?$/ }).click();
    const text = await page.getByRole("dialog", { name: /warning/ }).innerText();
    await page.keyboard.press("Escape");
    return text;
  };

  // The second lane closes at the end of the year, while its box runs on: 3 FTE in January against the 2 lanes left.
  github.deploy(github.otherSave({ [ANALYTICS]: (t) => t.replace("  - id: an-2\n    fte: 1\n", "  - id: an-2\n    fte: 1\n    end: 2026-12-31\n") }));
  await pollNow(page);
  const over = "3 FTE planned against 2, 2027-01-04 – 2027-01-29";
  await expect(analytics.locator(".dept-toggle")).toHaveAttribute("title", `Over capacity: ${over}`);
  await expect(analytics.locator(".dept-over")).toHaveText("3 planned");
  await expect(analytics.locator(".overflow-note")).toHaveText("Over capacity");
  await expect(analytics.locator(".overflow-note")).toHaveAttribute("title", `Over capacity: ${over}`);
  await expect(analytics.locator(".box.overflowing")).toHaveCount(1);
  expect(await warnings()).toContain(`Analytics: ${over}`);

  // Open all along, with a 2-FTE box squeezed in over September: over capacity, but only before today.
  github.deploy(
    github.otherSave({
      [ANALYTICS]: (t) => t.replace("    end: 2026-12-31\n", ""),
      [HIRE]: (t) => t.replace("start: 2027-01-04\nend: 2027-02-12\n", "start: 2026-09-07\nend: 2026-09-25\nfte: 2\n"),
    }),
  );
  await pollNow(page);
  await expect(analytics.locator(".overflow-note")).toHaveText("Over capacity in the past");
  await expect(analytics.locator(".overflow-note")).toHaveAttribute("title", "Over capacity before today: 4 FTE planned against 3, 2026-09-07 – 2026-09-25");
  await expect(analytics.locator(".dept-toggle")).not.toHaveAttribute("title", /./);
  await expect(analytics.locator(".dept-over")).toHaveCount(0);
  await expect(analytics.locator(".box.overflowing")).toHaveCount(0);
  expect(await warnings()).not.toContain("Analytics");

  // The lane closes again, and the 2-FTE box moves to April: the 2 lanes left hold it, but they aren't side by side.
  github.deploy(
    github.otherSave({
      [ANALYTICS]: (t) => t.replace("  - id: an-2\n    fte: 1\n", "  - id: an-2\n    fte: 1\n    end: 2026-12-31\n"),
      [HIRE]: (t) => t.replace("start: 2026-09-07\nend: 2026-09-25\n", "start: 2027-04-05\nend: 2027-04-16\n"),
    }),
  );
  await pollNow(page);
  await expect(analytics.locator(".overflow-note")).toHaveText("Doesn’t fit side by side");
  await expect(analytics.locator(".dept-over")).toHaveCount(0);
  await expect(analytics.locator(".box.overflowing")).toHaveCount(0);
  expect(await warnings()).not.toContain("Analytics");
});

test("today moves on at midnight in a tab left open", async ({ page, github: _ }) => {
  const flag = page.locator(".today-flag");
  await expect(flag).toHaveAttribute("title", "2026-10-03");
  await page.clock.fastForward("15:00:02"); // from 09:00 to just past midnight
  await expect(flag).toHaveAttribute("title", "2026-10-04");
});

test("the box editor's tags follow an undo made while it's open", async ({ page, github }) => {
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /Edit/ });
  await editor.getByRole("button", { name: "Tags", exact: true }).click();
  const tags = editor.getByRole("textbox", { name: /Tags/ });
  await tags.fill("iceberg, q4");
  await expect(toolbar(page)).toContainText("Save · 1 change");
  // Focus off the field, onto the editor, so ⌘Z is the app's undo.
  await editor.locator(".editor-foot .hint").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(toolbar(page)).toContainText("No changes");
  await expect(tags).toHaveValue("");
  // Typing again starts from what the box has, not the undone text.
  await tags.fill("ml");
  await page.keyboard.press("Escape");
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("tags:\n  - ml\n");
  expect(github.file(boxFile(DAGSTER))).not.toContain("iceberg");
});

test("drag moves a box in time and across lanes; edges resize", async ({ page, github: _ }) => {
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-14 – 2026-10-23");
  await dragDays(page, DAGSTER, 10); // keeps its 30 working days
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-28 – 2026-11-06");

  // Into Analytics' empty "Open req" lane: another department, and free at those dates.
  const openReq = (await page.locator('[data-lane="an-3"]').boundingBox())!;
  const b = (await box(page, DAGSTER).boundingBox())!;
  await drag(page, DAGSTER, 0, openReq.y + 10 - (b.y + b.height / 2));
  const lane = page.locator('[data-lane="an-3"]');
  await expect(box(page, DAGSTER).locator("xpath=ancestor::*[@data-dept-track][1]")).toHaveAttribute("data-dept-track", "analytics");
  await expect.poll(async () => (await box(page, DAGSTER).boundingBox())!.y - (await lane.boundingBox())!.y).toBe(3);

  await dragDays(page, DAGSTER, 5, 0, "end");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-28 – 2026-11-13");
  await expect(toolbar(page)).toContainText("Save · 1 change");
});

test("clicking a box opens the editor; edits apply live", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /Edit/ });
  await expect(editor.locator(".editor-title")).toHaveValue("Dagster 2.x upgrade");
  await editor.locator(".editor-title").fill("Dagster upgrade, phase 1");
  await editor.getByPlaceholder("https://…").fill("https://example.atlassian.net/browse/DATA-42");
  await expect(editor.getByRole("link", { name: "Open" })).toBeVisible();
  await expect(box(page, DAGSTER).locator(".box-flag")).toHaveText("At risk");
  await editor.getByLabel("Flag", { exact: true }).selectOption("blocked");
  await expect(boxTitle(page, DAGSTER)).toHaveText("Dagster upgrade, phase 1");
  await expect(box(page, DAGSTER).locator(".box-flag")).toHaveText("Blocked");
  await editor.getByLabel("Flag", { exact: true }).selectOption(""); // On track: no flag
  await expect(box(page, DAGSTER).locator(".box-flag")).toHaveCount(0);
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
  await expect(toolbar(page)).toContainText("Save · 1 change");

  await focusApp(page);
  await page.keyboard.press("ControlOrMeta+z"); // the typing
  await expect(page.locator('[data-box-id$="-new-box"]')).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z"); // the creation
  await expect(page.locator('[data-box-id$="-new-box"]')).toHaveCount(0);
  await expect(toolbar(page)).toContainText("No changes");
});

test("unsaved edits survive a reload", async ({ page, github: _ }) => {
  await dragDays(page, DAGSTER, 10);
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await page.reload();
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-28 – 2026-11-06");
});

test("weekends are never shown or counted", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Weeks" }).click();
  const days = await page.locator(".band-1 .band-cell").allInnerTexts();
  const i = days.indexOf("2"); // Fri Oct 2
  expect(days.slice(i, i + 3)).toEqual(["2", "5", "6"]); // …straight to Mon Oct 5
  expect(await box(page, DAGSTER).getAttribute("title")).toContain("30 working days");
});

test("FTE sets a box's height; 2 FTE covers the lane below", async ({ page, github }) => {
  const warehouse = "bx-a1f0-warehouse-migration";
  const oneFte = (await box(page, warehouse).boundingBox())!.height;
  await box(page, warehouse).click({ position: { x: 200, y: 10 } });
  await page.getByRole("dialog", { name: /Edit/ }).getByLabel("FTE", { exact: true }).selectOption("2");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await box(page, warehouse).boundingBox())!.height).toBeGreaterThan(oneFte * 2);

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(warehouse))).toContain("type: project\nfte: 2\n");
});

test("engineers are picked from the roster, and new ones can be added", async ({ page, github }) => {
  await box(page, DAGSTER).click();
  await page.getByRole("button", { name: "Engineers" }).click();
  await page.getByRole("checkbox", { name: "Sam Lee" }).click();
  await page.getByLabel("New engineer name").fill("Robin Park");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "Engineers" })).toHaveText("Sam Lee, Robin Park");
  await page.keyboard.press("Escape"); // closes the picker…
  await expect(page.getByRole("dialog", { name: /Edit/ })).toBeVisible(); // …not the editor
  await page.keyboard.press("Escape");
  await expect(box(page, DAGSTER).locator(".avatar")).toHaveText(["SL", "RP"]);
  await focusApp(page); // off the box, which shows its scale card while it has keyboard focus
  // Scale (FTE × working days) sits right after the initials: 1 FTE × 30 days.
  const scale = box(page, DAGSTER).locator(".box-scale");
  await expect(scale).toHaveText("Scale 30"); // "Scale" for screen readers only
  const last = (await box(page, DAGSTER).locator(".avatar").last().boundingBox())!;
  expect((await scale.boundingBox())!.x).toBeGreaterThan(last.x + last.width);
  await expect(scale).toHaveCSS("text-decoration-line", "underline");
  await scale.hover();
  const pop = page.getByRole("tooltip");
  await expect(pop).toContainText("Scale 30");
  await expect(pop).toContainText("= 1 FTE × 30 working days");
  await expect(pop).toContainText("≈ 6 weeks · 1.5 months · 0.5 quarters");
  await expect(pop).toContainText("FTE per Month = ~20");
  await expect(pop).toContainText("29% of Data Engineering while it runs");
  await page.mouse.move(5, 5);
  await expect(pop).toHaveCount(0);

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("engineers:\n  - sam-lee\n  - robin-park\n");
  expect(github.file("people.yaml")).toContain("  - id: robin-park\n    name: Robin Park\n    department: data-eng\n");
});

test("the Engineers list follows its button while a name is typed (a phone's keyboard shrinks the window), else closes", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const button = page.getByRole("dialog", { name: /^Edit / }).getByRole("button", { name: /^Engineers/ });
  await button.click();
  const list = page.getByRole("dialog", { name: "Engineers" });
  await page.getByLabel("New engineer name").fill("Robin");
  await page.setViewportSize({ width: 1440, height: 560 });
  await expect(page.getByLabel("New engineer name")).toBeFocused();
  // Just below its button, or just above it.
  const gap = async () => {
    const [b, l] = [(await button.boundingBox())!, (await list.boundingBox())!];
    return Math.min(Math.abs(l.y - (b.y + b.height)), Math.abs(b.y - (l.y + l.height)));
  };
  await expect.poll(gap).toBeLessThan(5);

  await list.getByRole("checkbox").first().focus();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(list).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("the Engineers list closes, name or not, once the box editor's fields are scrolled till its button is out of sight", async ({ page, github: _ }) => {
  await page.setViewportSize({ width: 1440, height: 360 });
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /^Edit / });
  const button = editor.getByRole("button", { name: /^Engineers/ });
  const fields = editor.locator(".editor-body");
  // The button scrolled into sight first, and that scroll's event (in the next frame) passed: it would close the list.
  await button.evaluate((el) => {
    el.scrollIntoView({ block: "center" });
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  await button.click();
  const list = page.getByRole("dialog", { name: "Engineers" });
  await page.getByLabel("New engineer name").fill("Robin");
  // Scrolled a little, the list moves with its button: just above it, or just below it.
  await fields.evaluate((el) => (el.scrollTop -= 10));
  const gap = async () => {
    const [b, l] = [(await button.boundingBox())!, (await list.boundingBox())!];
    return Math.min(Math.abs(l.y - (b.y + b.height)), Math.abs(b.y - (l.y + l.height)));
  };
  await expect.poll(gap).toBeLessThan(5);

  // Scrolled till the button is below the fields' edge, it would be over the rest of the editor.
  await fields.evaluate((el) => (el.scrollTop = 0));
  await expect(list).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("lanes can be renamed in place", async ({ page, github: _ }) => {
  const names = page.locator(".lane-label .lane-name");
  await names.nth(1).click();
  await page.keyboard.type("Platform team");
  await page.keyboard.press("Enter");
  await expect(names.nth(1)).toContainText("Platform team");
  await expect(toolbar(page)).toContainText("Save · 1 change");

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

test("the theme follows the system by default; light and dark are remembered choices", async ({ page, github: _ }) => {
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const theme = async (name: string) => {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("group", { name: "Theme" }).getByRole("button", { name }).click();
    await page.keyboard.press("Escape");
  };
  const LIGHT = "rgb(246, 247, 249)";
  const DARK = "rgb(15, 18, 24)";
  // System, live.
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(bg).toBe(LIGHT);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(bg).toBe(DARK);

  // Light sticks, even on a dark system and after a reload.
  await theme("Light");
  expect(await bg()).toBe(LIGHT);
  await page.reload();
  expect(await bg()).toBe(LIGHT);

  await page.emulateMedia({ colorScheme: "light" });
  await theme("Dark");
  expect(await bg()).toBe(DARK);
  await page.reload();
  expect(await bg()).toBe(DARK);
});

test("a title sliding along while scrolling never runs into the initials", async ({ page, github: _ }) => {
  const warehouse = "bx-a1f0-warehouse-migration";
  await box(page, warehouse).locator(".box-name").click();
  await page.getByRole("button", { name: "Engineers" }).click();
  await page.getByRole("checkbox", { name: "Sam Lee" }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(box(page, warehouse).locator(".avatar")).toHaveText(["SL"]);
  const worst = await page.evaluate(async () => {
    const tl = document.querySelector(".timeline")!;
    let worst = 0;
    for (let x = 0; x <= tl.scrollWidth; x += 40) {
      tl.scrollLeft = x;
      await new Promise(requestAnimationFrame);
      for (const bx of document.querySelectorAll(".box")) {
        const t = bx.querySelector(".box-title"), people = bx.querySelector(".box-people");
        if (t && people) worst = Math.max(worst, t.getBoundingClientRect().right - people.getBoundingClientRect().left);
      }
    }
    return worst;
  });
  expect(worst).toBeLessThanOrEqual(0);
});

test("discard lives under the save button's ▾ and asks first", async ({ page, github: _ }) => {
  await dragDays(page, DAGSTER, 5);
  await expect(toolbar(page)).toContainText("Save · 1 change");
  await page.getByRole("button", { name: "More save options" }).click();
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Discard this change…" }).click();
  await expect(toolbar(page)).toContainText("Save · 1 change"); // said no

  await page.getByRole("button", { name: "More save options" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Discard this change…" }).click();
  await expect(toolbar(page)).toContainText("No changes");
  await expect.poll(() => boxDates(page, DAGSTER)).toBe("2026-09-14 – 2026-10-23");
});

test("in the box editor, Esc closes the calendar but not the editor", async ({ page, github: _ }) => {
  await page.locator(`[data-box-id="${DAGSTER}"]`).click();
  const editor = page.getByRole("dialog", { name: /^Edit / });
  await editor.getByRole("button", { name: "Choose date" }).first().click();
  const calendar = page.getByRole("dialog", { name: "Choose date" });
  await calendar.getByRole("gridcell", { name: "2026-09-21, Monday" }).click();
  await expect(calendar).toHaveCount(0);
  await expect(editor.getByLabel("Start")).toHaveValue("2026-09-21");
  await editor.getByRole("button", { name: "Choose date" }).first().click();
  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);
  await expect(editor).toBeVisible();
});

test("a collapsed department shows capacity used, as a line or bars (a setting)", async ({ page, github: _ }) => {
  const ml = page.locator(".dept", { hasText: "ML Platform" });
  await expect(ml.locator(".use-chart.line polyline")).not.toHaveCount(0);
  await expect(ml.locator(".box")).toHaveCount(0);

  // Data Engineering runs 4 FTE on 3.5 FTE of lanes around 2026-10-01.
  const de = page.locator(".dept", { hasText: "Data Engineering" });
  await de.locator(".dept-toggle").click();
  await expect(de.locator(".use-chart")).toHaveAttribute("aria-label", /^Data Engineering: capacity used by week, peak \d+%$/);
  await expect(de.locator('.use-hit[data-week="2026-09-28"] title')).toHaveText(/^Week of 2026-09-28: [\d.]+ of 3.5 FTE used \(\d+%\); over capacity on 2026-\d\d-\d\d: 4 of 3.5 FTE$/);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("group", { name: "Collapsed rows" }).getByRole("button", { name: "Bars" }).click();
  await page.keyboard.press("Escape");
  await expect(de.locator(".use-chart.bars .use-marks rect")).not.toHaveCount(0);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("group", { name: "Collapsed rows" }).getByRole("button", { name: "Boxes" }).click();
  await page.keyboard.press("Escape");
  await expect(de.locator(".use-chart")).toHaveCount(0);
  await expect(de.locator(".box.compact")).not.toHaveCount(0);
});

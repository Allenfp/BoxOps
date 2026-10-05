import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { CDC, DAGSTER, box, boxFile, dragDays, expect, heard, pollNow, said, save, test, toolbar } from "./helpers";

// What a screen reader finds on the page: landmarks, headings and names; and
// axe-core's automated checks against WCAG 2.2 A and AA, in both themes.
// Keyboard behaviour has tests of its own (keyboard.spec.ts).

/** WCAG 2.2 A and AA, as axe-core tags its rules (2.2 adds to 2.1, which adds to 2.0). */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

/** Everything axe finds wrong with the page as it is, one line per rule with where. */
async function axeProblems(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}

/** Each part of the app, opened from the roadmap as it first shows. */
const PARTS: [string, (page: Page) => Promise<void>][] = [
  ["the timeline", async () => {}],
  [
    "the Table view",
    async (page) => {
      await page.getByRole("button", { name: "Table", exact: true }).click();
      await expect(page.locator(".box-table")).toBeVisible();
    },
  ],
  [
    "the People view",
    async (page) => {
      await page.getByRole("button", { name: "People", exact: true }).click();
      await expect(page.locator(".people-table")).toBeVisible();
    },
  ],
  [
    "the box editor and its Engineers list",
    async (page) => {
      await box(page, DAGSTER).click();
      await page.getByRole("dialog", { name: /^Edit / }).getByRole("button", { name: /^Engineers/ }).click();
      await expect(page.getByRole("dialog", { name: "Engineers" })).toBeVisible();
    },
  ],
  [
    "the calendar of a date field",
    async (page) => {
      await box(page, DAGSTER).click();
      await page.getByRole("dialog", { name: /^Edit / }).getByRole("button", { name: "Choose date" }).first().click();
      await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
    },
  ],
  [
    "the PTO editor",
    async (page) => {
      await page.getByRole("button", { name: "Add PTO in Data Engineering" }).click();
      await expect(page.getByRole("dialog", { name: /^Edit PTO/ })).toBeVisible();
    },
  ],
  [
    "the department editor",
    async (page) => {
      await page.getByRole("button", { name: "Edit Analytics" }).click();
      await expect(page.getByRole("dialog", { name: "Edit Analytics" })).toBeVisible();
    },
  ],
  [
    "the settings menu",
    async (page) => {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Settings" })).toContainText("Team settings");
    },
  ],
  [
    "team settings",
    async (page) => {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Team settings…" }).click();
      await expect(page.getByRole("dialog", { name: "Team settings" })).toBeVisible();
    },
  ],
];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe, ${colorScheme} theme`, () => {
    test.use({ colorScheme });
    for (const [name, open] of PARTS) {
      test(`${name} has no problems axe finds`, async ({ page, github: _ }) => {
        await open(page);
        expect(await axeProblems(page)).toEqual([]);
      });
    }
  });

  test.describe(`axe, ${colorScheme} theme, signed out`, () => {
    test.use({ colorScheme, signedIn: false });
    test("the save dialog has no problems axe finds", async ({ page, github: _ }) => {
      await dragDays(page, DAGSTER, 5);
      await page.getByRole("button", { name: "Save · 1 change" }).click();
      await expect(page.getByRole("dialog", { name: "Connect to GitHub to save" })).toBeVisible();
      expect(await axeProblems(page)).toEqual([]);
    });
  });
}

test("the page has a banner, a main region named for the view, and a heading for each department", async ({ page, github: _ }) => {
  await expect(page.getByRole("banner").getByRole("heading", { level: 1 })).toHaveText("BoxOps Roadmap");
  const views = [
    { name: "Timeline", departments: [/^Data Engineering/, /^Analytics/, /^ML Platform/] },
    { name: "Table", departments: [/^Data Engineering/, /^Analytics/, /^ML Platform/] },
    { name: "People", departments: [/^Data Engineering/, /^Analytics/, /^ML Platform/] },
  ];
  for (const { name, departments } of views) {
    await page.getByRole("button", { name, exact: true }).click();
    const main = page.getByRole("main", { name });
    await expect(main.getByRole("heading", { level: 2 })).toHaveText(name);
    await expect(main.getByRole("heading", { level: 3 })).toHaveText(departments);
  }
});

// Status messages, read from live regions that are on the page from the start (a11y/announce.tsx).

test("saving is announced step by step, then where it went", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 5);
  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  await expect.poll(() => heard(page)).toContain("Saving 1 change… Checking for newer saves…");
  const sha = github.head.slice(0, 7);
  await expect.poll(() => heard(page)).toContain(`Saved to main as commit ${sha}. The site picks it up in about a minute.`);
});

test("someone else's save coming in is announced, and so is an app update", async ({ page, github }) => {
  github.deploy(github.otherSave({ [boxFile(CDC)]: (t) => t.replace("CDC pipeline for orders DB", "CDC pipeline v2") }, "Sam Lee", "CDC pipeline: renamed"));
  await pollNow(page);
  await expect.poll(() => heard(page)).toContain("Sam Lee saved “CDC pipeline: renamed”. The roadmap has been updated.");

  github.patchBundle = (b) => ({ ...b, app: { version: "0.2.0", build: "0.2.0+0123456789ab", time: "2099-01-01T00:00:00Z" } });
  await pollNow(page);
  await expect.poll(() => heard(page)).toContain("BoxOps was updated to 0.2.0 — Reload to keep editing.");
});

test("with an editor or dialog open, messages are spoken from inside it (VoiceOver reads only those)", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /^Edit / });
  await editor.getByRole("textbox", { name: "Title", exact: true }).fill("");
  await expect(editor.locator('[data-live="polite"]')).toHaveText("A title is required.");
  await editor.getByRole("textbox", { name: "Title", exact: true }).fill("Dagster");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Edit Analytics" }).click();
  const dialog = page.locator("dialog[open]"); // its name follows the department's
  await dialog.getByLabel("Department name").fill("");
  await expect(dialog.locator('[data-live="polite"]')).toHaveText("A name is required to save.");
});

test("search results are counted aloud once typing stops, in the table and the People view", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search boxes" }).fill("dagster");
  await expect.poll(() => said(page)).toContainEqual("1 of 15 boxes.");
  await page.getByRole("searchbox", { name: "Search boxes" }).fill("nothing like it");
  await expect.poll(() => said(page)).toContainEqual("No boxes match “nothing like it”.");
  await page.getByRole("searchbox", { name: "Search boxes" }).fill("");
  await expect.poll(() => said(page)).toContainEqual("15 boxes.");

  await page.getByRole("button", { name: "People", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search engineers" }).fill("sam");
  await expect.poll(() => said(page)).toContainEqual(expect.stringMatching(/^1 of \d+ engineers\.$/));
});

test("an edit that breaks a rule is announced, and the same message twice is read twice", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /^Edit / });
  await editor.getByRole("button", { name: "Rule", exact: true }).click();
  await editor.getByLabel("New rule").selectOption("before");
  await editor.getByLabel("Add a rule with").selectOption("C4P");
  await page.keyboard.press("Escape");
  await dragDays(page, DAGSTER, 5);
  await expect.poll(() => heard(page)).toMatch(/That breaks a rule: DE-D9U Dagster 2.x upgrade should finish before DE-C4P .* Nothing is blocked\./);

  const undone = async () => (await said(page)).filter((m) => m === "Undone.").length;
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(undone).toBe(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(undone).toBe(2);
});

// Fields: real labels, and problems (or changes made for the user) tied to them, shown and said.

test("the box editor's fields are labelled, and a missing title or a moved weekend date is tied to its field and said", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /^Edit / }); // "Edit box" while it has no title
  const title = editor.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("");
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(title).toHaveAccessibleDescription("A title is required.");
  await expect.poll(() => heard(page)).toContain("A title is required.");
  await title.fill("Dagster 2.x upgrade");
  await expect(title).not.toHaveAttribute("aria-invalid", /./);

  // Named by its label alone, not the calendar button's name too.
  const start = editor.getByRole("textbox", { name: "Start", exact: true });
  await start.fill("2026-10-10"); // a Saturday
  await expect(start).toHaveValue("2026-10-12");
  await expect(start).toHaveAccessibleDescription(/^Moved to 2026-10-12: boxes start on a weekday\. Written YYYY-MM-DD\./);
  await expect.poll(() => heard(page)).toContain("Moved to 2026-10-12: boxes start on a weekday.");

  // The same correction again is said again.
  const moved = async () => (await said(page)).filter((m) => m.includes("Moved to 2026-10-12: boxes start on a weekday.")).length;
  await expect.poll(moved).toBe(1);
  await start.fill("2026-10-11"); // a Sunday
  await expect.poll(moved).toBe(2);

  await editor.getByRole("textbox", { name: "End", exact: true }).fill("2026-10-09");
  await expect.poll(() => heard(page)).toContain("The start moved to 2026-10-09 too.");
});

test("a problem already there when its field shows isn't announced as news", async ({ page, github: _ }) => {
  const told = async (text: string) => (await said(page)).filter((m) => m.includes(text)).length;
  // The box editor, opened again on a box left with no title.
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /^Edit / });
  await editor.getByRole("textbox", { name: "Title", exact: true }).fill("");
  await expect.poll(() => told("A title is required.")).toBe(1);
  await page.keyboard.press("Escape");
  await box(page, DAGSTER).click();
  await expect(editor).toContainText("A title is required.");
  await editor.getByRole("textbox", { name: "Start", exact: true }).fill("2026-10-10"); // said later than it would be
  await expect.poll(() => heard(page)).toContain("Moved to 2026-10-12");
  expect(await told("A title is required.")).toBe(1);
  await editor.getByRole("textbox", { name: "Title", exact: true }).fill("Dagster 2.x upgrade");
  await page.keyboard.press("Escape");

  // The table, shown again with a cell saved with a link that won't do.
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const epic = page.locator("tbody tr").filter({ has: page.locator('input[value="Dagster 2.x upgrade"]') }).getByLabel("Epic link");
  await epic.fill("not a link");
  await epic.press("Enter");
  await expect.poll(() => told("Use a full http(s) link.")).toBe(1);
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.locator(".cell-problem")).toHaveText("Use a full http(s) link.");
  await page.getByRole("searchbox", { name: "Search boxes" }).fill("dagster"); // said 600 ms after typing stops
  await expect.poll(() => said(page)).toContainEqual("1 of 15 boxes.");
  expect(await told("Use a full http(s) link.")).toBe(1);
});

test("a field problem put right before it's read out isn't read out", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const title = page.getByRole("dialog", { name: /^Edit / }).getByRole("textbox", { name: "Title", exact: true });
  // Messages are written 150 ms after they're asked for: hold the clock between the two edits.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await title.fill("");
  await title.fill("Dagster 2.x upgrade");
  await page.clock.runFor(1000);
  expect(await heard(page)).not.toContain("A title is required.");
  await title.fill("");
  await page.clock.runFor(1000);
  expect(await heard(page)).toContain("A title is required.");
});

test("a table cell saved with a value that won't do says why, under it", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const epic = page.locator("tbody tr").filter({ has: page.locator('input[value="Dagster 2.x upgrade"]') }).getByLabel("Epic link");
  await epic.fill("not a link");
  await expect(epic).toHaveAttribute("aria-invalid", "true");
  await expect(epic).not.toHaveAccessibleDescription(/./); // not while it's being typed
  await epic.press("Enter");
  await expect(epic).toHaveAccessibleDescription("Use a full http(s) link.");
  await expect(page.locator(".cell-problem")).toHaveText("Use a full http(s) link.");
  const field = (await epic.boundingBox())!;
  expect((await page.locator(".cell-problem").boundingBox())!.y).toBeGreaterThanOrEqual(field.y + field.height - 1);
  await expect.poll(() => heard(page)).toContain("Use a full http(s) link.");
});

test("a blank type or flag name in team settings says it's required", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Team settings…" }).click();
  const name = page.getByRole("dialog", { name: "Team settings" }).getByLabel("Flag 1 name");
  await name.fill("");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription("A name is required.");
  await expect.poll(() => heard(page)).toContain("A name is required.");
});

test("the table marks rows someone else changed, and clashes, with more than colour", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 5);
  github.deploy(
    github.otherSave({
      [boxFile(DAGSTER)]: (t) => t.replace("status: at_risk", "status: blocked"),
      [boxFile(CDC)]: (t) => t.replace("CDC pipeline for orders DB", "CDC pipeline v2"),
    }),
  );
  await pollNow(page);
  await expect(box(page, DAGSTER)).toHaveClass(/conflict/);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const code = (title: string) => page.locator("tbody tr").filter({ has: page.locator(`input[value="${title}"]`) }).locator(".cell-code");
  await expect(code("Dagster 2.x upgrade")).toContainText("Someone else also changed this box");
  await expect(code("Dagster 2.x upgrade").locator(".box-warn svg")).toBeVisible();
  await expect(code("CDC pipeline v2")).toContainText("Changed by someone else");
  await expect(code("CDC pipeline v2").locator(".row-updated")).toBeVisible();
});

test("names say what things are: colours by name, sort order once, and no blank column headers", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Edit Analytics" }).click();
  const editor = page.getByRole("dialog", { name: "Edit Analytics" });
  await expect(editor.getByRole("button", { name: /^Colour: / })).toHaveText(Array(8).fill(""));
  await expect(editor.getByRole("button", { name: "Colour: Green" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Department / lane", exact: true })).toHaveAttribute("aria-sort", "ascending");
  await expect(page.getByRole("columnheader", { name: "Actions" })).toHaveCount(1);
  await page.getByRole("button", { name: "People", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Actions" })).toHaveCount(1);
});

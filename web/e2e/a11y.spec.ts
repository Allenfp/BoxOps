import { CDC, DAGSTER, box, boxFile, dragDays, expect, heard, pollNow, said, save, test, toolbar } from "./helpers";

// What a screen reader finds on the page: landmarks, headings and names.

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
  await expect(start).toHaveAccessibleDescription("Moved to 2026-10-12: boxes start on a weekday.");
  await expect.poll(() => heard(page)).toContain("Moved to 2026-10-12: boxes start on a weekday.");

  await editor.getByRole("textbox", { name: "End", exact: true }).fill("2026-10-09");
  await expect.poll(() => heard(page)).toContain("The start moved to 2026-10-09 too.");
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

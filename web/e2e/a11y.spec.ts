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

import { expect, test } from "./helpers";

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

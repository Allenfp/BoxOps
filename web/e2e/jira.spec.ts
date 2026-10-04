import { boxFile, DAGSTER, expect, save, test, toolbar } from "./helpers";

test("a Jira epic link labels the box with its key; the editor still shows the BoxOps code", async ({ page, github }) => {
  const box = page.locator(`[data-box-id="${DAGSTER}"]`);
  const boxops = (await box.locator(".box-code").innerText()).trim();
  await box.click();
  const editor = page.getByRole("dialog", { name: /^Edit / });
  await editor.getByLabel("Epic link").fill("https://acme.atlassian.net/browse/DATA-123");
  await expect(editor.locator(".code-chip")).toHaveText(boxops);
  await expect(editor).toContainText(`Labelled DATA-123 on the timeline and table (BoxOps code ${boxops})`);
  await page.keyboard.press("Escape");

  await expect(box.locator(".box-code")).toHaveText("DATA-123");
  await expect(box).toHaveAttribute("title", new RegExp(`DATA-123  Dagster 2\\.x upgrade  \\(BoxOps ${boxops}\\)`));

  await page.getByRole("button", { name: "Table" }).click();
  const row = page.locator("tbody tr").filter({ has: page.locator('input[aria-label="Title"][value="Dagster 2.x upgrade"]') });
  await expect(row.locator(".cell-code")).toHaveText("DATA-123");
  await expect(row.locator(".cell-code")).toHaveAttribute("title", `BoxOps ${boxops}`);
  await page.locator(".table-search").fill("data-123");
  await expect(page.locator("tbody tr .cell-code")).toHaveText(["DATA-123"]);

  await save(page);
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("epic: https://acme.atlassian.net/browse/DATA-123");
});

import { expect, test } from "./helpers";

// Working by keyboard: where focus goes, and what keys do. WebKit's Tab, like
// Safari's by default, skips buttons and links unless they have a tabindex,
// so tests start from a focused element and check where focus lands.

test("the first Tab reaches “Skip to roadmap”, which moves focus to the roadmap", async ({ page, github: _ }) => {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to roadmap" })).toBeFocused();
  await expect(page.getByRole("link", { name: "Skip to roadmap" })).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  expect(page.url()).not.toContain("#main");
});

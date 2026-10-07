import { type Page } from "@playwright/test";
import { type Endpoint, type Injected, OTHER_OWNER_TOKEN, READ_TOKEN, REPO, TOKEN } from "./fake-github";
import { DAGSTER, boxFile, dragDays, expect, save, test, toolbar } from "./helpers";

// A save GitHub refuses, or can't be reached for, says why in plain words and
// what to do about it; the draft and the token are kept for Try again.

const dialog = (page: Page) => page.locator(".save-dialog[open]");

async function pasteToken(page: Page, token: string) {
  await dialog(page).locator('input[type="password"]').fill(token);
  await dialog(page).getByRole("button", { name: "Save" }).click();
}

test.describe("private repository, signed out", () => {
  test.use({ visibility: "private", signedIn: false });

  test("a token made for the wrong owner: what to check, then another token saves", async ({ page, github }) => {
    await dragDays(page, DAGSTER, 10);
    await save(page);
    await pasteToken(page, OTHER_OWNER_TOKEN);
    await expect(dialog(page).locator("h2")).toHaveText("This token can’t see the repository");
    await expect(dialog(page).locator(".callout.error")).toContainText("set Resource owner to acme (not your own account)");
    await expect(dialog(page).locator(".callout.error")).toContainText("an owner must approve it first");
    await expect(dialog(page).locator(".callout.error")).toContainText("classic token with the repo scope");
    // Single sign-on asks members, not outside collaborators, to authorize a classic token.
    await expect(dialog(page).locator(".callout.error")).not.toContainText("single sign-on");
    await expect(dialog(page).locator(".token-help")).toContainText("Resource owner shows acme");
    await expect(dialog(page).locator(".token-help")).toContainText("a member of acme authorizes it for single sign-on if acme uses it");
    await expect(dialog(page).locator("details")).toContainText("GitHub said: “Not Found” · HTTP 404");

    await dialog(page).getByRole("button", { name: "Use a different token" }).click();
    await expect(dialog(page).locator("h2")).toHaveText("Connect to GitHub to save");
    await expect(dialog(page).locator(".callout.error")).toHaveCount(0);
    await pasteToken(page, TOKEN);
    await expect(toolbar(page)).toContainText("No changes");
    expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
  });

  test("a read-only token: set Contents to Read and write", async ({ page, github }) => {
    await dragDays(page, DAGSTER, 10);
    await save(page);
    await pasteToken(page, READ_TOKEN);
    await expect(dialog(page).locator("h2")).toHaveText("This token can’t write to the repository");
    await expect(dialog(page).locator(".callout.error")).toContainText("This token can read acme/roadmap but not write to it");
    await dialog(page).getByRole("button", { name: "Use a different token" }).click();
    await pasteToken(page, TOKEN);
    await expect(toolbar(page)).toContainText("No changes");
    expect(github.calls("graphql")).toBe(2);
  });
});

test("an account without Write access: ask an admin, with no token help, and Close first", async ({ page, github }) => {
  github.writer = false;
  await dragDays(page, DAGSTER, 10);
  await save(page);
  await expect(dialog(page).locator("h2")).toHaveText("Your account can’t write to the repository");
  await expect(dialog(page).locator(".callout.error")).toHaveText("Your GitHub account can’t write to acme/roadmap. Ask an admin for Write access.");
  // Another token of the same account can't write either.
  await expect(dialog(page).locator(".token-help")).toHaveCount(0);
  await expect(dialog(page).getByRole("button", { name: "Use a different token" })).toHaveCount(0);
  const foot = dialog(page).locator(".dialog-foot");
  await expect(foot.getByRole("button", { name: "Close" })).toHaveClass(/primary/);
  await expect(foot.getByRole("button", { name: "Try again" })).not.toHaveClass(/primary/);
  expect(github.head).toBe(github.root);
  // Once an admin grants it, Try again saves.
  github.writer = true;
  await foot.getByRole("button", { name: "Try again" }).click();
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
});

test.describe("signed out", () => {
  test.use({ signedIn: false });

  test("a kept token no header can carry is asked for again, never taken for being offline", async ({ page, github }) => {
    // Kept with curly quotes around it, as pasted from a document.
    const key = `boxops-github-token:${REPO}`;
    await page.evaluate((key) => sessionStorage.setItem(key, "“github_pat_TEST”"), key);
    await dragDays(page, DAGSTER, 10);
    await save(page);
    await expect(dialog(page).locator("h2")).toHaveText("Connect to GitHub to save");
    await expect(dialog(page).locator(".callout.error")).toContainText("rejected that token");
    expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
    await pasteToken(page, TOKEN);
    await expect(toolbar(page)).toContainText("No changes");
    expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
  });

  test("a token pasted with quotes and an invisible character is cleaned up; text that isn't one can't be sent", async ({ page, github }) => {
    await dragDays(page, DAGSTER, 10);
    await save(page);
    const input = dialog(page).locator('input[type="password"]');
    const submit = dialog(page).getByRole("button", { name: "Save" });
    await input.fill(`Your token: ${TOKEN}`);
    await expect(dialog(page).locator(".not-token")).toHaveText("That isn’t a GitHub token: copy it again from GitHub.");
    await expect(input).toHaveAccessibleDescription("That isn’t a GitHub token: copy it again from GitHub.");
    // Said as it appears, focus staying in the field: from the dialog's own live region.
    await expect(dialog(page).locator('[data-live="polite"]')).toHaveText("That isn’t a GitHub token: copy it again from GitHub.");
    await expect(submit).toBeDisabled();
    await input.fill(` “${TOKEN}”\u200B `);
    await expect(dialog(page).locator(".not-token")).toHaveCount(0);
    await submit.click();
    await expect(toolbar(page)).toContainText("No changes");
    expect(await page.evaluate((key) => sessionStorage.getItem(key), `boxops-github-token:${REPO}`)).toBe(TOKEN);
    expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
  });
});

const CASES: { on: Endpoint; as: Injected; title: string; says: string | RegExp }[] = [
  { on: "ref", as: "sso", title: "Authorize the token for single sign-on", says: "acme uses single sign-on. Authorize this token for acme" },
  { on: "ref", as: "token-policy", title: "The organization doesn’t accept this token", says: "acme doesn’t accept this token" },
  { on: "ref", as: "ip-blocked", title: "GitHub refused this network", says: "Connect to the company network or VPN" },
  { on: "ref", as: "rate-limit", title: "GitHub asked BoxOps to wait", says: /hourly allowance\. Try again after (\d{4}-\d\d-\d\d )?\d\d:\d\d\./ },
  { on: "graphql", as: "secondary-limit", title: "GitHub asked BoxOps to wait", says: "GitHub asked BoxOps to slow down. Try again in 30 seconds." },
];

for (const c of CASES) {
  test(`${c.as} (${c.on}) is explained, and Try again saves without asking for the token`, async ({ page, github }) => {
    await dragDays(page, DAGSTER, 10);
    github.inject(c.on, c.as);
    await save(page);
    await expect(dialog(page).locator("h2")).toHaveText(c.title);
    await expect(dialog(page).locator(".callout.error")).toContainText(c.says);
    await expect(dialog(page)).toContainText("Your changes are still here and still saved in this browser.");
    if (c.as === "sso") {
      await expect(dialog(page).getByRole("link", { name: "Authorize this token for acme" })).toHaveAttribute(
        "href",
        "https://github.com/orgs/acme/sso?authorization_request=FAKE",
      );
    }
    expect(github.head).toBe(github.root);
    await dialog(page).getByRole("button", { name: "Try again" }).click();
    await expect(toolbar(page)).toContainText("No changes");
    expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
  });
}

test("offline: says GitHub can't be reached, then saves once it can be", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 10);
  const offline = /^https:\/\/api\.github\.com\//;
  await page.route(offline, (route) => route.abort("internetdisconnected"));
  await save(page);
  await expect(dialog(page).locator("h2")).toHaveText("Couldn’t reach GitHub");
  await expect(dialog(page).locator(".callout.error")).toHaveText(
    "Couldn’t reach GitHub: you may be offline, or a network filter may be blocking api.github.com. Save again once you’re connected.",
  );
  await expect(dialog(page)).toContainText("Your changes are still here and still saved in this browser.");
  await page.unroute(offline);
  await dialog(page).getByRole("button", { name: "Try again" }).click();
  await expect(toolbar(page)).toContainText("No changes");
  expect(github.file(boxFile(DAGSTER))).toContain("start: 2026-09-28");
});

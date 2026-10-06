import { defineConfig, devices } from "@playwright/test";

// Browser tests run against the production build (`vite preview`) in WebKit,
// the engine behind Safari, the browser BoxOps is made for; then the whole
// suite again in Chromium (Chrome, Edge) and Firefox, which must work too.
// GitHub and the site's roadmap.json are faked per test (see
// e2e/fake-github.ts), so no network access is needed.

const viewport = { width: 1440, height: 900 };
const webkit = { ...devices["Desktop Safari"], viewport };

/** e2e/helpers.ts's options. */
interface Options {
  cull: boolean | undefined;
  virtualize: boolean | undefined;
}

export default defineConfig<Options>({
  testDir: "e2e",
  // Timing a big roadmap is `npm run perf` (playwright.perf.config.ts).
  testIgnore: "perf.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173/",
    trace: "retain-on-failure",
  },
  projects: [
    // In UTC wherever it runs (the TZ variable doesn't reach WebKit; timezoneId does).
    { name: "webkit", use: { ...webkit, timezoneId: "UTC" } },
    // Days are the viewer's local days: the specs about dates again, where the
    // day starts 7 hours after UTC's and 14 hours before it. Each test's "today"
    // is 09:00 on 2026-10-03 in its zone (e2e/helpers.ts). Saving to a private
    // repository differs only in how GitHub is called, so it runs in UTC alone.
    ...["America/Los_Angeles", "Pacific/Kiritimati"].map((timezoneId) => ({
      name: `webkit ${timezoneId}`,
      testMatch: /\/(timeline|table|pto|save|calendar)\.spec\.ts$/,
      grepInvert: /private repository/,
      use: { ...webkit, timezoneId },
    })),
    // The timeline's specs again with it drawing only what's near the screen, as it does for a
    // big roadmap (the fixture's is small). Checks that count every box it has are skipped there.
    {
      name: "webkit culled",
      testMatch: /\/(timeline|timeline-keys|drag|move|departments|pto)\.spec\.ts$/,
      use: { ...webkit, timezoneId: "UTC", cull: true },
    },
    // The table's and People's specs with only the rows near the screen drawn, as for a big roadmap
    // (and the departments', whose headings are dragged and moved in the table too).
    {
      name: "webkit windowed",
      testMatch: /\/(table|people|pto|keyboard|departments)\.spec\.ts$/,
      use: { ...webkit, timezoneId: "UTC", virtualize: true },
    },
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport, timezoneId: "UTC" } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport, timezoneId: "UTC" } },
  ],
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: !process.env.CI,
  },
});

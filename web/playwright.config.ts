import { defineConfig, devices } from "@playwright/test";

// Browser tests run against the production build (`vite preview`) in WebKit,
// the engine behind Safari. GitHub and the site's roadmap.json are faked per
// test (see e2e/fake-github.ts), so no network access is needed.
export default defineConfig({
  testDir: "e2e",
  // Timing a big roadmap is `npm run perf` (playwright.perf.config.ts).
  testIgnore: "perf.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173/",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: !process.env.CI,
  },
});

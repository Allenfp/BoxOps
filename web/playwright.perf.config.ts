import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// `npm run perf`: e2e/perf.spec.ts on its own (the browser tests leave it
// out, to stay fast), in WebKit against the production build, which it
// serves itself, one test at a time so the timings don't compete for the
// machine.
export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: "perf.spec.ts",
  fullyParallel: false,
  workers: 1,
  projects: [{ ...base.projects![0], name: "perf" }],
  webServer: undefined,
});

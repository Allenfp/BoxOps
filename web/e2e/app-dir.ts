// Where the app the browser tests open is: by default npm run build's,
// web/dist/app; with $BOXOPS_RELEASE_DIR (a release tree, as npm run
// release:build writes it, relative to web/), that tree's dist/app, so that
// what CI tests is what a release ships. playwright.config.ts serves it, the
// fake GitHub takes its build id from its index.html, npm run perf serves it
// itself, and release.spec.ts runs the command-line tool beside it.

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("..", import.meta.url));

/** The release tree under test, if there's one. */
export const RELEASE_DIR = process.env.BOXOPS_RELEASE_DIR ? resolve(WEB, process.env.BOXOPS_RELEASE_DIR) : null;
/** The app's folder. */
export const APP_DIR = RELEASE_DIR ? join(RELEASE_DIR, "dist", "app") : join(WEB, "dist", "app");
/** The command-line tool beside it (web/dist/boxops.mjs is npm run build:cli's). */
export const CLI = RELEASE_DIR ? join(RELEASE_DIR, "dist", "boxops.mjs") : join(WEB, "dist", "boxops.mjs");

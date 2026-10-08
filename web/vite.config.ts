import { posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type Plugin, normalizePath } from "vite";
import { defineConfig } from "vitest/config";
import { withContentSecurityPolicy } from "./cli/csp.ts";
import { ICONS_NOTICE, licenseFile } from "./cli/licenses.ts";
import { appInfo, buildBundle, findRepo } from "./cli/site.ts";
import { LIVE_HEADER } from "./src/model/bundle.ts";

const WEB_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_DIR = resolve(WEB_DIR, "..");
/** What `npm run dev` shows: $BOXOPS_ROADMAP (relative to where npm was run), else this repo's roadmap/. */
const DEV_ROADMAP = process.env.BOXOPS_ROADMAP
  ? resolve(process.env.INIT_CWD ?? process.cwd(), process.env.BOXOPS_ROADMAP)
  : resolve(REPO_DIR, "roadmap");
/**
 * The build id and time, in index.html (and the dev server's roadmap.json;
 * a site's comes from the command-line tool, built with the same id). The id
 * is also defined for the app; the time isn't, as it changes with every commit while
 * the id changes only with the app's code: the JavaScript then stays the same
 * from one roadmap save's deploy to the next, so a tab left open can still
 * fetch the parts of the app it loads later.
 */
const APP = appInfo(WEB_DIR, REPO_DIR);

/**
 * The roadmap and the build id around the app.
 * Build: index.html names the build (<meta name="boxops-build"> and
 * "boxops-build-time"); no roadmap is read. A site's roadmap.json is written
 * next to the app by the action, or by `node dist/boxops.mjs build` (cli/),
 * so one build of the app serves every roadmap.
 * Dev: `roadmap.json` (cli/site.ts; the fields are in src/model/bundle.ts)
 * from the files on disk, re-read on every request (and said to be, with
 * LIVE_HEADER) and always marked local; YAML edits reload the page.
 */
function roadmapData(): Plugin {
  return {
    name: "boxops-roadmap-data",
    configureServer(server) {
      const repo = findRepo(DEV_ROADMAP);
      const bundle = () =>
        buildBundle({
          repoDir: repo ?? DEV_ROADMAP,
          dir: repo ? relative(repo, DEV_ROADMAP).split(sep).join("/") : "roadmap",
          worktree: DEV_ROADMAP,
          app: APP,
          warn: (message) => server.config.logger.warn(message),
          parsed: false,
        });
      server.watcher.add(DEV_ROADMAP);
      server.watcher.on("all", (_event, path) => {
        if (path === DEV_ROADMAP || path.startsWith(DEV_ROADMAP + sep)) server.ws.send({ type: "full-reload" });
      });
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/roadmap.json") return next();
        bundle().then(
          (b) => {
            res.setHeader("Content-Type", "application/json");
            // Made afresh at each fetch: the app looks again twice a second.
            res.setHeader(LIVE_HEADER, "1");
            res.end(JSON.stringify(b));
          },
          (e: Error) => {
            server.config.logger.error(e.message);
            res.statusCode = 500;
            res.end(e.message);
          },
        );
      });
    },
    transformIndexHtml: () => [
      { tag: "meta", attrs: { name: "boxops-build", content: APP.build }, injectTo: "head" },
      { tag: "meta", attrs: { name: "boxops-build-time", content: APP.time }, injectTo: "head" },
    ],
  };
}

/** The built page's Content-Security-Policy (cli/csp.ts). Not in dev, whose server injects scripts and a websocket. */
function contentSecurityPolicy(): Plugin {
  return {
    name: "boxops-csp",
    apply: "build",
    transformIndexHtml: { order: "post", handler: withContentSecurityPolicy },
  };
}

/**
 * `boxops-chunk:src/x.ts`, in a string in the app's code, becomes the address of the file the build
 * puts module x in (one fetched when it's needed, in a file of its own), relative to the file the
 * string ends up in; in dev, x's own address. The app fetches such a file again under another
 * address after a failure: WebKit and Chromium keep a module that failed to load for its address
 * until the page reloads, and WebKit can keep it across a reload too. A module the build puts in
 * no file of its own fails the build.
 */
function chunkAddresses(): Plugin {
  const marker = /boxops-chunk:([\w./-]+)/g;
  let dev = false;
  return {
    name: "boxops-chunk-addresses",
    configResolved: (config) => void (dev = config.command === "serve"),
    transform: (code, id) =>
      dev && id.startsWith(normalizePath(resolve(WEB_DIR, "src")) + "/") && code.includes("boxops-chunk:")
        ? code.replace(marker, (_, path: string) => `/${path}`)
        : null,
    renderChunk(code, chunk, _options, { chunks }) {
      if (!code.includes("boxops-chunk:")) return null;
      return code.replace(marker, (_, path: string) => {
        // Its name as it is here, a placeholder for the hash, which the build fills in afterwards.
        // Module ids are Vite's: with / between names, on Windows too.
        const file = Object.values(chunks).find((c) => c.facadeModuleId === normalizePath(resolve(WEB_DIR, path)))?.fileName;
        if (!file) throw new Error(`boxops-chunk: the build puts ${path} in no file of its own`);
        return `./${posix.relative(posix.dirname(chunk.fileName), file)}`;
      });
    },
  };
}

export default defineConfig({
  // Relative asset paths so the site works under https://<user>.github.io/BoxOps/.
  base: "./",
  build: {
    // dist/app, as in a release (dist/ also gets the command-line tool: vite.cli.config.ts).
    outDir: "dist/app",
    // The licences of what the app bundles (React, yaml), shipped with it, and
    // of the icons it draws (cli/licenses.ts).
    license: { fileName: "licenses.txt" },
  },
  define: { __BOXOPS_BUILD__: JSON.stringify(APP.build) },
  plugins: [react(), roadmapData(), contentSecurityPolicy(), chunkAddresses(), licenseFile("licenses.txt", { append: ICONS_NOTICE })],
  test: {
    environment: "node",
    // .tsx too, so a component's test is never skipped without a word.
    include: ["src/**/*.test.{ts,tsx}", "cli/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});

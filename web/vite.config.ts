import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { appInfo, buildBundle, findRepo } from "./cli/site.ts";

const WEB_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_DIR = resolve(WEB_DIR, "..");
/** What `npm run dev` shows: $BOXOPS_ROADMAP (relative to where npm was run), else this repo's roadmap/. */
const DEV_ROADMAP = process.env.BOXOPS_ROADMAP
  ? resolve(process.env.INIT_CWD ?? process.cwd(), process.env.BOXOPS_ROADMAP)
  : resolve(REPO_DIR, "roadmap");
/** The build id and time: defined for the app, in index.html and in roadmap.json. */
const APP = appInfo(WEB_DIR, REPO_DIR);

/**
 * Serves the roadmap as `roadmap.json` (cli/site.ts; the fields are in
 * src/model/bundle.ts).
 * Build: read from git objects at HEAD (or GITHUB_SHA in Actions) and emitted
 * next to index.html, so Pages viewers need no GitHub API calls. A local
 * build whose roadmap/ has uncommitted changes uses the files on disk and is
 * marked local.
 * Dev: the files on disk, re-read on every request and always marked local;
 * YAML edits reload the page.
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
    async generateBundle() {
      const bundle = await buildBundle({ repoDir: REPO_DIR, app: APP, warn: (message) => this.warn(message) });
      this.emitFile({ type: "asset", fileName: "roadmap.json", source: JSON.stringify(bundle) });
    },
    transformIndexHtml: () => [{ tag: "meta", attrs: { name: "boxops-build", content: APP.build }, injectTo: "head" }],
  };
}

export default defineConfig({
  // Relative asset paths so the site works under https://<user>.github.io/BoxOps/.
  base: "./",
  define: { __BOXOPS_BUILD__: JSON.stringify(APP.build), __BOXOPS_BUILD_TIME__: JSON.stringify(APP.time) },
  plugins: [react(), roadmapData()],
  test: { environment: "node", include: ["src/**/*.test.ts", "cli/**/*.test.ts"] },
});

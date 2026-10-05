import { createHash } from "node:crypto";
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
/**
 * The build id and time, in roadmap.json and in index.html. The id is also
 * defined for the app; the time isn't, as it changes with every commit while
 * the id changes only with the app's code: the JavaScript then stays the same
 * from one roadmap save's deploy to the next, so a tab left open can still
 * fetch the parts of the app it loads later.
 */
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
    transformIndexHtml: () => [
      { tag: "meta", attrs: { name: "boxops-build", content: APP.build }, injectTo: "head" },
      { tag: "meta", attrs: { name: "boxops-build-time", content: APP.time }, injectTo: "head" },
    ],
  };
}

/**
 * The built page's Content-Security-Policy, as a meta tag (Pages can't send
 * headers): scripts and styles only from the site, except index.html's inline
 * scripts, allowed by their hashes; network calls only to the site, the
 * GitHub API and raw.githubusercontent.com (anonymous reads of a public
 * repository). React's style props go through the CSSOM, which style-src
 * doesn't govern. Not in dev, whose server injects scripts and a websocket.
 * It goes straight after <meta charset>, which must stay in the first 1024
 * bytes, and before anything it governs.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: "boxops-csp",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
          (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
        );
        const policy = [
          "default-src 'none'",
          `script-src 'self' ${inline.join(" ")}`.trim(),
          "style-src 'self'",
          "img-src 'self' data:",
          "connect-src 'self' https://api.github.com https://raw.githubusercontent.com",
          "base-uri 'none'",
          "form-action 'none'",
          "object-src 'none'",
        ].join("; ");
        const charset = /<meta charset="[^"]*"\s*\/?>/i;
        if (!charset.test(html)) throw new Error("index.html has no <meta charset> to put the Content-Security-Policy after.");
        return html.replace(charset, (tag) => `${tag}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

export default defineConfig({
  // Relative asset paths so the site works under https://<user>.github.io/BoxOps/.
  base: "./",
  define: { __BOXOPS_BUILD__: JSON.stringify(APP.build) },
  plugins: [react(), roadmapData(), contentSecurityPolicy()],
  test: {
    environment: "node",
    // .tsx too, so a component's test is never skipped without a word.
    include: ["src/**/*.test.{ts,tsx}", "cli/**/*.test.ts"],
  },
});

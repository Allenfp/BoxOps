import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { readRoadmapDir } from "./src/model/files.ts";

const ROADMAP_DIR = fileURLToPath(new URL("../roadmap", import.meta.url));

const git = (...args: string[]) => {
  try {
    return execFileSync("git", args, { cwd: ROADMAP_DIR, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

/**
 * Which repo, branch and commit the data came from. In GitHub Actions this is
 * the commit being deployed; locally it is HEAD, flagged dirty when roadmap/
 * has edits that aren't committed (a PR would be built on HEAD, not on them).
 */
function source() {
  // Who made the latest commit and what it says, for "Sam saved: …" notices.
  const author = git("log", "-1", "--format=%an");
  const subject = git("log", "-1", "--format=%s");
  if (process.env.GITHUB_ACTIONS) {
    return {
      repo: process.env.GITHUB_REPOSITORY,
      branch: process.env.GITHUB_REF_NAME,
      commit: process.env.GITHUB_SHA,
      author,
      subject,
    };
  }
  const remote = git("remote", "get-url", "origin");
  return {
    repo: /github\.com[:/](.+?)(?:\.git)?$/.exec(remote)?.[1] ?? "",
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    commit: git("rev-parse", "HEAD"),
    author,
    subject,
    dirty: git("status", "--porcelain", "--", ".") !== "",
  };
}

/**
 * Serves the repo's roadmap/ folder as `roadmap.json` ({ files: { path: yaml }, source }).
 * Dev: rebuilt on every request, and YAML edits reload the page.
 * Build: emitted next to index.html so Pages viewers need no GitHub API calls.
 */
function roadmapData(): Plugin {
  const bundle = () => JSON.stringify({ files: readRoadmapDir(ROADMAP_DIR), source: source() });
  return {
    name: "boxops-roadmap-data",
    configureServer(server) {
      server.watcher.add(ROADMAP_DIR);
      server.watcher.on("all", (_event, path) => {
        if (path.startsWith(ROADMAP_DIR)) server.ws.send({ type: "full-reload" });
      });
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/roadmap.json") return next();
        res.setHeader("Content-Type", "application/json");
        res.end(bundle());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "roadmap.json", source: bundle() });
    },
  };
}

export default defineConfig({
  // Relative asset paths so the site works under https://<user>.github.io/BoxOps/.
  base: "./",
  plugins: [react(), roadmapData()],
  test: { environment: "node" },
});

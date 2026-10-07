// Text from the BoxOps repository that the command-line tool carries, so it
// works offline and always matches its own release: the AGENTS.md block, the
// guide and Path B's workflows (templates/), and the starter repository's
// files (starter/). vite.cli.config.ts compiles them into dist/boxops.mjs;
// run from source, they're read from the checkout. Node-only.

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { absolutePath } from "./git.ts";
import { HERE } from "./release.ts";

declare const __BOXOPS_EMBEDDED__: Record<string, string> | undefined;

/** What's carried, from the BoxOps repository's top level: folders (every file in them git tracks, dotfiles too) and files. */
export const EMBEDDED_PATHS = ["templates", "starter"];

/**
 * The files git tracks (committed, or added) under `paths` in the BoxOps
 * checkout at `repoDir`: never an untracked .DS_Store or editor backup, which
 * `init` would otherwise write into new repositories.
 */
export function trackedFiles(repoDir: string, paths: string[]): string[] {
  // As cli/site.ts's appInfo reads this checkout: no system configuration, no fsmonitor hook, no GIT_* variable,
  // the git in PATH's absolute folders.
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("GIT_")) env[key] = value;
  try {
    const listed = execFileSync("git", ["-c", "core.fsmonitor=false", "ls-files", "-z", "--cached", "--", ...paths], {
      cwd: repoDir,
      env: { ...env, PATH: absolutePath(), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
      encoding: "utf8",
      stdio: "pipe",
    });
    return listed.split("\0").filter(Boolean);
  } catch (e) {
    const err = e as Error & { stderr?: string };
    throw new Error(`Can’t list the files git tracks in ${repoDir} (${err.stderr?.trim() || err.message}): BoxOps carries only those, so build it from a git checkout`);
  }
}

/** The carried files (path from the BoxOps repository's top level → text): those git tracks in the checkout at `repoDir`, as they are on disk. */
export function collectEmbedded(repoDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of trackedFiles(repoDir, EMBEDDED_PATHS).sort()) {
    const st = lstatSync(join(repoDir, path), { throwIfNoEntry: false });
    if (!st) continue; // deleted, and not committed yet
    if (!st.isFile()) throw new Error(`${path} isn’t a plain file: BoxOps carries plain files only`);
    out[path] = readFileSync(join(repoDir, path), "utf8");
  }
  for (const path of EMBEDDED_PATHS) {
    if (!Object.keys(out).some((p) => p === path || p.startsWith(`${path}/`))) throw new Error(`${path}: git tracks nothing there for BoxOps to carry`);
  }
  return out;
}

let cache: Record<string, string> | undefined;

/** The carried files: compiled in, or read from this source checkout. */
export function embedded(): Record<string, string> {
  if (typeof __BOXOPS_EMBEDDED__ !== "undefined") return __BOXOPS_EMBEDDED__;
  cache ??= collectEmbedded(resolve(HERE, "../.."));
  return cache;
}

/** One carried file's text; throws if it isn't carried. */
export function carried(path: string): string {
  const text = embedded()[path];
  if (text === undefined) throw new Error(`BoxOps doesn’t carry ${path}`);
  return text;
}

/** The starter repository's files (path in the starter → text). */
export function starterFiles(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(embedded())
      .filter(([p]) => p.startsWith("starter/"))
      .map(([p, t]) => [p.slice("starter/".length), t]),
  );
}

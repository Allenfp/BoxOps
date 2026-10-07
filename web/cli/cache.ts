// Where the command-line tool keeps releases it downloads (upgrade fetches the
// new release's tool to run it): the launcher's cache, never inside the
// repository, since a file committed there would run as code on teammates'
// machines. The order, the checks and the layout are the launcher's
// (starter/.boxops/boxops.mjs): a release's folder holds its boxops.mjs and
// the BUILD.json of the same commit, which the tool is checked against
// whenever it's used, and, once preview or build has run, the app beside
// them (app/**, cli/preview.ts). Node-only.

import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { Env } from "./gha.ts";
import { type BuildJson, digest, parseBuildJson } from "./release.ts";

/**
 * `path` with its existing part as the file system spells it
 * (realpathSync.native: symlinks resolved, and on a disk that ignores case,
 * macOS's or Windows', the case it has, as /Users/me/ROADMAP is
 * /Users/me/roadmap there), the rest as written: where a folder not made yet
 * would be.
 */
function realish(path: string): string {
  const rest: string[] = [];
  let at = resolve(path);
  while (!existsSync(at) && dirname(at) !== at) {
    rest.unshift(basename(at));
    at = dirname(at);
  }
  return join(realpathSync.native(at), ...rest);
}

const within = (path: string, top: string) => path === top || path.startsWith(top + sep);

/**
 * The cache folder: $BOXOPS_CACHE, $XDG_CACHE_HOME/boxops (an absolute
 * one), ~/.cache/boxops, then a folder of this user's in the temp folder;
 * the first that can be made, is outside `root`, is this user's and isn't
 * writable by others. The temp folder is everyone's: there, only a folder
 * (not a symlink, which another user could leave, to a folder of this
 * user's holding their files) that no one else can use, as it's made.
 * Throws if none is, or if $BOXOPS_CACHE is inside `root` (nothing is made
 * there).
 */
export function cacheRoot(env: Env, root: string): string {
  const uid = process.getuid?.();
  const xdg = env.XDG_CACHE_HOME;
  const tries = [
    env.BOXOPS_CACHE ? resolve(env.BOXOPS_CACHE) : undefined,
    xdg && isAbsolute(xdg) ? join(xdg, "boxops") : undefined,
    join(homedir(), ".cache", "boxops"),
    join(tmpdir(), `boxops-cache-${uid ?? "user"}`),
  ];
  const top = realpathSync.native(root);
  for (const [i, dir] of tries.entries()) {
    if (!dir) continue;
    try {
      if (within(realish(dir), top)) {
        if (i === 0) throw new Error("BOXOPS_CACHE must be outside this repository");
        continue;
      }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (i === tries.length - 1) {
        const own = lstatSync(dir);
        if (!own.isDirectory() || (uid !== undefined && (own.uid !== uid || own.mode & 0o077))) continue;
      }
      const real = realpathSync.native(dir);
      if (within(real, top)) continue;
      const st = statSync(real);
      if (uid !== undefined && (st.uid !== uid || st.mode & 0o022)) continue;
      writeFileSync(join(real, ".write-test"), "");
      return real;
    } catch (e) {
      if ((e as Error).message === "BOXOPS_CACHE must be outside this repository") throw e;
    }
  }
  throw new Error("no writable cache folder outside this repository; set BOXOPS_CACHE");
}

/**
 * The folder a release's files are cached in: `<cache>/<owner>__<repo>/<sha>`,
 * as the launcher keeps them. Throws if that's inside `root` (as it would be
 * with the cache in the folder around a repository named `<owner>__<repo>`).
 */
export function releaseCache(env: Env, root: string, repo: string, sha: string): string {
  const dir = join(cacheRoot(env, root), repo.replace("/", "__"), sha);
  if (within(realish(dir), realpathSync.native(root))) throw new Error(`${dir} is inside this repository: set BOXOPS_CACHE to a folder outside it`);
  return dir;
}

/**
 * The tool cached in a release's folder, with the BUILD.json beside it, if
 * both are there and the tool is the file that BUILD.json describes; else
 * null (missing, cut short, or changed since: fetch them again).
 */
export function cachedTool(dir: string): { file: string; buildJson: BuildJson } | null {
  const file = join(dir, "boxops.mjs");
  try {
    const buildJson = parseBuildJson(readFileSync(join(dir, "BUILD.json"), "utf8"));
    return digest(readFileSync(file)) === buildJson.files["dist/boxops.mjs"] ? { file, buildJson } : null;
  } catch {
    return null;
  }
}

/** Writes a file whole, then moves it into place, so no one ever reads half of one. */
export function writeWhole(file: string, bytes: Uint8Array | string): void {
  writeFileSync(`${file}.${process.pid}`, bytes, { mode: 0o600 });
  renameSync(`${file}.${process.pid}`, file);
}

/** Keeps a release's tool and its BUILD.json (the text as fetched) in its cache folder. */
export function keepTool(dir: string, tool: Uint8Array, buildJson: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeWhole(join(dir, "boxops.mjs"), tool);
  writeWhole(join(dir, "BUILD.json"), buildJson);
  return join(dir, "boxops.mjs");
}

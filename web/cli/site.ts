// Builds the site's roadmap.json (bundle schema 1, see src/model/bundle.ts).
// Node-only; vite.config.ts and the browser tests' fake GitHub use it.
//
// A build in GitHub Actions reads the roadmap from git objects at GITHUB_SHA
// and takes the repository's visibility from the event payload. A local build
// reads it from git objects at HEAD too, unless the working tree's roadmap
// differs, in which case it uses the files on disk and marks the bundle
// local. The dev server always uses the files on disk.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type GitTreeEntry, gitBlobSha, gitTreeSha } from "../src/github/git-objects.ts";
import { type AppInfo, type Bundle, type BundleSource, type RoadmapFolder, SCHEMA, type Visibility } from "../src/model/bundle.ts";
import { FORMAT } from "../src/model/format.ts";
import { isHiddenPath, isRoadmapPath } from "../src/model/paths.ts";
import type { RoadmapFiles } from "../src/model/types.ts";
import { firstParents, gitPlumbing, readCommit, readRoadmapDir, readRoadmapGit, resolveCommit } from "./git.ts";

export type Env = Record<string, string | undefined>;

const posix = (path: string) => path.split(sep).join("/");

/**
 * Plain git in the checkout this app is built from, for what plumbing can't
 * tell: the origin's URL and whether web/ has changes. Never used on roadmap
 * data. The user's and the repository's configuration apply, but not the
 * system's, and `status` never starts an fsmonitor.
 */
function localGit(cwd: string, args: string[]): string {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
  try {
    return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd, encoding: "utf8", env, stdio: "pipe" }).trim();
  } catch {
    return "";
  }
}

/** The closest folder at or above `dir` that has a .git (folder or file), or null. */
export function findRepo(dir: string): string | null {
  for (let at = resolve(dir); ; at = dirname(at)) {
    if (existsSync(join(at, ".git"))) return at;
    if (dirname(at) === at) return null;
  }
}

/**
 * The app being built (AppInfo). For now BoxOps is one repository, so the
 * build id is the version plus the first 12 hex of web/'s tree at HEAD, which
 * roadmap-only saves leave alone; ".dirty" when web/ has uncommitted changes.
 * The time is HEAD's committer date, so rebuilding a commit gives the same id
 * and time.
 */
export function appInfo(webDir: string, repoDir = resolve(webDir, "..")): AppInfo {
  const { version } = JSON.parse(readFileSync(join(webDir, "package.json"), "utf8")) as { version: string };
  let tree = "unknown";
  let time = "";
  try {
    tree = gitPlumbing(repoDir, "rev-parse", ["--verify", `HEAD:${posix(relative(repoDir, webDir))}`]).toString().trim().slice(0, 12);
    time = readCommit(repoDir, resolveCommit(repoDir, "HEAD")).date;
  } catch {
    // Not a git checkout: the build can't be identified.
  }
  const dirty = tree !== "unknown" && localGit(webDir, ["status", "--porcelain", "--", "."]) !== "";
  return { version, build: `${version}+${tree}${dirty ? ".dirty" : ""}`, time };
}

/** "owner/repo" from a remote URL on any host (github.com, GHE.com, GHES), or "" if it doesn't name one. */
export function repoFromRemote(url: string): string {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/]+@)?(?!\.\.?[:/])[^/:]+(?::\d+)?[:/]\/*(.+?)(?:\.git)?\/*$/i.exec(url.trim());
  return m && /^[^/]+\/[^/]+$/.test(m[1]) ? m[1] : "";
}

/** A remote URL fit for a log: without the user and password (a token) a URL may carry. */
export const withoutCredentials = (url: string) => url.replace(/^([a-z][a-z0-9+.-]*:\/\/)?[^@/]+@/i, "$1");

/**
 * The repository's visibility from the GitHub Actions event payload. Unknown
 * (no payload, no repository in it, or another repository) counts as private,
 * the safe guess: the app then never calls GitHub without a token.
 */
export function repoVisibility(env: Env): { visibility: Visibility | null; private: boolean } {
  let repo: Record<string, unknown> | undefined;
  try {
    const r: unknown = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8")).repository;
    if (typeof r === "object" && r !== null) repo = r as Record<string, unknown>;
  } catch {
    // No payload: unknown.
  }
  const name = typeof repo?.full_name === "string" ? repo.full_name.toLowerCase() : undefined;
  if (!repo || (name !== undefined && name !== env.GITHUB_REPOSITORY?.toLowerCase())) return { visibility: null, private: true };
  const visibility =
    repo.visibility === "public" || repo.visibility === "private" || repo.visibility === "internal"
      ? repo.visibility
      : typeof repo.private === "boolean"
        ? repo.private
          ? "private"
          : "public"
        : null;
  return { visibility, private: !(repo.private === false && visibility === "public") };
}

/**
 * firstParents, remembered per repository and commit: the dev server builds a
 * bundle on every request, and reading 50 commits one `git cat-file` at a time
 * takes most of a second. A commit's first parents never change (a shallow
 * clone deepened meanwhile keeps its shorter history until a restart).
 */
const histories = new Map<string, string[]>();
function history(repo: string, commit: string): string[] {
  const key = `${repo}\0${commit}`;
  let list = histories.get(key);
  if (!list) histories.set(key, (list = firstParents(repo, commit)));
  return [...list];
}

/** Two reads of a roadmap folder hold the same files. */
function sameFolder(a: RoadmapFolder, b: RoadmapFolder): boolean {
  const key = (f: RoadmapFolder) => JSON.stringify([Object.entries(f.blobs).sort(), [...f.ignored].sort()]);
  return key(a) === key(b);
}

/**
 * What a reader returns for a folder holding exactly these files, all plain
 * (mode 100644): the roadmap files with their blob SHAs, the other files
 * (unless hidden) as ignored, and the folder's tree SHA.
 */
export async function hashFolder(all: RoadmapFiles): Promise<RoadmapFolder> {
  const utf8 = new TextEncoder();
  const folder: RoadmapFolder = { files: {}, blobs: {}, ignored: [], tree: null };
  const entries: GitTreeEntry[] = [];
  for (const [path, text] of Object.entries(all).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const sha = await gitBlobSha(utf8.encode(text));
    entries.push({ path, mode: "100644", sha });
    if (isRoadmapPath(path)) {
      folder.files[path] = text;
      folder.blobs[path] = sha;
    } else if (!isHiddenPath(path)) folder.ignored.push(path);
  }
  folder.tree = await gitTreeSha(entries);
  return folder;
}

/** The bundle for these files from this source: what buildBundle writes. */
export function assembleBundle(app: AppInfo, source: BundleSource, folder: RoadmapFolder): Bundle {
  return {
    schema: SCHEMA,
    format: FORMAT,
    app,
    source,
    files: folder.files,
    blobs: folder.blobs,
    ignored: folder.ignored,
    notices: [],
  };
}

export interface BuildOptions {
  /** Top level of the git repository the roadmap is in. */
  repoDir: string;
  /** The roadmap folder's path in it. */
  dir?: string;
  /** Read the roadmap from this folder on disk instead (the dev server): the bundle is local. */
  worktree?: string;
  app: AppInfo;
  /** Default: process.env. */
  env?: Env;
  /** Told about a local build from uncommitted files, or a remote that names no repository. */
  warn?(message: string): void;
}

/** roadmap.json for the site, as described at the top of this file. */
export async function buildBundle(o: BuildOptions): Promise<Bundle> {
  const env = o.env ?? process.env;
  const dir = o.dir ?? "roadmap";
  const warn = o.warn ?? ((message: string) => console.warn(message));
  const actions = env.GITHUB_ACTIONS === "true";
  let folder: RoadmapFolder;
  let commit = "";
  let local = false;

  if (o.worktree !== undefined) {
    folder = await readRoadmapDir(o.worktree);
    local = true;
    try {
      commit = resolveCommit(o.repoDir, "HEAD");
    } catch {
      // Not in a repository: no commit to name.
    }
  } else if (actions) {
    if (!env.GITHUB_SHA) throw new Error("GITHUB_SHA isn't set");
    commit = resolveCommit(o.repoDir, env.GITHUB_SHA);
    folder = await readRoadmapGit(o.repoDir, commit, dir);
  } else {
    const disk = await readRoadmapDir(join(o.repoDir, dir));
    let committed: RoadmapFolder | null = null;
    let why = `${dir}/ has changes that aren't committed`;
    try {
      commit = resolveCommit(o.repoDir, "HEAD");
      committed = await readRoadmapGit(o.repoDir, commit, dir);
    } catch (e) {
      why = (e as Error).message;
    }
    if (committed && sameFolder(committed, disk)) folder = committed;
    else {
      folder = disk;
      local = true;
      warn(`${why}: roadmap.json is built from the files on disk (marked local)`);
    }
  }

  const meta = commit ? readCommit(o.repoDir, commit) : undefined;
  let repo = env.GITHUB_REPOSITORY ?? "";
  let branch = env.GITHUB_REF_NAME ?? "";
  if (!actions) {
    // Outside a repository (a dev server on some folder) there's nothing to name.
    const remote = commit ? localGit(o.repoDir, ["remote", "get-url", "origin"]) : "";
    repo = repoFromRemote(remote);
    if (commit && !repo) {
      warn(`Can't tell the repository from the origin remote${remote ? ` (${withoutCredentials(remote)})` : ""}: source.repo is empty`);
    }
    branch = commit ? gitPlumbing(o.repoDir, "rev-parse", ["--abbrev-ref", "HEAD"]).toString().trim() : "";
  }
  const { visibility, private: isPrivate } = actions ? repoVisibility(env) : { visibility: null, private: true };
  const source: BundleSource = {
    repo,
    branch,
    commit,
    dir,
    tree: local ? null : folder.tree,
    visibility,
    private: isPrivate,
    readonly: false,
    ...(local ? { local: true } : {}),
    author: meta?.author ?? "",
    subject: meta?.subject ?? "",
    date: meta?.date ?? "",
    history: commit ? history(o.repoDir, commit) : [],
    ...(actions && env.GITHUB_RUN_ID && repo
      ? { run: `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` }
      : {}),
  };
  return assembleBundle(o.app, source, folder);
}

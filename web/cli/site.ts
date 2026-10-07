// Builds the site's roadmap.json (bundle schema 1, see src/model/bundle.ts).
// Node-only; vite.config.ts and the browser tests' fake GitHub use it.
//
// A build in GitHub Actions reads the roadmap from git objects at GITHUB_SHA
// and takes the repository's visibility from the event payload. A local build
// reads it from git objects at HEAD too, unless the working tree's roadmap
// differs, in which case it uses the files on disk and marks the bundle
// local. The dev server always uses the files on disk. The repository is
// named only on github.com, the one GitHub the app talks to.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type GitTreeEntry, gitBlobSha, gitTreeSha } from "../src/github/git-objects.ts";
import { type AppInfo, type Bundle, type BundleSource, type ParsedFiles, type RoadmapFolder, SCHEMA, type Visibility } from "../src/model/bundle.ts";
import type { ParsedEntry } from "../src/model/load.ts";
import { FORMAT } from "../src/model/format.ts";
import { parseFile } from "../src/model/parse.ts";
import { isHiddenPath, isRoadmapPath } from "../src/model/paths.ts";
import type { RoadmapFiles } from "../src/model/types.ts";
import { type CommitInfo, absolutePath, firstParents, gitPlumbing, readCommit, readRoadmapDir, readRoadmapGit, resolveCommit } from "./git.ts";

export type Env = Record<string, string | undefined>;

const posix = (path: string) => path.split(sep).join("/");

/**
 * Plain git, for what plumbing can't tell: whether web/ has changes in the
 * checkout this app is built from, and a local build's origin URL. Never used
 * on roadmap data. The user's and the repository's configuration apply, but
 * not the system's, and `status` never starts an fsmonitor. It's the git in
 * PATH's absolute folders (absolutePath): it runs in a roadmap repository's
 * folder too, for the origin.
 */
function localGit(cwd: string, args: string[]): string {
  const env = { ...process.env, PATH: absolutePath(), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
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
 * The version a build is stamped with: web/package.json's, or `wanted` (from
 * $BOXOPS_VERSION, which `npm run release:build -- --version` sets for the
 * builds it runs) when given: that version itself, or it with a pre-release
 * tag, such as 0.1.0-rc.1 or 0.1.0-next. Throws for any other.
 */
export function buildVersion(pkg: string, wanted: string | undefined): string {
  if (!wanted) return pkg;
  const m = /^(\d+\.\d+\.\d+)(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.exec(wanted);
  if (m?.[1] !== pkg) {
    throw new Error(`BOXOPS_VERSION is “${wanted}”: it must be web/package.json’s version, ${pkg}, or that with a pre-release tag, such as ${pkg}-rc.1`);
  }
  return wanted;
}

/**
 * The app being built (AppInfo). For now BoxOps is one repository, so the
 * build id is the version (buildVersion: package.json's, or a release's)
 * plus the first 12 hex of web/'s tree at HEAD, which roadmap-only saves
 * leave alone; ".dirty" when web/ has uncommitted changes. The time is HEAD's
 * committer date, so rebuilding a commit gives the same id and time. A
 * `git worktree` checkout (whose .git is a file) is read too.
 */
export function appInfo(webDir: string, repoDir = resolve(webDir, ".."), wanted = process.env.BOXOPS_VERSION): AppInfo {
  const pkg = (JSON.parse(readFileSync(join(webDir, "package.json"), "utf8")) as { version: string }).version;
  const version = buildVersion(pkg, wanted);
  let tree = "unknown";
  let time = "";
  const checkout = { checkout: true };
  try {
    tree = gitPlumbing(repoDir, "rev-parse", ["--verify", `HEAD:${posix(relative(repoDir, webDir))}`], checkout).toString().trim().slice(0, 12);
    time = readCommit(repoDir, resolveCommit(repoDir, "HEAD", checkout), checkout).date;
  } catch {
    // Not a git checkout: the build can't be identified.
  }
  const dirty = tree !== "unknown" && localGit(webDir, ["status", "--porcelain", "--", "."]) !== "";
  return { version, build: `${version}+${tree}${dirty ? ".dirty" : ""}`, time };
}

/**
 * The host and "owner/repo" a remote URL names, or null if it names none. As
 * in git, a URL without a scheme names a host only before a colon
 * (`git@host:owner/repo`); otherwise, like a file:// URL, it's a local path.
 */
export function repoFromRemote(url: string): { host: string; repo: string } | null {
  if (/^file:/i.test(url.trim())) return null;
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/|(?:[^@/]+@)?([^/:]+):)\/*(.+?)(?:\.git)?\/*$/i.exec(url.trim());
  return m && /^[^/]+\/[^/]+$/.test(m[3]) ? { host: (m[1] ?? m[2]).toLowerCase(), repo: m[3] } : null;
}

/**
 * The app talks to github.com only (api.github.com, raw.githubusercontent.com,
 * and nothing else in the CSP): GitHub Enterprise Server and GHE.com aren't
 * supported in BoxOps 0.1. ssh.github.com is GitHub's SSH over port 443.
 */
const GITHUB_HOSTS = new Set(["github.com", "ssh.github.com"]);

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

/** readCommit, remembered as firstParents is (a preview builds a bundle twice a second): a commit never changes. */
const commits = new Map<string, CommitInfo>();
function commitInfo(repo: string, commit: string): CommitInfo {
  const key = `${repo}\0${commit}`;
  let info = commits.get(key);
  if (!info) commits.set(key, (info = readCommit(repo, commit)));
  return info;
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

/** A build id that names the app's code exactly: web/'s tree at a commit, not ".dirty" or "+unknown". */
const CLEAN_BUILD = /^[^+\s]+\+[0-9a-f]{12}$/;

/**
 * What files parsed to, kept from one build to the next (the preview's, every
 * half second): by path and blob SHA, since what a file parses to depends on
 * those alone (src/model/parse.ts).
 */
export type ParseCache = Map<string, ParsedEntry>;

/**
 * The bundle for these files from this source: what buildBundle writes. With
 * `parsed`, each file as this build's parser makes of it, by path (without
 * the path itself), stamped with the build id. By default only under an id that names the
 * app's code exactly: two builds with uncommitted changes, or from outside a
 * git checkout, can share an id but not a parser, and a tab of one would take
 * the other's. `parsed: true` stamps any id (the browser tests, whose app is
 * the one just built here), `false` none. With a `cache`, only the files not
 * in it are parsed, and it's left holding this folder's files alone.
 */
export function assembleBundle(app: AppInfo, source: BundleSource, folder: RoadmapFolder, o: { parsed?: boolean; cache?: ParseCache } = {}): Bundle {
  let parsed: ParsedFiles | undefined;
  if (app.build && (o.parsed ?? CLEAN_BUILD.test(app.build))) {
    parsed = { parser: app.build, files: {} };
    const keys = new Set<string>();
    for (const path of Object.keys(folder.blobs)) {
      const key = `${path}\0${folder.blobs[path]}`;
      keys.add(key);
      let entry = o.cache?.get(key);
      if (!entry) {
        const { path: _, ...made } = parseFile(path, folder.files[path]);
        entry = made;
        o.cache?.set(key, entry);
      }
      parsed.files[path] = entry;
    }
    if (o.cache) for (const key of o.cache.keys()) if (!keys.has(key)) o.cache.delete(key);
  }
  return {
    schema: SCHEMA,
    format: FORMAT,
    app,
    source,
    files: folder.files,
    blobs: folder.blobs,
    ignored: folder.ignored,
    notices: [],
    ...(parsed && { parsed }),
  };
}

export interface BuildOptions {
  /** Top level of the git repository the roadmap is in. */
  repoDir: string;
  /** The roadmap folder's path in it. */
  dir?: string;
  /** Read the roadmap from this folder on disk instead (the dev server): the bundle is local. */
  worktree?: string;
  /** Read it from git objects at this commit (HEAD, a branch or a SHA) instead of GITHUB_SHA or, locally, HEAD or the files on disk. */
  commit?: string;
  /**
   * The repository the roadmap belongs to (owner/name), in place of
   * GITHUB_REPOSITORY or the origin remote's. Naming one other than the
   * workflow's in Actions makes the site read-only, and private.
   */
  repository?: string;
  /** The site never offers to save. */
  readonly?: boolean;
  app: AppInfo;
  /** Default: process.env. */
  env?: Env;
  /** Told about a local build from uncommitted files, a remote that names no github.com repository, or an executable roadmap file. */
  warn?(message: string): void;
  /**
   * Put the files in parsed (the default, under a build id that names a
   * clean tree; see assembleBundle). The dev server doesn't: its app
   * changes under the same build id as you edit it.
   */
  parsed?: boolean;
  /** What files parsed to in earlier builds (see assembleBundle). */
  parseCache?: ParseCache;
}

/** roadmap.json for the site, as described at the top of this file. */
export async function buildBundle(o: BuildOptions): Promise<Bundle> {
  const env = o.env ?? process.env;
  const dir = o.dir ?? "roadmap";
  const warn = o.warn ?? ((message: string) => console.warn(message));
  const actions = env.GITHUB_ACTIONS === "true";
  // Elsewhere the app would read, and save to, a repository of that name on github.com.
  const server = actions ? env.GITHUB_SERVER_URL?.replace(/\/+$/, "") : undefined;
  if (server && server.toLowerCase() !== "https://github.com") {
    throw new Error(`This runs on ${server}: GitHub Enterprise Server and GHE.com aren’t supported in BoxOps 0.1`);
  }
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
  } else if (o.commit !== undefined || actions) {
    const rev = o.commit ?? env.GITHUB_SHA;
    if (!rev) throw new Error("GITHUB_SHA isn’t set");
    commit = resolveCommit(o.repoDir, rev);
    folder = await readRoadmapGit(o.repoDir, commit, dir);
  } else {
    const disk = await readRoadmapDir(join(o.repoDir, dir));
    let committed: RoadmapFolder | null = null;
    let why = `${dir}/ has changes that aren’t committed`;
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

  for (const w of folder.warnings ?? []) warn(`${dir}/${w.path} ${w.message}`);
  const meta = commit ? commitInfo(o.repoDir, commit) : undefined;
  let repo = o.repository ?? env.GITHUB_REPOSITORY ?? "";
  let branch = env.GITHUB_REF_NAME ?? "";
  if (!actions && o.repository === undefined) {
    // Outside a repository (a dev server on some folder) there's nothing to name.
    const remote = commit ? localGit(o.repoDir, ["remote", "get-url", "origin"]) : "";
    const named = repoFromRemote(remote);
    repo = named && GITHUB_HOSTS.has(named.host) ? named.repo : "";
    if (commit && named && !repo) {
      warn(`origin is on ${named.host}; BoxOps 0.1 works with github.com only: source.repo is empty`);
    } else if (commit && !repo) {
      warn(`Can’t tell the repository from the origin remote${remote ? ` (${withoutCredentials(remote)})` : ""}: source.repo is empty`);
    }
  }
  if (!actions) branch = commit ? gitPlumbing(o.repoDir, "rev-parse", ["--abbrev-ref", "HEAD"]).toString().trim() : "";
  // Another repository's roadmap (a canary, a mirror) is read-only, and never taken to be public.
  const another = actions && repo.toLowerCase() !== (env.GITHUB_REPOSITORY ?? "").toLowerCase();
  const { visibility, private: isPrivate } = actions ? repoVisibility({ ...env, GITHUB_REPOSITORY: repo }) : { visibility: null, private: true };
  const source: BundleSource = {
    repo,
    branch,
    commit,
    dir,
    tree: local ? null : folder.tree,
    visibility,
    private: isPrivate,
    readonly: o.readonly === true || another,
    ...(local ? { local: true } : {}),
    author: meta?.author ?? "",
    subject: meta?.subject ?? "",
    date: meta?.date ?? "",
    history: commit ? history(o.repoDir, commit) : [],
    ...(actions && env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY
      ? { run: `${server ?? "https://github.com"}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` }
      : {}),
  };
  return assembleBundle(o.app, source, folder, { parsed: o.parsed, cache: o.parseCache });
}

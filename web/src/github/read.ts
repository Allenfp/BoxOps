// Reading the roadmap folder from GitHub when the site's roadmap.json may be
// behind (the deploy lags each save by a minute or so): on load, before every
// save, and for ?ref= branch previews.
//
// Everything is compared by git SHA, so only what changed is fetched: the
// branch head (from a URL the browser hasn't cached), its commit and root
// tree; if the roadmap folder's tree SHA is the one already known, that's
// all. Otherwise the folder is listed and only blobs with SHAs this tab
// doesn't hold are fetched, 4 at a time, through a cache kept for the whole
// session. Whether files changed is decided from those blob SHAs, never from
// the tree SHA alone: a new README in the folder changes the tree, not the
// roadmap.
//
// With a token everything goes through the API, the only way into a private
// repository (raw.githubusercontent.com takes no token). Without one BoxOps
// reads only a repository the build said is public, and fetches file
// contents from raw.githubusercontent.com to spare the 60-an-hour anonymous
// API allowance. A private repository and no token cost no requests at all:
// the reader refuses (NeedsToken).
//
// The folder is held to the build's rules (cli/git.ts): plain files only, the
// same limits, UTF-8 text with any BOM kept. The build stops on anything
// else, and so does the reader (FolderProblems). An executable roadmap file
// is read like any other, with a warning in the console, as the build warns.

import type { Bundle, BundleSource } from "../model/bundle";
import { EXECUTABLE, READ_LIMITS, isHiddenPath, isRoadmapPath } from "../model/paths";
import type { RoadmapFiles } from "../model/types";
import { type GitHubClient, GitHubFailure, type TreeItem, isBranchName } from "./api";
import { gitBlobSha, textBlobSha, utf8Text } from "./git-objects";

/** Where a snapshot came from: the bundle's fields, plus what the reader learns. */
export interface Source extends BundleSource {
  /** The first parent of `commit`, when it was read from GitHub. */
  parent?: string;
}

/** The roadmap folder at one commit. */
export interface Snapshot {
  source: Source;
  /** Roadmap files (path in the folder → text). */
  files: RoadmapFiles;
  /** Path → git blob SHA of each file in `files`. */
  blobs: Record<string, string>;
  /** The folder's other files, not read; the loader reports them as unexpected. */
  ignored: string[];
}

/** Blob fetches one read may make. More means a stale site or a mass edit: better to say so than to spend the rate limit. */
export const MAX_BLOB_FETCHES = 300;
const POOL = 4;
/** How long one read may wait out rate limits and retries. */
const RETRY_FOR_MS = 60_000;

/** More files changed than one read fetches. */
export class TooManyChanges extends Error {
  constructor(
    readonly count: number,
    readonly limit = MAX_BLOB_FETCHES,
  ) {
    super(
      `${count} roadmap files changed since this copy was loaded, more than BoxOps reads at once (${limit}). Reload once the site has redeployed.`,
    );
  }
}

/** The roadmap folder on GitHub breaks the rules the build holds it to; nothing is read until it's fixed. */
export class FolderProblems extends Error {
  constructor(
    readonly dir: string,
    readonly problems: { path: string; message: string }[],
  ) {
    super(problems.map((p) => `${p.path ? `${dir}/${p.path}` : dir}: ${p.message}`).join("\n"));
  }
}

/**
 * GitHub named a branch head older than what this tab already has (its
 * commit's parent, a commit in its history, or one it has seen), asked twice:
 * a lagging answer. Taking it would roll the screen back, and a save would
 * take it for newer saves, so the read stops; a moment later it's right.
 */
export class LaggingHead extends Error {
  constructor(readonly head: string) {
    super("GitHub’s answer is behind; try again in a few seconds.");
  }
}

/** The repository is private (or not known to be public) and there's no token: reading it would only fail. */
export class NeedsToken extends Error {
  constructor(readonly repo: string) {
    super(`${repo} is private: reading it from GitHub needs a token.`);
  }
}

/** Whether this client may read the repository: with a token, or without one only when the build said it's public. */
export const canRead = (source: Source, gh: GitHubClient) => gh.authenticated || source.private === false;

/** Blob SHA → text, for every file this tab has held; blobs never change, so entries never go stale. */
const blobCache = new Map<string, string>();

/** Keep a snapshot's files in the session's blob cache, so later reads needn't fetch them. Returns the snapshot. */
export function remember(s: Snapshot): Snapshot {
  for (const [path, sha] of Object.entries(s.blobs)) {
    const text = s.files[path];
    if (text !== undefined) blobCache.set(sha, text);
  }
  return s;
}

/** For tests: start with an empty blob cache. */
export function forgetBlobs(): void {
  blobCache.clear();
}

/** A bundle as a snapshot. A bundle from before schema 1 has no blob SHAs; they're computed from the text. */
export async function fromBundle(b: Bundle): Promise<Snapshot> {
  const blobs: Record<string, string> = {};
  for (const [path, text] of Object.entries(b.files)) blobs[path] = b.blobs[path] ?? (await textBlobSha(text));
  return { source: b.source, files: b.files, blobs, ignored: b.ignored };
}

/** Whether two snapshots hold the same roadmap files (other files in the folder don't count). */
export function sameBlobs(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

export interface ReadOptions {
  /** A branch other than base's (a preview); base's files still spare fetches. */
  branch?: string;
  /** Commits the tab has already shown or moved past: a head among them is a stale answer, read again once (LaggingHead if still). */
  seen?: ReadonlySet<string>;
}

/**
 * The roadmap folder at the tip of the branch, fetching only blobs that
 * differ from `base` (or are in the session's cache). Returns `base` itself
 * when the branch hasn't moved. Validates the branch name before any request.
 */
export async function readSnapshot(gh: GitHubClient, base: Snapshot, o: ReadOptions = {}): Promise<Snapshot> {
  const { repo, dir } = base.source;
  const branch = o.branch ?? base.source.branch;
  if (!isBranchName(branch)) throw new Error(`“${branch}” isn’t a branch name.`);
  if (!canRead(base.source, gh)) throw new NeedsToken(repo);
  const retry = retrier(gh);

  let head = await retry(() => gh.head(repo, branch));
  const behind = (sha: string) =>
    branch === base.source.branch &&
    sha !== base.source.commit &&
    (sha === base.source.parent || base.source.history.slice(1).includes(sha) || (o.seen?.has(sha) ?? false));
  // Behind what this tab already has: a lagging answer. Ask once more (each ask is a URL no cache has seen).
  if (behind(head)) head = await retry(() => gh.head(repo, branch));
  if (behind(head)) throw new LaggingHead(head);
  if (head === base.source.commit) return branch === base.source.branch ? base : { ...base, source: { ...base.source, branch } };

  const commit = await retry(() => gh.commit(repo, head));
  const tree = await findFolder(gh, retry, repo, commit.tree, dir, head);
  const { local: _local, run: _run, parent: _parent, ...kept } = base.source;
  const parent = commit.parents[0];
  const source: Source = {
    ...kept,
    branch,
    commit: head,
    tree,
    author: commit.author,
    subject: commit.message.split("\n")[0],
    date: commit.date,
    // Only the first parent is known, unless it's base's commit.
    history: parent === base.source.commit ? [head, ...base.source.history].slice(0, 50) : parent ? [head, parent] : [head],
    ...(parent ? { parent } : {}),
  };
  if (tree === base.source.tree) return { ...base, source }; // the folder didn't change

  const problems: { path: string; message: string }[] = [];
  const blobs: Record<string, string> = {};
  const ignored: string[] = [];
  let count = 0;
  let bytes = 0;
  for (const e of await listFolder(gh, retry, repo, tree, dir)) {
    if (e.type === "tree" || isHiddenPath(e.path)) continue;
    if (++count > READ_LIMITS.files) throw new FolderProblems(dir, [{ path: "", message: `holds more than ${READ_LIMITS.files.toLocaleString("en")} files` }]);
    if (e.type !== "blob" || (e.mode !== "100644" && e.mode !== "100755")) {
      const what = e.mode === "120000" ? "a symlink" : e.type === "commit" ? "a submodule" : `not a plain file (git mode ${e.mode})`;
      problems.push({ path: e.path, message: `is ${what}; a roadmap folder holds plain files only` });
    } else if (!isRoadmapPath(e.path)) {
      ignored.push(e.path);
    } else if ((e.size ?? 0) > READ_LIMITS.fileBytes) {
      problems.push({ path: e.path, message: `is ${amount(e.size ?? 0)}; a roadmap file can be at most ${amount(READ_LIMITS.fileBytes)}` });
    } else {
      bytes += e.size ?? 0;
      if (bytes > READ_LIMITS.totalBytes) throw new FolderProblems(dir, [{ path: "", message: `holds more than ${amount(READ_LIMITS.totalBytes)} of roadmap files` }]);
      blobs[e.path] = e.sha;
      if (e.mode === "100755") console.warn(`${dir}/${e.path} ${EXECUTABLE}`);
    }
  }
  if (problems.length) throw new FolderProblems(dir, problems);

  const got: RoadmapFiles = {};
  const todo: string[] = [];
  for (const [path, sha] of Object.entries(blobs)) {
    const known = base.blobs[path] === sha ? base.files[path] : blobCache.get(sha);
    if (known !== undefined) got[path] = known;
    else todo.push(path);
  }
  if (todo.length > MAX_BLOB_FETCHES) throw new TooManyChanges(todo.length);
  await pool(todo, async (path) => {
    const sha = blobs[path];
    const data = await retry(() => (gh.authenticated ? gh.blob(repo, sha) : gh.rawFile(repo, head, `${dir}/${path}`)));
    const text = utf8Text(data);
    if ((await gitBlobSha(data)) !== sha) problems.push({ path, message: `doesn’t match its git object id ${sha}` });
    else if (text === null) problems.push({ path, message: "isn’t UTF-8 text" });
    else got[path] = text;
  });
  if (problems.length) throw new FolderProblems(dir, problems);
  // In path order, like the bundle, so the same files always serialize the same way.
  const files: RoadmapFiles = {};
  for (const path of Object.keys(blobs).sort()) files[path] = got[path];
  return remember({ source, files, blobs, ignored });
}

const amount = (bytes: number) =>
  bytes < 1024 ? `${bytes} bytes` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

type Retry = <T>(call: () => Promise<T>) => Promise<T>;

/** The roadmap folder's tree SHA, from the root tree down `dir`'s parts. */
async function findFolder(gh: GitHubClient, retry: Retry, repo: string, root: string, dir: string, commit: string): Promise<string> {
  let sha = root;
  for (const name of dir.split("/")) {
    const { items } = await retry(() => gh.tree(repo, sha, false));
    const e = items.find((i) => i.path === name);
    if (!e) throw new FolderProblems(dir, [{ path: "", message: `isn’t in commit ${commit.slice(0, 12)}` }]);
    if (e.type !== "tree") {
      throw new FolderProblems(dir, [{ path: "", message: `is ${e.type === "commit" ? "a submodule" : "a file or a symlink"}, not a folder` }]);
    }
    sha = e.sha;
  }
  return sha;
}

/** Everything under a tree, paths relative to it. GitHub truncates big recursive listings; then it's walked a folder at a time. */
async function listFolder(gh: GitHubClient, retry: Retry, repo: string, sha: string, dir: string): Promise<TreeItem[]> {
  const all = await retry(() => gh.tree(repo, sha, true));
  if (!all.truncated) return all.items;
  const out: TreeItem[] = [];
  const walk = async (tree: string, prefix: string) => {
    const level = await retry(() => gh.tree(repo, tree, false));
    if (level.truncated) throw new FolderProblems(dir, [{ path: prefix.slice(0, -1), message: "holds too many files for GitHub to list" }]);
    for (const e of level.items) {
      const path = prefix + e.path;
      if (e.type !== "tree") out.push({ ...e, path });
      else if (!isHiddenPath(path)) await walk(e.sha, `${path}/`);
    }
  };
  await walk(sha, "");
  return out;
}

/**
 * Runs a read's GETs with retries, within a minute in all: a rate limit is
 * waited out (retry-after, or until the hourly reset), pausing every call of
 * the read; a 5xx or a timeout is retried once.
 */
function retrier(gh: GitHubClient): Retry {
  const deadline = gh.now() + RETRY_FOR_MS;
  let pausedUntil = 0;
  return async (call) => {
    for (let attempt = 0; ; attempt++) {
      const wait = pausedUntil - gh.now();
      if (wait > 0) await gh.sleep(wait);
      try {
        return await call();
      } catch (e) {
        const delay = retryDelay(e, attempt, gh.now());
        if (delay === null || gh.now() + delay > deadline) throw e;
        pausedUntil = Math.max(pausedUntil, gh.now() + delay);
      }
    }
  };
}

function retryDelay(e: unknown, attempt: number, now: number): number | null {
  if (!(e instanceof GitHubFailure) || attempt >= 3) return null;
  if (e.kind === "rate-limited") {
    if (e.detail.retryAfter !== undefined) return e.detail.retryAfter * 1000;
    if (e.detail.resetAt !== undefined) return Math.max(0, e.detail.resetAt - now) + 1000;
    return null;
  }
  return (e.kind === "server" || e.kind === "timeout") && attempt === 0 ? 1000 : null;
}

/** Runs `each` over the items, POOL at a time; the first failure stops the rest from starting and is thrown. */
async function pool<T>(items: T[], each: (item: T) => Promise<void>): Promise<void> {
  const state: { next: number; failed: boolean; error?: unknown } = { next: 0, failed: false };
  const worker = async () => {
    while (!state.failed && state.next < items.length) {
      const item = items[state.next++];
      try {
        await each(item);
      } catch (error) {
        if (!state.failed) Object.assign(state, { failed: true, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, items.length) }, worker));
  if (state.failed) throw state.error;
}

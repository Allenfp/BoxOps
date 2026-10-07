// Reads a roadmap folder for the build and the command-line tools. Node-only.
//
// - readRoadmapGit: from a repository's git objects at a commit. Production
//   builds and CI use it, so the site holds exactly what was committed, never
//   something the checkout added (a symlink to a secret, a filter's output).
//   Git runs hardened and as plumbing only (rev-parse, cat-file, ls-tree): no
//   hooks, filters, textconv or fsmonitor, no system or global configuration,
//   no fetching of objects a partial clone lacks, never a prompt; and it's the
//   git in PATH's absolute folders, run in the .git folder, never a `git`
//   committed to the repository.
// - readRoadmapDir: from a folder on disk, with lstat, so a symlink is never
//   followed. The dev server and `npm run validate`/`report` use it.
//
// Both apply one policy. Hidden paths (a part starting with ".") are skipped,
// whatever they are, symlinks and submodules included. Every other entry must
// be a plain file (git modes 100644 and 100755; an executable roadmap file is
// read with a warning, as the app's reader does): a symlink, a submodule or
// anything else is an error naming it. Only git can see a submodule, though:
// on disk it's a folder, walked like any other (its .git is hidden), and an
// empty one if it isn't checked out. Roadmap files (model/paths.ts) are
// read; other files are listed as `ignored`. Limits: 20,000 files, 1 MiB per
// roadmap file, 64 MiB in all. Text must be UTF-8; a BOM is kept, so a file's
// text hashes to its git blob SHA.

import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { gitBlobSha } from "../src/github/git-objects.ts";
import type { RoadmapFolder } from "../src/model/bundle.ts";
import { EXECUTABLE, READ_LIMITS, isHiddenPath, isRoadmapPath } from "../src/model/paths.ts";
import type { RoadmapFiles } from "../src/model/types.ts";

/** READ_LIMITS, changeable only so tests can reach them. */
export const LIMITS = { ...READ_LIMITS };

export interface ReadProblem {
  /** Relative to the roadmap folder; "" for the folder itself. */
  path: string;
  message: string;
}

/** The roadmap folder can't be read as it is: never build or check it until these are fixed. */
export class RoadmapReadError extends Error {
  constructor(
    /** The folder, as the reader was given it ("roadmap" in a repository, or a path on disk). */
    readonly dir: string,
    readonly problems: ReadProblem[],
  ) {
    super(problems.map((p) => `${p.path ? `${dir}/${p.path}` : dir}: ${p.message}`).join("\n"));
  }
}

const SHA = /^[0-9a-f]{40}$/;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const amount = (bytes: number) =>
  bytes < 1024 ? `${bytes} bytes` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

type EntryKind = "file" | "symlink" | "submodule" | "other";

/** The shared policy: what to do with each entry a reader finds, plus the limits. */
class Triage {
  readonly problems: ReadProblem[] = [];
  readonly ignored: string[] = [];
  private files = 0;
  private bytes = 0;

  constructor(private dir: string) {}

  /** True if the reader should read this file. */
  take(path: string, kind: EntryKind, size: number, detail = ""): boolean {
    if (isHiddenPath(path)) return false;
    if (++this.files > LIMITS.files) {
      throw new RoadmapReadError(this.dir, [{ path: "", message: `holds more than ${LIMITS.files.toLocaleString("en")} files` }]);
    }
    if (kind !== "file") {
      const what = kind === "symlink" ? "a symlink" : kind === "submodule" ? "a submodule" : `not a plain file${detail}`;
      this.problems.push({ path, message: `is ${what}; a roadmap folder holds plain files only` });
      return false;
    }
    if (!isRoadmapPath(path)) {
      this.ignored.push(path);
      return false;
    }
    if (size > LIMITS.fileBytes) {
      this.problems.push({ path, message: `is ${amount(size)}; a roadmap file can be at most ${amount(LIMITS.fileBytes)}` });
      return false;
    }
    this.bytes += size;
    if (this.bytes > LIMITS.totalBytes) {
      throw new RoadmapReadError(this.dir, [{ path: "", message: `holds more than ${amount(LIMITS.totalBytes)} of roadmap files` }]);
    }
    return true;
  }

  /** The text of a file read as bytes, or a problem if it isn't UTF-8. */
  decode(path: string, bytes: Uint8Array): string | undefined {
    try {
      return strictUtf8.decode(bytes);
    } catch {
      this.problems.push({ path, message: "isn’t UTF-8 text" });
      return undefined;
    }
  }

  check(): void {
    if (this.problems.length) throw new RoadmapReadError(this.dir, this.problems);
  }
}

// --- Git ---------------------------------------------------------------------

type Plumbing = "rev-parse" | "cat-file" | "ls-tree";

/**
 * PATH's absolute folders alone, for git to be found in. A program is looked
 * for in the folder it runs in, and a relative folder on PATH (`.`,
 * `node_modules/.bin`, or an empty entry, which means `.`) would be one of
 * the repository's, where anyone who can push could have committed a `git`.
 */
export const absolutePath = (path = process.env.PATH ?? ""): string =>
  path
    .split(delimiter)
    .filter((p) => p !== "" && isAbsolute(p))
    .join(delimiter);

/** The caller's environment without any GIT_* variable (GIT_DIR, GIT_CONFIG_*, …) or relative folder on PATH, plus the hardening. */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // PATH whatever its case (Windows' is Path), given again below.
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("GIT_") && key.toUpperCase() !== "PATH") env[key] = value;
  // GIT_NO_LAZY_FETCH (git 2.44 and later): a partial clone never fetches a missing object from its remote (a
  // network call, with the repository's remote and credential config) to answer. Older git ignores it without a
  // word; protocol.allow=never (gitPlumbing) stops the fetch there.
  return {
    ...env,
    PATH: absolutePath(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
  };
}

/**
 * The repository's own .git folder; a .git file (a worktree or submodule
 * checkout) or a symlink is refused. With `checkout`, a .git file that names
 * a git folder (`gitdir: …`, as `git worktree add` writes) is followed: only
 * for what identifies the app being built, never for roadmap data.
 */
function gitDir(repo: string, checkout = false): string {
  const dir = join(repo, ".git");
  let st;
  try {
    st = lstatSync(dir);
  } catch {
    throw new Error(`${repo} isn’t a git repository (it has no .git folder)`);
  }
  if (checkout && st.isFile() && st.size < 4096) {
    const target = /^gitdir: (.+)$/.exec(readFileSync(dir, "utf8").trim())?.[1];
    const real = target === undefined ? undefined : resolve(repo, target);
    if (real && lstatSync(real, { throwIfNoEntry: false })?.isDirectory()) return real;
  }
  if (!st.isDirectory()) {
    const what = st.isSymbolicLink() ? "a symlink" : "a file (a worktree or submodule checkout)";
    throw new Error(`${dir} is ${what}; BoxOps reads only a repository’s own .git folder`);
  }
  return dir;
}

/** `checkout`: the repository may be a worktree's checkout (see gitDir); for the app's build id only. */
export interface GitOptions {
  checkout?: boolean;
}

/**
 * Runs one plumbing command against the repository whose top level is `repo`;
 * returns its output. git runs in the .git folder, which no commit can put a
 * file in (Windows looks for a program in the folder it runs in first, and
 * PATH may name relative folders: see absolutePath).
 */
export function gitPlumbing(
  repo: string,
  command: Plumbing,
  args: string[],
  o: { input?: string; maxBuffer?: number } & GitOptions = {},
): Buffer {
  const dir = gitDir(repo, o.checkout);
  // No transport at all: plumbing never needs one, and a lazy fetch (see gitEnv) inherits this.
  const argv = ["--git-dir", dir, "-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never", command, ...args];
  try {
    return execFileSync("git", argv, { cwd: dir, env: gitEnv(), input: o.input, maxBuffer: o.maxBuffer ?? 1024 * 1024, stdio: "pipe" });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: Buffer };
    if (err.code === "ENOENT") {
      throw new Error("git isn’t installed; BoxOps needs git 2.18 or later (without it, actions/checkout downloads a tarball with no .git)");
    }
    if (err.code === "ENOBUFS") throw new Error(`git ${command}: more output than BoxOps reads`);
    throw new Error(`git ${command} ${args.join(" ")}: ${err.stderr?.toString().trim() || err.message}`);
  }
}

/** The full SHA of a commit (`rev`: HEAD, a branch or a SHA). */
export function resolveCommit(repo: string, rev: string, o: GitOptions = {}): string {
  if (rev.startsWith("-")) throw new Error(`"${rev}" isn’t a commit`);
  const sha = gitPlumbing(repo, "rev-parse", ["--verify", `${rev}^{commit}`], o).toString().trim();
  if (!SHA.test(sha)) throw new Error(`${rev} is ${sha}: BoxOps reads SHA-1 repositories only`);
  return sha;
}

export interface CommitInfo {
  tree: string;
  parents: string[];
  /** The author's name. */
  author: string;
  /** Committer date, ISO 8601 in UTC. */
  date: string;
  /** The message's first paragraph on one line, as `git log --format=%s` shows it. */
  subject: string;
}

/** A commit object, read with `git cat-file commit`. */
export function readCommit(repo: string, sha: string, o: GitOptions = {}): CommitInfo {
  const raw = gitPlumbing(repo, "cat-file", ["commit", sha], o).toString("utf8");
  const end = raw.indexOf("\n\n");
  const info: CommitInfo = { tree: "", parents: [], author: "", date: "", subject: "" };
  // Headers; a line starting with a space continues the one before (a signature).
  for (const line of (end < 0 ? raw : raw.slice(0, end)).split("\n")) {
    const [key] = line.split(" ", 1);
    const value = line.slice(key.length + 1);
    if (key === "tree") info.tree = value;
    else if (key === "parent") info.parents.push(value);
    else if (key === "author") info.author = /^(.*?) <[^>]*>/.exec(value)?.[1] ?? "";
    else if (key === "committer") {
      const seconds = /> (\d+) [+-]\d{4}$/.exec(value)?.[1];
      if (seconds) info.date = new Date(Number(seconds) * 1000).toISOString().replace(".000Z", "Z");
    }
  }
  const message = end < 0 ? "" : raw.slice(end + 2);
  info.subject = message.trim().split(/\n[ \t]*\n/)[0].split("\n").map((l) => l.trim()).join(" ");
  return info;
}

/**
 * `sha` and up to `max - 1` of its first parents, newest first. Stops early in
 * a shallow clone, after the first parent whose commit isn't there.
 */
export function firstParents(repo: string, sha: string, max = 50): string[] {
  const history = [sha];
  while (history.length < max) {
    let parent: string | undefined;
    try {
      parent = readCommit(repo, history[history.length - 1]).parents[0];
    } catch {
      break;
    }
    if (!parent) break;
    history.push(parent);
  }
  return history;
}

const DIR = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
/** A path in the repository BoxOps names: DIR's characters, and no "." or ".." part. */
const isPlainPath = (path: string) => DIR.test(path) && !path.split("/").some((p) => p === "." || p === "..");

/** Splits `ls-tree -z` output into records. */
function records(out: Buffer): Buffer[] {
  const list: Buffer[] = [];
  for (let at = 0; at < out.length; ) {
    const nul = out.indexOf(0, at);
    const end = nul < 0 ? out.length : nul;
    if (end > at) list.push(out.subarray(at, end));
    at = end + 1;
  }
  return list;
}

/**
 * The roadmap folder `dir` (a path in the repository) at `commit`, from git
 * objects. Throws RoadmapReadError if the folder breaks the policy above.
 */
export async function readRoadmapGit(repo: string, commit: string, dir = "roadmap"): Promise<RoadmapFolder> {
  if (!isPlainPath(dir)) {
    throw new Error(`"${dir}" isn’t a folder BoxOps reads: letters, digits, ".", "_" and "-", in parts separated by "/"`);
  }
  if (!SHA.test(commit)) throw new Error(`"${commit}" isn’t a full commit SHA`);
  gitDir(repo);
  const at = `${commit}:${dir}`;
  let type: string;
  try {
    type = gitPlumbing(repo, "cat-file", ["-t", at]).toString().trim();
  } catch {
    // A submodule's commit is in its own repository, not this one: only the tree says what's there.
    const entry = gitPlumbing(repo, "ls-tree", [commit, "--", dir]).toString("latin1");
    const message = entry.startsWith("160000 ") ? "is a submodule, not a folder" : `isn’t in commit ${commit.slice(0, 12)}`;
    throw new RoadmapReadError(dir, [{ path: "", message }]);
  }
  if (type !== "tree") {
    // A symlinked folder is a blob; a submodule is a commit.
    const what = type === "commit" ? "a submodule" : "a file or a symlink";
    throw new RoadmapReadError(dir, [{ path: "", message: `is ${what}, not a folder` }]);
  }
  const tree = gitPlumbing(repo, "rev-parse", ["--verify", at]).toString().trim();
  if (!SHA.test(tree)) throw new Error(`${dir} is ${tree}: BoxOps reads SHA-1 repositories only`);

  // "<mode> <type> <sha> <size>\t<path>" per file, paths relative to the folder.
  const listing = gitPlumbing(repo, "ls-tree", ["-r", "-z", "-l", tree], { maxBuffer: 64 * 1024 * 1024 });
  const triage = new Triage(dir);
  const wanted: { path: string; sha: string; size: number }[] = [];
  const warnings: ReadProblem[] = [];
  for (const record of records(listing)) {
    const tab = record.indexOf(9); // the first tab: a path may hold tabs too
    if (tab < 0) throw new Error(`git ls-tree printed "${record.toString("latin1")}"`);
    const [mode, kind, sha, size] = record.subarray(0, tab).toString("latin1").trim().split(/ +/);
    let path: string;
    try {
      path = strictUtf8.decode(record.subarray(tab + 1));
    } catch {
      triage.problems.push({ path: record.subarray(tab + 1).toString("utf8"), message: "has a name that isn’t UTF-8" });
      continue;
    }
    const entry: EntryKind =
      kind === "blob" && (mode === "100644" || mode === "100755")
        ? "file"
        : mode === "120000"
          ? "symlink"
          : mode === "160000"
            ? "submodule"
            : "other";
    if (triage.take(path, entry, Number(size), ` (git mode ${mode})`)) {
      // ls-tree can't size a blob the clone lacks (git 2.44 and later say so; older git fails to fetch it).
      if (!/^\d+$/.test(size)) {
        throw new Error(`${dir}/${path} isn’t in this clone (a partial clone?), and BoxOps never fetches what a clone lacks: clone without --filter`);
      }
      wanted.push({ path, sha, size: Number(size) });
      if (mode === "100755") warnings.push({ path, message: EXECUTABLE });
    }
  }

  // One process for every blob: "<sha> blob <size>\n<bytes>\n" each.
  const files: RoadmapFiles = {};
  const blobs: Record<string, string> = {};
  if (wanted.length) {
    const out = gitPlumbing(repo, "cat-file", ["--batch"], {
      input: wanted.map((w) => w.sha).join("\n") + "\n",
      maxBuffer: wanted.reduce((n, w) => n + w.size + 64, 1024),
    });
    let pos = 0;
    for (const w of wanted) {
      const nl = out.indexOf(10, pos);
      const header = out.subarray(pos, nl < 0 ? out.length : nl).toString("latin1");
      if (nl < 0 || header !== `${w.sha} blob ${w.size}`) {
        throw new Error(`git cat-file answered "${header}" for ${dir}/${w.path} (${w.sha})`);
      }
      const bytes = out.subarray(nl + 1, nl + 1 + w.size);
      pos = nl + 1 + w.size + 1;
      if ((await gitBlobSha(bytes)) !== w.sha) {
        triage.problems.push({ path: w.path, message: `doesn’t match its git object id ${w.sha} (a damaged repository?)` });
        continue;
      }
      const text = triage.decode(w.path, bytes);
      if (text === undefined) continue;
      files[w.path] = text;
      blobs[w.path] = w.sha;
    }
  }
  triage.check();
  return { files, blobs, ignored: triage.ignored, tree, ...(warnings.length && { warnings }) };
}

/**
 * The plain files directly in folder `dir` (a path from the repository's top
 * level) at `commit`, by path from the top level; [] if there's no such
 * folder. A symlink, submodule or subfolder is left out.
 */
export function listCommitFolder(repo: string, commit: string, dir: string): string[] {
  if (!SHA.test(commit) || !isPlainPath(dir)) throw new Error(`can’t list "${dir}" at "${commit}"`);
  const out = gitPlumbing(repo, "ls-tree", ["-z", commit, "--", `${dir}/`], { maxBuffer: 4 * 1024 * 1024 });
  const paths: string[] = [];
  for (const record of records(out)) {
    const tab = record.indexOf(9);
    const [mode, kind] = record.subarray(0, tab).toString("latin1").split(" ");
    const path = record.subarray(tab + 1).toString("utf8");
    if (kind === "blob" && (mode === "100644" || mode === "100755")) paths.push(path);
  }
  return paths.sort();
}

/**
 * Small text files at `commit`, by path from the repository's top level: what
 * the action reads besides the roadmap (workflows, the launcher, AGENTS.md),
 * only to warn. A path that isn't there or isn't a plain file (a symlink, a
 * submodule, a folder), a file over `maxBytes`, or one that isn't UTF-8 is
 * left out. Each blob is checked against its SHA.
 */
export async function readCommitFiles(repo: string, commit: string, paths: string[], maxBytes = 1024 * 1024): Promise<Record<string, string>> {
  if (!SHA.test(commit)) throw new Error(`"${commit}" isn’t a full commit SHA`);
  const wanted = new Set(paths.filter(isPlainPath));
  if (!wanted.size) return {};
  const listing = gitPlumbing(repo, "ls-tree", ["-z", "-l", commit, "--", ...wanted], { maxBuffer: 4 * 1024 * 1024 });
  const blobs: { path: string; sha: string; size: number }[] = [];
  for (const record of records(listing)) {
    const tab = record.indexOf(9);
    const [mode, kind, sha, size] = record.subarray(0, tab).toString("latin1").trim().split(/ +/);
    const path = record.subarray(tab + 1).toString("utf8");
    if (wanted.has(path) && kind === "blob" && (mode === "100644" || mode === "100755") && /^\d+$/.test(size) && Number(size) <= maxBytes) {
      blobs.push({ path, sha, size: Number(size) });
    }
  }
  const files: Record<string, string> = {};
  if (!blobs.length) return files;
  const out = gitPlumbing(repo, "cat-file", ["--batch"], {
    input: blobs.map((b) => b.sha).join("\n") + "\n",
    maxBuffer: blobs.reduce((n, b) => n + b.size + 64, 1024),
  });
  let pos = 0;
  for (const b of blobs) {
    const nl = out.indexOf(10, pos);
    if (nl < 0 || out.subarray(pos, nl).toString("latin1") !== `${b.sha} blob ${b.size}`) break;
    const bytes = out.subarray(nl + 1, nl + 1 + b.size);
    pos = nl + 1 + b.size + 1;
    if ((await gitBlobSha(bytes)) !== b.sha) continue;
    try {
      files[b.path] = strictUtf8.decode(bytes);
    } catch {
      // Not text: nothing to read in it.
    }
  }
  return files;
}

// --- Disk --------------------------------------------------------------------

/** A file's bytes, refusing to follow a symlink that appeared since it was listed. */
function readPlainFile(full: string): Buffer {
  const fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error("not a plain file");
    const bytes = Buffer.alloc(Math.min(st.size, LIMITS.fileBytes + 1));
    let n = 0;
    while (n < bytes.length) {
      const got = readSync(fd, bytes, n, bytes.length - n, null);
      if (got === 0) break;
      n += got;
    }
    return bytes.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

/**
 * The roadmap folder at `dir` on disk, read with lstat: a symlink anywhere
 * (the folder itself included) is an error, never followed. `tree` is null:
 * files on disk needn't be any commit's. Throws RoadmapReadError if the
 * folder breaks the policy above.
 */
export async function readRoadmapDir(dir: string): Promise<RoadmapFolder> {
  let root;
  try {
    root = lstatSync(dir);
  } catch {
    throw new RoadmapReadError(dir, [{ path: "", message: "doesn’t exist" }]);
  }
  if (root.isSymbolicLink()) throw new RoadmapReadError(dir, [{ path: "", message: "is a symlink; give the folder it points to" }]);
  if (!root.isDirectory()) throw new RoadmapReadError(dir, [{ path: "", message: "isn’t a folder" }]);

  const triage = new Triage(dir);
  const read: { path: string; bytes: Buffer }[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      // Hidden entries aren't even looked at (editors' lock files are often symlinks).
      if (name.startsWith(".")) continue;
      const path = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(dir, path));
      if (st.isDirectory()) {
        walk(path);
        continue;
      }
      if (!triage.take(path, st.isFile() ? "file" : st.isSymbolicLink() ? "symlink" : "other", st.size)) continue;
      try {
        const bytes = readPlainFile(join(dir, path));
        if (bytes.length > LIMITS.fileBytes) {
          triage.problems.push({ path, message: `is over ${amount(LIMITS.fileBytes)}; a roadmap file can be at most that` });
        } else read.push({ path, bytes });
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        triage.problems.push({ path, message: code === "ELOOP" ? "is a symlink; a roadmap folder holds plain files only" : `can’t be read (${code ?? (e as Error).message})` });
      }
    }
  };
  walk("");

  const files: RoadmapFiles = {};
  const blobs: Record<string, string> = {};
  for (const { path, bytes } of read) {
    const text = triage.decode(path, bytes);
    if (text === undefined) continue;
    files[path] = text;
    blobs[path] = await gitBlobSha(bytes);
  }
  triage.check();
  return { files, blobs, ignored: triage.ignored, tree: null };
}

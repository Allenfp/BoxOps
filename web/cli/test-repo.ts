// Throwaway git repositories for unit tests, made with the git CLI in the
// system's temp folder. Commits are built from exact tree entries (so a test
// can commit a symlink, an executable, a submodule or bytes that aren't UTF-8
// without touching the disk), with fixed authors and dates. Every git call
// gets a fixed identity, so no test depends on what git guesses from the host
// (a runner whose hostname has no domain makes git refuse to commit).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

/** A file's content, or an entry with an explicit git mode (a submodule names a commit). */
export type Entry = string | Uint8Array | { mode: "100644" | "100755" | "120000"; content: string | Uint8Array } | { mode: "160000"; sha: string };

/** 2026-10-01T00:00:00Z: commit n is made n minutes later. */
const T0 = Date.UTC(2026, 9, 1) / 1000;

/** Who and when, for a commit made without commit()'s own. */
const IDENTITY = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_AUTHOR_DATE: `${T0} +0000`,
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_COMMITTER_DATE: `${T0} +0000`,
};

export class TestRepo {
  readonly dir: string;
  /** main's commit, once there is one. */
  private main: string | undefined;
  private n = 0;

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), "boxops-test-"));
    this.git(["init", "-q", "-b", "main"]);
  }

  /** git in the repo, with no system or global configuration and a fixed identity; stdout, trimmed. */
  git(args: string[], o: { input?: string | Uint8Array; env?: Record<string, string> } = {}): string {
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", ...IDENTITY, ...o.env };
    return execFileSync("git", args, { cwd: this.dir, env, input: o.input, stdio: "pipe" }).toString().trim();
  }

  /** Stores a blob as a loose object, as `git hash-object -w` would (without a process per file); returns its SHA. */
  blob(content: string | Uint8Array): string {
    const body = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
    const object = Buffer.concat([Buffer.from(`blob ${body.length}\0`), body]);
    const sha = createHash("sha1").update(object).digest("hex");
    const file = join(this.dir, ".git", "objects", sha.slice(0, 2), sha.slice(2));
    if (!existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, deflateSync(object), { mode: 0o444 });
    }
    return sha;
  }

  /**
   * Commits exactly these entries (path → entry) on top of `parents` (default:
   * the current main, if any) and moves main there. Returns the commit SHA.
   */
  commit(entries: Record<string, Entry>, message = `Commit ${this.n + 1}`, parents?: string[], author = "Sam Lee"): string {
    const index = join(this.dir, ".git", "test-index");
    rmSync(index, { force: true });
    const records = Object.entries(entries).map(([path, e]) => {
      const { mode, sha } =
        typeof e === "string" || e instanceof Uint8Array
          ? { mode: "100644", sha: this.blob(e) }
          : e.mode === "160000"
            ? e
            : { mode: e.mode, sha: this.blob(e.content) };
      return `${mode} ${sha}\t${path}\0`;
    });
    this.git(["update-index", "-z", "--index-info"], { input: records.join(""), env: { GIT_INDEX_FILE: index } });
    const tree = this.git(["write-tree"], { env: { GIT_INDEX_FILE: index } });
    const time = `${T0 + 60 * ++this.n} +0000`;
    const env = {
      GIT_AUTHOR_NAME: author,
      GIT_AUTHOR_EMAIL: "sam@example.com",
      GIT_AUTHOR_DATE: time,
      GIT_COMMITTER_NAME: "GitHub",
      GIT_COMMITTER_EMAIL: "noreply@github.com",
      GIT_COMMITTER_DATE: time,
    };
    const head = parents ?? (this.main ? [this.main] : []);
    const commit = this.git(["commit-tree", tree, ...head.flatMap((p) => ["-p", p]), "-m", message], { env });
    this.git(["update-ref", "refs/heads/main", commit]);
    this.main = commit;
    return commit;
  }

  /** Writes files into the working tree. */
  write(files: Record<string, string | Uint8Array>): void {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(this.dir, path)), { recursive: true });
      writeFileSync(join(this.dir, path), content);
    }
  }

  /** Checks HEAD out into the working tree. */
  checkout(): void {
    this.git(["reset", "-q", "--hard", "HEAD"]);
  }

  remove(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

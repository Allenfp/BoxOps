import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS, RoadmapReadError, firstParents, listCommitFolder, readCommit, readCommitFiles, readRoadmapDir, readRoadmapGit, resolveCommit } from "./git";
import { EXECUTABLE } from "../src/model/paths";
import { type Entry, TestRepo } from "./test-repo";

// Most tests make a repository and read it with git, some many times: up to a second on a quiet
// machine, and several times that under load, near or past vitest's 5.
vi.setConfig({ testTimeout: 30_000 });

const repos: TestRepo[] = [];
const temps: string[] = [];
const saved = { ...LIMITS };
afterEach(() => {
  for (const r of repos.splice(0)) r.remove();
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
  Object.assign(LIMITS, saved);
});

/** A repo whose main holds these entries under roadmap/ (plus a README outside it). */
function repoWith(entries: Record<string, Entry>): { repo: TestRepo; commit: string } {
  const repo = new TestRepo();
  repos.push(repo);
  const commit = repo.commit({ "README.md": "outside\n", ...Object.fromEntries(Object.entries(entries).map(([p, e]) => [`roadmap/${p}`, e])) });
  return { repo, commit };
}

const read = ({ repo, commit }: { repo: TestRepo; commit: string }) => readRoadmapGit(repo.dir, commit);

/** The problems a read throws, as "path: message". */
async function problems(reading: Promise<unknown>): Promise<string[]> {
  try {
    await reading;
  } catch (e) {
    if (e instanceof RoadmapReadError) return e.problems.map((p) => `${p.path}: ${p.message}`);
    throw e;
  }
  throw new Error("read without a problem");
}

const ROADMAP = { "settings.yaml": "format: 1\n", "people.yaml": "people: []\n", "boxes/b1.yaml": "id: b1\n" };
const NOT_UTF8 = Uint8Array.from([0x69, 0x64, 0x3a, 0x20, 0xe9, 0x0a]); // "id: é" in Latin-1

describe("readRoadmapGit", () => {
  it("reads the roadmap files with their blob SHAs and the folder's tree; lists other files, skips hidden ones", async () => {
    const r = repoWith({
      ...ROADMAP,
      "departments/eng.yml": "id: eng\n",
      "boxes/run.yaml": { mode: "100755", content: "id: run\n" }, // executable: still data
      "NOTES.md": "notes\n",
      "boxes/sub/b2.yaml": "id: b2\n",
      ".gitkeep": "",
      "boxes/.#b1.yaml": { mode: "120000", content: "sam@laptop.1234" }, // an editor's lock file
      ".github/x": { mode: "160000", sha: "1".repeat(40) },
    });
    const folder = await read(r);
    expect(folder.files).toEqual({ ...ROADMAP, "departments/eng.yml": "id: eng\n", "boxes/run.yaml": "id: run\n" });
    expect(folder.ignored).toEqual(["NOTES.md", "boxes/sub/b2.yaml"]);
    expect(folder.tree).toBe(r.repo.git(["rev-parse", `${r.commit}:roadmap`]));
    for (const path of Object.keys(folder.files)) {
      expect(folder.blobs[path]).toBe(r.repo.git(["rev-parse", `${r.commit}:roadmap/${path}`]));
    }
    expect(folder.warnings).toEqual([{ path: "boxes/run.yaml", message: EXECUTABLE }]);
  });

  it("keeps a BOM and CRLF line ends, so the text hashes to the blob SHA", async () => {
    const text = "\uFEFFformat: 1\r\n";
    const r = repoWith({ "settings.yaml": text });
    const folder = await read(r);
    expect(folder.files["settings.yaml"]).toBe(text);
    expect(folder.blobs["settings.yaml"]).toBe(r.repo.blob(text));
  });

  it("refuses symlinks and submodules anywhere but hidden paths, naming each", async () => {
    const r = repoWith({
      ...ROADMAP,
      "boxes/b2.yaml": { mode: "120000", content: "../../.git/config" },
      "NOTES.md": { mode: "120000", content: "/etc/passwd" },
      "departments": { mode: "120000", content: "../elsewhere" }, // a symlinked folder is a blob
      "boxes/vendor": { mode: "160000", sha: "2".repeat(40) },
    });
    expect(await problems(read(r))).toEqual([
      "NOTES.md: is a symlink; a roadmap folder holds plain files only",
      "boxes/b2.yaml: is a symlink; a roadmap folder holds plain files only",
      "boxes/vendor: is a submodule; a roadmap folder holds plain files only",
      "departments: is a symlink; a roadmap folder holds plain files only",
    ]);
  });

  it("refuses a roadmap folder that's a symlink, a submodule or missing", async () => {
    const repo = new TestRepo();
    repos.push(repo);
    const link = repo.commit({ roadmap: { mode: "120000", content: "/etc" } });
    expect(await problems(readRoadmapGit(repo.dir, link))).toEqual([": is a file or a symlink, not a folder"]);
    const sub = repo.commit({ roadmap: { mode: "160000", sha: link } });
    expect(await problems(readRoadmapGit(repo.dir, sub))).toEqual([": is a submodule, not a folder"]);
    // As usual, the submodule's commit isn't in this repository.
    const elsewhere = repo.commit({ roadmap: { mode: "160000", sha: "5".repeat(40) } });
    expect(await problems(readRoadmapGit(repo.dir, elsewhere))).toEqual([": is a submodule, not a folder"]);
    const none = repo.commit({ "other/settings.yaml": "x\n" });
    expect(await problems(readRoadmapGit(repo.dir, none))).toEqual([`: isn’t in commit ${none.slice(0, 12)}`]);
    await expect(readRoadmapGit(repo.dir, none, "../roadmap")).rejects.toThrow("isn’t a folder BoxOps reads");
    await expect(readRoadmapGit(repo.dir, "HEAD")).rejects.toThrow("isn’t a full commit SHA");
  });

  it("reads only a repository's own .git folder", async () => {
    const r = repoWith(ROADMAP);
    const other = mkdtempSync(join(tmpdir(), "boxops-test-"));
    temps.push(other);
    writeFileSync(join(other, ".git"), `gitdir: ${join(r.repo.dir, ".git")}\n`); // a worktree or submodule checkout
    await expect(readRoadmapGit(other, r.commit)).rejects.toThrow("is a file (a worktree or submodule checkout)");
    rmSync(join(other, ".git"));
    symlinkSync(join(r.repo.dir, ".git"), join(other, ".git"));
    await expect(readRoadmapGit(other, r.commit)).rejects.toThrow("is a symlink");
    rmSync(join(other, ".git"));
    await expect(readRoadmapGit(other, r.commit)).rejects.toThrow("isn’t a git repository");
  });

  it("ignores GIT_* variables in its environment (GIT_DIR can't point it elsewhere)", async () => {
    const r = repoWith(ROADMAP);
    const decoy = repoWith({ "settings.yaml": "format: 99\n" });
    const before = process.env.GIT_DIR;
    process.env.GIT_DIR = join(decoy.repo.dir, ".git");
    try {
      expect((await read(r)).files["settings.yaml"]).toBe("format: 1\n");
    } finally {
      if (before === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = before;
    }
  });

  it("never fetches what a partial clone lacks, even with a git older than 2.44 (which ignores GIT_NO_LAZY_FETCH)", async () => {
    const r = repoWith(ROADMAP);
    r.repo.git(["config", "uploadpack.allowFilter", "true"]);
    const clone = mkdtempSync(join(tmpdir(), "boxops-test-"));
    temps.push(clone);
    r.repo.git(["clone", "-q", "--no-checkout", "--filter=blob:none", `file://${r.repo.dir}`, clone]);
    const blob = r.repo.git(["rev-parse", `${r.commit}:roadmap/settings.yaml`]);
    const missing = () => {
      try {
        r.repo.git(["-C", clone, "cat-file", "-e", blob], { env: { GIT_NO_LAZY_FETCH: "1" } });
        return false;
      } catch {
        return true;
      }
    };
    expect(missing()).toBe(true);
    await expect(readRoadmapGit(clone, r.commit)).rejects.toThrow("roadmap/boxes/b1.yaml isn’t in this clone (a partial clone?)");
    // An older git: one that drops GIT_NO_LAZY_FETCH, first on the PATH.
    const bin = mkdtempSync(join(tmpdir(), "boxops-test-"));
    temps.push(bin);
    const git = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
    writeFileSync(join(bin, "git"), `#!/bin/sh\nunset GIT_NO_LAZY_FETCH\nexec "${git}" "$@"\n`, { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      await expect(readRoadmapGit(clone, r.commit)).rejects.toThrow("not allowed");
    } finally {
      process.env.PATH = path;
    }
    expect(missing()).toBe(true);
    // Whereas git left to itself would have fetched it.
    r.repo.git(["-C", clone, "cat-file", "-e", blob]);
    expect(missing()).toBe(false);
  });

  it("refuses text that isn't UTF-8, and file names that aren't", async () => {
    expect(await problems(read(repoWith({ ...ROADMAP, "boxes/b2.yaml": NOT_UTF8 })))).toEqual(["boxes/b2.yaml: isn’t UTF-8 text"]);
    const repo = new TestRepo();
    repos.push(repo);
    // update-index takes the name's bytes as given.
    const sha = repo.blob("x\n");
    repo.git(["update-index", "-z", "--add", "--index-info"], {
      input: Buffer.concat([Buffer.from(`100644 ${sha}\troadmap/caf`), Buffer.from([0xe9]), Buffer.from(".yaml\0")]),
    });
    const tree = repo.git(["write-tree"]);
    const commit = repo.git(["commit-tree", tree, "-m", "x"]);
    expect(await problems(readRoadmapGit(repo.dir, commit))).toEqual(["caf\uFFFD.yaml: has a name that isn’t UTF-8"]);
  });

  it("enforces the limits: files, size per roadmap file, size in all", async () => {
    const r = repoWith({ ...ROADMAP, "NOTES.md": "x".repeat(100) });
    LIMITS.files = 3;
    await expect(read(r)).rejects.toThrow("roadmap: holds more than 3 files");
    LIMITS.files = 20_000;
    LIMITS.fileBytes = 10; // NOTES.md isn't read, so its size doesn't count
    expect(await problems(read(r))).toEqual(["people.yaml: is 11 bytes; a roadmap file can be at most 10 bytes"]);
    LIMITS.fileBytes = 1024;
    LIMITS.totalBytes = 20;
    await expect(read(r)).rejects.toThrow("of roadmap files");
  });

  it("refuses a blob whose bytes don't match its SHA", async () => {
    const r = repoWith(ROADMAP);
    const sha = r.repo.git(["rev-parse", `${r.commit}:roadmap/boxes/b1.yaml`]);
    const object = join(r.repo.dir, ".git", "objects", sha.slice(0, 2), sha.slice(2));
    chmodSync(object, 0o644);
    writeFileSync(object, deflateSync(Buffer.from("blob 7\0id: b9\n")));
    expect(await problems(read(r))).toEqual([`boxes/b1.yaml: doesn’t match its git object id ${sha} (a damaged repository?)`]);
  });
});

describe("readCommitFiles and listCommitFolder", () => {
  it("read small plain files at a commit, leaving out links, submodules, folders, big files and non-text", async () => {
    const repo = new TestRepo();
    repos.push(repo);
    const commit = repo.commit({
      ".github/workflows/deploy.yml": "name: Deploy\n",
      ".github/workflows/old.yaml": { mode: "100755", content: "name: Old\r\n" },
      ".github/workflows/linked.yml": { mode: "120000", content: "/etc/passwd" },
      ".github/workflows/sub": { mode: "160000", sha: "a".repeat(40) },
      ".github/workflows/nested/x.yml": "x\n",
      "AGENTS.md": NOT_UTF8,
      "big.md": "x".repeat(2000),
    });
    expect(listCommitFolder(repo.dir, commit, ".github/workflows")).toEqual([".github/workflows/deploy.yml", ".github/workflows/old.yaml"]);
    expect(listCommitFolder(repo.dir, commit, "nowhere")).toEqual([]);
    const paths = [".github/workflows/deploy.yml", ".github/workflows/old.yaml", ".github/workflows/linked.yml", ".github/workflows/sub", ".github/workflows", "AGENTS.md", "big.md", "missing.md", "../x"];
    expect(await readCommitFiles(repo.dir, commit, paths, 1000)).toEqual({
      ".github/workflows/deploy.yml": "name: Deploy\n",
      ".github/workflows/old.yaml": "name: Old\r\n",
    });
  });
});

describe("commits", () => {
  it("reads author, committer date and subject", () => {
    const repo = new TestRepo();
    repos.push(repo);
    const sha = repo.commit({ a: "1\n" }, "Payments revamp:\ndates now later\n\n- body line\n", undefined, "Alex Kim");
    expect(resolveCommit(repo.dir, "HEAD")).toBe(sha);
    expect(readCommit(repo.dir, sha)).toMatchObject({
      author: "Alex Kim",
      date: "2026-10-01T00:01:00Z",
      subject: "Payments revamp: dates now later",
      parents: [],
    });
  });

  it("lists first parents, newest first, up to the limit; a shallow clone stops after the first missing one", () => {
    const repo = new TestRepo();
    repos.push(repo);
    const c1 = repo.commit({ a: "1\n" });
    const side = repo.commit({ a: "side\n" }, "side", [c1]);
    const c2 = repo.commit({ a: "2\n" }, "c2", [c1]);
    const merge = repo.commit({ a: "3\n" }, "merge", [c2, side]);
    const c4 = repo.commit({ a: "4\n" });
    expect(firstParents(repo.dir, c4)).toEqual([c4, merge, c2, c1]);
    expect(firstParents(repo.dir, c4, 2)).toEqual([c4, merge]);

    const clone = mkdtempSync(join(tmpdir(), "boxops-test-"));
    temps.push(clone);
    // Like every test git, without the host's configuration (TestRepo.git).
    repo.git(["clone", "-q", "--depth", "2", `file://${repo.dir}`, clone]);
    expect(firstParents(clone, c4)).toEqual([c4, merge, c2]);
  });
});

describe("readRoadmapDir", () => {
  /** A folder on disk with these files (string = content). */
  function folder(files: Record<string, string | Uint8Array>): string {
    const dir = mkdtempSync(join(tmpdir(), "boxops-test-"));
    temps.push(dir);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    return dir;
  }

  it("reads roadmap files with git's blob SHAs; lists other files; skips hidden ones without a look", async () => {
    const dir = folder({ ...ROADMAP, "boxes/run.yaml": "id: run\n", "README.md": "hi\n", ".DS_Store": "\0", "boxes/sub/x.yaml": "x\n" });
    chmodSync(join(dir, "boxes/run.yaml"), 0o755);
    symlinkSync("b1.yaml", join(dir, "boxes/.#b1.yaml"));
    mkdirSync(join(dir, ".hidden"));
    symlinkSync("/etc", join(dir, ".hidden/link"));
    const read = await readRoadmapDir(dir);
    expect(read.files).toEqual({ ...ROADMAP, "boxes/run.yaml": "id: run\n" });
    expect(read.ignored).toEqual(["README.md", "boxes/sub/x.yaml"]);
    expect(read.tree).toBeNull();
    const git = new TestRepo();
    repos.push(git);
    expect(read.blobs["boxes/b1.yaml"]).toBe(git.blob(ROADMAP["boxes/b1.yaml"]));
  });

  it("keeps a BOM; refuses text that isn't UTF-8", async () => {
    expect((await readRoadmapDir(folder({ "settings.yaml": "\uFEFFformat: 1\n" }))).files["settings.yaml"]).toBe("\uFEFFformat: 1\n");
    expect(await problems(readRoadmapDir(folder({ "settings.yaml": NOT_UTF8 })))).toEqual(["settings.yaml: isn’t UTF-8 text"]);
  });

  it("refuses symlinked files and folders, and anything that isn't a plain file", async () => {
    const dir = folder(ROADMAP);
    symlinkSync("../../../.ssh/id_ed25519", join(dir, "boxes/b2.yaml"));
    const elsewhere = folder({ "eng.yaml": "id: eng\n" });
    symlinkSync(elsewhere, join(dir, "departments"));
    execFileSync("mkfifo", [join(dir, "pipe")]);
    expect(await problems(readRoadmapDir(dir))).toEqual([
      "boxes/b2.yaml: is a symlink; a roadmap folder holds plain files only",
      "departments: is a symlink; a roadmap folder holds plain files only",
      "pipe: is not a plain file; a roadmap folder holds plain files only",
    ]);
  });

  it("sees a submodule only as a folder: a checked-out one's files are read, its .git skipped; one not checked out is empty", async () => {
    const dir = folder({ ...ROADMAP, "vendor/.git": "gitdir: ../../.git/modules/vendor\n", "vendor/notes.md": "x\n" });
    mkdirSync(join(dir, "plans"));
    const read = await readRoadmapDir(dir);
    expect(read.files).toEqual(ROADMAP);
    expect(read.ignored).toEqual(["vendor/notes.md"]);
  });

  it("refuses a folder that's a symlink, isn't a folder, or doesn't exist", async () => {
    const real = folder(ROADMAP);
    const link = join(folder({}), "roadmap");
    symlinkSync(real, link);
    expect(await problems(readRoadmapDir(link))).toEqual([": is a symlink; give the folder it points to"]);
    expect(await problems(readRoadmapDir(join(real, "settings.yaml")))).toEqual([": isn’t a folder"]);
    expect(await problems(readRoadmapDir(join(real, "nope")))).toEqual([": doesn’t exist"]);
  });

  it("enforces the same limits", async () => {
    const dir = folder({ ...ROADMAP, "NOTES.md": "x".repeat(100) });
    LIMITS.files = 3;
    await expect(readRoadmapDir(dir)).rejects.toThrow("holds more than 3 files");
    LIMITS.files = 20_000;
    LIMITS.fileBytes = 10;
    expect(await problems(readRoadmapDir(dir))).toEqual(["people.yaml: is 11 bytes; a roadmap file can be at most 10 bytes"]);
    LIMITS.fileBytes = 1024;
    LIMITS.totalBytes = 20;
    await expect(readRoadmapDir(dir)).rejects.toThrow("of roadmap files");
  });
});

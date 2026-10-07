// The commands that ask GitHub (doctor, upgrade, init) and preview, against a
// fake GitHub (a `fetch` that answers from a table), and the token they'd
// send (from a stand-in `gh`). The launcher has its own tests
// (launcher.test.ts).

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./boxops";
import { cacheRoot } from "./cache";
import type { Io, LaunchContext } from "./context";
import { doctorCommand } from "./doctor";
import { starterFiles } from "./embedded";
import { gitHub } from "./github";
import { ensureApp, startPreview } from "./preview";
import { fetchRelease, upgradeCommand } from "./upgrade";
import { openRelease, verifiedApp } from "./release";
import { APP_FILES, ID, IGNORES_CASE, capture, cleanUp, fakeGitHub, releaseFiles, sampleRepo, tempDir } from "./test-release";
import { TestRepo } from "./test-repo";
import { SHELLS, block, paste, shellEnv, standIns } from "./test-shell";

const repos: TestRepo[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.remove();
  cleanUp();
});

const A = "a".repeat(40);
const B = "b".repeat(40);

/** A release as GitHub's API lists it. */
const rel = (tag_name: string, name: string | null = `BoxOps ${tag_name.slice(1)}`, prerelease = false) => ({ tag_name, name, prerelease });

/** A roadmap repository made from the starter, pinned to `repo@sha # tag`, checked out. */
function adopter(sha: string, tag = "v0.1.0", o: { crlf?: boolean; pathB?: boolean } = {}): TestRepo {
  const files: Record<string, string> = { ...starterFiles() };
  for (const p of Object.keys(files)) if (p.startsWith(".github/workflows/")) files[p] = files[p].replace("<RELEASE_COMMIT_SHA> # v0.1.0", `${sha} # ${tag}`);
  if (o.pathB) files[".github/workflows/path-b.yml"] = `jobs:\n  b:\n    steps:\n      - env:\n          BOXOPS_ACTION: Allenfp/BoxOps@${sha} # ${tag}\n`;
  if (o.crlf) files[".github/workflows/deploy.yml"] = files[".github/workflows/deploy.yml"].replace(/\n/g, "\r\n");
  const repo = new TestRepo();
  repos.push(repo);
  repo.commit(files, "Start roadmap");
  repo.checkout();
  return repo;
}

describe("init", () => {
  it("writes the starter pinned to this release's commit, after checking its BUILD.json", async () => {
    const gh = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.1.0": A } }, files: { [A]: releaseFiles(ID) } });
    const io = capture({ fetch: gh.fetch });
    expect(await main(["init", "acme-roadmap"], {}, io)).toBe(0);
    const dir = join(io.cwd, "acme-roadmap");
    const deploy = readFileSync(join(dir, ".github/workflows/deploy.yml"), "utf8");
    expect(deploy).toContain(`        uses: Allenfp/BoxOps@${A} # v0.1.0\n`);
    expect(readFileSync(join(dir, ".github/workflows/check.yml"), "utf8")).toContain(`      - uses: Allenfp/BoxOps@${A} # v0.1.0\n`);
    expect(readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile())).toHaveLength(13);
    expect(io.stdout[0]).toBe(`Wrote a BoxOps roadmap repository in acme-roadmap/ (13 files), pinned to Allenfp/BoxOps@${A.slice(0, 12)} # v0.1.0.`);
    expect(gh.calls).toEqual([
      "https://api.github.com/repos/Allenfp/BoxOps/git/ref/tags/v0.1.0",
      `https://raw.githubusercontent.com/Allenfp/BoxOps/${A}/BUILD.json`,
    ]);
    // The files it wrote validate, and sync has nothing to do.
    expect(await main(["validate"], {}, capture({ cwd: dir }))).toBe(0);
    expect(await main(["sync", "--check", "--root", dir], {}, capture())).toBe(0);
  });

  // Its next steps, pasted into each shell as someone would (test-shell.ts), <org>/<name> filled in.
  for (const shell of SHELLS) {
    it(`prints its next steps as one command, the folder quoted, that stops at a step that fails: pasted into ${shell[0]}`, async () => {
      const gh = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.1.0": A } }, files: { [A]: releaseFiles(ID) } });
      const io = capture({ fetch: gh.fetch });
      expect(await main(["init", "acme's roadmap"], {}, io)).toBe(0);
      expect(io.stdout).toEqual([
        `Wrote a BoxOps roadmap repository in acme's roadmap/ (13 files), pinned to Allenfp/BoxOps@${A.slice(0, 12)} # v0.1.0.`,
        "Next, one command (with your organization and the new repository’s name for <org>/<name>), which stops at the first step that fails:",
        "  cd 'acme'\\''s roadmap' && git init -b main && git add -A && \\",
        '    git commit -m "Start roadmap from BoxOps v0.1.0" && \\',
        "    gh repo create <org>/<name> --private --source . --push",
        "Pushing workflow files takes SSH, or a token with the workflow scope. Then follow README.md: Pages, rulesets, people.",
      ]);
      const command = block(io.stdout, "Next, one command").replace("<org>/<name>", "acme/roadmap");
      const stand = standIns();
      const env = shellEnv(stand);
      const git = (dir: string, args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env }).trim();
      const ghCalls = () => readFileSync(join(stand, "gh.log"), "utf8").split("\n").filter(Boolean);

      // Where init ran: the folder it wrote becomes a repository, which gh creates on GitHub from there.
      const made = paste(shell, command, io.cwd, env);
      expect(made.status, made.stderr).toBe(0);
      expect(git(join(io.cwd, "acme's roadmap"), ["log", "--format=%s"])).toBe("Start roadmap from BoxOps v0.1.0");
      expect(ghCalls()).toEqual(["repo create acme/roadmap --private --source . --push"]);

      // Somewhere else, a repository of its own: the cd fails, and nothing after it runs.
      const elsewhere = new TestRepo();
      repos.push(elsewhere);
      elsewhere.commit({ "README.md": "Another project\n" }, "Another project");
      elsewhere.checkout();
      elsewhere.write({ "notes.txt": "Not committed\n" });
      const state = () => [git(elsewhere.dir, ["rev-parse", "HEAD"]), git(elsewhere.dir, ["status", "--porcelain"])];
      const before = state();
      const failed = paste(shell, command, elsewhere.dir, env);
      expect(failed.status).not.toBe(0);
      expect(failed.stderr).toMatch(/no such file or directory/i);
      expect(state()).toEqual(before);
      expect(ghCalls()).toHaveLength(1);
    });
  }

  it("pins a mirror with --action, and refuses a commit that's another build", async () => {
    const gh = fakeGitHub({ files: { [A]: releaseFiles(ID), [B]: releaseFiles({ ...ID, build: "0.1.0+ffffffffffff" }) } });
    const io = capture({ fetch: gh.fetch });
    expect(await main(["init", "mirror", "--action", `acme/boxops-mirror@${A}`], {}, io)).toBe(0);
    expect(readFileSync(join(io.cwd, "mirror", ".github/workflows/check.yml"), "utf8")).toContain(`uses: acme/boxops-mirror@${A} # v0.1.0`);
    const other = capture({ fetch: gh.fetch });
    expect(await main(["init", "x", "--action", `acme/boxops-mirror@${B}`], {}, other)).toBe(2);
    expect(other.stderr).toEqual([
      `boxops init: acme/boxops-mirror@${B.slice(0, 12)} is BoxOps build 0.1.0+ffffffffffff, not this one (0.1.0+0123456789ab): run that release’s boxops.mjs, or give this one’s commit with --action`,
    ]);
    expect(readdirSync(other.cwd)).toEqual([]);
  });

  it("refuses a folder that isn't empty, a bad --action, and a build that isn't a release without one", async () => {
    const io = capture();
    mkdirSync(join(io.cwd, "full"));
    writeFileSync(join(io.cwd, "full", "x"), "");
    expect(await main(["init", "full"], {}, io)).toBe(2);
    expect(io.stderr.pop()).toBe(`boxops init: ${join(io.cwd, "full")} isn’t empty: give a new or empty folder`);
    expect(await main(["init", "y", "--action", "Allenfp/BoxOps@v0.1.0"], {}, io)).toBe(2);
    expect(io.stderr.pop()).toBe('boxops init: --action is "Allenfp/BoxOps@v0.1.0": give owner/repo@<40-character commit SHA>');
    const dev = capture({ identity: () => ({ ...ID, version: "0.1.0-next", build: "0.1.0-next+0123456789ab" }) });
    expect(await main(["init", "z"], {}, dev)).toBe(2);
    expect(dev.stderr).toEqual(["boxops init: This BoxOps (0.1.0-next) isn’t a release: give --action owner/repo@<release commit>"]);
  });
});

describe("upgrade", () => {
  /** A new release whose tool records how it was called, in `log`. */
  function newRelease(log: string) {
    const cli = `import { appendFileSync } from "node:fs";\nexport async function main(argv, ctx) { appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, sha: ctx.sha, tag: ctx.tag, root: ctx.root, launcher: ctx.launcher, checked: ctx.checked }) + "\\n"); return 0; }\n`;
    return releaseFiles({ ...ID, version: "0.2.0", build: "0.2.0+fedcba987654" }, cli);
  }

  it("moves every pin (CRLF, Path B), runs the new release's migrate --check, sync and validate, and commits nothing", async () => {
    const repo = adopter(A, "v0.1.0", { crlf: true, pathB: true });
    const head = repo.git(["rev-parse", "HEAD"]);
    const log = join(tempDir(), "calls.jsonl");
    const gh = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.1.0": A, "v0.2.0": B } }, releases: { "Allenfp/BoxOps": [rel("v0.2.0"), rel("v0.1.0")] }, files: { [B]: newRelease(log) } });
    const io = capture({ fetch: gh.fetch, cwd: repo.dir, env: { BOXOPS_CACHE: tempDir() } });
    // As launcher 1 runs it: with its number, and its word that it checked the BoxOps files (against the old release).
    expect(await main(["upgrade"], { root: repo.dir, repo: "Allenfp/BoxOps", sha: A, tag: "v0.1.0", launcher: 1, checked: true }, io)).toBe(0);
    expect(io.stdout[0]).toBe(
      `Moved the BoxOps pins in .github/workflows/check.yml, .github/workflows/deploy.yml, .github/workflows/path-b.yml from v0.1.0 to v0.2.0 (Allenfp/BoxOps@${B.slice(0, 12)}).`,
    );
    const deploy = readFileSync(join(repo.dir, ".github/workflows/deploy.yml"), "utf8");
    expect(deploy).toContain(`uses: Allenfp/BoxOps@${B} # v0.2.0\r\n`);
    expect(/[^\r]\n/.test(deploy)).toBe(false);
    expect(readFileSync(join(repo.dir, ".github/workflows/path-b.yml"), "utf8")).toContain(`BOXOPS_ACTION: Allenfp/BoxOps@${B} # v0.2.0\n`);
    const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    // Neither passed on: the new release reads its files itself. Its validate warns, after its sync; migrate --check, before it, doesn't.
    expect(calls).toEqual([
      { argv: ["migrate", "--check"], sha: B, tag: "v0.2.0", root: repo.dir, checked: true },
      { argv: ["sync"], sha: B, tag: "v0.2.0", root: repo.dir },
      { argv: ["validate"], sha: B, tag: "v0.2.0", root: repo.dir },
    ]);
    expect(repo.git(["rev-parse", "HEAD"])).toBe(head);
    expect(repo.git(["status", "--porcelain"]).split("\n").map((l) => l.trim()).sort()).toEqual([
      "M .github/workflows/check.yml",
      "M .github/workflows/deploy.yml",
      "M .github/workflows/path-b.yml",
    ]);
    // Done: nothing more to move.
    const again = capture({ fetch: gh.fetch, cwd: repo.dir, env: io.env });
    expect(await main(["upgrade", "v0.2.0"], { root: repo.dir }, again)).toBe(0);
    expect(again.stdout).toEqual([`Already on Allenfp/BoxOps@${B.slice(0, 12)} (v0.2.0).`]);
  });

  it("moves to the newest release that wasn't withdrawn (nor a draft or release candidate), and refuses a withdrawn one by name", async () => {
    const C = "c".repeat(40);
    const list = [
      { ...rel("v0.3.0"), draft: true },
      rel("v0.3.0-rc.1", "BoxOps 0.3.0-rc.1", true),
      rel("v0.2.1", "Withdrawn: BoxOps 0.2.1"),
      rel("v0.2.0"),
      rel("v0.1.0"),
    ];
    const gh = fakeGitHub({
      tags: { "Allenfp/BoxOps": { "v0.1.0": A, "v0.2.0": B, "v0.2.1": C } },
      releases: { "Allenfp/BoxOps": list },
      files: { [B]: newRelease(join(tempDir(), "calls.jsonl")), [C]: newRelease(join(tempDir(), "never.jsonl")) },
    });
    const repo = adopter(A);
    const io = capture({ fetch: gh.fetch, cwd: repo.dir, env: { BOXOPS_CACHE: tempDir() } });
    expect(await main(["upgrade"], { root: repo.dir }, io)).toBe(0);
    expect(io.stdout[0]).toBe(`Moved the BoxOps pins in .github/workflows/check.yml, .github/workflows/deploy.yml from v0.1.0 to v0.2.0 (Allenfp/BoxOps@${B.slice(0, 12)}).`);
    // By name: refused, before anything is fetched or changed.
    const other = adopter(A);
    const named = capture({ fetch: gh.fetch, cwd: other.dir, env: { BOXOPS_CACHE: tempDir() } });
    const before = gh.calls.length;
    expect(await main(["upgrade", "v0.2.1"], { root: other.dir }, named)).toBe(2);
    expect(named.stderr).toEqual(["boxops upgrade: v0.2.1 of Allenfp/BoxOps was withdrawn (“Withdrawn: BoxOps 0.2.1”): give another release, or none for the newest that wasn’t"]);
    expect(gh.calls.slice(before)).toEqual(["https://api.github.com/repos/Allenfp/BoxOps/releases/tags/v0.2.1"]);
    expect(other.git(["status", "--porcelain"])).toBe("");
    // A repository with no release to move to (a mirror of the commits alone): give the tag.
    const mirror = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.2.0": B } }, files: { [B]: newRelease(join(tempDir(), "x")) } });
    const bare = capture({ fetch: mirror.fetch, cwd: other.dir, env: { BOXOPS_CACHE: tempDir() } });
    expect(await main(["upgrade"], { root: other.dir }, bare)).toBe(2);
    expect(bare.stderr).toEqual([
      "boxops upgrade: Allenfp/BoxOps has no release to move to (a vX.Y.Z, not a release candidate, a draft or withdrawn, among its newest; a mirror of BoxOps’ commits has none): give the tag, as in upgrade v0.2.0",
    ]);
    expect(await main(["upgrade", "v0.2.0"], { root: other.dir }, bare)).toBe(0);
  });

  it("runs the new release's migrate --check and validate on --roadmap's folder, and names it in what to run", async () => {
    const repo = adopter(A);
    const log = join(tempDir(), "calls.jsonl");
    const gh = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.2.0": B } }, files: { [B]: newRelease(log) } });
    const io = capture({ fetch: gh.fetch, cwd: repo.dir, env: { BOXOPS_CACHE: tempDir() } });
    expect(await main(["upgrade", "v0.2.0", "--roadmap", "plans"], { root: repo.dir }, io)).toBe(0);
    expect(readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l).argv)).toEqual([["migrate", "--check", "--roadmap", "plans"], ["sync"], ["validate", "--roadmap", "plans"]]);
    expect(io.stdout).toEqual(expect.arrayContaining(["v0.2.0: migrate --check --roadmap plans", "v0.2.0: sync", "v0.2.0: validate --roadmap plans"]));
    // A release whose migrate --check says a migration is needed: the command to run names the folder.
    const C = "c".repeat(40);
    const migrating = releaseFiles({ ...ID, version: "0.3.0", build: "0.3.0+fedcba987654" }, 'export async function main(argv) { return argv[0] === "migrate" ? 1 : 0; }\n');
    const gh3 = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.3.0": C } }, files: { [C]: migrating } });
    const io3 = capture({ fetch: gh3.fetch, cwd: repo.dir, env: { BOXOPS_CACHE: tempDir() } });
    expect(await main(["upgrade", "v0.3.0", "--roadmap", "our plans"], { root: repo.dir }, io3)).toBe(1);
    expect(io3.stdout).toContain("The data format changes in v0.3.0: run `node .boxops/boxops.mjs migrate --roadmap 'our plans'`, then validate again.");
  });

  it("lets the new release's validate warn of the files its sync didn't make its own, such as the Pages guard", async () => {
    const repo = adopter(A);
    const deploy = join(repo.dir, ".github/workflows/deploy.yml");
    writeFileSync(deploy, readFileSync(deploy, "utf8").replace("# boxops-guard: 1", "# boxops-guard: 0"));
    const gh = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.2.0": B } }, files: { [B]: newRelease(join(tempDir(), "x")) } });
    const io = capture({ fetch: gh.fetch, cwd: repo.dir, env: { BOXOPS_CACHE: tempDir() } });
    // The new release is this one (Pages guard 1), printing to `inner`.
    const inner = capture({ cwd: repo.dir });
    const load = async () => (argv: string[], ctx: LaunchContext) => main(argv, ctx, inner);
    // From an old launcher (0), which checked the files against the old release.
    const ctx = { root: repo.dir, repo: "Allenfp/BoxOps", sha: A, tag: "v0.1.0", launcher: 0, checked: true };
    expect(await upgradeCommand(repo.dir, "v0.2.0", ctx, io, { load })).toBe(0);
    // Once, from validate; and not "the launcher is 0": the launcher is the file, this release's.
    expect(inner.stderr).toEqual(["boxops: the Pages guard in deploy.yml is 0; this BoxOps expects 1: run `node .boxops/boxops.mjs doctor`"]);
  });

  it("checks the release's tool against its BUILD.json before running it", async () => {
    const repo = adopter(A);
    const files = newRelease(join(tempDir(), "never.jsonl"));
    files["dist/boxops.mjs"] = "export async function main() { /* swapped */ return 0; }\n";
    const gh = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.2.0": B } }, files: { [B]: files } });
    const io = capture({ fetch: gh.fetch, cwd: repo.dir, env: { BOXOPS_CACHE: tempDir() } });
    expect(await main(["upgrade", "v0.2.0"], { root: repo.dir }, io)).toBe(2);
    expect(io.stderr).toEqual([`boxops upgrade: dist/boxops.mjs of Allenfp/BoxOps@${B.slice(0, 7)} isn’t the file its BUILD.json describes`]);
    expect(repo.git(["status", "--porcelain"])).toBe("");
    const wrong = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.3.0": B } }, files: { [B]: newRelease(join(tempDir(), "x")) } });
    const io2 = capture({ fetch: wrong.fetch, cwd: repo.dir, env: { BOXOPS_CACHE: tempDir() } });
    expect(await main(["upgrade", "v0.3.0"], { root: repo.dir }, io2)).toBe(2);
    expect(io2.stderr).toEqual([`boxops upgrade: Allenfp/BoxOps@${B.slice(0, 7)} is BoxOps 0.2.0, not v0.3.0`]);
  });

  it("says what's wrong with a tag that isn't there, or a repository with no pin", async () => {
    const repo = adopter(A);
    const gh = fakeGitHub({ tags: { "Allenfp/BoxOps": {} } });
    const io = capture({ fetch: gh.fetch, cwd: repo.dir, env: { BOXOPS_CACHE: tempDir() } });
    expect(await main(["upgrade", "v9.9.9"], { root: repo.dir }, io)).toBe(2);
    expect(io.stderr).toEqual(["boxops upgrade: Allenfp/BoxOps has no tag v9.9.9"]);
    expect(await main(["upgrade", "latest"], { root: repo.dir }, io)).toBe(2);
    expect(io.stderr.pop()).toBe('boxops upgrade: "latest" isn’t a release tag: give one like v0.2.0');
    const bare = tempDir();
    expect(await main(["upgrade", "--root", bare], {}, io)).toBe(2);
    expect(io.stderr.pop()).toBe("boxops upgrade: No BoxOps pin (`uses: <owner>/<boxops repo>@<commit>`) in .github/workflows to upgrade");
  });

  it("keeps the new release's tool with its BUILD.json, as the launcher does, and fetches a changed one again", async () => {
    const repo = adopter(A);
    const files = newRelease(join(tempDir(), "calls.jsonl"));
    const gh = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.2.0": B } }, files: { [B]: files } });
    const cache = tempDir();
    const io = capture({ fetch: gh.fetch, cwd: repo.dir, env: { BOXOPS_CACHE: cache } });
    expect(await main(["upgrade", "v0.2.0"], { root: repo.dir }, io)).toBe(0);
    const dir = join(realpathSync(cache), "Allenfp__BoxOps", B);
    expect(readdirSync(dir).sort()).toEqual(["BUILD.json", "boxops.mjs"]);
    expect(readFileSync(join(dir, "BUILD.json"), "utf8")).toBe(files["BUILD.json"]);
    const calls = gh.calls.length;
    expect(await fetchRelease(io, repo.dir, "Allenfp/BoxOps", B, "v0.2.0")).toBe(join(dir, "boxops.mjs"));
    expect(gh.calls.length).toBe(calls);
    writeFileSync(join(dir, "boxops.mjs"), "export async function main() { return 9; }\n");
    await fetchRelease(io, repo.dir, "Allenfp/BoxOps", B, "v0.2.0");
    expect(gh.calls.slice(calls)).toEqual([`https://raw.githubusercontent.com/Allenfp/BoxOps/${B}/BUILD.json`, `https://raw.githubusercontent.com/Allenfp/BoxOps/${B}/dist/boxops.mjs`]);
    expect(readFileSync(join(dir, "boxops.mjs"))).toEqual(Buffer.from(files["dist/boxops.mjs"]));
  });

  it("never caches inside the repository, whatever case names it on a disk that ignores case", async () => {
    const repo = adopter(A);
    const gh = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.2.0": B } }, files: { [B]: newRelease(join(tempDir(), "x")) } });
    const caches = [join(repo.dir, ".cache"), ...(IGNORES_CASE ? [join(repo.dir.toUpperCase(), ".cache"), join(repo.dir.toUpperCase(), "new", "cache")] : [])];
    for (const cache of caches) {
      const io = capture({ fetch: gh.fetch, cwd: repo.dir, env: { BOXOPS_CACHE: cache } });
      expect(await main(["upgrade", "v0.2.0"], { root: repo.dir }, io)).toBe(2);
      expect([cache, io.stderr]).toEqual([cache, ["boxops upgrade: BOXOPS_CACHE must be outside this repository"]]);
    }
    // The tag and its release looked up, nothing downloaded, and nothing made in the repository.
    expect(gh.calls.filter((url) => !/\/(git\/ref|releases)\/tags\/v0\.2\.0$/.test(url))).toEqual([]);
    expect(repo.git(["status", "--porcelain", "--ignored"])).toBe("");
  });
});

describe("the cache (cli/cache.ts), as the launcher keeps it", () => {
  it("in the temp folder, which anyone can write to, is only a folder that no one else can use: never a symlink", () => {
    const root = realpathSync(tempDir());
    const base = realpathSync(tempDir());
    writeFileSync(join(base, "file"), "");
    const saved = { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
    // ~/.cache can't be made (a file is in the way): the temp folder is all that's left.
    process.env.HOME = join(base, "file", "home");
    process.env.TMPDIR = join(base, "tmp");
    mkdirSync(process.env.TMPDIR);
    const there = join(process.env.TMPDIR, `boxops-cache-${process.getuid?.() ?? "user"}`);
    try {
      expect(cacheRoot({}, root)).toBe(there);
      expect(statSync(there).mode & 0o777).toBe(0o700);
      rmSync(there, { recursive: true });
      // Left there by another user: a symlink to a folder of this user's that others can read. Then that folder itself.
      const clone = join(base, "clone");
      mkdirSync(clone);
      chmodSync(clone, 0o755);
      symlinkSync(clone, there);
      expect(() => cacheRoot({}, root)).toThrow("no writable cache folder outside this repository; set BOXOPS_CACHE");
      rmSync(there);
      renameSync(clone, there);
      expect(() => cacheRoot({}, root)).toThrow("no writable cache folder outside this repository; set BOXOPS_CACHE");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("doctor", () => {
  const ok = () => ({ ok: true, output: "Loaded 1 attestation" });

  it("passes a repository set up from the starter at a tagged release", async () => {
    const repo = adopter(A);
    const gh = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.0.9": B, "v0.1.0": A } } });
    const io = capture({ fetch: gh.fetch });
    const cliFile = join(io.cliDir, "boxops.mjs");
    expect(await doctorCommand(repo.dir, { launcher: 1 }, io, { attest: ok, cliFile })).toBe(0);
    expect(io.stdout.slice(1)).toEqual([
      expect.stringMatching(/^ {2}ok {7}Node\.js \d+\.\d+\.\d+$/),
      `  ok       2 pins, all Allenfp/BoxOps@${A.slice(0, 12)}`,
      `  ok       ${A.slice(0, 12)} is v0.1.0 of Allenfp/BoxOps`,
      "  ok       The pins’ comments name that tag",
      "  ok       Attestation: signed by Allenfp/BoxOps/.github/workflows/release.yml",
      "  ok       Launcher 1",
      "  ok       AGENTS.md’s BoxOps block 1",
      "  ok       Pages guard (deploy.yml) 1",
      "  ok       .github/workflows/deploy.yml: permissions as in the starter",
      "  ok       .github/workflows/check.yml: permissions as in the starter",
      "  ok       Runners: none retired",
      "No problems.",
    ]);
  });

  it("finds an imposter commit, wrong comments, changed permissions, old files and retired runners", async () => {
    const repo = adopter(A, "v0.0.9");
    const deploy = join(repo.dir, ".github/workflows/deploy.yml");
    writeFileSync(deploy, readFileSync(deploy, "utf8").replace("contents: read # check out the roadmap", "contents: write").replace("runs-on: ubuntu-24.04 # pinned", "runs-on: ubuntu-20.04 # pinned"));
    writeFileSync(join(repo.dir, "AGENTS.md"), "<!-- boxops:begin block=0 -->\n<!-- boxops:end -->\n");
    const tagged = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.1.0": A } } });
    const io = capture({ fetch: tagged.fetch });
    expect(await doctorCommand(repo.dir, {}, io, { attest: () => null, cliFile: join(io.cliDir, "boxops.mjs") })).toBe(1);
    const text = io.stdout.join("\n");
    expect(text).toContain("  warning  The comment says v0.0.9 (.github/workflows/check.yml:27), v0.0.9 (.github/workflows/deploy.yml:44), but the pin is v0.1.0");
    expect(text).toContain("  skipped  Attestation: the GitHub CLI (gh) isn’t installed");
    expect(text).toContain("  problem  AGENTS.md’s BoxOps block is 0; this BoxOps’s is 1 (run `node .boxops/boxops.mjs sync`)");
    expect(text).toContain("  problem  .github/workflows/deploy.yml jobs.build: permissions differ from the starter’s\n             - contents: write\n             + contents: read");
    expect(text).toContain("  problem  .github/workflows/deploy.yml:26 runs on ubuntu-20.04; GitHub retired it on 2025-04-15: jobs on it don’t start. Use ubuntu-24.04.");
    expect(text).toMatch(/\d problems to fix\.$/);

    const imposter = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.1.0": B } } });
    const io2 = capture({ fetch: imposter.fetch });
    await doctorCommand(repo.dir, {}, io2, { attest: () => ({ ok: false, output: "no attestations found" }), cliFile: join(io2.cliDir, "boxops.mjs") });
    expect(io2.stdout).toContain(`  problem  ${A.slice(0, 12)} isn’t the commit of any tag in Allenfp/BoxOps: it may be a fork’s commit seen through Allenfp/BoxOps. Pin a release (\`node .boxops/boxops.mjs upgrade\`)`);
    expect(io2.stdout).toContain("  problem  Attestation: gh attestation verify failed for " + join(io2.cliDir, "boxops.mjs"));

    // AGENTS.md is read only as a plain file, never through a symlink (to /dev/zero, say, a read would never end).
    const elsewhere = join(tempDir(), "AGENTS.md");
    writeFileSync(elsewhere, "<!-- boxops:begin block=1 -->\n<!-- boxops:end -->\n");
    rmSync(join(repo.dir, "AGENTS.md"));
    symlinkSync(elsewhere, join(repo.dir, "AGENTS.md"));
    const io3 = capture({ fetch: tagged.fetch });
    await doctorCommand(repo.dir, {}, io3, { attest: () => null, cliFile: join(io3.cliDir, "boxops.mjs") });
    expect(io3.stdout).toContain("  warning  AGENTS.md’s BoxOps block: not found (run `node .boxops/boxops.mjs sync`)");
  });

  it("offline, says it couldn't ask GitHub, and checks the rest", async () => {
    const repo = adopter(A);
    const io = capture();
    expect(await doctorCommand(repo.dir, {}, io, { attest: ok, cliFile: join(io.cliDir, "boxops.mjs") })).toBe(0);
    expect(io.stdout).toContain("  warning  Couldn’t ask GitHub about the pin: couldn’t reach GitHub (no network in this test)");
  });
});

/** GET a path from the preview, with this Host header; status, headers and body. */
function get(url: string, path: string, headers: Record<string, string> = {}, method = "GET"): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  const u = new URL(path, url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path: u.pathname, method, headers: { Host: u.host, ...headers } }, (res) => {
      let body = "";
      res.setEncoding("utf8").on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject).end();
  });
}

describe("preview", () => {
  it("serves the release's app and a local roadmap.json from the working tree, made afresh", async () => {
    const repo = new TestRepo();
    repos.push(repo);
    repo.commit(sampleRepo(), "Start");
    repo.checkout();
    const io: Io = capture({ cwd: repo.dir });
    const preview = await startPreview({ root: repo.dir, dir: join(repo.dir, "roadmap"), port: 0, io });
    try {
      expect(preview.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const index = await get(preview.url, "/");
      expect([index.status, index.body, index.headers["content-type"]]).toEqual([200, APP_FILES["index.html"], "text/html; charset=utf-8"]);
      expect((await get(preview.url, "/assets/index-A1.js")).body).toBe(APP_FILES["assets/index-A1.js"]);
      const first = await get(preview.url, "/roadmap.json");
      const bundle = JSON.parse(first.body);
      expect(bundle.source).toMatchObject({ local: true, tree: null, commit: repo.git(["rev-parse", "HEAD"]), dir: "roadmap" });
      expect(bundle.app.build).toBe(ID.build);
      // Said to be made afresh, so the app looks twice a second; the app's own files aren't.
      expect(first.headers["boxops-live"]).toBe("1");
      expect(index.headers["boxops-live"]).toBeUndefined();
      expect((await get(preview.url, "/roadmap.json", { "If-None-Match": String(first.headers.etag) })).status).toBe(304);
      writeFileSync(join(repo.dir, "roadmap", "people.yaml"), "people: []\n");
      const second = await get(preview.url, "/roadmap.json", { "If-None-Match": String(first.headers.etag) });
      expect([second.status, JSON.parse(second.body).files["people.yaml"]]).toEqual([200, "people: []\n"]);
    } finally {
      await preview.close();
    }
  });

  it("answers this machine's names only, GET only, and only the release's files", async () => {
    const repo = new TestRepo();
    repos.push(repo);
    repo.commit(sampleRepo(), "Start");
    repo.checkout();
    const preview = await startPreview({ root: repo.dir, dir: join(repo.dir, "roadmap"), port: 0, io: capture({ cwd: repo.dir }) });
    try {
      expect((await get(preview.url, "/", { Host: "evil.example" })).status).toBe(403);
      expect((await get(preview.url, "/", {}, "POST")).status).toBe(405);
      for (const path of ["/package.json", "/../roadmap/people.yaml", "/%2e%2e/BUILD.json", "/BUILD.json", "/boxops.mjs", "/%zz"]) {
        expect([path, (await get(preview.url, path)).status]).toEqual([path, path === "/%zz" ? 400 : 404]);
      }
      const port = new URL(preview.url).port;
      expect((await get(preview.url, "/favicon.svg", { Host: `localhost:${port}` })).status).toBe(200);
    } finally {
      await preview.close();
    }
  });

  it("fetches the app once for a tool with no BUILD.json beside it (a release's boxops.mjs alone), checking every file", async () => {
    const cliDir = tempDir();
    writeFileSync(join(cliDir, "boxops.mjs"), "export async function main() { return 0; }\n");
    const gh = fakeGitHub({ files: { [A]: releaseFiles(ID) } });
    const io = capture({ fetch: gh.fetch, cliDir });
    await ensureApp(cliDir, { repo: "Allenfp/BoxOps", sha: A }, io);
    expect(verifiedApp(openRelease(cliDir, ID.build)).map((f) => f.path).sort()).toEqual(Object.keys(APP_FILES).sort());
    const calls = gh.calls.length;
    await ensureApp(cliDir, { repo: "Allenfp/BoxOps", sha: A }, io);
    expect(gh.calls.length).toBe(calls); // once

    const tampered = releaseFiles(ID);
    tampered["dist/app/assets/index-A1.js"] = "steal();\n";
    const other = tempDir();
    await expect(ensureApp(other, { repo: "Allenfp/BoxOps", sha: B }, capture({ fetch: fakeGitHub({ files: { [B]: tampered } }).fetch, cliDir: other }))).rejects.toThrow(
      `dist/app/assets/index-A1.js from Allenfp/BoxOps@${B.slice(0, 12)} isn’t the file its BUILD.json describes`,
    );
    expect(readdirSync(other)).not.toContain("BUILD.json");
    await expect(ensureApp(tempDir(), {}, capture())).rejects.toThrow(/^No app beside .*: run the command through \.boxops\/boxops\.mjs/);
  });

  it("beside the BUILD.json the launcher keeps, fetches the app alone, and later only what's missing or damaged", async () => {
    const cliDir = tempDir();
    const files = releaseFiles(ID);
    writeFileSync(join(cliDir, "boxops.mjs"), files["dist/boxops.mjs"]);
    writeFileSync(join(cliDir, "BUILD.json"), files["BUILD.json"]);
    const gh = fakeGitHub({ files: { [A]: files } });
    const io = capture({ fetch: gh.fetch, cliDir });
    const fetched = () => gh.calls.splice(0).map((url) => url.replace(`https://raw.githubusercontent.com/Allenfp/BoxOps/${A}/`, ""));
    await ensureApp(cliDir, { repo: "Allenfp/BoxOps", sha: A }, io);
    expect(fetched()).toEqual(Object.keys(APP_FILES).sort().map((p) => `dist/app/${p}`));
    expect(verifiedApp(openRelease(cliDir, ID.build)).map((f) => f.path).sort()).toEqual(Object.keys(APP_FILES).sort());
    await ensureApp(cliDir, { repo: "Allenfp/BoxOps", sha: A }, io);
    expect(fetched()).toEqual([]);
    writeFileSync(join(cliDir, "app", "favicon.svg"), "<svg/>");
    rmSync(join(cliDir, "app", "assets", "parse-B2.js"));
    await ensureApp(cliDir, { repo: "Allenfp/BoxOps", sha: A }, io);
    expect(fetched()).toEqual(["dist/app/assets/parse-B2.js", "dist/app/favicon.svg"]);
    expect(verifiedApp(openRelease(cliDir, ID.build))).toHaveLength(Object.keys(APP_FILES).length);
    // A file GitHub serves that isn't the one the BUILD.json beside the tool describes: refused, not kept.
    rmSync(join(cliDir, "app", "favicon.svg"));
    const swapped = fakeGitHub({ files: { [A]: { ...files, "dist/app/favicon.svg": "<svg onload='steal()'/>" } } });
    await expect(ensureApp(cliDir, { repo: "Allenfp/BoxOps", sha: A }, capture({ fetch: swapped.fetch, cliDir }))).rejects.toThrow(
      `dist/app/favicon.svg from Allenfp/BoxOps@${A.slice(0, 12)} isn’t the file the BUILD.json beside this tool describes`,
    );
    expect(readdirSync(join(cliDir, "app"))).not.toContain("favicon.svg");
    // Run without the launcher, it can't know the pin, and says what's wrong.
    await expect(ensureApp(cliDir, {}, io)).rejects.toThrow(
      `The app beside ${cliDir} isn’t whole (dist/app/favicon.svg is missing or damaged): run the command through .boxops/boxops.mjs, which fetches it`,
    );
  });

  it("won't fetch the app of a pinned commit that's another build than the tool", async () => {
    const cliDir = tempDir();
    writeFileSync(join(cliDir, "boxops.mjs"), "export async function main() { return 0; }\n");
    const gh = fakeGitHub({ files: { [B]: releaseFiles({ ...ID, build: "0.1.0+ffffffffffff" }) } });
    await expect(ensureApp(cliDir, { repo: "Allenfp/BoxOps", sha: B }, capture({ fetch: gh.fetch, cliDir }))).rejects.toThrow(
      `Allenfp/BoxOps@${B.slice(0, 12)} is BoxOps build 0.1.0+ffffffffffff, but this tool is 0.1.0+0123456789ab: set BOXOPS_CLI to that release’s dist/boxops.mjs`,
    );
    expect(gh.calls).toEqual([`https://raw.githubusercontent.com/Allenfp/BoxOps/${B}/BUILD.json`]);
    expect(readdirSync(cliDir)).toEqual(["boxops.mjs"]);
  });
});

describe("build", () => {
  /** A checked-out repository holding the sample roadmap, acme/roadmap on github.com. */
  function sample(): TestRepo {
    const repo = new TestRepo();
    repos.push(repo);
    repo.commit(sampleRepo(), "Start");
    repo.checkout();
    repo.git(["remote", "add", "origin", "https://github.com/acme/roadmap.git"]);
    return repo;
  }

  /** The files of a site folder, "/"-separated, sorted. */
  const siteFiles = (dir: string) =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => join(d.parentPath, d.name).slice(dir.length + 1).split("\\").join("/"))
      .sort();

  it("through the launcher, fetches the app beside the tool and BUILD.json it keeps, once, then writes the site", async () => {
    const repo = sample();
    const cliDir = tempDir();
    const files = releaseFiles(ID);
    writeFileSync(join(cliDir, "boxops.mjs"), files["dist/boxops.mjs"]);
    writeFileSync(join(cliDir, "BUILD.json"), files["BUILD.json"]);
    const gh = fakeGitHub({ files: { [A]: files } });
    const ctx = { root: repo.dir, repo: "Allenfp/BoxOps", sha: A };
    const io = capture({ fetch: gh.fetch, cliDir, cwd: repo.dir });
    const out = join(tempDir(), "site");
    expect(await main(["build", "--out", out], ctx, io)).toBe(0);
    expect(io.stderr).toEqual([`Fetching the app of Allenfp/BoxOps@${A.slice(0, 12)} (once)…`]);
    expect(siteFiles(out)).toEqual([...Object.keys(APP_FILES), "roadmap.json"].sort());
    for (const [path, text] of Object.entries(APP_FILES)) expect([path, readFileSync(join(out, path), "utf8")]).toEqual([path, text]);
    expect(JSON.parse(readFileSync(join(out, "roadmap.json"), "utf8")).source.commit).toBe(repo.git(["rev-parse", "HEAD"]));
    // The next one fetches nothing.
    const calls = gh.calls.length;
    expect(await main(["build", "--out", join(tempDir(), "again")], ctx, capture({ fetch: gh.fetch, cliDir, cwd: repo.dir }))).toBe(0);
    expect(gh.calls.length).toBe(calls);
  });

  it("run without the launcher, says how to run it, not that the release is damaged", async () => {
    const repo = sample();
    const kept = tempDir();
    const files = releaseFiles(ID);
    writeFileSync(join(kept, "boxops.mjs"), files["dist/boxops.mjs"]);
    writeFileSync(join(kept, "BUILD.json"), files["BUILD.json"]);
    const io = capture({ cliDir: kept, cwd: repo.dir });
    const out = join(tempDir(), "site");
    expect(await main(["build", "--out", out], {}, io)).toBe(2);
    expect(io.stderr).toEqual([
      `boxops build: The app beside ${kept} isn’t whole (dist/app/assets/index-A1.js is missing or damaged): run the command through .boxops/boxops.mjs, which fetches it`,
    ]);
    // A release's boxops.mjs alone: not "in web/, run npm run build && npm run build:cli".
    const alone = tempDir();
    writeFileSync(join(alone, "boxops.mjs"), files["dist/boxops.mjs"]);
    const io2 = capture({ cliDir: alone, cwd: repo.dir });
    expect(await main(["build", "--out", out], {}, io2)).toBe(2);
    expect(io2.stderr).toEqual([`boxops build: No app beside ${alone}: run the command through .boxops/boxops.mjs, or set BOXOPS_CLI to a release’s dist/boxops.mjs`]);
    expect(() => readdirSync(out)).toThrow();
  });
});

describe("the token", () => {
  /**
   * A folder holding a stand-in `gh` signed in to a GitHub Enterprise Server
   * (`gh auth token` with no host prints that server's token, as gh does when
   * it's the only host or GH_HOST's), and to github.com if `github` is given.
   */
  function standInGh(github?: string): string {
    const bin = tempDir();
    const answer = github === undefined ? "exit 1" : `{ echo ${github}; exit 0; }`;
    writeFileSync(join(bin, "gh"), `#!/bin/sh\n[ "$*" = "auth token --hostname github.com" ] && ${answer}\n[ "$*" = "auth token" ] && { echo ghes-token; exit 0; }\nexit 1\n`, { mode: 0o755 });
    return bin;
  }

  it("is GH_TOKEN, else GITHUB_TOKEN, else the GitHub CLI's for github.com, never another host's", () => {
    const path = process.env.PATH;
    try {
      process.env.PATH = `${standInGh("gh-token")}${delimiter}${path}`;
      expect([gitHub({ GH_TOKEN: "a", GITHUB_TOKEN: "b" }).token(), gitHub({ GITHUB_TOKEN: "b" }).token(), gitHub({}).token()]).toEqual(["a", "b", "gh-token"]);
      // Signed in to a GitHub Enterprise Server alone: no token, rather than that server's sent to api.github.com.
      process.env.PATH = `${standInGh()}${delimiter}${path}`;
      expect(gitHub({}).token()).toBeUndefined();
    } finally {
      process.env.PATH = path;
    }
  });
});

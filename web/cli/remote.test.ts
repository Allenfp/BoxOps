// The commands that ask GitHub (doctor, upgrade, init) and preview, against a
// fake GitHub (a `fetch` that answers from a table). The launcher has its own
// tests (launcher.test.ts).

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./boxops";
import type { Io } from "./context";
import { doctorCommand } from "./doctor";
import { starterFiles } from "./embedded";
import { ensureApp, startPreview } from "./preview";
import { fetchRelease } from "./upgrade";
import { openRelease, verifiedApp } from "./release";
import { APP_FILES, ID, capture, cleanUp, fakeGitHub, releaseFiles, sampleRepo, tempDir } from "./test-release";
import { TestRepo } from "./test-repo";
import { SHELLS, block, paste, shellEnv, standIns } from "./test-shell";

const repos: TestRepo[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.remove();
  cleanUp();
});

const A = "a".repeat(40);
const B = "b".repeat(40);

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
    const cli = `import { appendFileSync } from "node:fs";\nexport async function main(argv, ctx) { appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, sha: ctx.sha, tag: ctx.tag, root: ctx.root }) + "\\n"); return 0; }\n`;
    return releaseFiles({ ...ID, version: "0.2.0", build: "0.2.0+fedcba987654" }, cli);
  }

  it("moves every pin (CRLF, Path B), runs the new release's migrate --check, sync and validate, and commits nothing", async () => {
    const repo = adopter(A, "v0.1.0", { crlf: true, pathB: true });
    const head = repo.git(["rev-parse", "HEAD"]);
    const log = join(tempDir(), "calls.jsonl");
    const gh = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.1.0": A, "v0.2.0": B } }, latest: { "Allenfp/BoxOps": "v0.2.0" }, files: { [B]: newRelease(log) } });
    const io = capture({ fetch: gh.fetch, cwd: repo.dir, env: { BOXOPS_CACHE: tempDir() } });
    expect(await main(["upgrade"], { root: repo.dir }, io)).toBe(0);
    expect(io.stdout[0]).toBe(
      `Moved the BoxOps pins in .github/workflows/check.yml, .github/workflows/deploy.yml, .github/workflows/path-b.yml from v0.1.0 to v0.2.0 (Allenfp/BoxOps@${B.slice(0, 12)}).`,
    );
    const deploy = readFileSync(join(repo.dir, ".github/workflows/deploy.yml"), "utf8");
    expect(deploy).toContain(`uses: Allenfp/BoxOps@${B} # v0.2.0\r\n`);
    expect(/[^\r]\n/.test(deploy)).toBe(false);
    expect(readFileSync(join(repo.dir, ".github/workflows/path-b.yml"), "utf8")).toContain(`BOXOPS_ACTION: Allenfp/BoxOps@${B} # v0.2.0\n`);
    const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(calls).toEqual([
      { argv: ["migrate", "--check"], sha: B, tag: "v0.2.0", root: repo.dir },
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

  it("never caches inside the repository", async () => {
    const repo = adopter(A);
    const gh = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.2.0": B } }, files: { [B]: newRelease(join(tempDir(), "x")) } });
    const io = capture({ fetch: gh.fetch, cwd: repo.dir, env: { BOXOPS_CACHE: join(repo.dir, ".cache") } });
    expect(await main(["upgrade", "v0.2.0"], { root: repo.dir }, io)).toBe(2);
    expect(io.stderr).toEqual(["boxops upgrade: BOXOPS_CACHE must be outside this repository"]);
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
    await expect(ensureApp(tempDir(), {}, capture())).rejects.toThrow(/^No app beside .*: run preview through \.boxops\/boxops\.mjs/);
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
      `The app beside ${cliDir} isn’t whole (dist/app/favicon.svg is missing or damaged): run preview through .boxops/boxops.mjs, which fetches it`,
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

// The commands that ask GitHub (doctor, upgrade, init) and preview, against a
// fake GitHub (a `fetch` that answers from a table), and the launcher.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./boxops";
import type { Io } from "./context";
import { doctorCommand } from "./doctor";
import { starterFiles } from "./embedded";
import { ensureApp, startPreview } from "./preview";
import { buildJsonText, type Identity, makeBuildJson, openRelease, verifiedApp } from "./release";
import { launcherText } from "./sync";
import { APP_FILES, ID, capture, cleanUp, sampleRepo, tempDir } from "./test-release";
import { TestRepo } from "./test-repo";

const repos: TestRepo[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.remove();
  cleanUp();
});

const A = "a".repeat(40);
const B = "b".repeat(40);

/** A fake GitHub: tags per repository (tag → commit), and files per commit. Every call is listed in `calls`. */
function fakeGitHub(o: { tags?: Record<string, Record<string, string>>; files?: Record<string, Record<string, string | Uint8Array>>; latest?: Record<string, string> }) {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    let m = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/git\/ref\/tags\/(.+)$/.exec(url);
    if (m) {
      const sha = o.tags?.[m[1]]?.[m[2]];
      return sha ? json({ ref: `refs/tags/${m[2]}`, object: { type: "commit", sha } }) : json({ message: "Not Found" }, 404);
    }
    m = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/git\/matching-refs\/tags\?per_page=100&page=1$/.exec(url);
    if (m) return json(Object.entries(o.tags?.[m[1]] ?? {}).map(([tag, sha]) => ({ ref: `refs/tags/${tag}`, object: { type: "commit", sha } })));
    m = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/releases\/latest$/.exec(url);
    if (m) return o.latest?.[m[1]] ? json({ tag_name: o.latest[m[1]] }) : json({ message: "Not Found" }, 404);
    m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([0-9a-f]{40})\/(.+)$/.exec(url);
    if (m) {
      const file = o.files?.[m[2]]?.[m[3]];
      return file === undefined ? new Response("404: Not Found", { status: 404 }) : new Response(typeof file === "string" ? file : Buffer.from(file));
    }
    return json({ message: "Not Found" }, 404);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

/** A release's files as GitHub serves them at its commit: BUILD.json, dist/boxops.mjs, the app. */
function releaseFiles(id: Identity, cli = "export async function main() { return 0; }\n"): Record<string, string | Uint8Array> {
  const files: Record<string, Uint8Array> = { "dist/boxops.mjs": Buffer.from(cli), "dist/action.mjs": Buffer.from('import "./boxops.mjs";\n') };
  for (const [p, t] of Object.entries(APP_FILES)) files[`dist/app/${p}`] = Buffer.from(t);
  return { ...files, "BUILD.json": buildJsonText(makeBuildJson(id, files)) };
}

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
    expect(io.stdout[0]).toBe(`Wrote a BoxOps roadmap repository in acme-roadmap/ (13 files), pinned to Allenfp/BoxOps@${A.slice(0, 12)} # v0.1.0. Next:`);
    expect(gh.calls).toEqual([
      "https://api.github.com/repos/Allenfp/BoxOps/git/ref/tags/v0.1.0",
      `https://raw.githubusercontent.com/Allenfp/BoxOps/${A}/BUILD.json`,
    ]);
    // The files it wrote validate, and sync has nothing to do.
    expect(await main(["validate"], {}, capture({ cwd: dir }))).toBe(0);
    expect(await main(["sync", "--check", "--root", dir], {}, capture())).toBe(0);
  });

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

  it("fetches the app once for a tool the launcher downloaded alone, checking every file", async () => {
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
});

describe("the launcher (starter/.boxops/boxops.mjs)", () => {
  /** A roadmap repository with the launcher, this deploy.yml, and a stand-in tool that prints what it was given. */
  function launcherRepo(deploy: string | null): { root: string; cli: string } {
    const root = tempDir();
    mkdirSync(join(root, ".boxops"));
    writeFileSync(join(root, ".boxops", "boxops.mjs"), launcherText());
    if (deploy !== null) {
      mkdirSync(join(root, ".github", "workflows"), { recursive: true });
      writeFileSync(join(root, ".github", "workflows", "deploy.yml"), deploy);
    }
    const cli = join(tempDir(), "boxops.mjs");
    writeFileSync(cli, "export async function main(argv, ctx) { console.log(JSON.stringify({ argv, ctx })); return argv[0] === 'fail' ? 3 : 0; }\n");
    return { root, cli };
  }
  const launch = (root: string, args: string[], env: Record<string, string>) => {
    const r = spawnSync(process.execPath, [join(root, ".boxops", "boxops.mjs"), ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: tempDir(), ...env } });
    return { code: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
  };

  it("finds the pin by the repository's name, CRLF, mirrors and Path B included, and passes main the contract", () => {
    const cases: [string, string, string | undefined][] = [
      [`jobs:\r\n  build:\r\n    steps:\r\n      - id: boxops\r\n        uses: Allenfp/BoxOps@${A} # v0.1.0\r\n`, "Allenfp/BoxOps", "v0.1.0"],
      [`      - uses: "acme/boxops-mirror@${A}" # v0.1.0 (mirror)\n`, "acme/boxops-mirror", "v0.1.0"],
      [`    env:\n      BOXOPS_ACTION: Allenfp/BoxOps@${A}\n`, "Allenfp/BoxOps", undefined],
    ];
    for (const [deploy, repo, tag] of cases) {
      const { root, cli } = launcherRepo(`      - uses: actions/checkout@${B} # v7.0.1\n${deploy}`);
      const r = launch(root, ["version", "--x"], { BOXOPS_CLI: cli });
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ argv: ["version", "--x"], ctx: { root: realpathSync(root), repo, sha: A, ...(tag && { tag }), launcher: 1 } });
    }
  });

  it("passes the tool's exit code on, and says what's wrong without a pin or deploy.yml", () => {
    const { root, cli } = launcherRepo(`uses: Allenfp/BoxOps@${A}\n`);
    expect(launch(root, ["fail"], { BOXOPS_CLI: cli }).code).toBe(3);
    const unpinned = launcherRepo("uses: Allenfp/BoxOps@v0.1.0\n");
    expect(launch(unpinned.root, ["version"], { BOXOPS_CLI: unpinned.cli })).toMatchObject({
      code: 2,
      stderr: "boxops: no `uses: <owner>/<boxops repo>@<40-character commit SHA>` line in .github/workflows/deploy.yml",
    });
    const none = launcherRepo(null);
    expect(launch(none.root, ["version"], { BOXOPS_CLI: none.cli })).toMatchObject({ code: 2, stderr: "boxops: no .github/workflows/deploy.yml in this repository, so no BoxOps release to run" });
  });

  it("refuses a cache inside the repository (before any download)", () => {
    const { root } = launcherRepo(`uses: Allenfp/BoxOps@${A}\n`);
    expect(launch(root, ["version"], { BOXOPS_CACHE: join(root, ".cache") })).toMatchObject({ code: 2, stderr: "boxops: BOXOPS_CACHE must be outside this repository" });
  });
});

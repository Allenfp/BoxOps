// The launcher (starter/.boxops/boxops.mjs), run with Node as a roadmap
// repository runs it: how it finds the pin, where it keeps the tool and how it
// checks it against BUILD.json, BOXOPS_CLI, private mirrors, proxies, and its
// warnings. GitHub is a table the launcher's fetch answers from (a module
// loaded with --import), every call noted; `gh` is a stand-in, so no test can
// read a real token.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WARNING_COMMANDS } from "./boxops";
import { type BuildJson, buildJsonText, makeBuildJson } from "./release";
import { launcherText } from "./sync";
import { ID, IGNORES_CASE, cleanUp, tempDir } from "./test-release";

afterEach(cleanUp);

const A = "a".repeat(40);
const B = "b".repeat(40);

/** A stand-in tool: prints what main was given (and NODE_USE_ENV_PROXY), as JSON; exits 3 for `fail`. */
const TOOL =
  "export async function main(argv, ctx) { console.log(JSON.stringify({ argv, ctx, proxy: process.env.NODE_USE_ENV_PROXY ?? null })); return argv[0] === 'fail' ? 3 : 0; }\n";

/** The BUILD.json of a release whose tool is `tool` (contract numbers as this release's, unless given). */
const buildJson = (tool = TOOL, o: Partial<BuildJson> = {}) => buildJsonText({ ...makeBuildJson(ID, { "dist/boxops.mjs": Buffer.from(tool) }), ...o });

/** What raw.githubusercontent.com serves for `repo@sha`: BUILD.json and the tool. */
const raw = (repo: string, sha: string, tool = TOOL, build = buildJson(tool)) => ({
  [`https://raw.githubusercontent.com/${repo}/${sha}/BUILD.json`]: build,
  [`https://raw.githubusercontent.com/${repo}/${sha}/dist/boxops.mjs`]: tool,
});

const DEPLOY = (pin = `Allenfp/BoxOps@${A} # v0.1.0`) =>
  `jobs:\n  build:\n    steps:\n      - uses: actions/checkout@${B} # v7.0.1\n      - id: boxops\n        uses: ${pin}\n  deploy:\n    steps:\n      - name: Check the GitHub Pages settings # boxops-guard: 1\n`;

/** A roadmap repository with the launcher, this deploy.yml (none if null) and these other files; its top level. */
function launcherRepo(deploy: string | null = DEPLOY(), files: Record<string, string> = {}): string {
  const root = realpathSync(tempDir());
  const all: Record<string, string> = { ".boxops/boxops.mjs": launcherText(), ...files };
  if (deploy !== null) all[".github/workflows/deploy.yml"] = deploy;
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** A release laid out as one is (BUILD.json beside dist/), with this tool; its dist/boxops.mjs. */
function releaseTool(tool = TOOL, build = buildJson(tool)): string {
  const dir = tempDir();
  mkdirSync(join(dir, "dist"));
  writeFileSync(join(dir, "dist", "boxops.mjs"), tool);
  writeFileSync(join(dir, "BUILD.json"), build);
  return join(dir, "dist", "boxops.mjs");
}

/** Answers fetch from FAKE_GITHUB (URL → body, base64), else 404; notes each call in FAKE_GITHUB_LOG. */
const FAKE_FETCH = `import { appendFileSync, readFileSync } from "node:fs";
const table = JSON.parse(readFileSync(process.env.FAKE_GITHUB, "utf8"));
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const headers = new Headers(init.headers);
  appendFileSync(process.env.FAKE_GITHUB_LOG, JSON.stringify({ url, auth: headers.get("authorization"), accept: headers.get("accept") }) + "\\n");
  return Object.hasOwn(table, url) ? new Response(Buffer.from(table[url], "base64")) : new Response("404: Not Found", { status: 404 });
};
`;

interface Call {
  url: string;
  auth: string | null;
  accept: string | null;
}

interface Launched {
  code: number | null;
  stdout: string;
  stderr: string;
  /** What the tool printed: main's arguments. */
  ran?: { argv: string[]; ctx: Record<string, unknown>; proxy: string | null };
  calls: Call[];
}

interface LaunchOptions {
  /** Added to a bare environment: PATH (a `gh` that has no token first), HOME and TMPDIR of the test's own. */
  env?: Record<string, string>;
  /** What GitHub serves. */
  github?: Record<string, string | Uint8Array>;
  /**
   * What `gh auth token --hostname github.com` prints (default: it fails, as
   * when signed out of github.com). `gh auth token` with no host prints a
   * GitHub Enterprise Server's token, as when gh is signed in to that alone:
   * never one to send to GitHub.
   */
  ghToken?: string;
  /** Node's options, after the --import of the stand-in fetch. */
  nodeArgs?: string[];
  /** Milliseconds before the launcher is stopped (exit code null): for a run that could hang. */
  timeout?: number;
}

/** Runs the launcher in `root` with Node. */
function launch(root: string, args: string[], o: LaunchOptions = {}): Launched {
  const dir = tempDir();
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const gh = [
    "#!/bin/sh",
    `[ "$*" = "auth token --hostname github.com" ] && ${o.ghToken === undefined ? "exit 1" : `{ echo ${o.ghToken}; exit 0; }`}`,
    '[ "$*" = "auth token" ] && { echo ghes-token; exit 0; }',
    "exit 1",
  ];
  writeFileSync(join(bin, "gh"), `${gh.join("\n")}\n`, { mode: 0o755 });
  writeFileSync(join(dir, "fetch.mjs"), FAKE_FETCH);
  const table = Object.fromEntries(Object.entries(o.github ?? {}).map(([url, body]) => [url, Buffer.from(body).toString("base64")]));
  writeFileSync(join(dir, "github.json"), JSON.stringify(table));
  writeFileSync(join(dir, "calls.jsonl"), "");
  const home = join(dir, "home");
  const tmp = join(dir, "tmp");
  mkdirSync(home);
  mkdirSync(tmp);
  const env = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: home,
    TMPDIR: tmp,
    FAKE_GITHUB: join(dir, "github.json"),
    FAKE_GITHUB_LOG: join(dir, "calls.jsonl"),
    ...o.env,
  };
  const node = ["--import", pathToFileURL(join(dir, "fetch.mjs")).href, ...(o.nodeArgs ?? [])];
  const r = spawnSync(process.execPath, [...node, join(root, ".boxops", "boxops.mjs"), ...args], { encoding: "utf8", env, timeout: o.timeout });
  const stdout = r.stdout.trim();
  const calls = readFileSync(join(dir, "calls.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Call);
  let ran: Launched["ran"];
  try {
    ran = JSON.parse(stdout.split("\n").pop() ?? "");
  } catch {
    ran = undefined;
  }
  return { code: r.status, stdout, stderr: r.stderr.trim(), ran, calls };
}

describe("the launcher finds the pin", () => {
  it("by the repository's name: CRLF, quotes, comments, mirrors and Path B too; and passes main the contract", () => {
    const cases: [string, string, string | undefined][] = [
      [`jobs:\r\n  build:\r\n    steps:\r\n      - id: boxops\r\n        uses: Allenfp/BoxOps@${A} # v0.1.0\r\n`, "Allenfp/BoxOps", "v0.1.0"],
      [`      - uses: "acme/boxops-mirror@${A}" # v0.1.0 (mirror)\n`, "acme/boxops-mirror", "v0.1.0"],
      [`    env:\n      BOXOPS_ACTION: Allenfp/BoxOps@${A}\n`, "Allenfp/BoxOps", undefined],
      // A pin commented out, one by tag, an action whose repository isn't named boxops and an uppercase SHA aren't the pin; the first that is, is.
      [`#     - uses: Allenfp/BoxOps@${B} # v0.0.9\n      - uses: Allenfp/BoxOps@v0.1.0\n      - uses: boxops-org/checkout@${B}\n      - uses: Allenfp/BoxOps@${"B".repeat(40)}\n      - uses: 'Allenfp/BoxOps@${A}' # v0.1.0\n      - uses: Allenfp/BoxOps@${B} # v0.1.1\n`, "Allenfp/BoxOps", "v0.1.0"],
    ];
    const tool = join(tempDir(), "tool.mjs");
    writeFileSync(tool, TOOL);
    for (const [deploy, repo, tag] of cases) {
      const root = launcherRepo(`      - uses: actions/checkout@${B} # v7.0.1\n${deploy}`);
      const r = launch(root, ["version", "--x"], { env: { BOXOPS_CLI: tool } });
      expect([r.code, r.ran]).toEqual([0, { argv: ["version", "--x"], ctx: { root, repo, sha: A, ...(tag && { tag }), launcher: 1 }, proxy: null }]);
    }
  });

  it("passes the tool's exit code on, and says what's wrong without a pin or deploy.yml", () => {
    const tool = join(tempDir(), "tool.mjs");
    writeFileSync(tool, TOOL);
    expect(launch(launcherRepo(), ["fail"], { env: { BOXOPS_CLI: tool } }).code).toBe(3);
    expect(launch(launcherRepo("uses: Allenfp/BoxOps@v0.1.0\n"), ["version"], { env: { BOXOPS_CLI: tool } })).toMatchObject({
      code: 2,
      stderr: "boxops: no `uses: <owner>/<boxops repo>@<40-character commit SHA>` line in .github/workflows/deploy.yml",
    });
    expect(launch(launcherRepo(null), ["version"], { env: { BOXOPS_CLI: tool } })).toMatchObject({
      code: 2,
      stderr: "boxops: no .github/workflows/deploy.yml in this repository, so no BoxOps release to run",
    });
  });
});

describe("the launcher's download", () => {
  it("fetches the pinned commit's tool and BUILD.json once, the tool checked, into a cache outside the repository", () => {
    const root = launcherRepo();
    const cache = join(tempDir(), "cache");
    const first = launch(root, ["validate"], { env: { BOXOPS_CACHE: cache }, github: raw("Allenfp/BoxOps", A) });
    expect([first.code, first.stderr, first.ran?.ctx]).toEqual([0, "", { root, repo: "Allenfp/BoxOps", sha: A, tag: "v0.1.0", launcher: 1, checked: true }]);
    expect(first.calls.map((c) => [c.url, c.auth])).toEqual([
      [`https://raw.githubusercontent.com/Allenfp/BoxOps/${A}/BUILD.json`, null],
      [`https://raw.githubusercontent.com/Allenfp/BoxOps/${A}/dist/boxops.mjs`, null],
    ]);
    const dir = join(realpathSync(cache), "Allenfp__BoxOps", A);
    expect(readdirSync(dir).sort()).toEqual(["BUILD.json", "boxops.mjs"]);
    expect(readFileSync(join(dir, "BUILD.json"), "utf8")).toBe(buildJson());
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "boxops.mjs")).mode & 0o777).toBe(0o600);
    // Once: the next run asks GitHub nothing.
    const again = launch(root, ["validate"], { env: { BOXOPS_CACHE: cache }, github: raw("Allenfp/BoxOps", A) });
    expect([again.code, again.ran?.argv, again.calls]).toEqual([0, ["validate"], []]);
  });

  it("won't run a tool that isn't the file its BUILD.json describes; a cached one that changed is fetched again", () => {
    const root = launcherRepo();
    const cache = join(tempDir(), "cache");
    const swapped = { ...raw("Allenfp/BoxOps", A), [`https://raw.githubusercontent.com/Allenfp/BoxOps/${A}/dist/boxops.mjs`]: "console.log('not the release');\n" };
    const r = launch(root, ["version"], { env: { BOXOPS_CACHE: cache }, github: swapped });
    expect([r.code, r.stdout, r.stderr]).toEqual([
      2,
      "",
      `boxops: dist/boxops.mjs as downloaded from Allenfp/BoxOps@${A.slice(0, 12)} isn’t the file its BUILD.json describes, so it wasn’t run: try again (a proxy may have changed it), or set BOXOPS_CLI`,
    ]);
    expect(existsSync(join(cache, "Allenfp__BoxOps", A, "boxops.mjs"))).toBe(false);

    expect(launch(root, ["version"], { env: { BOXOPS_CACHE: cache }, github: raw("Allenfp/BoxOps", A) }).code).toBe(0);
    writeFileSync(join(cache, "Allenfp__BoxOps", A, "boxops.mjs"), "console.log('changed in the cache');\n");
    const refetched = launch(root, ["version"], { env: { BOXOPS_CACHE: cache }, github: raw("Allenfp/BoxOps", A) });
    expect([refetched.code, refetched.ran?.argv, refetched.calls.length]).toEqual([0, ["version"], 2]);
    expect(readFileSync(join(cache, "Allenfp__BoxOps", A, "boxops.mjs"), "utf8")).toBe(TOOL);
  });

  it("reads a private mirror through the contents API with GH_TOKEN, else gh's for github.com (never another host's), and sends the token nowhere else", () => {
    const root = launcherRepo(DEPLOY(`acme/boxops-mirror@${A} # v0.1.0`));
    const api = (path: string) => `https://api.github.com/repos/acme/boxops-mirror/contents/${path}?ref=${A}`;
    const github = { [api("BUILD.json")]: buildJson(), [api("dist/boxops.mjs")]: TOOL };
    const withEnv = launch(root, ["version"], { env: { GH_TOKEN: "env-token" }, github, ghToken: "gh-token" });
    expect([withEnv.code, withEnv.ran?.ctx.repo]).toEqual([0, "acme/boxops-mirror"]);
    expect(withEnv.calls).toEqual([
      { url: `https://raw.githubusercontent.com/acme/boxops-mirror/${A}/BUILD.json`, auth: null, accept: null },
      { url: api("BUILD.json"), auth: "Bearer env-token", accept: "application/vnd.github.raw+json" },
      { url: api("dist/boxops.mjs"), auth: "Bearer env-token", accept: "application/vnd.github.raw+json" },
    ]);
    const withGh = launch(root, ["version"], { github, ghToken: "gh-token" });
    expect([withGh.code, withGh.calls.filter((c) => c.auth).map((c) => c.auth)]).toEqual([0, ["Bearer gh-token", "Bearer gh-token"]]);
    // gh signed in to another host alone (its token is gh's default): none is sent.
    const none = launch(root, ["version"], { github: {} });
    expect([none.code, none.stderr]).toEqual([
      2,
      `boxops: couldn’t download BoxOps v0.1.0 from acme/boxops-mirror. Check the network; behind a proxy, set HTTPS_PROXY (Node.js 22.21+ or 24+ uses it; this is ${process.versions.node}) and, if it re-signs TLS, run \`node --use-system-ca .boxops/boxops.mjs …\`; for a private mirror set GH_TOKEN or run \`gh auth login\`; offline, set BOXOPS_CLI to that release’s dist/boxops.mjs.`,
    ]);
    expect(none.calls.every((c) => c.auth === null)).toBe(true);
  });
});

describe("the launcher offline (BOXOPS_CLI)", () => {
  it("runs a release's tool, checked against the BUILD.json beside dist/, asking GitHub nothing", () => {
    const root = launcherRepo();
    const ok = launch(root, ["report"], { env: { BOXOPS_CLI: releaseTool() } });
    expect([ok.code, ok.ran?.ctx.checked, ok.calls]).toEqual([0, true, []]);
    const tampered = releaseTool();
    writeFileSync(tampered, `${TOOL}// changed\n`);
    const bad = launch(root, ["report"], { env: { BOXOPS_CLI: tampered } });
    expect([bad.code, bad.stdout, bad.stderr]).toEqual([2, "", `boxops: BOXOPS_CLI (${tampered}) isn’t the boxops.mjs its BUILD.json (${join(tampered, "..", "..", "BUILD.json")}) describes`]);
  });

  it("says when its BUILD.json is another release than deploy.yml's `# vX.Y.Z`, and runs it all the same", () => {
    const tool = releaseTool();
    const r = launch(launcherRepo(DEPLOY(`Allenfp/BoxOps@${A} # v0.2.0`)), ["version"], { env: { BOXOPS_CLI: tool } });
    expect([r.code, r.ran?.ctx.tag, r.stderr]).toEqual([0, "v0.2.0", `boxops: BOXOPS_CLI (${tool}) is BoxOps 0.1.0, but deploy.yml pins v0.2.0: set it to that release’s dist/boxops.mjs`]);
    // The release pinned, or no tag to compare with: nothing to say.
    expect(launch(launcherRepo(), ["version"], { env: { BOXOPS_CLI: tool } }).stderr).toBe("");
    expect(launch(launcherRepo(DEPLOY(`Allenfp/BoxOps@${A}`)), ["version"], { env: { BOXOPS_CLI: tool } }).stderr).toBe("");
  });

  it("runs a tool alone, as given (the tool then warns of old files itself), and a web/dist build beside its BUILD.json", () => {
    const root = launcherRepo();
    const alone = join(tempDir(), "boxops.mjs");
    writeFileSync(alone, TOOL);
    const r = launch(root, ["report"], { env: { BOXOPS_CLI: alone } });
    expect([r.code, r.ran?.ctx.checked, r.calls]).toEqual([0, undefined, []]);
    const dist = join(tempDir(), "dist");
    mkdirSync(dist);
    writeFileSync(join(dist, "boxops.mjs"), TOOL);
    writeFileSync(join(dist, "BUILD.json"), buildJson());
    expect(launch(root, ["report"], { env: { BOXOPS_CLI: join(dist, "boxops.mjs") } }).ran?.ctx.checked).toBe(true);
  });

  it("says so when there's no such file, or it's a folder, or the release needs a newer Node.js", () => {
    const missing = join(tempDir(), "boxops.mjs");
    expect(launch(launcherRepo(), ["version"], { env: { BOXOPS_CLI: missing } })).toMatchObject({ code: 2, stderr: `boxops: BOXOPS_CLI is ${missing}, and there’s no such file` });
    const folder = join(releaseTool(), "..");
    expect(launch(launcherRepo(), ["version"], { env: { BOXOPS_CLI: folder } })).toMatchObject({
      code: 2,
      stderr: `boxops: BOXOPS_CLI is ${folder}, which isn’t a file: set it to the dist/boxops.mjs of a copy of the pinned release`,
    });
    const r = launch(launcherRepo(), ["version"], { env: { BOXOPS_CLI: releaseTool(TOOL, buildJson(TOOL, { node: ">=99.0" })) } });
    expect([r.code, r.stderr]).toEqual([2, `boxops: BoxOps 0.1.0 needs Node.js 99.0 or newer (this is ${process.versions.node})`]);
  });
});

describe("the launcher's cache", () => {
  /** Where a run with this environment kept the tool (it downloads it), as a path from `base`; null if it ran none. */
  function cachedIn(env: Record<string, string>, base: string): string | null {
    const tools = () => readdirSync(base, { recursive: true }).map(String).filter((p) => p.endsWith(join("Allenfp__BoxOps", A, "boxops.mjs")));
    const before = new Set(tools());
    const r = launch(launcherRepo(), ["version"], { env, github: raw("Allenfp/BoxOps", A) });
    if (r.code !== 0 || r.calls.length !== 2) return null;
    const made = tools().filter((p) => !before.has(p));
    return made.length === 1 ? made[0] : null;
  }

  it("is BOXOPS_CACHE, else $XDG_CACHE_HOME/boxops, else ~/.cache/boxops, else a folder of this user's in the temp folder", () => {
    const base = realpathSync(tempDir());
    let n = 0;
    /** A fresh home (and temp folder) each time, so each run downloads. */
    const env = (o: Record<string, string> = {}) => {
      n++;
      mkdirSync(join(base, `home${n}`));
      mkdirSync(join(base, `tmp${n}`));
      return { HOME: join(base, `home${n}`), TMPDIR: join(base, `tmp${n}`), ...o };
    };
    const tail = join("Allenfp__BoxOps", A, "boxops.mjs");
    expect(cachedIn(env({ BOXOPS_CACHE: join(base, "mine"), XDG_CACHE_HOME: join(base, "xdg") }), base)).toBe(join("mine", tail));
    expect(cachedIn(env({ XDG_CACHE_HOME: join(base, "xdg") }), base)).toBe(join("xdg", "boxops", tail));
    expect(cachedIn(env(), base)).toBe(join("home3", ".cache", "boxops", tail));
    // A relative XDG_CACHE_HOME is to be ignored (XDG's rule).
    expect(cachedIn(env({ XDG_CACHE_HOME: "relative" }), base)).toBe(join("home4", ".cache", "boxops", tail));
    // ~/.cache can't be made (a file is in the way): the temp folder.
    writeFileSync(join(base, "file"), "");
    expect(cachedIn(env({ HOME: join(base, "file", "home") }), base)).toBe(join("tmp5", `boxops-cache-${process.getuid?.() ?? "user"}`, tail));
    // Writable by others: passed over.
    mkdirSync(join(base, "shared"));
    chmodSync(join(base, "shared"), 0o777);
    expect(cachedIn(env({ BOXOPS_CACHE: join(base, "shared") }), base)).toBe(join("home6", ".cache", "boxops", tail));
  });

  it("in the temp folder, which anyone can write to, is only a folder that no one else can use: never a symlink", () => {
    const base = realpathSync(tempDir());
    writeFileSync(join(base, "file"), "");
    // ~/.cache can't be made (a file is in the way): the temp folder is all that's left.
    const env = { HOME: join(base, "file", "home"), TMPDIR: join(base, "tmp") };
    mkdirSync(env.TMPDIR);
    const there = join(env.TMPDIR, `boxops-cache-${process.getuid?.() ?? "user"}`);
    // Left there by another user: a symlink to a folder of yours that others can read (a clone of their repository,
    // say), holding a tool where the pinned release's would be, with a BUILD.json that describes it.
    const planted = "export async function main() { console.log('PLANTED TOOL RAN'); return 0; }\n";
    const clone = join(base, "clone");
    mkdirSync(join(clone, "Allenfp__BoxOps", A), { recursive: true });
    writeFileSync(join(clone, "Allenfp__BoxOps", A, "boxops.mjs"), planted);
    writeFileSync(join(clone, "Allenfp__BoxOps", A, "BUILD.json"), buildJson(planted));
    chmodSync(clone, 0o755);
    symlinkSync(clone, there);
    const refused = "boxops: no writable cache folder outside this repository; set BOXOPS_CACHE (a folder of yours) or BOXOPS_CLI";
    const linked = launch(launcherRepo(), ["version"], { env, github: raw("Allenfp/BoxOps", A) });
    expect([linked.code, linked.stdout, linked.stderr, linked.calls]).toEqual([2, "", refused, []]);
    // That folder itself there, which others can read: passed over too.
    rmSync(there);
    renameSync(clone, there);
    const shared = launch(launcherRepo(), ["version"], { env, github: raw("Allenfp/BoxOps", A) });
    expect([shared.code, shared.stdout, shared.stderr, shared.calls]).toEqual([2, "", refused, []]);
  });

  it("is never inside the repository: BOXOPS_CACHE there is refused, an XDG_CACHE_HOME there passed over, and nothing is made there", () => {
    const root = launcherRepo();
    const r = launch(root, ["version"], { env: { BOXOPS_CACHE: join(root, ".cache") }, github: raw("Allenfp/BoxOps", A) });
    expect([r.code, r.stderr, r.calls]).toEqual([2, "boxops: BOXOPS_CACHE must be outside this repository", []]);
    const xdg = launch(root, ["version"], { env: { XDG_CACHE_HOME: join(root, "cache") }, github: raw("Allenfp/BoxOps", A) });
    expect([xdg.code, xdg.ran?.argv]).toEqual([0, ["version"]]);
    expect(readdirSync(root).sort()).toEqual([".boxops", ".github"]);
  });

  it.skipIf(!IGNORES_CASE)("is never inside the repository, whatever case names it, on a disk that ignores case: a tool planted there never runs", () => {
    const root = launcherRepo();
    // A tool in the repository where a cache there would keep it, with a BUILD.json that describes it.
    const planted = "export async function main() { console.log('PLANTED TOOL RAN'); return 0; }\n";
    const dir = join(root, ".cache", "Allenfp__BoxOps", A);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "boxops.mjs"), planted);
    writeFileSync(join(dir, "BUILD.json"), buildJson(planted));
    for (const cache of [join(root.toUpperCase(), ".cache"), join(root, ".CACHE"), join(root.toUpperCase(), "new", "cache")]) {
      const r = launch(root, ["version"], { env: { BOXOPS_CACHE: cache }, github: raw("Allenfp/BoxOps", A) });
      expect([cache, r.code, r.stdout, r.stderr, r.calls]).toEqual([cache, 2, "", "boxops: BOXOPS_CACHE must be outside this repository", []]);
    }
    // XDG_CACHE_HOME there: passed over for ~/.cache/boxops.
    const xdg = launch(root, ["version"], { env: { XDG_CACHE_HOME: join(root.toUpperCase(), "cache") }, github: raw("Allenfp/BoxOps", A) });
    expect([xdg.code, xdg.ran?.argv, xdg.calls.length]).toEqual([0, ["version"], 2]);
    expect(readdirSync(root).sort()).toEqual([".boxops", ".cache", ".github"]);
  });
});

describe("the launcher's warnings", () => {
  const old = buildJson(TOOL, { launcher: 2, agentsBlock: 3, guard: 4 });

  it("says when the launcher, AGENTS.md's BoxOps block or deploy.yml's Pages guard isn't the release's, and tells the tool it has", () => {
    const root = launcherRepo(DEPLOY(), { "AGENTS.md": "# Ours\n<!-- boxops:begin block=1 -->\n<!-- boxops:end -->\n" });
    const r = launch(root, ["validate"], { env: { BOXOPS_CLI: releaseTool(TOOL, old) } });
    expect([r.code, r.ran?.ctx.checked]).toEqual([0, true]);
    expect(r.stderr.split("\n")).toEqual([
      "boxops: the launcher is 1; this BoxOps writes 2: run `node .boxops/boxops.mjs sync`",
      "boxops: AGENTS.md’s BoxOps block is 1; this BoxOps writes 3: run `node .boxops/boxops.mjs sync`",
      "boxops: the Pages guard in deploy.yml is 1; this BoxOps expects 4: run `node .boxops/boxops.mjs doctor`",
    ]);
    // On the commands the tool warns on, and no others (sync writes them, doctor lists them…):
    // those the tool decides on, which it doesn't for these.
    const others = ["sync", "doctor", "init", "version", "--version", "help", "--help", "-h", "action", "nope", ""];
    expect(WARNING_COMMANDS).not.toContain("version");
    for (const command of [...WARNING_COMMANDS, ...others]) {
      const ran = launch(root, command ? [command] : [], { env: { BOXOPS_CLI: releaseTool(TOOL, old) } });
      const warns = WARNING_COMMANDS.includes(command);
      expect([command, ran.code, ran.stderr.split("\n").filter(Boolean).length, ran.ran?.ctx.checked]).toEqual([command, 0, warns ? 3 : 0, warns || undefined]);
    }
    // The release's own numbers: nothing to say. No block in AGENTS.md: nothing either.
    expect(launch(root, ["validate"], { env: { BOXOPS_CLI: releaseTool() } }).stderr).toBe("");
    expect(launch(launcherRepo(DEPLOY(), { "AGENTS.md": "# Ours\n" }), ["validate"], { env: { BOXOPS_CLI: releaseTool(TOOL, buildJson(TOOL, { agentsBlock: 3 })) } }).stderr).toBe("");
  });

  it("reads AGENTS.md only as a plain file, never through a symlink: to /dev/zero, say, a read would never end", () => {
    // A block of the wrong number elsewhere, and a pipe no one writes to, as never-ending as /dev/zero.
    const block = join(tempDir(), "AGENTS.md");
    writeFileSync(block, "<!-- boxops:begin block=1 -->\n<!-- boxops:end -->\n");
    const pipe = join(tempDir(), "pipe");
    execFileSync("mkfifo", [pipe]);
    for (const target of [block, pipe]) {
      const root = launcherRepo();
      symlinkSync(target, join(root, "AGENTS.md"));
      const r = launch(root, ["validate"], { env: { BOXOPS_CLI: releaseTool(TOOL, old) }, timeout: 20_000 });
      expect([target, r.code, r.ran?.ctx.checked, r.stderr.split("\n")]).toEqual([
        target,
        0,
        true,
        [
          "boxops: the launcher is 1; this BoxOps writes 2: run `node .boxops/boxops.mjs sync`",
          "boxops: the Pages guard in deploy.yml is 1; this BoxOps expects 4: run `node .boxops/boxops.mjs doctor`",
        ],
      ]);
    }
  });
});

describe("the launcher and proxies", () => {
  it("turns on Node's own proxy support when HTTPS_PROXY is set (fetch ignores it otherwise)", () => {
    const root = launcherRepo();
    const tool = releaseTool();
    expect(launch(root, ["version"], { env: { BOXOPS_CLI: tool } }).ran?.proxy).toBe(null);
    expect(launch(root, ["version"], { env: { BOXOPS_CLI: tool, HTTPS_PROXY: "http://127.0.0.1:9" } }).ran?.proxy).toBe("1");
    expect(launch(root, ["version"], { env: { BOXOPS_CLI: tool, https_proxy: "http://127.0.0.1:9" } }).ran?.proxy).toBe("1");
  });

  it("starts Node again with the options it was given (--use-system-ca, for a proxy that re-signs TLS, say)", () => {
    const tool = "export async function main() { console.log(JSON.stringify({ execArgv: process.execArgv, proxy: process.env.NODE_USE_ENV_PROXY ?? null })); return 0; }\n";
    const r = launch(launcherRepo(), ["version"], { env: { HTTPS_PROXY: "http://127.0.0.1:9" }, github: raw("Allenfp/BoxOps", A, tool), nodeArgs: ["--no-warnings"] });
    // The tool came through the stand-in fetch, which only Node's --import option loads.
    expect([r.code, r.calls.length]).toEqual([0, 2]);
    expect(JSON.parse(r.stdout)).toEqual({ execArgv: ["--import", expect.stringMatching(/^file:.*\/fetch\.mjs$/), "--no-warnings"], proxy: "1" });
  });
});

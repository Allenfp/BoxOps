#!/usr/bin/env node
// BoxOps launcher (launcher: 1). Managed by BoxOps: `node .boxops/boxops.mjs sync` rewrites it.
// Runs the BoxOps command-line tool of exactly the release this repository deploys: the commit
// on the first `uses: <owner>/<repo with "boxops" in its name>@<40-hex SHA>` line of
// .github/workflows/deploy.yml (or its BOXOPS_ACTION line, for Path B).
//   node .boxops/boxops.mjs validate | report | preview | migrate | guide | doctor | sync | upgrade | version
// That commit's dist/boxops.mjs is downloaded once, checked against the commit's BUILD.json, and
// kept with it in a cache outside this repository (a file in the repository would run as code on
// everyone's machine). Each command warns when this launcher, AGENTS.md's BoxOps block or
// deploy.yml's Pages guard isn't the release's.
// Env: BOXOPS_CLI=<a release's dist/boxops.mjs> (offline), BOXOPS_CACHE=<a folder outside this
// repository>, GH_TOKEN (private mirrors; else `gh auth token`), HTTPS_PROXY (a proxy).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LAUNCHER = 1;
const fail = (msg) => {
  console.error(`boxops: ${msg}`);
  process.exit(2);
};
const atLeast = (version, [major, minor]) => {
  const [maj, min] = version.split(".").map(Number);
  return maj > major || (maj === major && min >= minor);
};
if (!atLeast(process.versions.node, [22, 12])) fail(`needs Node.js 22.12 or newer (this is ${process.versions.node})`);

// Node's fetch honours HTTPS_PROXY only when NODE_USE_ENV_PROXY=1 at startup (Node 22.21+, 24+).
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  process.exit(r.status ?? 2);
}

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
const inRepo = (path) => path === root || path.startsWith(root + sep);
const read = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
};
const digest = (bytes) => `sha256-${createHash("sha256").update(bytes).digest("base64")}`;

const workflow = read(join(root, ".github/workflows/deploy.yml"));
if (workflow === undefined) fail("no .github/workflows/deploy.yml in this repository, so no BoxOps release to run");
// LF or CRLF; quoted or not; a mirror's name; `# vX.Y.Z` (Dependabot keeps it on the line).
const PIN = /^[ \t]*(?:-[ \t]+)?(?:uses|BOXOPS_ACTION)[ \t]*:[ \t]*(["']?)([\w.-]+\/[\w.-]*boxops[\w.-]*)@([0-9a-f]{40})\1(?:[ \t]+#[ \t]*(\S+)[^\r\n]*)?[ \t\r]*$/gim;
const pin = [...workflow.matchAll(PIN)].find((m) => /^[0-9a-f]{40}$/.test(m[3]));
if (!pin) fail("no `uses: <owner>/<boxops repo>@<40-character commit SHA>` line in .github/workflows/deploy.yml");
const [, , repo, sha, tag] = pin;

const { cli, build } = process.env.BOXOPS_CLI ? given(resolve(process.env.BOXOPS_CLI)) : await cached();
if (build?.node && /^>=\d+\.\d+$/.test(build.node) && !atLeast(process.versions.node, build.node.slice(2).split(".").map(Number))) {
  fail(`BoxOps ${build.version} needs Node.js ${build.node.slice(2)} or newer (this is ${process.versions.node})`);
}
const checked = build !== undefined && warn(build);
const { main } = await import(pathToFileURL(cli).href);
process.exitCode = await main(process.argv.slice(2), { root, repo, sha, tag, launcher: LAUNCHER, ...(checked && { checked }) });

/** $BOXOPS_CLI: a release's dist/boxops.mjs, checked against the BUILD.json beside dist/ (or in its folder) if there is one. */
function given(file) {
  if (!existsSync(file)) fail(`BOXOPS_CLI is ${file}, and there’s no such file`);
  const dir = dirname(file);
  const json = [basename(dir) === "dist" ? join(dir, "..", "BUILD.json") : "", join(dir, "BUILD.json")].find((f) => f && existsSync(f));
  if (!json) return { cli: file };
  const build = parseBuild(read(json));
  if (build?.files["dist/boxops.mjs"] !== digest(readFileSync(file))) fail(`BOXOPS_CLI (${file}) isn’t the boxops.mjs its BUILD.json (${json}) describes`);
  return { cli: file, build };
}

/** A BoxOps BUILD.json's fields, or undefined if it isn't one. */
function parseBuild(text) {
  try {
    const b = JSON.parse(text);
    return b?.name === "BoxOps" && typeof b.files?.["dist/boxops.mjs"] === "string" ? b : undefined;
  } catch {
    return undefined;
  }
}

/** The pinned commit's tool and BUILD.json: from the cache if the tool there is the file its BUILD.json describes, else downloaded. */
async function cached() {
  const dir = join(cacheRoot(), repo.replace("/", "__"), sha);
  if (inRepo(dir)) fail(`${dir} is inside this repository: set BOXOPS_CACHE to a folder outside it`);
  const cli = join(dir, "boxops.mjs");
  const build = parseBuild(read(join(dir, "BUILD.json")));
  if (build && existsSync(cli) && digest(readFileSync(cli)) === build.files["dist/boxops.mjs"]) return { cli, build };
  return { cli, build: await download(dir) };
}

/** Downloads the pinned commit's BUILD.json and dist/boxops.mjs into `dir`, the tool checked against the BUILD.json. */
async function download(dir) {
  let token;
  const sources = [
    (path) => [`https://raw.githubusercontent.com/${repo}/${sha}/${path}`, {}], // public repositories
    (path) => {
      token ??= githubToken() ?? "";
      const auth = token ? { Authorization: `Bearer ${token}` } : {};
      return [`https://api.github.com/repos/${repo}/contents/${path}?ref=${sha}`, { Accept: "application/vnd.github.raw+json", ...auth }]; // private mirrors
    },
  ];
  for (const at of sources) {
    const json = await get(...at("BUILD.json"));
    const build = json && parseBuild(json.toString("utf8"));
    const bytes = build && (await get(...at("dist/boxops.mjs")));
    if (!bytes) continue;
    if (digest(bytes) !== build.files["dist/boxops.mjs"]) {
      fail(`dist/boxops.mjs as downloaded from ${repo}@${sha.slice(0, 12)} isn’t the file its BUILD.json describes, so it wasn’t run: try again (a proxy may have changed it), or set BOXOPS_CLI`);
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    keep(join(dir, "boxops.mjs"), bytes);
    keep(join(dir, "BUILD.json"), json);
    return build;
  }
  fail(
    `couldn’t download BoxOps ${tag ?? sha.slice(0, 7)} from ${repo}. Check the network; for a private ` +
      "mirror set GH_TOKEN or run `gh auth login`; offline, set BOXOPS_CLI to a release’s dist/boxops.mjs.",
  );
}

async function get(url, headers) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}

/** Writes a file whole, then moves it into place, so nothing ever reads half of one. */
function keep(file, bytes) {
  writeFileSync(`${file}.${process.pid}`, bytes, { mode: 0o600 });
  renameSync(`${file}.${process.pid}`, file);
}

/**
 * The cache: $BOXOPS_CACHE, $XDG_CACHE_HOME/boxops, ~/.cache/boxops, then a folder of this
 * user's in the temp folder (which sandboxes allow); the first that is outside this repository
 * (a file committed there would run as code), can be made and written, is this user's and
 * isn't writable by others.
 */
function cacheRoot() {
  const uid = process.getuid?.();
  const xdg = process.env.XDG_CACHE_HOME;
  const tries = [
    process.env.BOXOPS_CACHE && resolve(process.env.BOXOPS_CACHE),
    xdg && isAbsolute(xdg) && join(xdg, "boxops"),
    join(homedir(), ".cache", "boxops"),
    join(tmpdir(), `boxops-cache-${uid ?? "user"}`),
  ];
  for (const [i, dir] of tries.entries()) {
    if (!dir) continue;
    try {
      if (inRepo(realish(dir))) {
        if (i === 0) fail("BOXOPS_CACHE must be outside this repository");
        continue;
      }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const real = realpathSync(dir);
      const st = statSync(real);
      if (inRepo(real) || (uid !== undefined && (st.uid !== uid || st.mode & 0o022))) continue; // someone else's, or others can write to it
      writeFileSync(join(real, ".write-test"), "");
      return real;
    } catch {
      // Not writable here (a sandbox, say): try the next.
    }
  }
  fail("no writable cache folder outside this repository; set BOXOPS_CACHE (a folder of yours) or BOXOPS_CLI");
}

/** `path` with the symlinks in its existing part resolved: where a folder not made yet would be. */
function realish(path) {
  const rest = [];
  let at = path;
  while (!existsSync(at) && dirname(at) !== at) {
    rest.unshift(basename(at));
    at = dirname(at);
  }
  return join(realpathSync(at), ...rest);
}

function githubToken() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Warns when this launcher, AGENTS.md's BoxOps block or deploy.yml's Pages guard isn't what the
 * release's BUILD.json names (as the tool would; not for `sync`, which writes the first two,
 * `doctor`, which lists them all, or `init` and `version`). True: the tool needn't check them.
 */
function warn(build) {
  if (["sync", "doctor", "init", "version"].includes(process.argv[2])) return true;
  const number = (text, re) => {
    const m = re.exec(text ?? "");
    return m ? Number(m[1]) : null;
  };
  const say = (what, n, want, verb, fix) => {
    if (n !== null && Number.isInteger(want) && n !== want) console.error(`boxops: ${what} is ${n}; this BoxOps ${verb} ${want}: run \`node .boxops/boxops.mjs ${fix}\``);
  };
  say("the launcher", LAUNCHER, build.launcher, "writes", "sync");
  say("AGENTS.md’s BoxOps block", number(read(join(root, "AGENTS.md")), /<!--\s*boxops:begin block=(\d+)/), build.agentsBlock, "writes", "sync");
  say("the Pages guard in deploy.yml", number(workflow, /#\s*boxops-guard:\s*(\d+)/), build.guard, "expects", "doctor");
  return true;
}

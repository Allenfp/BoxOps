#!/usr/bin/env node
// BoxOps launcher (launcher: 1). Managed by BoxOps: `node .boxops/boxops.mjs sync` rewrites it.
// Runs the BoxOps command-line tool from exactly the release this repository deploys: the
// commit on the `uses: <owner>/<repo with "boxops" in its name>@<40-hex SHA>` line of
// .github/workflows/deploy.yml (or its BOXOPS_ACTION line, for Path B).
//   node .boxops/boxops.mjs validate | report | preview | migrate | guide | doctor | sync | upgrade | version
// Env: BOXOPS_CLI=<boxops.mjs> (offline), BOXOPS_CACHE=<dir outside this repo>, GH_TOKEN (private mirrors).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LAUNCHER = 1;
const fail = (msg) => {
  console.error(`boxops: ${msg}`);
  process.exit(2);
};
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 22 || (maj === 22 && min < 12)) fail(`needs Node.js 22.12 or newer (this is ${process.versions.node})`);

// Node's fetch honours HTTPS_PROXY only when NODE_USE_ENV_PROXY=1 at startup (Node 22.21+, 24+).
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  process.exit(r.status ?? 2);
}

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
let workflow = "";
try {
  workflow = readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8");
} catch {
  fail("no .github/workflows/deploy.yml in this repository, so no BoxOps release to run");
}
const pin = /^\s*(?:-\s+)?(?:uses|BOXOPS_ACTION)\s*:\s*["']?([\w.-]+\/[\w.-]*boxops[\w.-]*)@([0-9a-f]{40})["']?(?:\s+#\s*(\S+).*?)?\s*$/im.exec(workflow);
if (!pin) fail("no `uses: <owner>/<boxops repo>@<40-character commit SHA>` line in .github/workflows/deploy.yml");
const [, repo, sha, tag] = pin;

const cli = process.env.BOXOPS_CLI ? resolve(process.env.BOXOPS_CLI) : await fetchCli();
const { main } = await import(pathToFileURL(cli).href);
process.exitCode = await main(process.argv.slice(2), { root, repo, sha, tag, launcher: LAUNCHER });

async function fetchCli() {
  const dir = join(cacheRoot(), repo.replace("/", "__"), sha);
  const file = join(dir, "boxops.mjs");
  if (existsSync(file)) return file;
  const urls = [
    `https://raw.githubusercontent.com/${repo}/${sha}/dist/boxops.mjs`, // public repositories
    `https://api.github.com/repos/${repo}/contents/dist/boxops.mjs?ref=${sha}`, // private mirrors
  ];
  for (const [i, url] of urls.entries()) {
    const token = i === 1 ? githubToken() : undefined;
    const headers = i === 1 ? { Accept: "application/vnd.github.raw+json", ...(token && { Authorization: `Bearer ${token}` }) } : {};
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
    if (!res?.ok) continue;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.${process.pid}`, Buffer.from(await res.arrayBuffer()), { mode: 0o600 });
    renameSync(`${file}.${process.pid}`, file);
    return file;
  }
  fail(
    `couldn't download BoxOps ${tag ?? sha.slice(0, 7)} from ${repo}. Check the network; for a private ` +
      "mirror set GH_TOKEN or run `gh auth login`; offline, set BOXOPS_CLI to a downloaded boxops.mjs.",
  );
}

// The cache never lives inside the repository: a file committed there would run as code.
function cacheRoot() {
  const uid = process.getuid?.();
  const tries = [
    process.env.BOXOPS_CACHE,
    process.env.XDG_CACHE_HOME && join(process.env.XDG_CACHE_HOME, "boxops"),
    join(homedir(), ".cache", "boxops"),
    join(tmpdir(), `boxops-cache-${uid ?? "user"}`),
  ];
  for (const dir of tries.filter(Boolean)) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const real = realpathSync(dir);
      if (real === root || real.startsWith(root + sep)) {
        if (dir === process.env.BOXOPS_CACHE) fail("BOXOPS_CACHE must be outside this repository");
        continue;
      }
      const st = statSync(real);
      if (uid !== undefined && (st.uid !== uid || st.mode & 0o022)) continue; // someone else's, or writable by others
      writeFileSync(join(real, ".write-test"), "");
      return real;
    } catch {
      // Not writable here (a sandbox, say): try the next.
    }
  }
  fail("no writable cache folder outside this repository; set BOXOPS_CACHE or BOXOPS_CLI");
}

function githubToken() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

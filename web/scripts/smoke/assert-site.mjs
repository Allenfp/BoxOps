// Checks what the action of a release tree made of a roadmap repository, for
// the smoke tests: the site (--site) is the release's dist/app, byte for
// byte, and a roadmap.json holding the repository's roadmap at HEAD, read
// from its git objects (files, blob and tree ids, the commit), with the
// release's build id and data format; the step's outputs (the JSON of
// `steps.<id>.outputs` in $BOXOPS_OUTPUTS, if it's set) are the release's
// and the roadmap's, and clean; and nothing planted in it ran (--sentinels,
// plant-hostile.sh's folder, is empty). Plain JavaScript: it runs where npm
// never did. Exit 1, saying what's wrong, if anything is.
//
// Usage: node assert-site.mjs --release DIR --repo DIR [--site DIR] [--sentinels DIR]
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: o } = parseArgs({ options: { release: { type: "string" }, repo: { type: "string" }, site: { type: "string" }, sentinels: { type: "string" } } });
if (!o.release || !o.repo) {
  console.error("Usage: node assert-site.mjs --release DIR --repo DIR [--site DIR] [--sentinels DIR]");
  process.exit(2);
}
const problems = [];
const same = (actual, expected, what) => {
  const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
  if (a !== e) problems.push(`${what}: ${a.slice(0, 300)}, not ${e.slice(0, 300)}`);
};

/** Every file under `dir`, "/"-separated, sorted. */
const walk = (dir, rel = "") =>
  readdirSync(join(dir, rel))
    .sort()
    .flatMap((name) => {
      const path = rel ? `${rel}/${name}` : name;
      return lstatSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path];
    });

/** git in the repository, without configuration (its own, planted, is left out too: plumbing only). */
const git = (args) =>
  execFileSync("git", ["--git-dir", join(resolve(o.repo), ".git"), "-c", "core.hooksPath=/dev/null", ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });

const build = JSON.parse(readFileSync(join(o.release, "BUILD.json"), "utf8"));
const commit = git(["rev-parse", "HEAD"]).trim();
const result = /^\d+ departments, \d+ lanes, \d+ boxes — OK$/;

if (o.site) {
  const app = walk(join(o.release, "dist", "app"));
  same(walk(o.site), [...app, "roadmap.json"].sort(), "the site's files");
  for (const p of app) {
    if (existsSync(join(o.site, p)) && !readFileSync(join(o.site, p)).equals(readFileSync(join(o.release, "dist", "app", p)))) problems.push(`the site's ${p} isn't the release's`);
  }
  const bundle = JSON.parse(readFileSync(join(o.site, "roadmap.json"), "utf8"));
  same([bundle.schema, bundle.format, bundle.app?.version, bundle.app?.build], [build.bundle, build.format, build.version, build.build], "roadmap.json's schema, format, version and build");
  same([bundle.source?.commit, bundle.source?.dir, bundle.source?.tree], [commit, "roadmap", git(["rev-parse", "HEAD:roadmap"]).trim()], "roadmap.json's commit, folder and tree");
  // The roadmap at HEAD, from git objects: each file's blob id and text.
  const listed = git(["ls-tree", "-r", "--full-tree", "HEAD", "--", "roadmap/"])
    .split("\n")
    .filter(Boolean)
    .map((line) => /^100644 blob ([0-9a-f]{40})\troadmap\/(.+)$/.exec(line))
    .filter(Boolean);
  same(bundle.blobs, Object.fromEntries(listed.map((m) => [m[2], m[1]])), "roadmap.json's blob ids");
  same(bundle.files, Object.fromEntries(listed.map((m) => [m[2], git(["cat-file", "blob", m[1]])])), "roadmap.json's files");
}

if (process.env.BOXOPS_OUTPUTS) {
  const out = JSON.parse(process.env.BOXOPS_OUTPUTS);
  same([out.version, out.build, out.format, out.commit, out.problems], [build.version, build.build, String(build.format), commit, "0"], "the outputs version, build, format, commit and problems");
  if (!result.test(out.result ?? "")) problems.push(`the result output is “${out.result}”`);
  if (o.site) same(out.site, resolve(o.site), "the site output");
  else if (out.site !== undefined) problems.push(`check mode set the site output (“${out.site}”)`);
}

if (o.sentinels) same(readdirSync(o.sentinels), [], "sentinels left by planted files (something ran them)");

if (problems.length) {
  for (const p of problems) console.error(`assert-site.mjs: ${p}`);
  process.exit(1);
}
console.log(`ok: ${o.site ? `the site in ${o.site}` : "the outputs"} for ${o.repo}@${commit.slice(0, 12)}, BoxOps ${build.build}`);

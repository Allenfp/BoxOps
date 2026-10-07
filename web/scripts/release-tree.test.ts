// The release tree (scripts/release-tree.ts) and its checks
// (scripts/check-release-tree.ts): the checks against a small tree made here,
// right and broken every way they look for; and the real thing, built twice
// from one commit (this checkout's files as git would commit them), each in
// its own clone and folder: byte for byte the same, with git's tree id the
// same as the one computed without git.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildJsonText, makeBuildJson, parseBuildJson } from "../cli/release";
import { cleanUp, tempDir } from "../cli/test-release";
import { LIMITS, bundledPackages, checkReleaseTree, sha256sums, treeHash } from "./check-release-tree";
import { gitTree, renderReadme } from "./release-tree";

afterEach(cleanUp);

const WEB = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(WEB, "..");
const BUILD = "0.1.0+0123456789ab";
const SOURCE = "0123456789ab".padEnd(40, "c");

/** Every file under `dir`, "/"-separated, sorted. */
function walk(dir: string, rel = ""): string[] {
  return readdirSync(join(dir, rel))
    .sort()
    .flatMap((name) => {
      const path = rel ? `${rel}/${name}` : name;
      return lstatSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path];
    });
}

/** BUILD.json made again for the files now in the tree (as release-tree.ts makes it). */
function rehash(dir: string): void {
  const files: Record<string, Uint8Array> = {};
  for (const p of walk(dir)) if (p !== "BUILD.json" && lstatSync(join(dir, p)).isFile()) files[p] = readFileSync(join(dir, p));
  writeFileSync(join(dir, "BUILD.json"), buildJsonText(makeBuildJson({ version: "0.1.0", build: BUILD, time: "", source: SOURCE }, files)));
}

/** A small, right release tree: the layout, the build id everywhere, the licences; returns its folder. */
function goodTree(): string {
  const dir = join(tempDir(), "release");
  const files: Record<string, string> = {
    "action.yml": readFileSync(join(REPO, "release", "action.yml"), "utf8"),
    "README.md": renderReadme(readFileSync(join(REPO, "release", "README.md.tmpl"), "utf8"), { version: "0.1.0", build: BUILD, source: SOURCE, sourceShort: SOURCE.slice(0, 12) }),
    LICENSE: "MIT License\n",
    "THIRD_PARTY_LICENSES.txt": "# Licenses\n\ndist/boxops.mjs bundles dependencies which contain the following licenses:\n\n## yaml - 2.9.1 (ISC)\n\nISC\n",
    "dist/action.mjs": 'import { runAction } from "./boxops.mjs";\n\nprocess.exitCode = await runAction({ argv: process.argv.slice(2) });\n',
    "dist/boxops.mjs": `//#region node_modules/yaml/dist/index.js\nvar yaml = 1;\n//#endregion\n//#region cli/release.ts\nconst RELEASE = { "build": "${BUILD}" };\n//#endregion\n`,
    "dist/app/index.html": `<!doctype html>\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'" />\n<script type="module" crossorigin src="./assets/index-A1.js"></script>\n<link rel="icon" href="./favicon.svg">\n<meta name="boxops-build" content="${BUILD}">\n`,
    "dist/app/assets/index-A1.js": `const b=\`${BUILD}\`;\n`,
    "dist/app/favicon.svg": "<svg/>\n",
    "dist/app/licenses.txt": "# Licenses\n\n## react-dom - 19.3.0 (MIT)\n\n## react - 19.3.0 (MIT)\n\n## yaml - 2.9.1 (ISC)\n\n## Lucide icons (ISC; some derived from Feather, MIT)\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text, { mode: 0o644 });
  }
  rehash(dir);
  return dir;
}

/** The problems the checks find in the tree at `dir`. */
const problems = async (dir: string) => (await checkReleaseTree(dir, { webDir: WEB })).problems;

describe("the release tree's checks", () => {
  it("pass a right tree, and compute git's tree id without git", async () => {
    const dir = goodTree();
    const check = await checkReleaseTree(dir, { webDir: WEB });
    expect(check.problems).toEqual([]);
    expect(check.files).toEqual(walk(dir));
    expect(check.tree).toBe(gitTree(dir));
    expect(check.build?.build).toBe(BUILD);
  });

  it("check TREE and SHA256SUMS beside the tree", async () => {
    const dir = goodTree();
    const beside = dirname(dir);
    expect(await checkReleaseTree(dir, { beside, webDir: WEB })).toMatchObject({ problems: [`${beside}/TREE: missing`, `${beside}/SHA256SUMS: missing`] });
    const files = walk(dir);
    writeFileSync(join(beside, "TREE"), `${await treeHash(dir, files)}\n`);
    writeFileSync(join(beside, "SHA256SUMS"), sha256sums(dir, files));
    expect((await checkReleaseTree(dir, { beside, webDir: WEB })).problems).toEqual([]);
    // The format `sha256sum -c` reads, sorted by path.
    expect(readFileSync(join(beside, "SHA256SUMS"), "utf8").split("\n")[0]).toMatch(/^[0-9a-f]{64} {2}BUILD\.json$/);
    writeFileSync(join(beside, "TREE"), `${"0".repeat(40)}\n`);
    writeFileSync(join(beside, "SHA256SUMS"), sha256sums(dir, files.slice(1)));
    expect((await checkReleaseTree(dir, { beside, webDir: WEB })).problems).toEqual([
      `TREE: says ${"0".repeat(40)}, but the tree is ${await treeHash(dir, files)}`,
      "SHA256SUMS: not the tree’s files’ SHA-256s, one a line, sorted by path",
    ]);
  });

  it("find a file BUILD.json doesn't list, one it lists that isn't there, and one that changed", async () => {
    const dir = goodTree();
    writeFileSync(join(dir, "dist/app/assets/extra-B2.js"), "x\n");
    unlinkSync(join(dir, "dist/app/favicon.svg"));
    writeFileSync(join(dir, "dist/app/assets/index-A1.js"), `const b=\`${BUILD}\`;// changed\n`);
    expect(await problems(dir)).toEqual([
      "dist/app/assets/extra-B2.js: not in BUILD.json",
      "dist/app/assets/index-A1.js: not the file BUILD.json describes (its SHA-256 differs)",
      "dist/app/favicon.svg: in BUILD.json, but not in the tree",
      "dist/app/index.html: names ./favicon.svg, which isn’t in the tree",
    ]);
  });

  it("find what a release never holds: source, dependencies, workflows, source maps, other files", async () => {
    const dir = goodTree();
    for (const p of ["src/App.tsx", "node_modules/yaml/index.js", "dist/app/assets/index-A1.js.map", "dist/cli.mjs", "package.json", "dist/app/config.yml"]) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), "x\n");
    }
    rehash(dir);
    expect(await problems(dir)).toEqual([
      "dist/app/assets/index-A1.js.map: a source map, which a release never holds",
      "dist/app/config.yml: a workflow or other YAML (only action.yml, at the top), which a release never holds",
      "dist/cli.mjs: not part of a release (dist/ holds action.mjs, boxops.mjs and app/)",
      "node_modules/: dependencies (node_modules), which a release never holds",
      "node_modules/: not part of a release (its top level holds action.yml, BUILD.json, LICENSE, README.md, THIRD_PARTY_LICENSES.txt, dist/)",
      "node_modules/yaml/: dependencies (node_modules), which a release never holds",
      "node_modules/yaml/: not part of a release (its top level holds action.yml, BUILD.json, LICENSE, README.md, THIRD_PARTY_LICENSES.txt, dist/)",
      "node_modules/yaml/index.js: dependencies (node_modules), which a release never holds",
      "node_modules/yaml/index.js: not part of a release (its top level holds action.yml, BUILD.json, LICENSE, README.md, THIRD_PARTY_LICENSES.txt, dist/)",
      "package.json: an npm manifest, which a release never holds",
      "package.json: not part of a release (its top level holds action.yml, BUILD.json, LICENSE, README.md, THIRD_PARTY_LICENSES.txt, dist/)",
      "src/: source, which a release never holds",
      "src/: not part of a release (its top level holds action.yml, BUILD.json, LICENSE, README.md, THIRD_PARTY_LICENSES.txt, dist/)",
      "src/App.tsx: source, which a release never holds",
      "src/App.tsx: source (TypeScript), which a release never holds",
      "src/App.tsx: not part of a release (its top level holds action.yml, BUILD.json, LICENSE, README.md, THIRD_PARTY_LICENSES.txt, dist/)",
    ].map((p) => p.replace(/^([^:]+)\/:/, "$1:")));
  });

  it("find what git or a download would change: hidden files, symlinks, empty folders, an executable", async () => {
    const dir = goodTree();
    mkdirSync(join(dir, ".github/workflows"), { recursive: true });
    writeFileSync(join(dir, ".github/workflows/ci.yml"), "on: push\n");
    writeFileSync(join(dir, "dist/app/.DS_Store"), "x");
    symlinkSync("favicon.svg", join(dir, "dist/app/icon.svg"));
    mkdirSync(join(dir, "dist/app/empty"));
    chmodSync(join(dir, "dist/boxops.mjs"), 0o755);
    const found = await problems(dir);
    expect(found).toContain(".github: hidden; a release holds no dotfiles");
    expect(found).toContain(".github/workflows/ci.yml: a workflow or other YAML (only action.yml, at the top), which a release never holds");
    expect(found).toContain("dist/app/.DS_Store: hidden; a release holds no dotfiles");
    expect(found).toContain("dist/app/icon.svg: a symlink; a release holds plain files only");
    expect(found).toContain("dist/app/empty: an empty folder, which git can’t hold");
    expect(found).toContain("dist/boxops.mjs: executable; every file in a release is 0644, so its tree hash is the same wherever it’s built");
  });

  it("find an action.yml that runs anything but dist/action.mjs on node24, or uses another action", async () => {
    const dir = goodTree();
    const yml = readFileSync(join(dir, "action.yml"), "utf8").replace(/runs:\n[\s\S]*$/, "runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v7\n");
    writeFileSync(join(dir, "action.yml"), yml);
    writeFileSync(join(dir, "dist/action.mjs"), 'import "./boxops.mjs";\nimport { x } from "node:child_process";\n');
    rehash(dir);
    expect(await problems(dir)).toEqual([
      'action.yml: runs.using is "composite", not "node24"',
      "action.yml: runs.main is undefined, not \"dist/action.mjs\"",
      "action.yml: runs.steps; the action runs dist/action.mjs and nothing else",
      "action.yml: a `uses:` line; the action may use no other action (adopters allow one)",
      "dist/action.mjs: imports something other than ./boxops.mjs",
    ]);
  });

  it("find a build id that isn't the same everywhere", async () => {
    const dir = goodTree();
    for (const p of ["dist/app/index.html", "dist/app/assets/index-A1.js", "dist/boxops.mjs", "README.md"]) {
      writeFileSync(join(dir, p), readFileSync(join(dir, p), "utf8").replaceAll(BUILD, "0.1.0+fedcba987654"));
    }
    rehash(dir);
    expect(await problems(dir)).toEqual([
      `dist/app/index.html: names build 0.1.0+fedcba987654, BUILD.json ${BUILD}`,
      `dist/app/assets/index-A1.js: doesn’t hold build ${BUILD}`,
      `dist/boxops.mjs: doesn’t hold build ${BUILD}`,
      `README.md: doesn’t name build ${BUILD}`,
    ]);
    // A longer build id that starts with this one isn't it.
    writeFileSync(join(dir, "dist/boxops.mjs"), `const RELEASE = { "build": "${BUILD}.dirty" };\n`);
    rehash(dir);
    expect(await problems(dir)).toContain(`dist/boxops.mjs: doesn’t hold build ${BUILD}`);
  });

  it("find licences missing for what the tool or the app bundles, or for the icons", async () => {
    const dir = goodTree();
    writeFileSync(join(dir, "dist/boxops.mjs"), `${readFileSync(join(dir, "dist/boxops.mjs"), "utf8")}//#region node_modules/@scope/pkg/index.js\n//#endregion\n`);
    writeFileSync(join(dir, "dist/app/licenses.txt"), "# Licenses\n\n## react - 19.3.0 (MIT)\n\n## yaml - 2.9.1 (ISC)\n");
    rehash(dir);
    expect(await problems(dir)).toEqual([
      "THIRD_PARTY_LICENSES.txt: doesn’t name @scope/pkg, which dist/boxops.mjs bundles",
      "dist/app/licenses.txt: doesn’t name react-dom, which the app bundles",
      "dist/app/licenses.txt: no notice for the app’s icons (Lucide’s)",
    ]);
    expect(bundledPackages("//#region node_modules/yaml/dist/a.js\n//#region node_modules/yaml/dist/b.js\n//#region node_modules/@a/b/c.js\n//#region src/x.ts\n")).toEqual(["@a/b", "yaml"]);
  });

  it("find a missing file, a file over the size limit, and too many", async () => {
    const dir = goodTree();
    unlinkSync(join(dir, "LICENSE"));
    writeFileSync(join(dir, "dist/app/assets/big-C3.js"), Buffer.alloc(LIMITS.fileBytes + 1));
    for (let i = 0; i < LIMITS.files; i++) writeFileSync(join(dir, `dist/app/assets/n${i}.js`), `${i}\n`);
    rehash(dir);
    const found = await problems(dir);
    expect(found).toContain(`dist/app/assets/big-C3.js: ${LIMITS.fileBytes + 1} bytes, over the ${LIMITS.fileBytes} a release’s file may have`);
    expect(found).toContain("LICENSE: missing");
    expect(found).toContain(`${walk(dir).length} files, over the ${LIMITS.files} a release may have`);
  });

  it("say so when there's no tree", async () => {
    const missing = join(tempDir(), "nothing");
    expect(await problems(missing)).toEqual([`${missing}: no release tree here (npm run release:build makes one)`]);
  });
});

describe("release/README.md.tmpl", () => {
  it("is filled in, every placeholder known and every value used", () => {
    const template = readFileSync(join(REPO, "release", "README.md.tmpl"), "utf8");
    const values = { version: "0.1.0", build: BUILD, source: SOURCE, sourceShort: SOURCE.slice(0, 12) };
    const text = renderReadme(template, values);
    expect(text).toContain(`# BoxOps 0.1.0\n`);
    expect(text).toContain(`(build \`${BUILD}\`)`);
    expect(text).toContain(`https://github.com/Allenfp/BoxOps/tree/${SOURCE}`);
    expect(text).not.toMatch(/\{\{|\}\}/);
    expect(() => renderReadme("{{version}} {{oops}}", { version: "1" })).toThrow("release/README.md.tmpl: {{oops}} isn’t one of version");
    expect(() => renderReadme("{{version}}", { version: "1", build: "b" })).toThrow("release/README.md.tmpl doesn’t use {{build}}");
  });
});

/** git with no configuration but a fixed identity and date, in `cwd`. */
function git(cwd: string, args: string[]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("GIT_")) env[key] = value;
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    env: {
      ...env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_AUTHOR_DATE: "2026-10-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-10-01T00:00:00Z",
    },
  }).trim();
}

describe("two clean builds of one commit", () => {
  it("are the same release tree, byte for byte, whose id git agrees with", { timeout: 180_000 }, async () => {
    // One commit: this checkout's files as `git add -A` would commit them.
    const work = tempDir();
    const src = join(work, "src");
    const listed = git(REPO, ["-c", "core.fsmonitor=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean);
    for (const path of listed) {
      const st = lstatSync(join(REPO, path), { throwIfNoEntry: false });
      if (!st?.isFile()) continue; // deleted, and not committed yet
      mkdirSync(dirname(join(src, path)), { recursive: true });
      copyFileSync(join(REPO, path), join(src, path));
    }
    git(src, ["init", "-q", "-b", "main"]);
    git(src, ["add", "-A"]);
    git(src, ["commit", "-q", "-m", "The commit to build"]);
    const commit = git(src, ["rev-parse", "HEAD"]);

    // Two clones, each with its own copy of the dependencies npm ci installed, built apart.
    const built: { out: string; tree: string }[] = [];
    for (const name of ["a", "b"]) {
      const clone = join(work, name);
      git(work, ["clone", "-q", "--no-hardlinks", src, clone]);
      cpSync(join(WEB, "node_modules"), join(clone, "web", "node_modules"), { recursive: true, verbatimSymlinks: true });
      const out = join(work, `${name}-out`);
      const r = spawnSync(process.execPath, [join(clone, "web", "node_modules", "tsx", "dist", "cli.mjs"), "scripts/release-tree.ts", "--out", out, "--no-sbom"], {
        cwd: join(clone, "web"),
        encoding: "utf8",
      });
      expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
      expect(r.stdout).toMatch(/^Built the release tree of BoxOps /);
      built.push({ out, tree: readFileSync(join(out, "TREE"), "utf8").trim() });

      // A file not committed stops a build.
      writeFileSync(join(clone, "web", "scripts", "stray.ts"), "x\n");
      const dirty = spawnSync(process.execPath, [join(clone, "web", "node_modules", "tsx", "dist", "cli.mjs"), "scripts/release-tree.ts", "--out", join(work, "dirty"), "--no-sbom"], {
        cwd: join(clone, "web"),
        encoding: "utf8",
      });
      expect(dirty.status).toBe(1);
      expect(dirty.stderr).toContain("has uncommitted or untracked files (web/scripts/stray.ts): a release tree is built from a commit");
      expect(existsSync(join(work, "dirty"))).toBe(false);
    }

    const [a, b] = built;
    expect(a.tree).toMatch(/^[0-9a-f]{40}$/);
    expect(b.tree).toBe(a.tree);
    const files = walk(join(a.out, "release"));
    expect(walk(join(b.out, "release"))).toEqual(files);
    for (const p of files) expect(readFileSync(join(b.out, "release", p)).equals(readFileSync(join(a.out, "release", p))), p).toBe(true);
    expect(readFileSync(join(b.out, "SHA256SUMS"), "utf8")).toBe(readFileSync(join(a.out, "SHA256SUMS"), "utf8"));
    // git's id for the tree, as the release workflow's publish job makes it from the downloaded files.
    expect(gitTree(join(a.out, "release"))).toBe(a.tree);
    const check = await checkReleaseTree(join(a.out, "release"), { beside: a.out, webDir: WEB });
    expect(check.problems).toEqual([]);
    const build = parseBuildJson(readFileSync(join(a.out, "release", "BUILD.json"), "utf8"));
    expect(build.source).toBe(commit);
    const { version } = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8")) as { version: string };
    expect(build.build).toMatch(new RegExp(`^${version.replaceAll(".", "\\.")}\\+[0-9a-f]{12}$`));
    expect(Object.keys(build.files)).toEqual(files.filter((p) => p !== "BUILD.json"));
    // Every chunk the app has is in the tree, and listed.
    expect(files.filter((p) => p.startsWith("dist/app/assets/") && p.endsWith(".js")).length).toBeGreaterThan(10);
    rmSync(work, { recursive: true, force: true });
  });
});

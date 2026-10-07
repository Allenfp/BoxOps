// `npm run release:build -- [--version X.Y.Z[-rc.N]] [--out DIR] [--allow-dirty] [--no-sbom]`:
// the files of a BoxOps release commit, the release tree, built from this
// checkout into DIR/release (default: build/ at the repository's top level),
// with three files beside it:
//   TREE             git's id of the tree: what the release commit's tree is
//   SHA256SUMS       every file's SHA-256, as `sha256sum -c` reads them
//   sbom.spdx.json   the SBOM of what the app and the tool bundle (SPDX): npm's
//                    of every package installed, cut down to the production
//                    ones `npm ls --omit dev` lists (releaseSbom), its own
//                    package as this release's version. A release asset, not
//                    in the tree (an SPDX document carries a time and a
//                    random id, so it differs at every build)
//
// The tree (the distribution design's §2.2):
//   action.yml                 release/action.yml
//   README.md                  release/README.md.tmpl, filled in
//   LICENSE                    BoxOps' licence
//   THIRD_PARTY_LICENSES.txt   the licences of what dist/boxops.mjs bundles
//   BUILD.json                 the build, its contract numbers, and every other file's SHA-256
//   dist/action.mjs            the action's entry
//   dist/boxops.mjs            the engine and command-line tool
//   dist/app/**                the app: index.html, every chunk, icons, licenses.txt
//
// It builds the app and the tool afresh, `vite build` then vite.cli.config.ts,
// with NODE_ENV=production and the version given (default web/package.json's;
// one with a pre-release tag, such as 0.1.0-rc.1, too: cli/site.ts's
// buildVersion), from a checkout with nothing uncommitted or untracked (it
// refuses otherwise; --allow-dirty to try anyway, which gives a build id ending
// in .dirty), and no file git turned to CRLF (crlfCheckout). Every file is
// written 0644, so the tree hash doesn't depend on the umask. Two builds of one commit are the same, byte for byte
// (release-tree.test.ts builds one twice, in separate folders, to check).
// Then it checks what it wrote (check-release-tree.ts).

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError, flag, parseArgs } from "../cli/context.ts";
import { type BuildJson, buildJsonText, makeBuildJson, parseBuildJson } from "../cli/release.ts";
import { buildVersion } from "../cli/site.ts";
import { type SpdxDocument, type SpdxPackage, checkReleaseTree, sha256sums } from "./check-release-tree.ts";

/** web/ of the BoxOps checkout this script is in. */
const WEB_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** What the two builds write into web/dist, and where each goes in the tree (a folder's files go to the folder). */
const FROM_DIST: Record<string, string> = {
  "action.mjs": "dist/action.mjs",
  "boxops.mjs": "dist/boxops.mjs",
  "THIRD_PARTY_LICENSES.txt": "THIRD_PARTY_LICENSES.txt",
  app: "dist/app",
  // The CLI build's own, for web/dist; the tree gets one for all of it.
  "BUILD.json": "",
};

export interface TreeOptions {
  /** Where to write release/, TREE, SHA256SUMS and sbom.spdx.json. */
  out: string;
  /** The version (default: web/package.json's). */
  version?: string;
  /** web/ of the checkout to build (default: this script's). */
  webDir?: string;
  /** Build from a checkout with uncommitted or untracked files. */
  allowDirty?: boolean;
  /** Write sbom.spdx.json (default true). */
  sbom?: boolean;
  /** Where the builds' output goes (default: this process's stderr). */
  log?: (text: string) => void;
}

export interface ReleaseTree {
  /** The tree: out/release. */
  dir: string;
  /** Its git tree id. */
  tree: string;
  build: BuildJson;
  /** Its files, "/"-separated, sorted. */
  files: string[];
  bytes: number;
}

/** The environment without git's own variables (GIT_DIR and the like), for git run on this checkout. */
function gitFreeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("GIT_")) env[key] = value;
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", ...extra };
}

/** What `git status` lists in the checkout at `repoDir`: changed, staged or untracked files (ignored ones aren't). Throws outside a git checkout. */
export function uncommitted(repoDir: string): string[] {
  try {
    const out = execFileSync("git", ["-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: repoDir, env: gitFreeEnv(), encoding: "utf8", stdio: "pipe" });
    return out.split("\0").filter(Boolean).map((line) => line.slice(3));
  } catch (e) {
    const err = e as Error & { stderr?: string };
    throw new Error(`Can’t ask git about ${repoDir} (${err.stderr?.trim() || err.message}): a release tree is built from a git checkout`);
  }
}

/**
 * The files git tracks that the checkout at `repoDir` has with CRLF line ends
 * (some or all) where git has LF: a checkout git turned to CRLF, as
 * core.autocrlf (Git for Windows' default) does where .gitattributes doesn't
 * say eol=lf. `git status` shows none of them, but a build reads files as
 * they are on disk, so it would make other bytes under the same build id.
 */
export function crlfCheckout(repoDir: string): string[] {
  const out = execFileSync("git", ["-c", "core.fsmonitor=false", "ls-files", "--eol", "-z"], { cwd: repoDir, env: gitFreeEnv(), encoding: "utf8", stdio: "pipe" });
  // "i/lf    w/crlf  attr/text=auto eol=lf \t<path>"
  return out
    .split("\0")
    .filter(Boolean)
    .flatMap((entry) => {
      const tab = entry.indexOf("\t");
      const [index, tree] = entry.slice(0, tab).split(/\s+/);
      return index === "i/lf" && (tree === "w/crlf" || tree === "w/mixed") ? [entry.slice(tab + 1)] : [];
    });
}

/** Every file under `dir`, "/"-separated, relative to it, sorted. */
function walk(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const path = rel ? `${rel}/${name}` : name;
    if (lstatSync(join(dir, path)).isDirectory()) out.push(...walk(dir, path));
    else out.push(path);
  }
  return out;
}

/** release/README.md.tmpl with its {{name}} placeholders filled in; every placeholder must be one of `values`, and every value used. */
export function renderReadme(template: string, values: Record<string, string>): string {
  const used = new Set<string>();
  const text = template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (!Object.hasOwn(values, name)) throw new Error(`release/README.md.tmpl: {{${name}}} isn’t one of ${Object.keys(values).join(", ")}`);
    used.add(name);
    return values[name];
  });
  const unused = Object.keys(values).filter((n) => !used.has(n));
  if (unused.length) throw new Error(`release/README.md.tmpl doesn’t use {{${unused.join("}}, {{")}}}`);
  return text;
}

/** Runs Vite (`args`) in web/ for the release: its version, production mode, and no test runner's variables. */
function vite(webDir: string, args: string[], version: string, log: (text: string) => void): void {
  const bin = join(webDir, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(bin)) throw new Error(`${bin} is missing: run npm ci in ${webDir} first`);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(VITEST|BOXOPS_)/.test(key) && key !== "NODE_ENV") env[key] = value;
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: webDir, env: { ...env, NODE_ENV: "production", BOXOPS_VERSION: version }, encoding: "utf8" });
  log(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  if (r.status !== 0) throw new Error(`vite ${args.join(" ")} failed (exit ${r.status ?? r.signal}):\n${r.stdout ?? ""}${r.stderr ?? ""}`);
}

/** npm, in web/, as the release build runs it: its JSON on stdout (or an error saying what failed). */
function npm(webDir: string, args: string[]): string {
  const r = spawnSync("npm", args, { cwd: webDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`npm ${args.join(" ")} failed (exit ${r.status ?? r.signal}): ${r.stderr || r.error?.message}`);
  return r.stdout;
}

interface NpmLsNode {
  version?: string;
  dependencies?: Record<string, NpmLsNode>;
}

/**
 * Every package `npm ls --omit dev --all` lists in web/, as name@version:
 * web/package.json's production dependencies and theirs, the packages the
 * app and the tool may bundle.
 */
export function productionPackages(webDir: string): Set<string> {
  const out = new Set<string>();
  const visit = (deps: Record<string, NpmLsNode> | undefined) => {
    for (const [name, dep] of Object.entries(deps ?? {})) {
      if (!dep.version) throw new Error(`npm ls --omit dev lists ${name} with no version: run npm ci in ${webDir} first`);
      out.add(`${name}@${dep.version}`);
      visit(dep.dependencies);
    }
  };
  visit((JSON.parse(npm(webDir, ["ls", "--omit", "dev", "--all", "--json"])) as NpmLsNode).dependencies);
  return out;
}

/**
 * The release's SBOM, from npm's of every package installed (`npm sbom`):
 * the package it describes (web/package.json's), as the release's version
 * (npm gives package.json's, X.Y.Z for X.Y.Z-rc.N too); the `production`
 * packages (productionPackages), every one of which must be there; and the
 * relationships among those. Not `npm sbom --omit dev`, which leaves out a
 * production package that a dev dependency also names, as an optional
 * peer: yaml, which vite names, and which the tool and the app both bundle.
 */
export function releaseSbom(full: SpdxDocument, production: ReadonlySet<string>, version: string): SpdxDocument {
  const root = full.documentDescribes.length === 1 ? full.packages.find((p) => p.SPDXID === full.documentDescribes[0]) : undefined;
  if (!root) throw new Error("npm sbom: its document doesn’t describe one package, web/package.json’s");
  const packages = full.packages.filter((p) => p === root || production.has(`${p.name}@${p.versionInfo}`));
  const listed = new Set(packages.map((p) => `${p.name}@${p.versionInfo}`));
  const missing = [...production].filter((p) => !listed.has(p));
  if (missing.length) throw new Error(`npm sbom doesn’t list ${missing.join(", ")}, which npm ls --omit dev does`);
  const kept = new Set(["SPDXRef-DOCUMENT", ...packages.map((p) => p.SPDXID)]);
  // npm names the package, its id, the document and its namespace by package.json's version.
  const was = root.versionInfo;
  const id = root.SPDXID.endsWith(`-${was}`) ? `${root.SPDXID.slice(0, -was.length)}${version}` : root.SPDXID;
  const renamed = (ref: string) => (ref === root.SPDXID ? id : ref);
  const purl = (ref: NonNullable<SpdxPackage["externalRefs"]>[number]) =>
    ref.referenceType === "purl" && ref.referenceLocator.endsWith(`@${was}`) ? { ...ref, referenceLocator: `${ref.referenceLocator.slice(0, -was.length)}${version}` } : ref;
  return {
    ...full,
    name: full.name === `${root.name}@${was}` ? `${root.name}@${version}` : full.name,
    documentNamespace: full.documentNamespace.replace(`/${root.name}-${was}-`, `/${root.name}-${version}-`),
    documentDescribes: [id],
    packages: packages.map((p) => (p === root ? { ...p, SPDXID: id, versionInfo: version, ...(p.externalRefs && { externalRefs: p.externalRefs.map(purl) }) } : p)),
    relationships: full.relationships
      .filter((r) => kept.has(r.spdxElementId) && kept.has(r.relatedSpdxElement))
      .map((r) => ({ ...r, spdxElementId: renamed(r.spdxElementId), relatedSpdxElement: renamed(r.relatedSpdxElement) })),
  };
}

/** git's id of the tree of the files in `dir`, from git itself: a throwaway repository's index, no configuration but these. */
export function gitTree(dir: string): string {
  const scratch = mkdtempSync(join(tmpdir(), "boxops-tree-"));
  try {
    const env = gitFreeEnv({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_INDEX_FILE: join(scratch, "index") });
    const git = (args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: "pipe" }).trim();
    git(["init", "-q", "--bare", join(scratch, "repo.git")]);
    const base = ["--git-dir", join(scratch, "repo.git"), "--work-tree", dir, "-c", "core.autocrlf=false", "-c", "core.fileMode=true", "-c", "core.symlinks=true", "-c", "core.hooksPath=/dev/null"];
    git([...base, "add", "--all", "--force", "."]);
    return git([...base, "write-tree"]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Builds the release tree (see the top of this file). */
export async function buildReleaseTree(o: TreeOptions): Promise<ReleaseTree> {
  const webDir = resolve(o.webDir ?? WEB_DIR);
  const repoDir = resolve(webDir, "..");
  const log = o.log ?? ((text: string) => process.stderr.write(text));
  const pkg = (JSON.parse(readFileSync(join(webDir, "package.json"), "utf8")) as { version: string }).version;
  const version = buildVersion(pkg, o.version);

  const dirty = uncommitted(repoDir);
  if (dirty.length && !o.allowDirty) {
    throw new Error(
      `${repoDir} has uncommitted or untracked files (${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ", …" : ""}): a release tree is built from a commit. Commit or stash them, or give --allow-dirty to try it anyway`,
    );
  }
  // Even with --allow-dirty: git status doesn't show these, so the build id wouldn't say .dirty.
  const crlf = crlfCheckout(repoDir);
  if (crlf.length) {
    throw new Error(
      `${repoDir} has files with CRLF line ends where git has LF (${crlf.slice(0, 5).join(", ")}${crlf.length > 5 ? ", …" : ""}), as git checks them out with core.autocrlf: a build reads the files as they are, so it wouldn’t be the commit’s. Clone it again with \`git -c core.autocrlf=false clone …\``,
    );
  }

  // The builds, afresh.
  const dist = join(webDir, "dist");
  rmSync(dist, { recursive: true, force: true });
  vite(webDir, ["build"], version, log);
  vite(webDir, ["build", "-c", "vite.cli.config.ts"], version, log);
  const built = parseBuildJson(readFileSync(join(dist, "BUILD.json"), "utf8"));
  if (built.version !== version) throw new Error(`web/dist/BUILD.json is version ${built.version}, not ${version}`);
  for (const name of readdirSync(dist)) {
    if (!Object.hasOwn(FROM_DIST, name)) throw new Error(`web/dist/${name}: the builds wrote it, but a release doesn’t carry it (scripts/release-tree.ts’s FROM_DIST)`);
  }

  // The tree.
  const out = resolve(o.out);
  const dir = join(out, "release");
  mkdirSync(out, { recursive: true });
  for (const name of ["release", "TREE", "SHA256SUMS", "sbom.spdx.json"]) rmSync(join(out, name), { recursive: true, force: true });
  const put = (path: string, bytes: string | Uint8Array) => {
    const to = join(dir, ...path.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, bytes);
    chmodSync(to, 0o644);
  };
  for (const [from, to] of Object.entries(FROM_DIST)) {
    if (!to) continue;
    const at = join(dist, from);
    if (!existsSync(at)) throw new Error(`web/dist/${from} wasn’t built`);
    if (lstatSync(at).isDirectory()) for (const p of walk(at)) put(`${to}/${p}`, readFileSync(join(at, p)));
    else put(to, readFileSync(at));
  }
  put("action.yml", readFileSync(join(repoDir, "release", "action.yml")));
  put("LICENSE", readFileSync(join(repoDir, "LICENSE")));
  put("README.md", renderReadme(readFileSync(join(repoDir, "release", "README.md.tmpl"), "utf8"), { version, build: built.build, source: built.source, sourceShort: built.source.slice(0, 12) }));
  const files: Record<string, Uint8Array> = {};
  for (const p of walk(dir)) files[p] = readFileSync(join(dir, p));
  const build = makeBuildJson({ version, build: built.build, time: "", source: built.source }, files);
  put("BUILD.json", buildJsonText(build));

  // Beside it.
  const all = walk(dir);
  const tree = gitTree(dir);
  writeFileSync(join(out, "TREE"), `${tree}\n`);
  writeFileSync(join(out, "SHA256SUMS"), sha256sums(dir, all));
  if (o.sbom !== false) {
    // Every package installed, whatever NODE_ENV (production omits dev ones) or npm's own settings say.
    const full = JSON.parse(npm(webDir, ["sbom", "--sbom-format", "spdx", "--include=dev", "--include=optional", "--include=peer"])) as SpdxDocument;
    writeFileSync(join(out, "sbom.spdx.json"), `${JSON.stringify(releaseSbom(full, productionPackages(webDir), version), null, 2)}\n`);
  }

  const check = await checkReleaseTree(dir, { beside: out, webDir });
  if (check.problems.length) throw new Error(`The release tree in ${dir} isn’t right:\n${check.problems.map((p) => `  ${p}`).join("\n")}`);
  if (check.tree !== tree) throw new Error(`git says the tree is ${tree}, check-release-tree.ts ${check.tree}`);
  return { dir, tree, build, files: all, bytes: check.bytes };
}

/** `path` as the person who ran a script sees it: relative to where they were, unless it's far from there. */
export const shownPath = (here: string, path: string) => {
  const rel = relative(here, path);
  return rel.startsWith("../..") ? path : rel || ".";
};

/** The command: prints what it built; returns the exit code (2: usage). */
export async function main(argv: string[]): Promise<number> {
  const here = process.env.INIT_CWD ?? process.cwd();
  try {
    const args = parseArgs(argv, ["version", "out"], ["allow-dirty", "no-sbom"]);
    if (args.positional.length) throw new UsageError("Usage: npm run release:build -- [--version X.Y.Z[-rc.N]] [--out DIR] [--allow-dirty] [--no-sbom]");
    const out = resolve(here, flag(args, "out") ?? join(WEB_DIR, "..", "build"));
    const made = await buildReleaseTree({ out, version: flag(args, "version"), allowDirty: args.flags["allow-dirty"] === true, sbom: args.flags["no-sbom"] !== true });
    const shown = shownPath(here, made.dir);
    console.log(`Built the release tree of BoxOps ${made.build.version} (build ${made.build.build}, from ${made.build.source.slice(0, 12)}) in ${shown}: ${made.files.length} files, ${made.bytes} bytes.`);
    console.log(`Its tree is ${made.tree}; TREE, SHA256SUMS${args.flags["no-sbom"] ? "" : " and sbom.spdx.json"} are beside it.`);
    return 0;
  } catch (e) {
    console.error(`release:build: ${(e as Error).message}`);
    return e instanceof UsageError ? 2 : 1;
  }
}

/** Run as a script (npm run release:build), not imported by its tests. */
function isMain(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = await main(process.argv.slice(2));

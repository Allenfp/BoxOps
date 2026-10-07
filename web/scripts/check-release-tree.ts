// `npm run check:release-tree -- [folder]`: checks a release tree, the files
// of a BoxOps release commit (scripts/release-tree.ts writes one), before
// anything tests or ships it. The folder is release-tree.ts's --out (default
// ../build), holding release/ and, beside it, TREE, SHA256SUMS and (unless
// built with --no-sbom) sbom.spdx.json, which are checked too; or the tree
// itself.
//
// What it checks:
//   - Only what a release holds: action.yml, README.md, LICENSE,
//     THIRD_PARTY_LICENSES.txt, BUILD.json, dist/action.mjs, dist/boxops.mjs
//     and dist/app/**. No source, no node_modules, no workflows, no source
//     maps, nothing hidden, no symlinks or empty folders, nothing executable
//     (every file 0644, so git's tree hash is the same wherever it's built).
//   - BUILD.json lists every other file, each with its SHA-256, and no more.
//   - action.yml runs dist/action.mjs on node24, and uses no other action.
//   - The build id: BUILD.json's, index.html's <meta name="boxops-build">,
//     the app's JavaScript's and the tool's are one; the files index.html
//     names are there; its Content-Security-Policy is.
//   - The licences: THIRD_PARTY_LICENSES.txt names every package
//     dist/boxops.mjs bundles (its `//#region node_modules/…` comments, which
//     must be there, yaml's among them: it's unminified), and
//     dist/app/licenses.txt every package web/package.json depends on, and
//     the icons.
//   - Sizes within limits (LIMITS).
//   - TREE and SHA256SUMS, if there, are the tree's (the tree hash computed
//     here, as git does, without git); and the SBOM, sbom.spdx.json, if
//     there, describes this release and names exactly the packages the two
//     licence files name, each at its version (sbomProblems).

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { type GitFileMode, gitBlobSha, gitTreeSha } from "../src/github/git-objects.ts";
import { type BuildJson, digest, parseBuildJson } from "../cli/release.ts";

/** A release commit's files at its top level. */
export const TOP_FILES = ["action.yml", "BUILD.json", "LICENSE", "README.md", "THIRD_PARTY_LICENSES.txt"];
/** Files every release has besides those. */
const REQUIRED = ["dist/action.mjs", "dist/boxops.mjs", "dist/app/index.html", "dist/app/licenses.txt"];

/** Sizes a release keeps under: about twice 0.1.0's (one file 485 kB, all 1.3 MB, 46 files). */
export const LIMITS = { fileBytes: 1024 * 1024, totalBytes: 3 * 1024 * 1024, files: 200 };

/** Paths a release must never hold, wherever in it: what would be source, dependencies, workflows or build leftovers. */
const FORBIDDEN: [RegExp, string][] = [
  [/(^|\/)node_modules(\/|$)/, "dependencies (node_modules)"],
  [/(^|\/)(src|cli|web|scripts|e2e)\//, "source"],
  [/\.(ts|tsx|cts|mts)$/, "source (TypeScript)"],
  [/(^|\/)(package|package-lock)\.json$/, "an npm manifest"],
  [/\.map$/, "a source map"],
  [/\.ya?ml$/, "a workflow or other YAML (only action.yml, at the top)"],
];

export interface TreeCheck {
  /** "path: what's wrong", in the order found; none if it's a good release tree. */
  problems: string[];
  /** The tree itself. */
  dir: string;
  /** Its files, "/"-separated, sorted. */
  files: string[];
  /** git's tree hash of it (computed here), if it could be. */
  tree?: string;
  build?: BuildJson;
  bytes: number;
}

/** Every entry under `dir`: files, symlinks and the like, and folders (with a trailing "/"), "/"-separated, sorted. */
function entries(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const path = rel ? `${rel}/${name}` : name;
    const st = lstatSync(join(dir, path));
    if (st.isDirectory()) out.push(`${path}/`, ...entries(dir, path));
    else out.push(path);
  }
  return out;
}

const sha256hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** SHA256SUMS's text for these files of the tree: `<hex>  <path>`, one a line, sorted by path, as `sha256sum -c` reads it. */
export function sha256sums(dir: string, files: string[]): string {
  return [...files]
    .sort()
    .map((p) => `${sha256hex(readFileSync(join(dir, p)))}  ${p}\n`)
    .join("");
}

/** git's id of the tree holding these files of `dir` (each a plain 100644 file), computed without git. */
export async function treeHash(dir: string, files: string[]): Promise<string> {
  const listed = await Promise.all(files.map(async (path) => ({ path, mode: "100644" as GitFileMode, sha: await gitBlobSha(readFileSync(join(dir, path))) })));
  return gitTreeSha(listed);
}

/**
 * The packages a bundle's `//#region …node_modules/<name>/…` comments name
 * (Rolldown writes them, unminified): the package of each file's last
 * node_modules/, so one nested in another's (node_modules/a/node_modules/b/)
 * is b.
 */
export function bundledPackages(code: string): string[] {
  const names = [...code.matchAll(/^\/\/#region (?:\S*\/)?node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//gm)].map((m) => m[1]);
  return [...new Set(names)].sort();
}

/** What dist/boxops.mjs always bundles: yaml, the parser it reads every roadmap with. */
export const TOOL_BUNDLES = ["yaml"];

/** The packages a Vite licence list names (its "## <name> - <version>" headings). */
export const licensed = (text: string) => [...text.matchAll(/^## ((?:@[^/\s]+\/)?[^\s]+) - \S+/gm)].map((m) => m[1]);

/**
 * The packages a Vite licence list names, as name@version. Not the icons'
 * notice (cli/licenses.ts adds it, "## Lucide icons (…)"): no package brings
 * them in.
 */
export const licensedVersions = (text: string) => [...text.matchAll(/^## ((?:@[^/\s]+\/)?[^\s]+) - (\S+)/gm)].map((m) => `${m[1]}@${m[2]}`);

/** As much of an SPDX 2 document as the release's SBOM is made and checked by (`npm sbom --sbom-format spdx` writes one). */
export interface SpdxDocument {
  spdxVersion: string;
  name: string;
  documentNamespace: string;
  documentDescribes: string[];
  packages: SpdxPackage[];
  relationships: { spdxElementId: string; relatedSpdxElement: string; relationshipType: string }[];
}

export interface SpdxPackage {
  SPDXID: string;
  name: string;
  versionInfo: string;
  externalRefs?: { referenceCategory: string; referenceType: string; referenceLocator: string }[];
}

/**
 * What's wrong with a release's SBOM (`text`, sbom.spdx.json beside the
 * tree): it describes one package, BoxOps', at the release's `version`, and
 * names exactly the packages the release bundles, each at its version:
 * `bundled`, those its licence files name (name@version → the file).
 */
export function sbomProblems(text: string, version: string | undefined, bundled: ReadonlyMap<string, string>): string[] {
  let doc: SpdxDocument;
  try {
    doc = JSON.parse(text) as SpdxDocument;
  } catch (e) {
    return [`sbom.spdx.json: not JSON (${(e as Error).message})`];
  }
  if (!String(doc?.spdxVersion).startsWith("SPDX-2.") || !Array.isArray(doc.packages) || !Array.isArray(doc.documentDescribes)) return ["sbom.spdx.json: not an SPDX 2 document"];
  const problems: string[] = [];
  const root = doc.documentDescribes.length === 1 ? doc.packages.find((p) => p.SPDXID === doc.documentDescribes[0]) : undefined;
  if (!root) problems.push("sbom.spdx.json: doesn’t describe one package, BoxOps’");
  else if (version !== undefined && root.versionInfo !== version) problems.push(`sbom.spdx.json: describes ${root.name}@${root.versionInfo}, not this release, ${version}`);
  const named = new Set(doc.packages.filter((p) => p !== root).map((p) => `${p.name}@${p.versionInfo}`));
  for (const [pkg, file] of bundled) if (!named.has(pkg)) problems.push(`sbom.spdx.json: doesn’t name ${pkg}, which ${file} names: the release bundles it`);
  for (const pkg of [...named].sort()) if (!bundled.has(pkg)) problems.push(`sbom.spdx.json: names ${pkg}, which the release doesn’t bundle (no licence file names it)`);
  return problems;
}

/** Checks the release tree in `dir`; with `beside` (release-tree.ts's --out), its TREE and SHA256SUMS too, where they are, and its SBOM if it's there. */
export async function checkReleaseTree(dir: string, o: { beside?: string; webDir?: string } = {}): Promise<TreeCheck> {
  const problems: string[] = [];
  const result: TreeCheck = { problems, dir, files: [], bytes: 0 };
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) {
    problems.push(`${dir}: no release tree here (npm run release:build makes one)`);
    return result;
  }
  const files: string[] = [];
  const all = entries(dir);
  for (const entry of all) {
    const path = entry.replace(/\/$/, "");
    const st = lstatSync(join(dir, path));
    if (path.split("/").some((n) => n.startsWith("."))) problems.push(`${path}: hidden; a release holds no dotfiles`);
    if (st.isSymbolicLink()) problems.push(`${path}: a symlink; a release holds plain files only`);
    else if (st.isDirectory()) {
      if (!all.some((e) => e !== entry && e.startsWith(entry))) problems.push(`${path}: an empty folder, which git can’t hold`);
    } else if (!st.isFile()) problems.push(`${path}: not a plain file`);
    else {
      files.push(path);
      result.bytes += st.size;
      if (st.mode & 0o111) problems.push(`${path}: executable; every file in a release is 0644, so its tree hash is the same wherever it’s built`);
      if (st.size > LIMITS.fileBytes) problems.push(`${path}: ${st.size} bytes, over the ${LIMITS.fileBytes} a release’s file may have`);
    }
    for (const [pattern, what] of FORBIDDEN) {
      if (pattern.test(entry) && entry !== "action.yml") problems.push(`${path}: ${what}, which a release never holds`);
    }
    const top = path.split("/")[0];
    if (!TOP_FILES.includes(top) && top !== "dist") problems.push(`${path}: not part of a release (its top level holds ${[...TOP_FILES, "dist/"].join(", ")})`);
    if (top === "dist" && path.includes("/") && !/^dist\/(action\.mjs|boxops\.mjs|app(\/.*)?)$/.test(path)) problems.push(`${path}: not part of a release (dist/ holds action.mjs, boxops.mjs and app/)`);
    if (TOP_FILES.includes(top) && st.isDirectory()) problems.push(`${path}: a folder, where a release has a file`);
  }
  result.files = files;
  for (const need of [...TOP_FILES, ...REQUIRED]) if (!files.includes(need)) problems.push(`${need}: missing`);
  if (files.length > LIMITS.files) problems.push(`${files.length} files, over the ${LIMITS.files} a release may have`);
  if (result.bytes > LIMITS.totalBytes) problems.push(`${result.bytes} bytes in all, over the ${LIMITS.totalBytes} a release may have`);
  const read = (path: string) => (files.includes(path) ? readFileSync(join(dir, path), "utf8") : "");

  // BUILD.json.
  let build: BuildJson | undefined;
  if (files.includes("BUILD.json")) {
    try {
      build = parseBuildJson(read("BUILD.json"));
      result.build = build;
    } catch (e) {
      problems.push(`BUILD.json: ${(e as Error).message}`);
    }
  }
  if (build) {
    const listed = Object.keys(build.files).sort();
    const others = files.filter((p) => p !== "BUILD.json");
    for (const p of others) if (!listed.includes(p)) problems.push(`${p}: not in BUILD.json`);
    for (const p of listed) {
      if (!others.includes(p)) problems.push(`${p}: in BUILD.json, but not in the tree`);
      else if (digest(readFileSync(join(dir, p))) !== build.files[p]) problems.push(`${p}: not the file BUILD.json describes (its SHA-256 differs)`);
    }
  }

  // action.yml.
  const actionYml = read("action.yml");
  if (actionYml) {
    let runs: Record<string, unknown> = {};
    try {
      runs = (parse(actionYml) as { runs?: Record<string, unknown> } | null)?.runs ?? {};
    } catch (e) {
      problems.push(`action.yml: not YAML (${(e as Error).message.split("\n")[0]})`);
    }
    if (runs.using !== "node24") problems.push(`action.yml: runs.using is ${JSON.stringify(runs.using)}, not "node24"`);
    if (runs.main !== "dist/action.mjs") problems.push(`action.yml: runs.main is ${JSON.stringify(runs.main)}, not "dist/action.mjs"`);
    for (const key of Object.keys(runs)) if (!["using", "main"].includes(key)) problems.push(`action.yml: runs.${key}; the action runs dist/action.mjs and nothing else`);
    if (/^\s*(-\s+)?uses\s*:/m.test(actionYml)) problems.push("action.yml: a `uses:` line; the action may use no other action (adopters allow one)");
  }
  const actionMjs = read("dist/action.mjs");
  if (actionMjs && [...actionMjs.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g)].some((m) => (m[1] ?? m[2]) !== "./boxops.mjs")) {
    problems.push("dist/action.mjs: imports something other than ./boxops.mjs");
  }

  // The build id, in every place it's written.
  const index = read("dist/app/index.html");
  if (build && index) {
    const meta = /<meta name="boxops-build" content="([^"]*)"/.exec(index)?.[1];
    if (meta !== build.build) problems.push(`dist/app/index.html: names build ${meta ?? "(none)"}, BUILD.json ${build.build}`);
    if (!/<meta http-equiv="Content-Security-Policy" content="default-src 'none';/.test(index)) problems.push("dist/app/index.html: no Content-Security-Policy");
    for (const m of index.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) if (!files.includes(`dist/app/${m[1]}`)) problems.push(`dist/app/index.html: names ./${m[1]}, which isn’t in the tree`);
    const main = /<script type="module" crossorigin src="\.\/([^"]+\.js)"/.exec(index)?.[1];
    const quoted = (code: string) => new RegExp(`[\`"']${build?.build.replace(/[.+]/g, "\\$&")}[\`"']`).test(code);
    if (!main || !quoted(read(`dist/app/${main}`))) problems.push(`dist/app/${main ?? "(main script)"}: doesn’t hold build ${build.build}`);
    if (!quoted(read("dist/boxops.mjs"))) problems.push(`dist/boxops.mjs: doesn’t hold build ${build.build}`);
    if (!read("README.md").includes(`build \`${build.build}\``)) problems.push(`README.md: doesn’t name build ${build.build}`);
  }

  // Licences. The tool is unminified (vite.cli.config.ts), so its `//#region node_modules/…` comments name
  // what it bundles: without any, a minified tool or another bundler's comments, there'd be nothing to check.
  const third = read("THIRD_PARTY_LICENSES.txt");
  const cli = read("dist/boxops.mjs");
  if (cli) {
    const bundled = bundledPackages(cli);
    if (!bundled.length) {
      problems.push("dist/boxops.mjs: no `//#region node_modules/…` comments, so what it bundles, and their licences, can’t be checked: it must stay unminified (vite.cli.config.ts’s minify: false)");
    }
    for (const pkg of TOOL_BUNDLES) if (bundled.length && !bundled.includes(pkg)) problems.push(`dist/boxops.mjs: no \`//#region node_modules/${pkg}/…\` comment: the tool always bundles ${pkg}`);
    if (third) for (const pkg of bundled) if (!licensed(third).includes(pkg)) problems.push(`THIRD_PARTY_LICENSES.txt: doesn’t name ${pkg}, which dist/boxops.mjs bundles`);
  }
  const appLicences = read("dist/app/licenses.txt");
  const webDir = o.webDir ?? fileURLToPath(new URL("..", import.meta.url));
  if (appLicences) {
    const deps = Object.keys((JSON.parse(readFileSync(join(webDir, "package.json"), "utf8")) as { dependencies?: Record<string, string> }).dependencies ?? {});
    const named = licensed(appLicences);
    for (const pkg of deps) if (!named.includes(pkg)) problems.push(`dist/app/licenses.txt: doesn’t name ${pkg}, which the app bundles`);
    if (!/^## Lucide icons /m.test(appLicences)) problems.push("dist/app/licenses.txt: no notice for the app’s icons (Lucide’s)");
  }

  // The tree hash, and what's beside the tree.
  if (!problems.some((p) => /symlink|not a plain file|hidden/.test(p))) result.tree = await treeHash(dir, files);
  if (o.beside) {
    const treeFile = join(o.beside, "TREE");
    if (!existsSync(treeFile)) problems.push(`${treeFile}: missing`);
    else if (readFileSync(treeFile, "utf8") !== `${result.tree}\n`) problems.push(`TREE: says ${readFileSync(treeFile, "utf8").trim()}, but the tree is ${result.tree}`);
    const sumsFile = join(o.beside, "SHA256SUMS");
    if (!existsSync(sumsFile)) problems.push(`${sumsFile}: missing`);
    else if (readFileSync(sumsFile, "utf8") !== sha256sums(dir, files)) problems.push("SHA256SUMS: not the tree’s files’ SHA-256s, one a line, sorted by path");
    // A build without one (--no-sbom: the release workflow's rebuild) has none to check.
    const sbomFile = join(o.beside, "sbom.spdx.json");
    if (existsSync(sbomFile)) {
      const bundled = new Map<string, string>();
      for (const [file, text] of [["dist/app/licenses.txt", appLicences], ["THIRD_PARTY_LICENSES.txt", third]]) {
        for (const pkg of licensedVersions(text)) if (!bundled.has(pkg)) bundled.set(pkg, file);
      }
      problems.push(...sbomProblems(readFileSync(sbomFile, "utf8"), build?.version, bundled));
    }
  }
  return result;
}

/** The command: exit 0 if the tree is good, 1 if not, 2 if there's none. */
export async function main(argv: string[]): Promise<number> {
  const here = process.env.INIT_CWD ?? process.cwd();
  if (argv.length > 1 || argv[0]?.startsWith("-")) {
    console.error("Usage: npm run check:release-tree -- [folder]   (release-tree.ts's --out, default ../build; or a release tree)");
    return 2;
  }
  const given = resolve(here, argv[0] ?? fileURLToPath(new URL("../../build", import.meta.url)));
  const isTree = existsSync(join(given, "BUILD.json"));
  const dir = isTree ? given : join(given, "release");
  const check = await checkReleaseTree(dir, isTree ? {} : { beside: given });
  const rel = relative(here, dir);
  const shown = rel.startsWith("../..") ? dir : rel || ".";
  if (check.problems.length) {
    for (const p of check.problems) console.error(`${shown}/${p}`);
    console.error(`${shown}: not a good release tree (${check.problems.length} problem${check.problems.length === 1 ? "" : "s"})`);
    return existsSync(dir) ? 1 : 2;
  }
  console.log(`${shown}: a good release tree, BoxOps ${check.build?.version} (build ${check.build?.build}): ${check.files.length} files, ${check.bytes} bytes, tree ${check.tree}`);
  return 0;
}

/** Run as a script (npm run check:release-tree), not imported. */
function isMain(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = await main(process.argv.slice(2));

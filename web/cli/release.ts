// What a BoxOps release is, as its command-line tool and action see it: the
// contract numbers, BUILD.json, the app files it ships and this build's
// identity. Node-only.
//
// A release commit (branch `releases`, tag vX.Y.Z) holds action.yml,
// BUILD.json, dist/boxops.mjs (engine and CLI), dist/action.mjs and
// dist/app/** (the prebuilt site). BUILD.json names the build and gives each
// file's SHA-256; the action copies the app only after checking every file
// against it. `npm run build && npm run build:cli` makes the same layout in
// web/dist/, with BUILD.json in dist/ itself, and the launcher's cache keeps
// boxops.mjs with its commit's BUILD.json beside it (preview or build fetches
// the app there). So BUILD.json is looked for beside the CLI's folder (the
// release) or in it, and a path "dist/X" in it is the file X in the CLI's
// own folder.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppInfo, type Bundle, SCHEMA } from "../src/model/bundle.ts";
import { FORMAT } from "../src/model/format.ts";
import { MIGRATES_FROM } from "../src/model/migrations/index.ts";
import { resolveCommit } from "./git.ts";
import { appInfo } from "./site.ts";

/** The repository releases come from, unless a mirror's pinned. */
export const UPSTREAM = "Allenfp/BoxOps";
/** The launcher's contract (.boxops/boxops.mjs, `launcher: N`): what it passes `main` and how it finds the pin. */
export const LAUNCHER = 1;
/** The Pages guard step in the starter's deploy.yml (`# boxops-guard: N`). */
export const GUARD = 1;
/** The managed block in AGENTS.md (`<!-- boxops:begin block=N`). */
export const AGENTS_BLOCK = 1;
/** Node.js the command-line tool needs (the action runs on the runner's node24). */
export const NODE = ">=22.12";

/** BUILD.json: deterministic (no clocks, no run ids), so two clean builds of a commit match byte for byte. */
export interface BuildJson {
  name: "BoxOps";
  version: string;
  /** The app's build id, also in its JavaScript, index.html and every roadmap.json the action writes. */
  build: string;
  /** The commit of Allenfp/BoxOps it was built from (40 hex; "" when unknown). */
  source: string;
  format: number;
  migratesFrom: number;
  bundle: number;
  launcher: number;
  guard: number;
  agentsBlock: number;
  node: string;
  /** Path in the release → "sha256-<base64>" of the file's bytes, sorted by path. */
  files: Record<string, string>;
}

/** Who this build is: the app's version, build id and time, and the commit it was built from. */
export interface Identity extends AppInfo {
  source: string;
}

declare const __BOXOPS_RELEASE__: Identity | undefined;

/** Where this module's file is: dist/ in a release, cli/ in a source checkout. */
export const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * This build's identity: compiled into dist/boxops.mjs (vite.cli.config.ts);
 * run from source, the checkout's (cli/site.ts's appInfo, and HEAD).
 */
export function identity(): Identity {
  if (typeof __BOXOPS_RELEASE__ !== "undefined") return __BOXOPS_RELEASE__;
  const web = resolve(HERE, "..");
  let source = "";
  try {
    source = resolveCommit(resolve(web, ".."), "HEAD", { checkout: true });
  } catch {
    // Not a git checkout.
  }
  return { ...appInfo(web), source };
}

/** "sha256-<base64>" of a file's bytes, as BUILD.json and Subresource Integrity write it. */
export const digest = (bytes: Uint8Array) => `sha256-${createHash("sha256").update(bytes).digest("base64")}`;

/** BUILD.json for these files (path in the release → bytes). */
export function makeBuildJson(id: Identity, files: Record<string, Uint8Array>): BuildJson {
  return {
    name: "BoxOps",
    version: id.version,
    build: id.build,
    source: id.source,
    format: FORMAT,
    migratesFrom: MIGRATES_FROM,
    bundle: SCHEMA,
    launcher: LAUNCHER,
    guard: GUARD,
    agentsBlock: AGENTS_BLOCK,
    node: NODE,
    files: Object.fromEntries(
      Object.keys(files)
        .sort()
        .map((path) => [path, digest(files[path])]),
    ),
  };
}

/** BUILD.json's text: two-space JSON and a final newline. */
export const buildJsonText = (b: BuildJson) => `${JSON.stringify(b, null, 2)}\n`;

const NUMBERS = ["format", "migratesFrom", "bundle", "launcher", "guard", "agentsBlock"] as const;

/** A BUILD.json's text as a BuildJson; throws if it isn't one. */
export function parseBuildJson(text: string): BuildJson {
  const b = JSON.parse(text) as Partial<BuildJson>;
  const ok =
    b !== null &&
    typeof b === "object" &&
    b.name === "BoxOps" &&
    typeof b.version === "string" &&
    typeof b.build === "string" &&
    typeof b.source === "string" &&
    typeof b.node === "string" &&
    NUMBERS.every((k) => Number.isInteger(b[k])) &&
    typeof b.files === "object" &&
    b.files !== null &&
    Object.entries(b.files).every(([p, d]) => typeof d === "string" && /^sha256-[A-Za-z0-9+/]{43}=$/.test(d) && isReleasePath(p));
  if (!ok) throw new Error("BUILD.json isn’t a BoxOps build description");
  return b as BuildJson;
}

/** A path BUILD.json may name: relative, "/"-separated, no "." or ".." parts, nothing hidden. */
const isReleasePath = (p: string) => /^[A-Za-z0-9_+-][A-Za-z0-9._+-]*(\/[A-Za-z0-9_+-][A-Za-z0-9._+-]*)*$/.test(p);

/** A release as the CLI in `cliDir` sees it. */
export interface Release {
  /** The folder dist/boxops.mjs is in. */
  cliDir: string;
  buildJson: BuildJson;
  /** Where BUILD.json was read. */
  buildJsonPath: string;
}

/** BUILD.json for the CLI in `cliDir` (see the top of this file), or null if there's none. */
export function findBuildJson(cliDir: string): string | null {
  const beside = join(cliDir, "..", "BUILD.json");
  if (basename(cliDir) === "dist" && existsSync(beside)) return beside;
  const inside = join(cliDir, "BUILD.json");
  return existsSync(inside) ? inside : null;
}

/** The file a BUILD.json path names, for the CLI in `cliDir`. */
export const releaseFile = (cliDir: string, path: string) => (path.startsWith("dist/") ? join(cliDir, path.slice(5)) : join(cliDir, "..", path));

/**
 * The release around the CLI in `cliDir`, checked to be this build's: its
 * BUILD.json names `build`. Throws a plain message if there's no BUILD.json
 * or it's another build's.
 */
export function openRelease(cliDir: string, build: string): Release {
  const path = findBuildJson(cliDir);
  if (!path) throw new Error(`No BUILD.json beside ${cliDir}: this isn’t a BoxOps release (in web/, run npm run build && npm run build:cli)`);
  let buildJson: BuildJson;
  try {
    buildJson = parseBuildJson(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${path}: ${(e as Error).message}`);
  }
  if (buildJson.build !== build) {
    throw new Error(`${path} describes BoxOps build ${buildJson.build}, but this is ${build}: the release is damaged or mixed up`);
  }
  return { cliDir, buildJson, buildJsonPath: path };
}

export interface AppFile {
  /** Path in the site, "/"-separated: index.html, assets/index-C6SG.js. */
  path: string;
  /** The file on disk. */
  file: string;
}

const APP = "dist/app/";

/**
 * The app's files (dist/app/** in BUILD.json), each checked to be a plain
 * file whose SHA-256 is BUILD.json's; and the app folder holds no other file.
 * Throws a message naming the first file that isn't right.
 */
export function verifiedApp(release: Release): AppFile[] {
  const listed = Object.keys(release.buildJson.files).filter((p) => p.startsWith(APP));
  if (!listed.includes(`${APP}index.html`)) throw new Error("BUILD.json lists no dist/app/index.html: this release has no app");
  const files: AppFile[] = [];
  for (const key of listed) {
    const file = releaseFile(release.cliDir, key);
    const st = lstatSync(file, { throwIfNoEntry: false });
    if (!st?.isFile()) throw new Error(`${key} is ${st ? "not a plain file" : "missing"}: the release is damaged`);
    if (digest(readFileSync(file)) !== release.buildJson.files[key]) throw new Error(`${key} isn’t the file BUILD.json describes: the release is damaged`);
    files.push({ path: key.slice(APP.length), file });
  }
  const appDir = releaseFile(release.cliDir, APP.slice(0, -1));
  const extra = walk(appDir).find((p) => !Object.hasOwn(release.buildJson.files, APP + p));
  if (extra !== undefined) throw new Error(`${APP}${extra} isn’t in BUILD.json: the release is damaged`);
  return files;
}

/** Every entry under `dir` that isn't a folder, "/"-separated, relative to it. */
function walk(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const path = rel ? `${rel}/${name}` : name;
    if (lstatSync(join(dir, path)).isDirectory()) out.push(...walk(dir, path));
    else out.push(path);
  }
  return out;
}

/**
 * Writes the site: the app's files (verified) and roadmap.json, into `out`,
 * which must be new or empty. Data never becomes HTML: roadmap.json is the
 * only file made here, and index.html is copied byte for byte.
 */
export function writeSite(out: string, app: AppFile[], bundle: Bundle): void {
  mkdirSync(out, { recursive: true });
  if (readdirSync(out).length) throw new Error(`${out} isn’t empty; give a new or empty folder`);
  for (const f of app) {
    const to = join(out, ...f.path.split("/"));
    if (!resolve(to).startsWith(resolve(out) + sep)) throw new Error(`${f.path} is outside the site`);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(f.file, to);
  }
  writeFileSync(join(out, "roadmap.json"), JSON.stringify(bundle));
}

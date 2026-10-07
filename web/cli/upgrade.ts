// `upgrade [vX.Y.Z]`: moves a roadmap repository to another BoxOps release.
// Resolves the tag (default: the newest release that wasn't withdrawn, unless
// that's older than the pins' own; a withdrawn one is refused by name too) to
// its commit, fetches that
// release's tool (checked against its BUILD.json, whose Node.js floor this
// one must meet) into the launcher's cache and loads it, then, and only
// then, rewrites every BoxOps pin in the workflows (and its `# vX.Y.Z`
// comment), and runs the NEW release's `migrate --check`, `sync` and
// `validate`. Commits nothing. Node-only.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cachedTool, keepTool, releaseCache } from "./cache.ts";
import { EXIT, type Io, type LaunchContext, UsageError, shellWord } from "./context.ts";
import { allPins, workflowFiles } from "./doctor.ts";
import { fileAt, gitHub, releaseOfTag, releases, tagCommit } from "./github.ts";
import { compareVersions, isWithdrawn, newestRelease, parseVersion } from "./notices.ts";
import { rewritePins } from "./pins.ts";
import { type BuildJson, digest, parseBuildJson } from "./release.ts";

/** The `main` of a release's dist/boxops.mjs: the launcher's contract. */
export type Main = (argv: string[], ctx: LaunchContext) => Promise<number>;

export interface UpgradeOptions {
  /** Loads a release's tool; default: import its file. */
  load?(file: string): Promise<Main>;
  /** The roadmap folder in the repository (--roadmap), for the new release's migrate --check and validate; default: roadmap. */
  roadmap?: string;
}

/** Whether this Node.js is `floor` ("major.minor") or newer. */
function nodeAtLeast(floor: string): boolean {
  const [major, minor] = floor.split(".").map(Number);
  const [maj, min] = process.versions.node.split(".").map(Number);
  return maj > major || (maj === major && min >= minor);
}

/**
 * A release's dist/boxops.mjs in the launcher's cache, with the BUILD.json of
 * the same commit, which must name the tag's version and describe the tool
 * (as the launcher checks it), and whose Node.js floor (`node: ">=X.Y"`)
 * this Node.js must be at (as the launcher checks it too; a minor release
 * may raise it). Fetched if either isn't there, or the tool isn't the file
 * the BUILD.json describes.
 */
export async function fetchRelease(io: Io, root: string, repo: string, sha: string, tag: string): Promise<string> {
  const dir = releaseCache(io.env, root, repo, sha);
  const check = (build: BuildJson) => {
    if (`v${build.version}` !== tag) throw new Error(`${repo}@${sha.slice(0, 7)} is BoxOps ${build.version}, not ${tag}`);
    const floor = /^>=(\d+\.\d+)$/.exec(build.node)?.[1];
    if (floor && !nodeAtLeast(floor)) throw new UsageError(`BoxOps ${tag} needs Node.js ${floor} or newer (this is ${process.versions.node}): nothing was changed`);
  };
  const cached = cachedTool(dir);
  if (cached) {
    check(cached.buildJson);
    return cached.file;
  }
  const gh = gitHub(io.env, io.fetch);
  const text = new TextDecoder().decode(await fileAt(gh, repo, sha, "BUILD.json"));
  const build = parseBuildJson(text);
  check(build);
  const bytes = await fileAt(gh, repo, sha, "dist/boxops.mjs");
  if (digest(bytes) !== build.files["dist/boxops.mjs"]) throw new Error(`dist/boxops.mjs of ${repo}@${sha.slice(0, 7)} isn’t the file its BUILD.json describes`);
  return keepTool(dir, bytes, text);
}

export async function upgradeCommand(root: string, wanted: string | undefined, ctx: LaunchContext, io: Io, o: UpgradeOptions = {}): Promise<number> {
  const workflows = workflowFiles(root);
  const pins = allPins(workflows);
  if (!pins.length) throw new UsageError("No BoxOps pin (`uses: <owner>/<boxops repo>@<commit>`) in .github/workflows to upgrade");
  const repos = [...new Set(pins.map((p) => p.repo))];
  if (repos.length > 1) throw new UsageError(`The pins name different repositories (${repos.join(", ")}): make them one by hand first`);
  const repo = repos[0];
  if (wanted !== undefined && !/^v\d+\.\d+\.\d+(-rc\.\d+)?$/.test(wanted)) throw new UsageError(`"${wanted}" isn’t a release tag: give one like v0.2.0`);

  const gh = gitHub(io.env, io.fetch);
  const tag = wanted ?? newestRelease(await releases(gh, repo));
  if (tag === undefined) {
    throw new UsageError(
      `${repo} has no release to move to (a vX.Y.Z, not a release candidate, a draft or withdrawn, among its newest; a mirror of BoxOps’ commits has none): give the tag, as in upgrade v0.2.0`,
    );
  }
  if (wanted === undefined) {
    // Never back to an older release unless it's named: the newest that wasn't withdrawn can be older than the
    // pins' own (a release candidate's, or a release withdrawn since), and an older release may not read the roadmap.
    const to = parseVersion(tag);
    const ahead = [...new Set(pins.map((p) => p.tag))].find((t) => {
      const v = t === undefined ? null : parseVersion(t);
      return v !== null && to !== null && compareVersions(v, to) > 0;
    });
    if (ahead) throw new UsageError(`The newest release of ${repo} that wasn’t withdrawn, ${tag}, is older than the pins’ ${ahead}: nothing was changed (to move back to it anyway, give it: upgrade ${tag})`);
  } else {
    const release = (await releaseOfTag(gh, repo, wanted)) as { name?: unknown } | null;
    if (release && isWithdrawn(release)) {
      throw new UsageError(`${wanted} of ${repo} was withdrawn (“${String(release.name).trim()}”): give another release, or none for the newest that wasn’t`);
    }
  }
  const sha = await tagCommit(gh, repo, tag);
  if (pins.every((p) => p.ref === sha && p.tag === tag)) {
    io.out(`Already on ${repo}@${sha.slice(0, 12)} (${tag}).`);
    return EXIT.ok;
  }
  const file = await fetchRelease(io, root, repo, sha, tag);
  // Before a pin moves: a tool this Node.js can't load leaves everything as it was.
  let main: Main;
  try {
    main = await (o.load ?? (async (f: string) => ((await import(pathToFileURL(f).href)) as { main: Main }).main))(file);
    if (typeof main !== "function") throw new Error("it has no main");
  } catch (e) {
    throw new UsageError(`BoxOps ${tag}’s tool won’t load on Node.js ${process.versions.node} (${(e as Error).message}): nothing was changed`);
  }

  const changed: string[] = [];
  for (const [path, text] of Object.entries(workflows)) {
    const next = rewritePins(text, sha, tag);
    if (next === text) continue;
    writeFileSync(join(root, path), next);
    changed.push(path);
  }
  const from = [...new Set(pins.map((p) => p.tag ?? p.ref.slice(0, 12)))].join(", ");
  io.out(`Moved the BoxOps pins in ${changed.join(", ")} from ${from} to ${tag} (${repo}@${sha.slice(0, 12)}).`);

  // Not the launcher's number, nor its word that it has checked the BoxOps
  // files: it compared them with the old release's BUILD.json. The new
  // release reads them, after its sync has rewritten what it writes. Its
  // migrate --check, before that sync, warns of nothing (`checked`): its
  // warnings would be of files sync rewrites next, and validate, after it,
  // warns of whatever isn't the new release's yet, such as the Pages guard.
  const { checked: _checked, launcher: _launcher, ...rest } = ctx;
  const next: LaunchContext = { ...rest, root, repo, sha, tag };
  const roadmap = o.roadmap === undefined ? [] : ["--roadmap", o.roadmap];
  const run = (argv: string[], context: LaunchContext) => {
    io.out(`\n${tag}: ${argv.join(" ")}`);
    return main(argv, context);
  };
  const migrate = await run(["migrate", "--check", ...roadmap], { ...next, checked: true });
  const sync = await run(["sync"], next);
  const validate = await run(["validate", ...roadmap], next);

  io.out("");
  if (migrate === EXIT.problems) {
    const folder = o.roadmap === undefined ? "" : ` --roadmap ${/^[\w./-]+$/.test(o.roadmap) ? o.roadmap : shellWord(o.roadmap)}`;
    io.out(`The data format changes in ${tag}: run \`node .boxops/boxops.mjs migrate${folder}\`, then validate again.`);
  }
  io.out(
    "Nothing is committed: review with `git diff`, then commit and push on a branch for a pull request. " +
      "Pushing workflow changes needs a repository admin (and SSH, the web UI or a token with the workflow permission); " +
      "an allow list of exact commits needs the new one.",
  );
  // The worst first: what validate says, then sync, then whether a migration is still to do.
  return validate !== EXIT.ok ? validate : sync !== EXIT.ok ? sync : migrate;
}

// `upgrade [vX.Y.Z]`: moves a roadmap repository to another BoxOps release.
// Resolves the tag (default: the latest release) to its commit, fetches that
// release's tool (checked against its BUILD.json) into the launcher's cache,
// rewrites every BoxOps pin in the workflows (and its `# vX.Y.Z` comment),
// then runs the NEW release's `migrate --check`, `sync` and `validate`.
// Commits nothing. Node-only.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cachedTool, keepTool, releaseCache } from "./cache.ts";
import { EXIT, type Io, type LaunchContext, UsageError } from "./context.ts";
import { allPins, workflowFiles } from "./doctor.ts";
import { fileAt, gitHub, latestTag, tagCommit } from "./github.ts";
import { rewritePins } from "./pins.ts";
import { type BuildJson, digest, parseBuildJson } from "./release.ts";

/** The `main` of a release's dist/boxops.mjs: the launcher's contract. */
export type Main = (argv: string[], ctx: LaunchContext) => Promise<number>;

export interface UpgradeOptions {
  /** Loads a release's tool; default: import its file. */
  load?(file: string): Promise<Main>;
}

/**
 * A release's dist/boxops.mjs in the launcher's cache, with the BUILD.json of
 * the same commit, which must name the tag's version and describe the tool
 * (as the launcher checks it). Fetched if either isn't there, or the tool
 * isn't the file the BUILD.json describes.
 */
export async function fetchRelease(io: Io, root: string, repo: string, sha: string, tag: string): Promise<string> {
  const dir = releaseCache(io.env, root, repo, sha);
  const version = (build: BuildJson) => {
    if (`v${build.version}` !== tag) throw new Error(`${repo}@${sha.slice(0, 7)} is BoxOps ${build.version}, not ${tag}`);
  };
  const cached = cachedTool(dir);
  if (cached) {
    version(cached.buildJson);
    return cached.file;
  }
  const gh = gitHub(io.env, io.fetch);
  const text = new TextDecoder().decode(await fileAt(gh, repo, sha, "BUILD.json"));
  const build = parseBuildJson(text);
  version(build);
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
  const tag = wanted ?? (await latestTag(gh, repo));
  const sha = await tagCommit(gh, repo, tag);
  if (pins.every((p) => p.ref === sha && p.tag === tag)) {
    io.out(`Already on ${repo}@${sha.slice(0, 12)} (${tag}).`);
    return EXIT.ok;
  }
  const file = await fetchRelease(io, root, repo, sha, tag);

  const changed: string[] = [];
  for (const [path, text] of Object.entries(workflows)) {
    const next = rewritePins(text, sha, tag);
    if (next === text) continue;
    writeFileSync(join(root, path), next);
    changed.push(path);
  }
  const from = [...new Set(pins.map((p) => p.tag ?? p.ref.slice(0, 12)))].join(", ");
  io.out(`Moved the BoxOps pins in ${changed.join(", ")} from ${from} to ${tag} (${repo}@${sha.slice(0, 12)}).`);

  const main = await (o.load ?? (async (f: string) => ((await import(pathToFileURL(f).href)) as { main: Main }).main))(file);
  const next: LaunchContext = { ...ctx, root, repo, sha, tag };
  io.out(`\n${tag}: migrate --check`);
  const migrate = await main(["migrate", "--check"], next);
  io.out(`\n${tag}: sync`);
  const sync = await main(["sync"], next);
  io.out(`\n${tag}: validate`);
  const validate = await main(["validate"], next);

  io.out("");
  if (migrate === EXIT.problems) io.out(`The data format changes in ${tag}: run \`node .boxops/boxops.mjs migrate\`, then validate again.`);
  io.out(
    "Nothing is committed: review with `git diff`, then commit and push on a branch for a pull request. " +
      "Pushing workflow changes needs a repository admin (and SSH, the web UI or a token with the workflow permission); " +
      "an allow list of exact commits needs the new one.",
  );
  // The worst first: what validate says, then sync, then whether a migration is still to do.
  return validate !== EXIT.ok ? validate : sync !== EXIT.ok ? sync : migrate;
}

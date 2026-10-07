// `init <dir> [--action owner/repo@sha]`: writes a new roadmap repository's
// files (the starter's, made for a release: cli/starter.ts), for
// organizations that can't use the starter as a template (EMU, blocked
// templates). The release is this tool's own: its tag resolved to a commit
// through the API, or the commit given; either way, that commit's BUILD.json
// must name this tool's build, so the files written and the release they pin
// agree, and gives the commit of main README.md's links to BoxOps' docs
// point at. So it writes what web/scripts/publish-starter.ts publishes as
// the starter repository for that release. Node-only.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { EXIT, type Io, UsageError, oneCommand, shellWord } from "./context.ts";
import { starterFiles } from "./embedded.ts";
import { fileAt, gitHub, tagCommit } from "./github.ts";
import { parseVersion } from "./notices.ts";
import { COMMIT_SHA } from "./pins.ts";
import { UPSTREAM, parseBuildJson } from "./release.ts";
import { renderStarter } from "./starter.ts";

const ACTION = /^([\w.-]+\/[\w.-]+)@([0-9a-f]{40})$/;

export async function initCommand(dirArg: string | undefined, action: string | undefined, io: Io): Promise<number> {
  if (!dirArg) throw new UsageError("Usage: boxops init <new folder> [--action owner/repo@<40-character commit>]");
  const dir = resolve(io.cwd, dirArg);
  if (existsSync(dir) && readdirSync(dir).length) throw new UsageError(`${dir} isn’t empty: give a new or empty folder`);
  const id = io.identity();
  const version = parseVersion(id.version) ? `v${id.version}` : null;

  let repo = UPSTREAM;
  let sha: string;
  const gh = gitHub(io.env, io.fetch);
  if (action !== undefined) {
    const m = ACTION.exec(action);
    if (!m) throw new UsageError(`--action is "${action}": give owner/repo@<40-character commit SHA>`);
    [, repo, sha] = m;
  } else {
    if (!version) throw new UsageError(`This BoxOps (${id.version}) isn’t a release: give --action owner/repo@<release commit>`);
    sha = await tagCommit(gh, repo, version);
  }
  const build = parseBuildJson(new TextDecoder().decode(await fileAt(gh, repo, sha, "BUILD.json")));
  if (build.build !== id.build) {
    throw new UsageError(
      `${repo}@${sha.slice(0, 12)} is BoxOps build ${build.build}, not this one (${id.build}): run that release’s boxops.mjs, or give this one’s commit with --action`,
    );
  }
  const tag = version ?? `v${build.version}`;
  if (!COMMIT_SHA.test(build.source)) throw new UsageError(`${repo}@${sha.slice(0, 12)}’s BUILD.json names no commit it was built from: it isn’t a release`);

  const files = renderStarter(starterFiles(), { repo, sha, tag, source: build.source });
  for (const [path, text] of Object.entries(files)) {
    const file = join(dir, ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { flag: "wx" });
  }
  const shown = relative(io.cwd, dir) || ".";
  // One command, the folder quoted: a failed `cd` runs nothing where it's pasted (`oneCommand`).
  const next = oneCommand([
    [`cd ${shellWord(shown)}`, "git init -b main", "git add -A"],
    [`git commit -m "Start roadmap from BoxOps ${tag}"`],
    ["gh repo create <org>/<name> --private --source . --push"],
  ]);
  io.out(`Wrote a BoxOps roadmap repository in ${shown}/ (${Object.keys(files).length} files), pinned to ${repo}@${sha.slice(0, 12)} # ${tag}.`);
  io.out("Next, one command (with your organization and the new repository’s name for <org>/<name>), which stops at the first step that fails:");
  for (const line of next) io.out(line);
  io.out("Pushing workflow files takes SSH, or a token with the workflow scope. Then follow README.md: Pages, rulesets, people.");
  return EXIT.ok;
}

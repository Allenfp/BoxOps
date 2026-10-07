// `npm run publish-starter -- --tag vX.Y.Z --commit <release commit> --out <folder> [--source <commit>]`:
// writes the starter repository (Allenfp/boxops-starter) for a BoxOps
// release into a new or empty folder, and prints the commands a maintainer
// runs to publish it. It never pushes, and asks GitHub nothing: everything
// comes from this clone's git, so fetch first (`git fetch origin main
// releases --tags`).
//
// The files are starter/ as it is at the commit of main the release was
// built from (its BUILD.json's `source`; --source to say so when it's
// another), not as this checkout has it, made for the release by
// cli/starter.ts: what that release's `init` writes, byte for byte. Checked
// before anything is written: the release commit's BUILD.json names the tag's
// version; the tag, if this clone has it, names that commit; and every page of
// BoxOps' docs the starter links to is there at the source commit.

import { mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError, flag, oneCommand, parseArgs, shellWord } from "../cli/context.ts";
import { gitPlumbing } from "../cli/git.ts";
import { COMMIT_SHA } from "../cli/pins.ts";
import { UPSTREAM, parseBuildJson } from "../cli/release.ts";
import { docLinks, renderStarter } from "../cli/starter.ts";

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export interface PublishOptions {
  /** The BoxOps clone to read from. */
  repoDir: string;
  /** The release's tag (vX.Y.Z) and commit. */
  tag: string;
  commit: string;
  /** The commit of main it was built from; default: its BUILD.json's `source`. */
  source?: string;
  /** A new or empty folder. */
  out: string;
}

export interface Published {
  files: string[];
  source: string;
  /** Whether this clone has the tag (and it names the commit); if not, that wasn't checked. */
  tagChecked: boolean;
}

/** A plumbing command's output in `repoDir`, or null if git says no (an object this clone hasn't). */
function git(repoDir: string, command: "rev-parse" | "cat-file" | "ls-tree", args: string[]): Buffer | null {
  try {
    return gitPlumbing(repoDir, command, args, { checkout: true, maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    if ((e as Error).message.startsWith(`git ${command} `)) return null;
    throw e;
  }
}

/** starter/ at `source`: its plain files (path in the starter → text). Throws on a symlink, a submodule or a file that isn't UTF-8. */
function starterAt(repoDir: string, source: string): Record<string, string> {
  const listing = git(repoDir, "ls-tree", ["-r", "-z", "--full-tree", source, "--", "starter/"]);
  if (!listing) throw new Error(`git can’t list starter/ at ${source}`);
  const files: Record<string, string> = {};
  for (const record of listing.toString("utf8").split("\0").filter(Boolean)) {
    const [meta, path] = record.split("\t");
    const [mode, kind, sha] = meta.split(" ");
    if (kind !== "blob" || (mode !== "100644" && mode !== "100755")) throw new Error(`${path} at ${source.slice(0, 12)} is a ${mode === "120000" ? "symlink" : kind}: the starter is plain files`);
    const bytes = git(repoDir, "cat-file", ["blob", sha]);
    if (!bytes) throw new Error(`git can’t read ${path} at ${source.slice(0, 12)}`);
    try {
      files[path.slice("starter/".length)] = strictUtf8.decode(bytes);
    } catch {
      throw new Error(`${path} at ${source.slice(0, 12)} isn’t UTF-8 text`);
    }
  }
  if (!Object.keys(files).length) throw new Error(`there’s no starter/ at ${source.slice(0, 12)}`);
  return files;
}

/** Makes the starter for the release and writes it to `o.out`; throws a plain message if anything doesn't check out. */
export function publishStarter(o: PublishOptions): Published {
  if (!/^v\d+\.\d+\.\d+(-rc\.\d+)?$/.test(o.tag)) throw new UsageError(`--tag is "${o.tag}": give a release tag, like v0.1.0`);
  if (!COMMIT_SHA.test(o.commit)) throw new UsageError(`--commit is "${o.commit}": give the release's commit (40 lowercase hex)`);
  if (o.source !== undefined && !COMMIT_SHA.test(o.source)) throw new UsageError(`--source is "${o.source}": give a commit (40 lowercase hex)`);
  const short = (sha: string) => sha.slice(0, 12);
  const fetchFirst = "fetch first: git fetch origin main releases --tags";

  if (!git(o.repoDir, "cat-file", ["-e", `${o.commit}^{commit}`])) throw new Error(`This clone hasn’t commit ${short(o.commit)}: ${fetchFirst}`);
  const json = git(o.repoDir, "cat-file", ["blob", `${o.commit}:BUILD.json`]);
  if (!json) throw new Error(`${short(o.commit)} has no BUILD.json: it isn’t a BoxOps release commit`);
  const build = parseBuildJson(json.toString("utf8"));
  if (`v${build.version}` !== o.tag) throw new Error(`${short(o.commit)} is BoxOps ${build.version}, not ${o.tag}`);
  const tagged = git(o.repoDir, "rev-parse", ["-q", "--verify", `refs/tags/${o.tag}^{commit}`])?.toString().trim();
  if (tagged && tagged !== o.commit) throw new Error(`${o.tag} is ${short(tagged)} in this clone, not ${short(o.commit)}`);
  const source = o.source ?? build.source;
  if (!COMMIT_SHA.test(source)) throw new Error(`${short(o.commit)}’s BUILD.json names no commit it was built from: give --source`);
  if (build.source && build.source !== source) throw new Error(`${short(o.commit)} was built from ${short(build.source)}, not ${short(source)}`);
  if (!git(o.repoDir, "cat-file", ["-e", `${source}^{commit}`])) throw new Error(`This clone hasn’t commit ${short(source)}, which the release was built from: ${fetchFirst}`);

  const files = renderStarter(starterAt(o.repoDir, source), { repo: UPSTREAM, sha: o.commit, tag: o.tag, source });
  const broken = [...docLinks(files, source)].filter(([path, kind]) => git(o.repoDir, "cat-file", ["-t", `${source}:${path}`])?.toString().trim() !== kind);
  if (broken.length) {
    throw new Error(`The starter links to ${broken.map(([p]) => p).join(", ")} in BoxOps, which ${short(source)} hasn’t: nothing was written`);
  }

  mkdirSync(o.out, { recursive: true });
  if (readdirSync(o.out).length) throw new UsageError(`${o.out} isn’t empty: give a new or empty folder`);
  for (const [path, text] of Object.entries(files)) {
    const file = join(o.out, ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { flag: "wx" });
  }
  return { files: Object.keys(files).sort(), source, tagChecked: tagged === o.commit };
}

/**
 * What a maintainer runs to publish the folder written, `out` (an absolute
 * path, as the commands run in other folders): the first time, then for each
 * later release. Indented lines are commands, each block one command
 * (`oneCommand`); rsync writes into the new clone alone, once it's checked to
 * be one, never into the folder the command runs in.
 */
export function publishCommands(out: string, tag: string): string[] {
  if (!isAbsolute(out)) throw new Error(`publishCommands: ${out} isn’t an absolute path`);
  const repo = "Allenfp/boxops-starter";
  return [
    `The first time (${repo} doesn't exist yet), in the folder written:`,
    ...oneCommand([
      [`cd ${shellWord(out)}`, "git init -b main", "git add -A"],
      [`git commit -m "BoxOps starter for ${tag}"`],
      [`gh repo create ${repo} --public --source . --push`],
      [`gh repo edit ${repo} --template`],
    ]),
    "Then, on GitHub: Settings → Pages → Source: GitHub Actions, and run Actions → Deploy roadmap.",
    "Each later release, as a pull request, from a new clone in a temporary folder:",
    ...oneCommand([
      ["starter=$(mktemp -d)"],
      [`git clone git@github.com:${repo}.git "$starter"`],
      ['cd "$starter"', `git switch -c boxops-${tag}`],
      ['[ -d "$starter/.git" ]', `rsync -a --delete --exclude=.git ${shellWord(`${out}/`)} "$starter/"`],
      ["git add -A", `git commit -m "Upgrade BoxOps to ${tag}"`],
      [`git push -u origin boxops-${tag}`, "gh pr create --fill"],
    ]),
    "Each is one command: paste it whole, and it stops at the first step that fails.",
    "Pushing workflow files takes SSH, or a token with the workflow scope.",
  ];
}

/** The BoxOps clone this script is in. */
const REPO_DIR = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** The command: prints what it wrote and what to run next; returns the exit code (2: usage). */
export async function main(argv: string[], repoDir = REPO_DIR): Promise<number> {
  const here = process.env.INIT_CWD ?? process.cwd();
  try {
    const args = parseArgs(argv, ["tag", "commit", "out", "source"]);
    const [tag, commit, out] = [flag(args, "tag"), flag(args, "commit"), flag(args, "out")];
    if (!tag || !commit || !out || args.positional.length) {
      throw new UsageError("Usage: npm run publish-starter -- --tag vX.Y.Z --commit <release commit> --out <new folder> [--source <commit>]");
    }
    const dir = resolve(here, out);
    const done = publishStarter({ repoDir, tag, commit, out: dir, ...(flag(args, "source") && { source: flag(args, "source") }) });
    const shown = relative(here, dir) || ".";
    console.log(`Wrote the starter for BoxOps ${tag} to ${shown} (${done.files.length} files): ${UPSTREAM}@${commit.slice(0, 12)}, built from ${done.source.slice(0, 12)}.`);
    if (!done.tagChecked) console.log(`This clone hasn't the tag ${tag}, so it wasn't checked to name that commit.`);
    console.log("Nothing was pushed. To publish it:");
    for (const line of publishCommands(dir, tag)) console.log(`  ${line}`);
    return 0;
  } catch (e) {
    console.error(`publish-starter: ${(e as Error).message}`);
    return e instanceof UsageError ? 2 : 1;
  }
}

/** Run as a script (npm run publish-starter), not imported by its tests. */
function isMain(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = await main(process.argv.slice(2));

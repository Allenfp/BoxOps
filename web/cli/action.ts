// The BoxOps action: dist/action.mjs runs runAction() when a workflow uses a
// release (`uses: Allenfp/BoxOps@<sha>`), and Path B runs the same file with
// flags in place of inputs, `node dist/action.mjs --flag value …` (as does
// `node dist/boxops.mjs action --flag value …`). Node-only.
//
// It checks a roadmap repository's roadmap and, in build mode, assembles its
// Pages site from this release's prebuilt app and a roadmap.json. Steps:
//   1. Platform: github.com only (not GitHub Enterprise Server or GHE.com),
//      Linux or macOS runners, known input values; the action's own ref should
//      be a commit SHA.
//   2. Branch (build mode): the run's ref must be the default branch, from the
//      event payload (no token needed); a scheduled run always is.
//   3. Repository: `path` inside the workspace, with a .git folder of its own;
//      `roadmap` a plain relative folder name.
//   4–7. The roadmap read from git objects at the checkout's HEAD, never the
//      working tree: hardened plumbing git only (cli/git.ts); plain files
//      only (a symlink or submodule is an error naming it), within the limits,
//      every blob checked against its SHA and read as strict UTF-8. In build
//      mode HEAD must be the run's commit (GITHUB_SHA), unless `repository`
//      names another repository.
//   8. Format gate: a roadmap without a settings.yaml, in another data
//      format, or whose format can't be read, stops the build.
//   9. Validation: each problem an error annotation on its file and line,
//      counted in the `problems` output. Check mode fails on any; build mode
//      only with `on-problems: fail` (`deploy`, the default, publishes the
//      site without the broken entries, as the app loads them).
//   10. Consistency warnings, never fatal, also from git objects: every
//      BoxOps pin in the workflows names one commit; the guard's number, and
//      the launcher and AGENTS.md block (number and text), are this
//      release's; no retired runner labels.
//   11. Notices: newer releases, security fixes and withdrawals, from the
//      optional releases-file (cli/notices.ts).
//   12. Assembly (build mode): $RUNNER_TEMP/boxops-site, made fresh, gets this
//      release's dist/app (each file checked against BUILD.json) and
//      roadmap.json. Data never becomes HTML, CSS or SVG.
//   13. Outputs ($GITHUB_OUTPUT, heredoc-delimited) and the job summary.
// The only child process is git (the one in PATH's absolute folders, run in
// the .git folder: cli/git.ts); nothing in the workspace is executed,
// imported or read as configuration; no network; no token.

import { lstatSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Bundle } from "../src/model/bundle.ts";
import { FORMAT } from "../src/model/format.ts";
import { statedFormat } from "../src/model/migrations/index.ts";
import { loadRoadmap, parseFile, settingsFormat } from "../src/model/parse.ts";
import { buildReport } from "../src/model/report.ts";
import { type Env, Runner, clip, codeBlock, getInput } from "./gha.ts";
import { RoadmapReadError, listCommitFolder, readCommitFiles, resolveCommit } from "./git.ts";
import { readReleasesFile, releaseNotices } from "./notices.ts";
import { COMMIT_SHA, contractNumber, findPins } from "./pins.ts";
import { type BuildJson, HERE, type Identity, identity, openRelease, verifiedApp, writeSite } from "./release.ts";
import { headlines, resultLine } from "./roadmap.ts";
import { retiredRunners } from "./runners.ts";
import { buildBundle } from "./site.ts";
import { hasReleaseBlock, isReleaseLauncher } from "./sync.ts";

const TITLE = "BoxOps";
const ROADMAP_DIR = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
/** At most this many problems become annotations (GitHub shows 10 per step anyway); the rest are in the log. */
const MAX_ANNOTATIONS = 50;

/** Stops the action: an error annotation (on a file and line, if it's about one), and the step fails. */
export class ActionError extends Error {
  constructor(
    message: string,
    readonly file?: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

/**
 * Step 8's stop. `unreadable`: settings.yaml can't be read for its format (a
 * problem in the file, as validate counts it), rather than stating another
 * format or being missing (format 0, to migrate).
 */
export class FormatError extends ActionError {
  constructor(
    message: string,
    file: string,
    line?: number,
    readonly unreadable = false,
  ) {
    super(message, file, line);
    this.name = "FormatError";
  }
}

export interface Inputs {
  mode: "build" | "check";
  roadmap: string;
  path: string;
  onProblems: "deploy" | "fail";
  releasesFile: string;
  readOnly: boolean;
  /** "owner/name"; "" for the workflow's own. */
  repository: string;
  summary: boolean;
  /** Where to assemble the site (Path B's --out); "" for $RUNNER_TEMP/boxops-site. */
  out: string;
}

const FLAGS: Record<string, keyof Inputs> = {
  "--mode": "mode",
  "--roadmap": "roadmap",
  "--path": "path",
  "--on-problems": "onProblems",
  "--releases-file": "releasesFile",
  "--read-only": "readOnly",
  "--repository": "repository",
  "--summary": "summary",
  "--out": "out",
};
/** action.yml's inputs. Not `out`: only Path B chooses where the site goes. */
const INPUT_NAMES: Record<Exclude<keyof Inputs, "out">, string> = {
  mode: "mode",
  roadmap: "roadmap",
  path: "path",
  onProblems: "on-problems",
  releasesFile: "releases-file",
  readOnly: "read-only",
  repository: "repository",
  summary: "summary",
};

const oneOf = <T extends string>(name: string, value: string, allowed: readonly T[]): T => {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new ActionError(`Input ${name} is "${value}"; it must be ${allowed.map((a) => `"${a}"`).join(" or ")}`);
};

/** The inputs: the runner's INPUT_* variables (action.yml's), or Path B's flags (`--mode check`, and `--out`), with action.yml's defaults. */
export function readInputs(env: Env, argv: string[]): Inputs {
  const raw: Partial<Record<keyof Inputs, string>> = {};
  for (const key of Object.keys(INPUT_NAMES) as (keyof typeof INPUT_NAMES)[]) {
    const value = getInput(env, INPUT_NAMES[key]);
    if (value !== "") raw[key] = value;
  }
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    const key = FLAGS[flag];
    if (!key) throw new ActionError(`Unknown option ${flag} for \`boxops action\` (it takes ${Object.keys(FLAGS).join(", ")})`);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new ActionError(`${flag} needs a value`);
    raw[key] = value.trim();
  }
  return {
    mode: oneOf("mode", raw.mode ?? "build", ["build", "check"] as const),
    roadmap: raw.roadmap ?? "roadmap",
    path: raw.path ?? ".",
    onProblems: oneOf("on-problems", raw.onProblems ?? "deploy", ["deploy", "fail"] as const),
    releasesFile: raw.releasesFile ?? "",
    readOnly: oneOf("read-only", raw.readOnly ?? "false", ["true", "false"] as const) === "true",
    repository: raw.repository ?? "",
    summary: oneOf("summary", raw.summary ?? "true", ["true", "false"] as const) === "true",
    out: raw.out ?? "",
  };
}

/** Step 1: the platforms BoxOps 0.1 runs on. */
export function checkPlatform(env: Env): void {
  if (env.GITHUB_ACTIONS !== "true") throw new ActionError("This isn’t GitHub Actions (GITHUB_ACTIONS isn’t true): the action runs only in a workflow");
  const server = (env.GITHUB_SERVER_URL ?? "").replace(/\/+$/, "");
  if (server.toLowerCase() !== "https://github.com") {
    throw new ActionError(`GitHub Enterprise Server and GHE.com aren’t supported in BoxOps 0.1 (this runs on ${server || "an unknown server"}): use github.com`);
  }
  if (env.RUNNER_OS !== "Linux" && env.RUNNER_OS !== "macOS") {
    throw new ActionError(`BoxOps 0.1 runs on Linux and macOS runners, not ${env.RUNNER_OS || "this one"} (Windows is untested): use runs-on: ubuntu-24.04`);
  }
}

/** The event payload's repository fields, or {} if there's no payload. */
function eventRepository(env: Env): Record<string, unknown> {
  try {
    // A JSON file the runner writes, outside the workspace; only read, never run.
    const payload: unknown = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8"));
    const repo = (payload as { repository?: unknown })?.repository;
    return typeof repo === "object" && repo !== null ? (repo as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Step 2: build mode publishes the default branch only. A scheduled run's
 * payload has no repository, but GitHub runs schedules on the default branch
 * only (its ref is that branch), so one is let through.
 */
export function checkBranch(env: Env): void {
  if (env.GITHUB_EVENT_NAME === "schedule" && env.GITHUB_REF_TYPE === "branch") return;
  const branch = eventRepository(env).default_branch;
  if (typeof branch !== "string" || !branch) {
    throw new ActionError(
      "Can’t tell the repository’s default branch from the event payload, so nothing was built: run this on a push, schedule or workflow_dispatch event",
    );
  }
  const ref = env.GITHUB_REF_NAME ?? "";
  if (env.GITHUB_REF_TYPE === "tag" || ref !== branch) {
    throw new ActionError(`BoxOps builds the site from the default branch (${branch}) only, and this run is for ${ref || "an unknown ref"}: run it from ${branch}, or use mode: check`);
  }
}

/** Step 3: the repository's top level, inside the workspace, with its own .git folder. */
export function locateRepository(env: Env, path: string, roadmap: string): string {
  const workspace = env.GITHUB_WORKSPACE;
  if (!workspace) throw new ActionError("GITHUB_WORKSPACE isn’t set");
  if (!ROADMAP_DIR.test(roadmap) || roadmap.split("/").some((p) => p === "." || p === "..")) {
    throw new ActionError(`Input roadmap is "${roadmap}": give a folder in the repository, like roadmap (letters, digits, ".", "_" and "-", parts separated by "/", no "..")`);
  }
  let top: string;
  let ws: string;
  try {
    ws = realpathSync(workspace);
    top = realpathSync(resolve(ws, path));
  } catch {
    throw new ActionError(`Input path is "${path}", and there’s no such folder in the workspace: check the path given to actions/checkout`);
  }
  if (isAbsolute(relative(ws, top)) || relative(ws, top).split(sep)[0] === "..") {
    throw new ActionError(`Input path is "${path}", which is outside the workspace (${ws}): give the folder actions/checkout used, relative to the workspace`);
  }
  const dotGit = lstatSync(join(top, ".git"), { throwIfNoEntry: false });
  if (!dotGit) {
    throw new ActionError(
      `${path === "." ? "The workspace" : path} has no .git folder: actions/checkout downloads a tarball instead when the runner has no git 2.18 or later. Install git on the runner, or check the path`,
    );
  }
  if (!dotGit.isDirectory()) {
    throw new ActionError(`${join(path, ".git")} is ${dotGit.isSymbolicLink() ? "a symlink" : "a file (a worktree or submodule checkout)"}: BoxOps reads only a repository’s own .git folder`);
  }
  return top;
}

/**
 * Step 4, in build mode: the checkout is the commit the run is for
 * (GITHUB_SHA). A workflow on the default branch can check out another (a
 * pull request's head under pull_request_target or workflow_run, whose runs
 * are on the default branch), which step 2 alone would let it publish.
 * Another repository's roadmap (`repository` naming one: a canary, say) is
 * built from its checkout, read-only.
 */
export function checkCommit(env: Env, repository: string, commit: string): void {
  const own = !repository || repository.toLowerCase() === (env.GITHUB_REPOSITORY ?? "").toLowerCase();
  const sha = (env.GITHUB_SHA ?? "").toLowerCase();
  if (own && sha && commit !== sha) {
    throw new ActionError(
      `BoxOps builds the site from the commit this run is for (${sha.slice(0, 12)}), and the checkout is at ${commit.slice(0, 12)}: check out that commit (actions/checkout with no ref:), or use mode: check`,
    );
  }
}

/** The format `migrate` takes settings.yaml's text to be in (statedFormat), or null if it can't tell. */
function migratesFrom(text: string): number | null {
  try {
    return statedFormat({ "settings.yaml": text });
  } catch {
    return null;
  }
}

/**
 * Step 8: the roadmap must have a settings.yaml, in this BoxOps's data
 * format. `format: 0` is format 0, as `migrate` takes it (the loader calls it
 * unsupported). A format that can't be read stops on the loader's problem
 * with the file, on its line: a YAML syntax error, say.
 */
export function checkFormat(files: Record<string, string>, roadmap: string, version: string): number {
  const file = `${roadmap}/settings.yaml`;
  const text = files["settings.yaml"];
  if (text === undefined) {
    throw new FormatError(`${file} is missing: every roadmap needs one, with at least \`format: ${FORMAT}\`. Add it, commit and push. The site wasn’t changed`, file);
  }
  const format = settingsFormat(text) ?? (migratesFrom(text) === 0 ? 0 : null);
  if (format === null) {
    const issues = parseFile("settings.yaml", text).issues;
    const issue = issues.find((i) => i.message.startsWith("format:")) ?? issues[0];
    const line = issue?.line;
    throw new FormatError(
      `${file}${line === undefined ? "" : `:${line}`}: ${issue?.message ?? `format: expected a whole number, like "format: ${FORMAT}"`}. ` +
        "The data format can’t be read until that’s fixed: fix it, then push. The site wasn’t changed",
      file,
      line,
      true,
    );
  }
  if (format < FORMAT) {
    throw new FormatError(
      `This roadmap is in data format ${format}; BoxOps ${version} reads format ${FORMAT}. Run \`node .boxops/boxops.mjs migrate\`, commit and push. The site wasn’t changed`,
      file,
    );
  }
  if (format > FORMAT) {
    throw new FormatError(
      `This roadmap is in data format ${format}; BoxOps ${version} reads format ${FORMAT}: this roadmap needs BoxOps that reads format ${format}; upgrade the pin (\`node .boxops/boxops.mjs upgrade\`). The site wasn’t changed`,
      file,
    );
  }
  return format;
}

/** A warning step 10 gives, on a file. */
export interface Consistency {
  file: string;
  line?: number;
  message: string;
}

/** Step 10: warnings about the repository's BoxOps files, read from git objects at `commit`. */
export async function consistency(repoDir: string, commit: string, build: BuildJson, today: string): Promise<Consistency[]> {
  const out: Consistency[] = [];
  const workflowPaths = listCommitFolder(repoDir, commit, ".github/workflows").filter((p) => /\.ya?ml$/.test(p));
  const files = await readCommitFiles(repoDir, commit, [...workflowPaths, ".boxops/boxops.mjs", "AGENTS.md"]);

  const pins = workflowPaths.flatMap((file) => findPins(files[file] ?? "").map((pin) => ({ file, ...pin })));
  for (const pin of pins) {
    if (!COMMIT_SHA.test(pin.ref)) {
      out.push({
        file: pin.file,
        line: pin.line,
        message: `BoxOps is pinned to “${pin.ref}”, not a 40-character commit SHA: a tag or branch can be moved to other code. Pin the release commit (\`node .boxops/boxops.mjs upgrade\` does)`,
      });
    }
  }
  const shas = [...new Set(pins.map((p) => p.ref))];
  if (shas.length > 1) {
    const where = pins.map((p) => `${p.file}:${p.line} → ${p.ref.slice(0, 12)}`).join(", ");
    out.push({
      file: pins[0].file,
      line: pins[0].line,
      message: `The BoxOps pins differ (${where}): keep every \`uses:\` line on one release (\`node .boxops/boxops.mjs upgrade\` rewrites them all)`,
    });
  }

  const deploy = files[".github/workflows/deploy.yml"];
  const guard = deploy === undefined ? null : contractNumber(deploy, "guard");
  if (guard !== null && guard !== build.guard) {
    out.push({
      file: ".github/workflows/deploy.yml",
      message: `The Pages guard in deploy.yml is version ${guard}; this BoxOps expects ${build.guard}: \`node .boxops/boxops.mjs doctor\` shows what to change`,
    });
  }
  // The launcher and the block, number and text: one that says it's this release's may still have
  // been changed, and the launcher is code that runs on teammates' machines. This check runs none of it.
  const changed = (what: string, n: number | null, path: string, before: string) =>
    `${what} isn’t this release’s${n === null ? "" : `, though it says ${n}`}: see what changed (\`git log -p -- ${path}\`) ${before}, then \`node .boxops/boxops.mjs sync\` writes this release’s`;
  const launcherFile = files[".boxops/boxops.mjs"];
  const launcher = launcherFile === undefined ? null : contractNumber(launcherFile, "launcher");
  if (launcher !== null && launcher !== build.launcher) {
    out.push({ file: ".boxops/boxops.mjs", message: `The launcher is version ${launcher}; this BoxOps writes ${build.launcher}: run \`node .boxops/boxops.mjs sync\`` });
  } else if (launcherFile !== undefined && !isReleaseLauncher(launcherFile)) {
    out.push({ file: ".boxops/boxops.mjs", message: changed("The launcher", launcher, ".boxops/boxops.mjs", "before anyone runs it") });
  }
  const agents = files["AGENTS.md"];
  const block = agents === undefined ? null : contractNumber(agents, "block");
  if (block !== null && block !== build.agentsBlock) {
    out.push({ file: "AGENTS.md", message: `AGENTS.md’s BoxOps block is ${block}; this BoxOps writes ${build.agentsBlock}: run \`node .boxops/boxops.mjs sync\`` });
  } else if (agents !== undefined && block !== null && !hasReleaseBlock(agents)) {
    out.push({ file: "AGENTS.md", message: changed("AGENTS.md’s BoxOps block", block, "AGENTS.md", "before an assistant follows it") });
  }
  for (const file of workflowPaths) {
    for (const w of retiredRunners(files[file] ?? "", today)) out.push({ file, line: w.line, message: `This workflow ${w.message}` });
  }
  return out;
}

export interface ActionOptions {
  /** Default: process.env. */
  env?: Env;
  /** Path B's flags; default: none (the runner's INPUT_* variables). */
  argv?: string[];
  /** The log; default: stdout. */
  out?: (line: string) => void;
  /** The folder dist/boxops.mjs is in (its release's dist/); default: this module's. */
  cliDir?: string;
  /** Default: this build's (release.ts). */
  identity?: Identity;
  /** YYYY-MM-DD, for runner retirement dates; default: today in UTC. */
  today?: string;
}

/**
 * Runs the action; returns the exit code (0 success, 1 failure). Never
 * throws: what stops it (the format gate, a roadmap that can't be read, a
 * guard) is an error annotation, the `result` output ("failed: …") and that
 * line in the job summary, where the run's page shows it.
 */
export async function runAction(o: ActionOptions = {}): Promise<number> {
  const env = o.env ?? process.env;
  const runner = new Runner(env, o.out);
  try {
    return await steps(runner, env, o);
  } catch (e) {
    const file = e instanceof ActionError ? e.file : undefined;
    const line = e instanceof ActionError ? e.line : undefined;
    const message = e instanceof Error ? e.message : String(e);
    runner.annotate("error", message, { title: TITLE, ...(file !== undefined && { file }), ...(line !== undefined && { line }) });
    runner.setOutput("result", `failed: ${message}`);
    try {
      const version = (o.identity ?? identity()).version;
      runner.summary(`### ${TITLE} ${version}\n\n${codeBlock(clip(`failed: ${message}`))}`);
    } catch {
      // No summary to write to (an unwritable $GITHUB_STEP_SUMMARY): the annotation and the output say it.
    }
    return 1;
  }
}

async function steps(runner: Runner, env: Env, o: ActionOptions): Promise<number> {
  // 1. Platform and inputs.
  const inputs = readInputs(env, o.argv ?? []);
  checkPlatform(env);
  const id = o.identity ?? identity();
  const release = openRelease(o.cliDir ?? HERE, id.build);
  runner.setOutput("version", id.version);
  runner.setOutput("build", id.build);
  const actionRef = env.GITHUB_ACTION_REF ?? "";
  if (actionRef && !COMMIT_SHA.test(actionRef)) {
    runner.annotate("warning", `This workflow uses BoxOps at “${actionRef}”, not a 40-character commit SHA: a tag or branch can be moved to other code. Pin the release commit`, {
      title: TITLE,
    });
  }

  // 2. Branch.
  if (inputs.mode === "build") checkBranch(env);

  // 3–7. The repository, and the roadmap from its git objects.
  const repoDir = locateRepository(env, inputs.path, inputs.roadmap);
  const commit = resolveCommit(repoDir, "HEAD");
  runner.setOutput("commit", commit);
  if (inputs.mode === "build") checkCommit(env, inputs.repository, commit);
  const repository = inputs.repository || env.GITHUB_REPOSITORY || "";
  let bundle: Bundle;
  try {
    bundle = await buildBundle({
      repoDir,
      dir: inputs.roadmap,
      commit,
      repository,
      readonly: inputs.readOnly,
      app: { version: id.version, build: id.build, time: id.time },
      env,
      warn: (message) => runner.annotate("warning", message, { title: TITLE }),
    });
  } catch (e) {
    if (!(e instanceof RoadmapReadError)) throw e;
    const problems = e.problems.map((p) => {
      const file = p.path ? `${inputs.roadmap}/${p.path}` : inputs.roadmap;
      return { file, text: `${file} ${p.message}` };
    });
    for (const p of problems) runner.annotate("error", p.text, { title: TITLE, file: p.file });
    // The first problem named, so the `result` output says what it is (a symlink, a submodule…).
    const more = problems.length - 1;
    throw new ActionError(
      `${problems[0].text}${more ? ` (and ${more} more problem${more === 1 ? "" : "s"}, above)` : ""}: ${inputs.roadmap}/ can’t be read as it is, so nothing was built`,
    );
  }

  // 8. Format gate.
  const format = checkFormat(bundle.files, inputs.roadmap, id.version);
  runner.setOutput("format", String(format));

  // 9. Validation.
  const loaded = loadRoadmap(bundle.files, bundle.ignored);
  const problems = loaded.issues.length;
  loaded.issues.forEach((issue, i) => {
    const file = `${inputs.roadmap}/${issue.path}`;
    if (i < MAX_ANNOTATIONS) runner.annotate("error", issue.message, { title: TITLE, file, ...(issue.line !== undefined && { line: issue.line }) });
    else runner.log(`${file}${issue.line ? `:${issue.line}` : ""}: ${issue.message}`);
  });
  if (problems > MAX_ANNOTATIONS) runner.annotate("error", `…and ${problems - MAX_ANNOTATIONS} more problems, listed in the log`, { title: TITLE });
  const result = resultLine(loaded.roadmap, problems);
  runner.setOutput("problems", String(problems));
  runner.setOutput("result", result);
  runner.log(result);

  // 10. Consistency warnings.
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  for (const w of await consistency(repoDir, commit, release.buildJson, today)) {
    runner.annotate("warning", w.message, { title: TITLE, file: w.file, ...(w.line !== undefined && { line: w.line }) });
  }

  // 11. Notices.
  const list = readReleasesFile(inputs.releasesFile);
  if ("skipped" in list) runner.log(`Update notices: ${list.skipped}`);
  const notices = "releases" in list ? releaseNotices(id.version, list.releases) : { notices: [], annotations: [] };
  for (const a of notices.annotations) runner.annotate(a.level, a.message, { title: TITLE });
  bundle.notices = notices.notices;

  // Each line clipped (gha.ts): a problem quotes the value, and a name can be long.
  const summary = () => {
    if (!inputs.summary) return runner.summary(`### ${TITLE} ${id.version}\n\n${codeBlock(result)}`);
    const shown = loaded.issues.slice(0, 100).map((i) => clip(`${inputs.roadmap}/${i.path}${i.line ? `:${i.line}` : ""}: ${i.message}`));
    const more = problems > shown.length ? [`…and ${problems - shown.length} more`] : [];
    const capacity = headlines(buildReport(loaded.roadmap)).split("\n").map((line) => clip(line));
    runner.summary(
      `### ${TITLE} ${id.version}\n\n${codeBlock(result)}` +
        (problems ? `\n**Problems**\n\n${codeBlock([...shown, ...more].join("\n"))}` : "") +
        `\n**Capacity**\n\n${codeBlock(capacity.join("\n"))}`,
    );
  };

  if (inputs.mode === "check") {
    summary();
    if (problems) runner.annotate("error", `${result}: fix the problems above`, { title: TITLE });
    return problems ? 1 : 0;
  }
  if (problems && inputs.onProblems === "fail") {
    summary();
    runner.annotate("error", `${result}, and on-problems is fail: nothing was built, so the last site stays live. Fix the problems above, then push`, { title: TITLE });
    return 1;
  }

  // 12. Assembly.
  const app = verifiedApp(release);
  let site: string;
  if (inputs.out) {
    site = resolve(env.GITHUB_WORKSPACE ?? ".", inputs.out);
  } else {
    if (!env.RUNNER_TEMP) throw new ActionError("RUNNER_TEMP isn’t set");
    site = join(env.RUNNER_TEMP, "boxops-site");
    rmSync(site, { recursive: true, force: true });
  }
  writeSite(site, app, bundle);

  // 13. Outputs and summary.
  runner.setOutput("site", site);
  summary();
  runner.log(`Site assembled in ${site}: BoxOps ${id.build}, ${bundle.source.repo || "?"}@${commit.slice(0, 12)}${problems ? `, without the broken entries` : ""}`);
  return 0;
}

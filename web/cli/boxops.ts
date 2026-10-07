// The BoxOps command-line tool, dist/boxops.mjs in a release (vite.cli.config.ts
// bundles it with the engine and everything it needs; no npm). A roadmap
// repository runs it through its launcher, `node .boxops/boxops.mjs <command>`,
// which calls main(argv, ctx); `node dist/boxops.mjs <command>` runs it
// directly. Node-only.
//
// Commands work offline, except doctor, upgrade and init (they ask GitHub),
// and preview and build the first time they need the app's files, which
// version fetches too (it works without them). The `action` command is the
// GitHub Action's entry (action.ts), for Path B; it isn't for people.

import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { formatDay } from "../src/model/dates.ts";
import { FORMAT } from "../src/model/format.ts";
import { loadRoadmap } from "../src/model/parse.ts";
import { type Report, buildReport, formatReport } from "../src/model/report.ts";
import { ActionError, checkFormat, runAction } from "./action.ts";
import { type Args, EXIT, type Io, type LaunchContext, UsageError, defaultIo, flag, parseArgs, roadmapOf, rootOf } from "./context.ts";
import { doctorCommand } from "./doctor.ts";
import { RoadmapReadError } from "./git.ts";
import { TOPICS, type Topic, guideTopic, wholeGuide } from "./guide.ts";
import { initCommand } from "./init.ts";
import { migrateCommand } from "./migrate.ts";
import { contractNumber } from "./pins.ts";
import { ensureApp, previewCommand } from "./preview.ts";
import { AGENTS_BLOCK, GUARD, LAUNCHER, findBuildJson, openRelease, verifiedApp, writeSite } from "./release.ts";
import { issueLine, loadDir, resultLine } from "./roadmap.ts";
import { buildBundle, findRepo } from "./site.ts";
import { applySync, planSync, plainText } from "./sync.ts";
import { visible } from "./terminal.ts";
import { upgradeCommand } from "./upgrade.ts";

export { runAction };
export type { LaunchContext };

const HELP = `BoxOps command-line tool. In a roadmap repository: node .boxops/boxops.mjs <command>

  validate [--json] [folder]      check the roadmap (ends in "— OK"); exit 1 on problems, 3 on another data format
  report [--json] [folder]        capacity, overloads, PTO clashes, everyone's bookings: diff two to compare
  preview [--port 4173] [--open]  the working copy in the app at http://127.0.0.1:4173 (read-only, live)
  guide [topic]                   the guide for this release: ${TOPICS.join(", ")}
  migrate [--check]               bring roadmap/ to the data format this release reads
  sync [--check]                  rewrite AGENTS.md's BoxOps block and the launcher to this release's
  doctor                          check the BoxOps setup (asks GitHub)
  upgrade [vX.Y.Z]                move the pins to another release (default: the latest), then migrate --check, sync, validate
  build --out DIR [--commit REF | --worktree]   write the site the action would (for debugging and self-hosting)
  init <dir> [--action owner/repo@sha]          write a new roadmap repository's files, pinned to this release
  version                         this release (and fetches the app preview needs, once)

Options for every command: --root DIR (the repository; default: the one you're in), --roadmap NAME (default: roadmap).`;

/** `validate`: today's `npm run validate`, line for line. */
async function validate(args: Args, ctx: LaunchContext, io: Io): Promise<number> {
  const dir = roadmapOf(args, ctx, io, args.positional[0]);
  const loaded = await loadDir(dir);
  const json = args.flags.json === true;
  if (loaded.unreadable) {
    if (json) io.out(JSON.stringify({ ok: false, readable: false, problems: loaded.unreadable.map((p) => ({ path: p.path, message: p.message })) }, null, 2));
    else for (const p of loaded.unreadable) io.err(issueLine(dir, p, io.cwd));
    return EXIT.problems;
  }
  const { roadmap, issues, formatStatus } = loaded;
  const result = resultLine(roadmap, issues.length);
  const code = formatStatus === "older" || formatStatus === "newer" ? EXIT.format : issues.length ? EXIT.problems : EXIT.ok;
  if (json) {
    io.out(
      JSON.stringify(
        {
          ok: code === EXIT.ok,
          readable: true,
          format: roadmap.format,
          formatStatus,
          reads: FORMAT,
          departments: roadmap.departments.length,
          lanes: roadmap.departments.reduce((n, d) => n + d.lanes.length, 0),
          boxes: roadmap.boxes.length,
          people: roadmap.people.length,
          problems: issues.map((i) => ({ path: i.path, ...(i.line !== undefined && { line: i.line }), message: i.message })),
          result,
        },
        null,
        2,
      ),
    );
  } else {
    for (const issue of issues) io.err(issueLine(dir, issue, io.cwd));
    io.out(result);
  }
  return code;
}

/** The report as JSON: dates as YYYY-MM-DD, boxes by id, code and title. */
function reportJson(r: Report): unknown {
  const box = (b: { id: string; title: string; start: number; end: number }, code: string) => ({ id: b.id, code, title: b.title, start: formatDay(b.start), end: formatDay(b.end) });
  const stretch = (s: { from: number; to: number; fte: number; capacity?: number }) => ({ from: formatDay(s.from), to: formatDay(s.to), fte: s.fte, ...(s.capacity !== undefined && { capacity: s.capacity }) });
  const pto = (p: { start: number; end: number; note?: string }) => ({ start: formatDay(p.start), end: formatDay(p.end), ...(p.note && { note: p.note }) });
  return {
    departments: r.departments.map((d) => ({ id: d.id, name: d.name, fte: d.fte, boxes: d.boxes, over: d.over.map(stretch), full: d.full.map(stretch) })),
    people: r.people.map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.department !== undefined && { department: p.department }),
      bookings: p.bookings.map((b) => ("pto" in b ? { pto: pto(b.pto) } : { box: box(b.box, b.code), fte: b.fte })),
      over: p.over.map(stretch),
    })),
    onPto: r.onPto.map((c) => ({ person: c.person, pto: pto(c.pto), box: box(c.box, c.code) })),
    unassigned: r.unassigned.map((u) => box(u.box, u.code)),
    ruleWarnings: r.ruleWarnings,
  };
}

/** `report`: today's `npm run report`, byte for byte. */
async function report(args: Args, ctx: LaunchContext, io: Io): Promise<number> {
  const dir = roadmapOf(args, ctx, io, args.positional[0]);
  const loaded = await loadDir(dir);
  if (loaded.unreadable) {
    for (const p of loaded.unreadable) io.err(issueLine(dir, p, io.cwd));
    return EXIT.problems;
  }
  for (const issue of loaded.issues) io.err(issueLine(dir, issue, io.cwd));
  const r = buildReport(loaded.roadmap);
  io.out(args.flags.json === true ? JSON.stringify(reportJson(r), null, 2) : formatReport(r));
  if (loaded.formatStatus === "older" || loaded.formatStatus === "newer") return EXIT.format;
  return loaded.issues.length ? EXIT.problems : EXIT.ok;
}

/** `build`: the site the action writes, into a new or empty folder. */
async function build(args: Args, ctx: LaunchContext, io: Io): Promise<number> {
  const out = flag(args, "out");
  if (!out) throw new UsageError("Usage: boxops build --out DIR [--commit REF | --worktree]");
  const commit = flag(args, "commit");
  const worktree = args.flags.worktree === true;
  if (commit !== undefined && worktree) throw new UsageError("Give --commit or --worktree, not both");
  const root = rootOf(args, ctx, io);
  // The roadmap folder in --root, as every command takes it; git, and the
  // bundle's source.dir, name it from the top of the repository it's in.
  const folder = join(root, flag(args, "roadmap") ?? "roadmap");
  const repoDir = findRepo(root) ?? root;
  const dir = relative(repoDir, folder).split(sep).join("/");
  if (!dir || dir === ".." || dir.startsWith("../") || isAbsolute(dir)) {
    throw new UsageError(`The roadmap folder (${folder}) must be in the repository (${repoDir}), not the repository itself or outside it`);
  }
  const id = io.identity();
  // The launcher keeps a release's tool and BUILD.json alone: the first build (or preview) fetches the app.
  await ensureApp(io.cliDir, ctx, io);
  const app = verifiedApp(openRelease(io.cliDir, id.build));
  let bundle;
  try {
    bundle = await buildBundle({
      repoDir,
      dir,
      ...(worktree && { worktree: folder }),
      ...(commit !== undefined && { commit }),
      app: { version: id.version, build: id.build, time: id.time },
      env: io.env,
      warn: (m) => io.err(m),
    });
  } catch (e) {
    if (!(e instanceof RoadmapReadError)) throw e;
    for (const p of e.problems) io.err(issueLine(folder, p, io.cwd));
    io.err(`${dir}/ can’t be read as it is: nothing was written`);
    return EXIT.problems;
  }
  try {
    checkFormat(bundle.files, dir, id.version);
  } catch (e) {
    if (!(e instanceof ActionError)) throw e;
    io.err(e.message.replace(/The site wasn’t changed$/, "Nothing was written"));
    return EXIT.format;
  }
  const loaded = loadRoadmap(bundle.files, bundle.ignored);
  for (const issue of loaded.issues) io.err(issueLine(folder, issue, io.cwd));
  writeSite(resolve(io.cwd, out), app, bundle);
  io.out(resultLine(loaded.roadmap, loaded.issues.length));
  io.out(`Wrote the site to ${out}: BoxOps ${id.build}, ${bundle.source.local ? "the files on disk (local, read-only)" : `commit ${bundle.source.commit.slice(0, 12)}`}${loaded.issues.length ? ", without the broken entries" : ""}.`);
  return loaded.issues.length ? EXIT.problems : EXIT.ok;
}

/**
 * Warnings, on the commands that warn (WARNING_COMMANDS), when the
 * repository's BoxOps files aren't this release's: here unless the launcher
 * has given them (`ctx.checked`). Plain files only: none is read through a
 * symlink.
 */
function staleWarnings(root: string, ctx: LaunchContext, io: Io): void {
  if (ctx.checked) return;
  const read = (path: string) => plainText(join(root, path));
  const fix = "run `node .boxops/boxops.mjs sync`";
  const launcher = ctx.launcher ?? contractNumber(read(".boxops/boxops.mjs") ?? "", "launcher");
  if (launcher !== null && launcher !== LAUNCHER) io.err(`boxops: the launcher is ${launcher}; this BoxOps writes ${LAUNCHER}: ${fix}`);
  const block = contractNumber(read("AGENTS.md") ?? "", "block");
  if (block !== null && block !== AGENTS_BLOCK) io.err(`boxops: AGENTS.md’s BoxOps block is ${block}; this BoxOps writes ${AGENTS_BLOCK}: ${fix}`);
  const guard = contractNumber(read(".github/workflows/deploy.yml") ?? "", "guard");
  if (guard !== null && guard !== GUARD) io.err(`boxops: the Pages guard in deploy.yml is ${guard}; this BoxOps expects ${GUARD}: run \`node .boxops/boxops.mjs doctor\``);
}

type Command = (args: Args, ctx: LaunchContext, io: Io) => Promise<number>;

const COMMON = ["root", "roadmap"];

const COMMANDS: Record<string, { values?: string[]; switches?: string[]; run: Command }> = {
  validate: { switches: ["json"], run: validate },
  report: { switches: ["json"], run: report },
  build: { values: ["out", "commit"], switches: ["worktree"], run: build },
  preview: {
    values: ["port"],
    switches: ["open"],
    run: async (args, ctx, io) => {
      const port = Number(flag(args, "port") ?? 4173);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`--port is "${flag(args, "port")}": give a port number`);
      return previewCommand({ root: rootOf(args, ctx, io), dir: roadmapOf(args, ctx, io), port, open: args.flags.open === true }, ctx, io);
    },
  },
  migrate: { switches: ["check"], run: (args, ctx, io) => migrateCommand(roadmapOf(args, ctx, io), args.flags.check === true, io) },
  sync: {
    switches: ["check"],
    run: async (args, ctx, io) => {
      const root = rootOf(args, ctx, io);
      const changes = planSync(root);
      if (!changes.length) {
        io.out(`AGENTS.md’s BoxOps block (${AGENTS_BLOCK}), the launcher (${LAUNCHER}) and CLAUDE.md are this release’s.`);
        return EXIT.ok;
      }
      const list = changes.map((c) => `${c.path}${c.created ? " (new)" : ""}`).join(", ");
      if (args.flags.check === true) {
        io.out(`Not this release’s: ${list}. Run \`node .boxops/boxops.mjs sync\`.`);
        return EXIT.problems;
      }
      applySync(root, changes);
      io.out(`Wrote ${list} (BoxOps block ${AGENTS_BLOCK}, launcher ${LAUNCHER}). Review and commit them.`);
      return EXIT.ok;
    },
  },
  doctor: { run: (args, ctx, io) => doctorCommand(rootOf(args, ctx, io), ctx, io) },
  upgrade: { run: (args, ctx, io) => upgradeCommand(rootOf(args, ctx, io), args.positional[0], ctx, io, { roadmap: flag(args, "roadmap") }) },
  init: { values: ["action"], run: (args, _ctx, io) => initCommand(args.positional[0], flag(args, "action"), io) },
  guide: {
    run: async (args, _ctx, io) => {
      const topic = args.positional[0];
      if (topic === undefined) io.out(wholeGuide(io.identity().version));
      else if ((TOPICS as readonly string[]).includes(topic)) io.out(guideTopic(topic as Topic).trimEnd());
      else throw new UsageError(`No guide topic "${topic}": ${TOPICS.join(", ")}`);
      return EXIT.ok;
    },
  },
  version: {
    run: async (_args, ctx, io) => {
      const id = io.identity();
      const where = ctx.repo && ctx.sha ? `${ctx.repo}@${ctx.sha.slice(0, 7)}, ` : "";
      io.out(`BoxOps ${id.version} (${where}build ${id.build}, data format ${FORMAT})`);
      // Through the launcher, from its cache (the tool and its BUILD.json), the app too (once: then
      // there's nothing to fetch), so that a sandbox with the network only while it's set up, which
      // runs `version` then, can `preview` later. Not beside a tool BOXOPS_CLI names alone.
      if (ctx.repo && ctx.sha && findBuildJson(io.cliDir)) {
        try {
          await ensureApp(io.cliDir, ctx, io);
        } catch (e) {
          io.err(`boxops version: couldn’t fetch the app, which \`preview\` and \`build\` fetch on their first run instead: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return EXIT.ok;
    },
  },
};

/**
 * The commands that warn of old BoxOps files (staleWarnings): not sync, which
 * writes them, doctor, which lists them all, or init and version, which are
 * about the release; nor help, the action or an unknown command. The
 * launcher warns on the same ones (launcher.test.ts checks).
 */
export const WARNING_COMMANDS = Object.keys(COMMANDS).filter((name) => !["sync", "doctor", "init", "version"].includes(name));

/**
 * Runs a command; returns its exit code (0 OK, 1 problems, 2 usage or
 * environment, 3 data format mismatch). The launcher's contract: frozen.
 * What it prints shows the control characters in it as escapes
 * (terminal.ts): a roadmap's values and file names are anyone's who can save.
 */
export async function main(argv: string[], ctx: LaunchContext = {}, given: Io = defaultIo()): Promise<number> {
  const io: Io = { ...given, out: (text) => given.out(visible(text, true)), err: (text) => given.err(visible(text, true)) };
  const [name, ...rest] = argv;
  if (name === "action") return runAction({ argv: rest, env: io.env, out: io.out, cliDir: io.cliDir, identity: io.identity() });
  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    io.out(HELP);
    return name === undefined ? EXIT.usage : EXIT.ok;
  }
  if (name === "--version") return main(["version"], ctx, io);
  const command = COMMANDS[name];
  if (!command) {
    io.err(`boxops: no command "${name}". Commands: ${Object.keys(COMMANDS).join(", ")} (\`node .boxops/boxops.mjs help\`)`);
    return EXIT.usage;
  }
  try {
    const args = parseArgs(rest, [...COMMON, ...(command.values ?? [])], command.switches ?? []);
    if (WARNING_COMMANDS.includes(name)) {
      const root = rootOf(args, ctx, io);
      if (existsSync(root)) staleWarnings(root, ctx, io);
    }
    return await command.run(args, ctx, io);
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`boxops ${name}: ${e.message}`);
      return EXIT.usage;
    }
    io.err(`boxops ${name}: ${e instanceof Error ? e.message : String(e)}`);
    return EXIT.usage;
  }
}

/** Run directly (`node dist/boxops.mjs …`), not imported by the launcher or action.mjs. */
function isMain(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = await main(process.argv.slice(2));

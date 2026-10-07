// `migrate [--check]`: brings the working tree's roadmap to the data format
// this release reads, with the migrations in src/model/migrations/, then
// validates it. Only changed files are written; review and commit them like
// any edit. `--check` writes nothing and says whether a migration is needed.
// Node-only.

import { renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { FORMAT } from "../src/model/format.ts";
import { MigrationError, planMigration } from "../src/model/migrations/index.ts";
import { loadRoadmap } from "../src/model/parse.ts";
import { EXIT, type Io } from "./context.ts";
import { RoadmapReadError, readRoadmapDir } from "./git.ts";
import { issueLine, resultLine } from "./roadmap.ts";

/** Replaces a file's text in one step (a write to a temporary name, then a rename), keeping its mode. */
function replaceFile(file: string, text: string): void {
  let mode = 0o644;
  try {
    mode = statSync(file).mode & 0o777;
  } catch {
    // A new file.
  }
  const temp = join(dirname(file), `.boxops-migrate-${process.pid}`);
  writeFileSync(temp, text, { mode });
  renameSync(temp, file);
}

export async function migrateCommand(dir: string, check: boolean, io: Io): Promise<number> {
  const near = relative(io.cwd, dir) || ".";
  const shown = near.length < dir.length ? near : dir;
  let folder;
  try {
    folder = await readRoadmapDir(dir);
  } catch (e) {
    if (!(e instanceof RoadmapReadError)) throw e;
    for (const p of e.problems) io.err(issueLine(dir, p, io.cwd));
    io.err(`${shown}/ can’t be read as it is: fix the problems above, then migrate`);
    return EXIT.problems;
  }
  let plan;
  try {
    plan = planMigration(folder.files);
  } catch (e) {
    if (!(e instanceof MigrationError)) throw e;
    io.err(e.message);
    return EXIT.format;
  }
  if (!plan.steps.length) {
    io.out(`${shown}/ is in data format ${FORMAT}, the one this BoxOps reads: nothing to migrate.`);
    if (check) return EXIT.ok;
  } else {
    const steps = plan.steps.map((s) => `${s.from} → ${s.to}: ${s.summary}`).join("; ");
    if (check) {
      io.out(`${shown}/ is in data format ${plan.from}; this BoxOps reads ${plan.to}. \`node .boxops/boxops.mjs migrate\` would change ${plan.changed.join(", ")} (${steps}).`);
      return EXIT.problems;
    }
    for (const path of plan.changed) {
      const file = join(dir, ...path.split("/"));
      const text = plan.files[path];
      if (text === undefined) rmSync(file);
      else replaceFile(file, text);
    }
    io.out(`Migrated ${shown}/ from data format ${plan.from} to ${plan.to} (${steps}): changed ${plan.changed.join(", ")}. Review and commit them.`);
  }
  const loaded = loadRoadmap(plan.files, folder.ignored);
  for (const issue of loaded.issues) io.err(issueLine(dir, issue, io.cwd));
  io.out(resultLine(loaded.roadmap, loaded.issues.length));
  return loaded.issues.length ? EXIT.problems : EXIT.ok;
}

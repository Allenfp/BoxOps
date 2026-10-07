// Data format migrations: what `node .boxops/boxops.mjs migrate` runs to bring
// a roadmap's files from the format in its settings.yaml up to the one this
// BoxOps reads (model/format.ts).
//
// Each migration is code in the release that introduces its format (NNN.ts,
// numbered by the format it migrates to), and every later release keeps the
// whole chain, so a roadmap two formats behind goes through both. They run
// only through `migrate`, which leaves the result for a person to review and
// commit; nothing migrates data on its own (the action can't write, and the
// app opens any other format read-only).
//
// Rules for a migration's `files`:
// - It edits text in place, at the spots the yaml library's Document API
//   locates, so comments, key order, quoting and line ends stay as they were
//   (never a parse and re-stringify of a whole file).
// - It's idempotent: given files it has already migrated, or that never
//   needed it, it changes nothing. (The chain starts from the format
//   settings.yaml states, so a migrated branch that picked up saves made
//   meanwhile takes main's roadmap again and migrates that: see
//   docs/upgrading.md, "Migrations".)
// - It never touches `format`: the chain sets that, last, once every step has
//   run, so files are never stamped with a format they aren't in yet.

import { type Document, isMap, isScalar, parseDocument } from "yaml";
import { FORMAT } from "../format.ts";
import type { RoadmapFiles } from "../types.ts";
import m001 from "./001.ts";

export interface Migration {
  /** The format it reads, and the one it leaves behind (always from + 1). */
  from: number;
  to: number;
  /** What it does, for migrate's output: "stamps format: 1 in settings.yaml". */
  summary: string;
  /** The roadmap folder's files (path in the folder → text) in format `to`; a path left out is deleted. */
  files(files: RoadmapFiles): RoadmapFiles;
  /** Unsaved edits made in format `from`, as the app stored them, in format `to` (model/draftStore.ts); none: they can only be downloaded. */
  draft?(draft: unknown): unknown;
}

/** Every migration, oldest first: each one's `from` is the previous one's `to`. */
export const MIGRATIONS: readonly Migration[] = [m001];

/** The oldest format `migrate` can bring up to this BoxOps's (BUILD.json's `migratesFrom`). */
export const MIGRATES_FROM = MIGRATIONS[0].from;

/** The roadmap can't be migrated as it is: say why and stop. */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export interface MigrationPlan {
  /** The format settings.yaml states (0 when it doesn't), and the one the files are in afterwards. */
  from: number;
  to: number;
  /** The migrations run, in order; none when the roadmap is already in format `to`. */
  steps: Migration[];
  /** Every file afterwards. */
  files: RoadmapFiles;
  /** Paths whose text changed, were added or were deleted, sorted. */
  changed: string[];
}

const BOM = "\uFEFF";

/** settings.yaml as a yaml Document (without a BOM), or a MigrationError saying why it can't be. */
function settingsDocument(text: string): Document {
  const doc = parseDocument(text.replace(/^\uFEFF/, ""));
  if (doc.errors.length) throw new MigrationError(`settings.yaml isn’t valid YAML (${doc.errors[0].message.split("\n")[0]}); fix it first`);
  if (doc.contents !== null && !isMap(doc.contents)) throw new MigrationError("settings.yaml isn’t a list of settings (`key: value` lines); fix it first");
  return doc;
}

/**
 * The format the files state: `format` in settings.yaml, 0 when it isn't
 * there (or the file isn't). A MigrationError if it can't be read as a whole
 * number from 0 up.
 */
export function statedFormat(files: RoadmapFiles): number {
  const text = files["settings.yaml"]?.replace(/^\uFEFF/, "");
  if (text === undefined) return 0;
  const doc = settingsDocument(text);
  const node = isMap(doc.contents) ? doc.contents.get("format", true) : undefined;
  if (node === undefined || (isScalar(node) && (node.value === null || node.value === ""))) return 0;
  const value = isScalar(node) ? node.value : undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    const range = (node as { range?: [number, number, number] | null }).range;
    const written = range ? text.slice(range[0], range[1]).trim() : "…";
    throw new MigrationError(`settings.yaml: format: ${written} isn’t a whole number; fix it first`);
  }
  return value;
}

/**
 * settings.yaml's text with `format: n`, changing nothing else: the value
 * replaced where there is one, else a `format:` line put before the first
 * setting (after any comments above it), else added at the end. Line ends
 * (LF or CRLF) and a BOM are kept. `undefined` (no settings.yaml) gives a
 * file holding just `format: n`.
 */
export function withFormat(text: string | undefined, n: number): string {
  if (text === undefined) return `format: ${n}\n`;
  const bom = text.startsWith(BOM) ? BOM : "";
  const body = text.slice(bom.length);
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  statedFormat({ "settings.yaml": body }); // a value that isn't a whole number stops here
  const doc = settingsDocument(body);
  let out: string;
  if (!isMap(doc.contents)) {
    // Nothing but comments (or nothing at all).
    out = `${body}${body === "" || body.endsWith("\n") ? "" : eol}format: ${n}${eol}`;
  } else {
    const map = doc.contents;
    const pair = map.items.find((p) => isScalar(p.key) && p.key.value === "format");
    if (pair) {
      const value = pair.value;
      const at = isScalar(value) ? value.range : null;
      const key = isScalar(pair.key) ? pair.key.range : null;
      if (!at || !key) throw new MigrationError("settings.yaml: can’t tell where format’s value is; set `format: " + n + "` yourself");
      if (at[0] < at[1]) out = `${body.slice(0, at[0])}${n}${body.slice(at[1])}`;
      else {
        // `format:` with nothing after it (but maybe a comment): right after its colon.
        const colon = body.indexOf(":", key[1]);
        out = `${body.slice(0, colon + 1)} ${n}${body.slice(colon + 1)}`;
      }
    } else {
      const first = map.items[0]?.key as { range?: [number, number, number] | null } | null | undefined;
      const start = first?.range?.[0];
      if (start === undefined) throw new MigrationError("settings.yaml: can’t tell where to put format; add `format: " + n + "` at the top yourself");
      if (map.flow) {
        out = `${body.slice(0, start)}format: ${n}, ${body.slice(start)}`;
      } else {
        const column = start - (body.lastIndexOf("\n", start - 1) + 1);
        out = `${body.slice(0, start)}format: ${n}${eol}${" ".repeat(column)}${body.slice(start)}`;
      }
    }
  }
  if (statedFormat({ "settings.yaml": out }) !== n) throw new MigrationError("settings.yaml: couldn’t set format; add `format: " + n + "` yourself");
  return bom + out;
}

/**
 * Plans bringing `files` to format `target`: runs each migration from the
 * stated format up, then sets `format`. Nothing is written; the plan holds
 * the files afterwards. A roadmap already in `target` comes back unchanged.
 * A MigrationError if it's in a newer format, one older than the chain
 * reaches, or settings.yaml can't be read.
 */
export function planMigration(files: RoadmapFiles, migrations: readonly Migration[] = MIGRATIONS, target = FORMAT): MigrationPlan {
  const from = statedFormat(files);
  if (from > target) {
    throw new MigrationError(`This roadmap is in data format ${from}, newer than this BoxOps reads (${target}): upgrade BoxOps rather than migrating`);
  }
  const steps: Migration[] = [];
  let out: RoadmapFiles = { ...files };
  for (let at = from; at < target; ) {
    const step = migrations.find((m) => m.from === at);
    if (!step || step.to !== at + 1) throw new MigrationError(`No migration from data format ${at}: this BoxOps migrates format ${migrations[0]?.from ?? target} and later`);
    out = { ...step.files(out) };
    steps.push(step);
    at = step.to;
  }
  // Last: the files are in `target` now (a roadmap that only lacked the line gets it too).
  if (steps.length) out["settings.yaml"] = withFormat(out["settings.yaml"], target);
  const paths = new Set([...Object.keys(files), ...Object.keys(out)]);
  const changed = [...paths].filter((p) => files[p] !== out[p]).sort();
  return { from, to: target, steps, files: out, changed };
}

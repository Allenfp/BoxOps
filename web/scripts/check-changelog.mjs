// `node scripts/check-changelog.mjs [--release X.Y.Z [--notes FILE]] [--build-json FILE] [CHANGELOG.md]`
// (from web/): checks the changelog's form (docs/releasing.md, "The
// changelog"), as CI does on every change and the release workflow before a
// release:
//   - "# Changelog" first; then the sections, newest first: "## Unreleased"
//     (at most one, at the top), then "## X.Y.Z — YYYY-MM-DD" (a real date),
//     each version once, newer above older;
//   - each section opens with the fixed lines, in order, each with something
//     to say (FIXED), then "### Changes" and at least one item.
// --release X.Y.Z: there's a section for X.Y.Z, and it's the top one: no
// newer version, and no Unreleased section above it (changes merged since
// the release pull request would ship under notes that don't say so); with
// --notes FILE, its text (all but the heading) is written there, for the
// GitHub release. --build-json FILE: the top section's (with --release,
// X.Y.Z's) data format, AGENTS.md block, launcher and guard are that
// build's (BUILD.json's numbers).
// Problems go to stderr as CHANGELOG.md:LINE: …, and as error annotations in
// GitHub Actions. Exit 0 if it's right, 1 if not, 2 for a mistake in how it's
// run. Plain JavaScript: the release workflow runs it before any npm install.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** The lines every section opens with, in this order: what a roadmap repository has to know to upgrade. */
export const FIXED = [
  "Security",
  "Data format",
  "Workflow changes",
  "Action inputs and outputs",
  "AGENTS.md block",
  "Launcher",
  "Node and runner",
  "Open tabs",
];

const HEADING = /^## (?:Unreleased|(\d+)\.(\d+)\.(\d+) — (\d{4})-(\d{2})-(\d{2}))$/;

/** A real day, YYYY-MM-DD. */
const realDay = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/**
 * The changelog's sections, and its problems (line: 1-based). A section:
 * { line, version (null for Unreleased), date, values: { [fixed name]: text }, body: lines after the heading }.
 */
export function readChangelog(text) {
  const problems = [];
  const sections = [];
  const lines = text.split("\n");
  if (text.includes("\r")) problems.push({ line: 1, message: "has CR line ends; use LF" });
  if (lines[0] !== "# Changelog") problems.push({ line: 1, message: "should start with “# Changelog”" });
  let current = null;
  lines.forEach((line, i) => {
    if (line.startsWith("## ")) {
      const m = HEADING.exec(line);
      current = { line: i + 1, heading: line, version: null, date: null, values: {}, body: [] };
      sections.push(current);
      if (!m) problems.push({ line: i + 1, message: `“${line}” isn’t “## Unreleased” or “## X.Y.Z — YYYY-MM-DD” (an em dash, with a space each side)` });
      else if (m[1] !== undefined) {
        current.version = [Number(m[1]), Number(m[2]), Number(m[3])];
        current.date = `${m[4]}-${m[5]}-${m[6]}`;
        if (!realDay(Number(m[4]), Number(m[5]), Number(m[6]))) problems.push({ line: i + 1, message: `${current.date} isn’t a day` });
      }
    } else if (current) current.body.push(line);
  });

  const name = (s) => (s.version ? s.version.join(".") : "Unreleased");
  sections.forEach((s, n) => {
    if (!s.version && n > 0 && HEADING.test(s.heading)) problems.push({ line: s.line, message: "Unreleased goes first, above every version" });
    // The fixed lines: after the heading and a blank line, one each, in order.
    let at = 0;
    if (s.body[at] !== "") problems.push({ line: s.line + 1, message: `a blank line goes after ${name(s)}’s heading` });
    else at++;
    for (const key of FIXED) {
      const line = s.body[at] ?? "";
      const prefix = `- ${key}: `;
      const where = s.line + 1 + at;
      if (!line.startsWith(prefix) || !line.slice(prefix.length).trim()) {
        problems.push({ line: where, message: `${name(s)}: “${prefix}…” goes here (the fixed lines: ${FIXED.join(", ")})` });
        break;
      }
      s.values[key] = line.slice(prefix.length).trim();
      if (key === "Launcher" && !/ · Guard: \S/.test(line)) problems.push({ line: where, message: `${name(s)}: the launcher’s line says the guard’s too: “- Launcher: N (…) · Guard: N (…)”` });
      at++;
    }
    if (Object.keys(s.values).length === FIXED.length) {
      const rest = s.body.slice(at);
      if (rest[0] !== "" || rest[1] !== "### Changes" || rest[2] !== "" || !rest[3]?.startsWith("- ")) {
        problems.push({ line: s.line + 1 + at, message: `${name(s)}: after the fixed lines, a blank line, “### Changes”, a blank line and the changes, one “- ” item or more` });
      }
    }
  });

  // Newest first, each version once.
  const versions = sections.filter((s) => s.version);
  for (let n = 1; n < versions.length; n++) {
    const [a, b] = [versions[n - 1].version, versions[n].version];
    const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    if (cmp === 0) problems.push({ line: versions[n].line, message: `${name(versions[n])} is here twice` });
    else if (cmp < 0) problems.push({ line: versions[n].line, message: `${name(versions[n])} is newer than ${name(versions[n - 1])} above it: newest first` });
  }
  if (sections.filter((s) => !s.version && HEADING.test(s.heading)).length > 1) problems.push({ line: sections.at(-1).line, message: "more than one Unreleased section" });
  return { sections, problems };
}

/** The leading whole number of a fixed line's value ("2 (was 1): …" → 2), or null. */
const number = (value) => (/^\d+\b/.test(value ?? "") ? Number(/^\d+/.exec(value)[0]) : null);

/** Checks the changelog as the options say; returns { problems, notes (the release's section text, if asked for) }. */
export function checkChangelog(text, o = {}) {
  const { sections, problems } = readChangelog(text);
  let notes;
  // The section whose numbers --build-json checks: the release's, or the top one.
  let checked = sections[0];
  let what = "the top section";
  if (o.release !== undefined) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(o.release);
    if (!m) throw new Error(`--release ${o.release}: give X.Y.Z (a release candidate's notes are its version's)`);
    const versions = sections.filter((s) => s.version);
    const s = versions.find((v) => v.version.join(".") === o.release);
    checked = s;
    what = `${o.release}’s section`;
    if (!s) problems.push({ line: 1, message: `no section for ${o.release} (“## ${o.release} — YYYY-MM-DD”): move Unreleased’s there in the release pull request` });
    else if (versions[0] !== s) problems.push({ line: s.line, message: `${o.release} isn’t the newest version here (${versions[0].version.join(".")} is)` });
    else if (sections[0] !== s) {
      problems.push({
        line: sections[0].line,
        message: `“${sections[0].heading}” is above ${o.release}: move its changes into ${o.release}’s section in the release pull request, so ${o.release}’s notes say what it ships`,
      });
    } else {
      const body = [...s.body];
      while (body.length && body[0].trim() === "") body.shift();
      while (body.length && body.at(-1).trim() === "") body.pop();
      notes = `${body.join("\n")}\n`;
    }
  }
  if (o.buildJson) {
    const want = { "Data format": o.buildJson.format, "AGENTS.md block": o.buildJson.agentsBlock, Launcher: o.buildJson.launcher };
    if (checked && Object.keys(checked.values).length === FIXED.length) {
      for (const [key, value] of Object.entries(want)) {
        if (number(checked.values[key]) !== value) problems.push({ line: checked.line, message: `${key}: ${what} says “${checked.values[key]}”, but this build’s is ${value} (BUILD.json)` });
      }
      const guard = number(/ · Guard: (.*)$/.exec(checked.values.Launcher)?.[1]);
      if (guard !== o.buildJson.guard) problems.push({ line: checked.line, message: `Guard: ${what} says ${guard}, but this build’s is ${o.buildJson.guard} (BUILD.json)` });
    }
  }
  return { problems, notes };
}

/** An annotation's message, escaped as the runner reads it. */
const escapeData = (s) => s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

function main(argv) {
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: { release: { type: "string" }, notes: { type: "string" }, "build-json": { type: "string" } } });
  } catch (e) {
    console.error(`check-changelog: ${e.message}`);
    return 2;
  }
  const { values, positionals } = args;
  if (positionals.length > 1 || (values.notes && !values.release)) {
    console.error("Usage: node scripts/check-changelog.mjs [--release X.Y.Z [--notes FILE]] [--build-json FILE] [CHANGELOG.md]");
    return 2;
  }
  // As GitHub names files in annotations: from the repository's top level.
  const repo = fileURLToPath(new URL("../..", import.meta.url));
  const file = resolve(positionals[0] ?? resolve(repo, "CHANGELOG.md"));
  const shown = relative(repo, file).startsWith("..") ? file : relative(repo, file);
  let result;
  try {
    const buildJson = values["build-json"] ? JSON.parse(readFileSync(values["build-json"], "utf8")) : undefined;
    result = checkChangelog(readFileSync(file, "utf8"), { release: values.release, buildJson });
  } catch (e) {
    console.error(`check-changelog: ${e.message}`);
    return 2;
  }
  for (const p of result.problems) {
    console.error(`${shown}:${p.line}: ${p.message}`);
    if (process.env.GITHUB_ACTIONS === "true") console.log(`::error file=${shown},line=${p.line},title=Changelog::${escapeData(p.message)}`);
  }
  if (result.problems.length) return 1;
  if (values.notes) {
    mkdirSync(dirname(resolve(values.notes)), { recursive: true });
    writeFileSync(values.notes, result.notes);
  }
  console.log(`${shown}: in the changelog’s form${values.release ? `, with ${values.release}’s section${values.notes ? ` (its notes in ${values.notes})` : ""}` : ""}${values["build-json"] ? ", its numbers this build’s" : ""}.`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));

// A synthetic roadmap of any size, for scale tests (the loader's unit tests,
// e2e/perf.spec.ts) and for trying the app on a big team. The same box count
// and "today" always give the same files. It passes `npm run validate` and
// has what real roadmaps have: lanes with dates, PTO, rules, flags, epics.
//
//   npm run gen-roadmap -- <boxes> <today, YYYY-MM-DD> <new or empty folder>
//   BOXOPS_ROADMAP=<folder> npm run dev
//
// One department per 50 boxes (at least 2), each with 8 lanes and 10 people
// with 3 PTO stretches each: 2,000 boxes make 40 departments, 320 lanes and
// 400 people.

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { addWorkdays, formatDay, parseDay } from "../src/model/dates";
import type { RoadmapFiles } from "../src/model/types";

/** Letters and digits box codes use (no 0, O, 1 or I). */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TYPES = [
  { id: "project", name: "Project", color: "#4f7cff" },
  { id: "maintenance", name: "Maintenance", color: "#8a94a6" },
  { id: "research", name: "Research", color: "#a35cf0" },
  { id: "support", name: "Support / On-call", color: "#e8913a" },
];
const COLORS = ["#4f7cff", "#21a67a", "#e8913a", "#a35cf0", "#d6455d", "#2b9fc4", "#8a6d3b", "#5c6bc0"];
const AREAS = ["Data", "Platform", "Growth", "Infra", "Analytics", "ML", "Payments", "Search"];
const VERBS = ["Migrate", "Build", "Review", "Upgrade", "Sunset", "Harden", "Prototype", "Document"];
const THINGS = ["warehouse", "pipeline", "dashboard", "feature store", "CDC feed", "billing export", "search index", "alerting"];
const FIRST = ["Alex", "Sam", "Jordan", "Priya", "Morgan", "Taylor", "Chris", "Dana", "Lee", "Ravi", "Mei", "Olu", "Ines", "Jakob", "Zoë"];
const LAST = ["Kim", "Lee", "Diaz", "Shah", "Chen", "Brooks", "Nguyen", "Okafor", "Müller", "García", "Rossi", "Tanaka"];
const RULES = ["before", "after", "during", "starts_with", "ends_with", "overlaps", "apart"];
const LANES = 8;
const PEOPLE_PER_DEPARTMENT = 10;

/** YAML with long text on one line, as the app writes it. */
const toYaml = (value: unknown) => stringify(value, { lineWidth: 0 });

/** mulberry32: a small seeded generator, so the output never depends on Math.random. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/** The roadmap folder's files (path → text) for `boxes` boxes around `today` (YYYY-MM-DD). */
export function generateRoadmap(boxes: number, today: string): RoadmapFiles {
  const now = parseDay(today);
  if (now === null) throw new Error(`"${today}" isn't a YYYY-MM-DD date`);
  if (!Number.isInteger(boxes) || boxes < 0) throw new Error(`"${boxes}" isn't a number of boxes`);
  const rnd = random(boxes * 7919 + now);
  const int = (n: number) => Math.floor(rnd() * n);
  const pick = <T>(list: readonly T[]) => list[int(list.length)];
  /** A weekday `n` working days from today. */
  const day = (n: number) => addWorkdays(now, n);

  const files: RoadmapFiles = {};
  files["settings.yaml"] = toYaml({
    format: 1,
    title: `Synthetic roadmap (${boxes} boxes)`,
    fiscal_year_start_month: 1,
    default_zoom: "months",
    types: TYPES,
    statuses: [
      { id: "at_risk", name: "At risk" },
      { id: "late", name: "Late" },
      { id: "blocked", name: "Blocked" },
    ],
  });

  const departments = Array.from({ length: Math.max(2, Math.ceil(boxes / 50)) }, (_, d) => {
    const id = `dept-${String(d + 1).padStart(2, "0")}`;
    const lanes = Array.from({ length: LANES }, (_, l) => {
      const lane: Record<string, unknown> = { id: `${id}-${l + 1}` };
      if (l === LANES - 1) lane.name = "Contractor";
      lane.fte = l === LANES - 2 ? 0.5 : 1;
      // A new hire's lane opens later; a contractor's closes.
      if (l === LANES - 3) lane.start = formatDay(day(20 + int(60)));
      if (l === LANES - 1) lane.end = formatDay(day(60 + int(120)));
      return lane;
    });
    return {
      id,
      code: `D${(d + 1).toString(36).toUpperCase().padStart(2, "0")}`,
      name: `${AREAS[d % AREAS.length]} ${Math.floor(d / AREAS.length) + 1}`,
      color: COLORS[d % COLORS.length],
      order: d + 1,
      lanes,
    };
  });
  for (const dept of departments) files[`departments/${dept.id}.yaml`] = toYaml(dept);

  const people = departments.flatMap((dept, d) =>
    Array.from({ length: PEOPLE_PER_DEPARTMENT }, (_, i) => {
      const n = d * PEOPLE_PER_DEPARTMENT + i;
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const id = `${slug(name)}-${n + 1}`;
      let next = day(int(60) - 60);
      const pto = Array.from({ length: 3 }, () => {
        const start = next;
        const end = addWorkdays(start, int(8));
        next = addWorkdays(end, 10 + int(80));
        const note = pick(["Vacation", "Conference", "Parental leave", ""]);
        return { start: formatDay(start), end: formatDay(end), ...(note && { note }) };
      });
      return {
        id,
        name,
        department: dept.id,
        role: pick(["Data Engineer", "Senior Data Engineer", "ML Engineer", "Analyst"]),
        email: `${id}@example.com`,
        manager: `Manager ${d + 1}`,
        ...(rnd() < 0.3 && { notes: "Prefers backend work; on call rotation B." }),
        pto,
      };
    }),
  );
  files["people.yaml"] = toYaml({ people });

  const codes = new Set<string>();
  const newCode = () => {
    for (;;) {
      const code = Array.from({ length: 3 }, () => pick([...CODE_CHARS])).join("");
      // Never all digits or like 2E5: YAML would read those as numbers.
      if (!codes.has(code) && !/^\d+$|^\dE\d$/.test(code)) {
        codes.add(code);
        return code;
      }
    }
  };
  const made = Array.from({ length: boxes }, (_, i) => {
    const d = i % departments.length;
    const dept = departments[d];
    const title = `${pick(VERBS)} ${pick(THINGS)} ${i + 1}`;
    const start = day(int(500) - 200);
    const staff = people.slice(d * PEOPLE_PER_DEPARTMENT, (d + 1) * PEOPLE_PER_DEPARTMENT);
    const engineers = [...new Set(Array.from({ length: 1 + int(2) }, () => pick(staff).id))];
    const box: Record<string, unknown> = {
      id: `bx-${int(0x10000).toString(16).padStart(4, "0")}-${slug(title)}`,
      code: newCode(),
      title,
      lane: pick(dept.lanes.slice(0, LANES - 1)).id,
      start: formatDay(start),
      end: formatDay(addWorkdays(start, 4 + int(40))),
      type: pick(TYPES).id,
    };
    if (rnd() < 0.1) box.status = pick(["at_risk", "late", "blocked"]);
    box.fte = pick([0.5, 1, 1, 1, 1.5]);
    box.engineers = engineers;
    if (rnd() < 0.5) box.epic = `https://example.atlassian.net/browse/DATA-${i + 1}`;
    box.description = "Move raw and staging layers to Iceberg tables; coordinate with analytics on cut-over and backfill.";
    box.tags = ["q3", pick(["cost", "infra", "growth"])];
    return box;
  });
  // A rule on a quarter of the boxes, about another box.
  made.forEach((box, i) => {
    if (rnd() >= 0.25 || made.length <= departments.length) return;
    const other = made[(i + departments.length * (1 + int(5))) % made.length];
    if (other !== box) box.relations = [{ type: pick(RULES), box: other.code }];
  });
  for (const box of made) files[`boxes/${box.id}.yaml`] = toYaml(box);
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [count, today, folder, ...rest] = process.argv.slice(2);
  if (!count || !today || !folder || rest.length) {
    console.error("Usage: npm run gen-roadmap -- <boxes> <today, YYYY-MM-DD> <new or empty folder>");
    process.exit(2);
  }
  const dir = resolve(process.env.INIT_CWD ?? process.cwd(), folder);
  let existing: string[] = [];
  try {
    existing = readdirSync(dir);
  } catch {
    // A new folder.
  }
  if (existing.length) {
    console.error(`${dir} isn't empty`);
    process.exit(2);
  }
  const files = generateRoadmap(Number(count), today);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  console.log(`${Object.keys(files).length} files in ${dir}`);
}

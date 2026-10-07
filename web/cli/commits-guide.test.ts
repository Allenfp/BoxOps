// The guide's commit messages (templates/guide/commits.md) against the app's
// own (src/model/summary.ts): each row of the guide's table has edits that
// make its lines, the exact lines summary.ts writes for them are checked, and
// so is that each matches the row's wording, and that every wording in the
// table is one some edit makes. So the guide can't drift from the app, in
// either direction. The subject's rules and the example are checked too.

import { describe, expect, it } from "vitest";
import { parseDay } from "../src/model/dates";
import type { DraftState } from "../src/model/draft";
import { loadRoadmap } from "../src/model/parse";
import { type ChangeLine, commitMessage, describeChanges } from "../src/model/summary";
import type { Box, Department, Person } from "../src/model/types";
import { guideTopic } from "./guide";

/** The roadmap every edit starts from. */
const BASE_FILES: Record<string, string> = {
  "settings.yaml": `format: 1
title: Y
fiscal_year_start_month: 1
default_zoom: months
types:
  - id: project
    name: Project
    color: "#4f7cff"
  - id: maintenance
    name: Maintenance
    color: "#8a94a6"
  - id: support
    name: Support
    color: "#e8913a"
statuses:
  - id: at_risk
    name: At risk
  - id: blocked
    name: Blocked
`,
  "people.yaml": `people:
  - id: jordan-diaz
    name: Jordan Diaz
    department: data-eng
  - id: sam-lee
    name: Sam Lee
    department: data-eng
    pto:
      - start: 2026-12-14
        end: 2026-12-18
        note: Holiday
      - start: 2027-02-15
        end: 2027-02-19
        note: Ski
  - id: alex-kim
    name: Alex Kim
    department: analytics
`,
  "departments/data-eng.yaml": `id: data-eng
code: DE
name: Data Engineering
color: "#4f7cff"
order: 1
lanes:
  - id: de-1
  - id: de-2
  - id: de-3
    start: 2026-11-02
`,
  "departments/analytics.yaml": `id: analytics
code: AN
name: Analytics
color: "#e8913a"
order: 2
lanes:
  - id: an-1
`,
  "departments/ml.yaml": `id: ml
code: ML
name: ML
color: "#8a94a6"
order: 3
lanes:
  - id: ml-1
`,
  "boxes/bx-0001-pipeline.yaml": `id: bx-0001-pipeline
code: H2B
title: Pipeline
lane: de-1
start: 2027-01-04
end: 2027-01-15
type: project
engineers:
  - jordan-diaz
relations:
  - type: before
    box: M8T
  - type: apart
    box: M8T
`,
  "boxes/bx-0002-report.yaml": `id: bx-0002-report
code: M8T
title: Report
lane: an-1
start: 2027-02-01
end: 2027-02-12
type: maintenance
status: at_risk
epic: https://example.com/browse/R-1
`,
};

function base(): DraftState {
  const loaded = loadRoadmap(BASE_FILES);
  expect(loaded.issues).toEqual([]);
  const { boxes, departments, people, settings } = loaded.roadmap;
  return { boxes, departments, people, settings };
}

const day = (text: string) => parseDay(text) ?? Number.NaN;
const box = (d: DraftState, id: string) => d.boxes.find((b) => b.id.endsWith(id)) as Box;
const dept = (d: DraftState, id: string) => d.departments.find((x) => x.id === id) as Department;
const person = (d: DraftState, id: string) => d.people.find((p) => p.id === id) as Person;

/** The bullets of the commit message an edit of the base roadmap makes. */
function bullets(edit: (draft: DraftState) => void): string[] {
  const before = base();
  const draft = structuredClone(before);
  edit(draft);
  return commitMessage(describeChanges(before, draft))
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2));
}

/** Edits, by the row of the guide's table (its first cell) they're for, with the lines they make. */
const CASES: { row: string; edit: (d: DraftState) => void; lines: string[] }[] = [
  {
    row: "New box",
    edit: (d) =>
      d.boxes.push({ id: "bx-0003-data-quality-checks", code: "K7P", title: "Data quality checks", lane: "de-2", start: day("2027-03-01"), end: day("2027-03-19"), type: "project", fte: 1 }),
    lines: ["Added Data quality checks (DE-K7P) to Data Engineering / FTE 2, 2027-03-01 – 2027-03-19"],
  },
  { row: "Deleted box", edit: (d) => d.boxes.splice(1, 1), lines: ["Deleted Report (AN-M8T, Analytics / FTE 1, 2027-02-01 – 2027-02-12)"] },
  {
    row: "Edited box",
    edit: (d) => Object.assign(box(d, "pipeline"), { description: "Nightly loads.", tags: ["etl"] }),
    lines: ["Pipeline (DE-H2B): description edited; tags edited"],
  },
  { row: "… renamed", edit: (d) => (box(d, "pipeline").title = "Pipeline v2"), lines: ["Pipeline v2 (DE-H2B): renamed from “Pipeline”"] },
  { row: "… new lane", edit: (d) => (box(d, "pipeline").lane = "an-1"), lines: ["Pipeline (AN-H2B): moved from Data Engineering / FTE 1 to Analytics / FTE 1"] },
  {
    row: "… same number of working days, new dates",
    edit: (d) => Object.assign(box(d, "pipeline"), { start: day("2027-01-11"), end: day("2027-01-22") }),
    lines: ["Pipeline (DE-H2B): rescheduled to 2027-01-11 – 2027-01-22 (was 2027-01-04 – 2027-01-15)"],
  },
  {
    row: "… other date change",
    edit: (d) => (box(d, "pipeline").end = day("2027-01-22")),
    lines: ["Pipeline (DE-H2B): dates now 2027-01-04 – 2027-01-22 (was 2027-01-04 – 2027-01-15)"],
  },
  {
    row: "… flag, type or FTE",
    edit: (d) => {
      Object.assign(box(d, "pipeline"), { status: "blocked", type: "maintenance", fte: 1.5 });
      delete box(d, "report").status;
    },
    lines: ["Pipeline (DE-H2B): flag On track → Blocked; type Project → Maintenance; FTE 1 → 1.5", "Report (AN-M8T): flag At risk → On track"],
  },
  {
    row: "… engineers",
    edit: (d) => (box(d, "pipeline").engineers = ["sam-lee", "alex-kim"]),
    lines: ["Pipeline (DE-H2B): engineers now Sam Lee, Alex Kim"],
  },
  { row: "… engineers", edit: (d) => delete box(d, "pipeline").engineers, lines: ["Pipeline (DE-H2B): engineers now nobody"] },
  {
    row: "… epic, description, tags, links",
    edit: (d) => {
      Object.assign(box(d, "pipeline"), { epic: "https://example.com/browse/P-1", description: "x", tags: ["a"], links: ["https://example.com/doc"] });
      delete box(d, "report").epic;
    },
    lines: ["Pipeline (DE-H2B): epic link updated; description edited; tags edited; links edited", "Report (AN-M8T): epic link removed"],
  },
  {
    row: "… rule added or removed",
    edit: (d) => {
      box(d, "pipeline").relations = (["apart", "after", "during", "starts_with", "ends_with", "overlaps"] as const).map((type) => ({ type, box: "M8T" }));
      box(d, "report").relations = [{ type: "apart", box: "H2B" }];
    },
    lines: [
      "Pipeline (DE-H2B): now starts after Report (AN-M8T) finishes; now happens during Report (AN-M8T); now starts when Report (AN-M8T) starts; " +
        "now ends when Report (AN-M8T) ends; now runs at the same time as Report (AN-M8T); no longer finishes before Report (AN-M8T) starts",
      "Report (AN-M8T): now doesn’t overlap Pipeline (DE-H2B)",
    ],
  },
  {
    row: "… anything else",
    edit: (d) => box(d, "pipeline").relations?.reverse(),
    lines: ["Pipeline (DE-H2B): edited"],
  },
  { row: "Department code changed", edit: (d) => (dept(d, "data-eng").code = "DX"), lines: ["Data Engineering’s code is now DX (was DE): its boxes are DX-…"] },
  {
    row: "Department added",
    edit: (d) => {
      d.departments.push({ id: "platform", code: "PL", name: "Platform", color: "#8a94a6", order: 3, lanes: [{ id: "pl-1", fte: 1 }, { id: "pl-2", fte: 0.5 }] } as Department);
      d.departments.push({ id: "ops", code: "OP", name: "Ops", color: "#8a94a6", order: 4, lanes: [{ id: "op-1", fte: 1 }] } as Department);
    },
    lines: ["Added department Platform (2 lanes, 1.5 FTE)", "Added department Ops (1 lane, 1 FTE)"],
  },
  {
    row: "Department renamed, recoloured, deleted",
    edit: (d) => {
      Object.assign(dept(d, "data-eng"), { name: "Data Platform", color: "#123456" });
      d.departments.splice(d.departments.indexOf(dept(d, "analytics")), 1);
    },
    lines: ["Renamed department Data Engineering to Data Platform", "Changed the colour of Data Platform", "Deleted department Analytics"],
  },
  {
    row: "Departments reordered",
    edit: (d) => Object.assign(dept(d, "analytics"), { order: 0 }),
    lines: ["Reordered departments"],
  },
  { row: "Department changed some other way", edit: (d) => (dept(d, "data-eng").collapsed = true), lines: ["Updated department Data Engineering"] },
  {
    row: "Lane added, removed, resized, reordered",
    edit: (d) => {
      const lanes = dept(d, "data-eng").lanes;
      lanes[1].fte = 0.5;
      lanes.push({ id: "de-4", fte: 0.5 });
      dept(d, "analytics").lanes = [];
    },
    lines: ["Lane FTE 2 in Data Engineering is now 0.5 FTE (was 1)", "Added lane FTE 4 (0.5 FTE) to Data Engineering", "Removed lane FTE 1 from Analytics"],
  },
  {
    row: "Lane added, removed, resized, reordered",
    edit: (d) => {
      const lanes = dept(d, "data-eng").lanes;
      [lanes[0], lanes[1]] = [lanes[1], lanes[0]];
    },
    lines: ["Reordered the lanes in Data Engineering"],
  },
  {
    row: "Team settings (settings.yaml)",
    edit: (d) => Object.assign(d.settings, { title: "X", fiscal_year_start_month: 2, default_zoom: "quarters" }),
    lines: ["Team settings: title now “X” (was “Y”); fiscal year starts in February (was January); default zoom Quarters (was Months)"],
  },
  {
    row: "Team settings (settings.yaml)",
    edit: (d) => {
      d.settings.types[0].color = "#000000";
      d.settings.types[1].name = "Upkeep";
      d.settings.types.push({ id: "research", name: "Research", color: "#00aa00" });
      d.settings.statuses.push({ id: "late", name: "Late" });
    },
    lines: ["Team settings: changed the colour of type Project; renamed type Maintenance to Upkeep; added type Research; added flag Late"],
  },
  {
    row: "Team settings (settings.yaml)",
    edit: (d) => {
      d.settings.types = [d.settings.types[2], d.settings.types[0]];
    },
    lines: ["Team settings: removed type Maintenance; reordered types"],
  },
  { row: "Lane renamed", edit: (d) => (dept(d, "data-eng").lanes[0].name = "Core"), lines: ["Renamed lane FTE 1 to Core in Data Engineering"] },
  {
    row: "Lane dates changed",
    edit: (d) => {
      const lanes = dept(d, "data-eng").lanes;
      lanes[1].end = day("2027-03-31");
      lanes.push({ id: "de-4", fte: 1, start: day("2027-01-04") });
    },
    lines: ["Lane FTE 2 in Data Engineering now runs until 2027-03-31 (was always open)", "Added lane FTE 4 (1 FTE, from 2027-01-04) to Data Engineering"],
  },
  { row: "Lane dates changed", edit: (d) => delete dept(d, "data-eng").lanes[2].start, lines: ["Lane FTE 3 in Data Engineering is now always open (was from 2026-11-02)"] },
  {
    row: "Lane dates changed",
    edit: (d) => (dept(d, "data-eng").lanes[2].end = day("2027-03-31")),
    lines: ["Lane FTE 3 in Data Engineering now runs 2026-11-02 – 2027-03-31 (was from 2026-11-02)"],
  },
  {
    row: "Person added, edited or removed",
    edit: (d) => {
      d.people.push({ id: "riley-park", name: "Riley Park" } as Person);
      person(d, "jordan-diaz").role = "Lead";
      d.people.splice(d.people.indexOf(person(d, "alex-kim")), 1);
    },
    lines: ["Added engineer Riley Park", "Updated engineer Jordan Diaz", "Removed engineer Alex Kim"],
  },
  { row: "Person added, edited or removed", edit: (d) => person(d, "sam-lee").pto?.reverse(), lines: ["Updated engineer Sam Lee"] },
  {
    row: "PTO added, changed, removed",
    edit: (d) => {
      person(d, "jordan-diaz").pto = [
        { start: day("2027-03-01"), end: day("2027-03-05"), note: "Trip" },
        { start: day("2027-04-02"), end: day("2027-04-02") },
      ];
      const sam = person(d, "sam-lee");
      sam.pto = [{ start: day("2026-12-21"), end: day("2026-12-24"), note: "Holiday" }, ...(sam.pto ?? []).slice(1)];
      person(d, "alex-kim").pto = [];
    },
    lines: [
      "PTO for Jordan Diaz: 2027-03-01 – 2027-03-05 (Trip)",
      "PTO for Jordan Diaz: 2027-04-02",
      "PTO for Sam Lee: 2026-12-21 – 2026-12-24 (Holiday) (was 2026-12-14 – 2026-12-18)",
    ],
  },
  {
    row: "PTO added, changed, removed",
    edit: (d) => person(d, "sam-lee").pto?.splice(1, 1),
    lines: ["Removed PTO for Sam Lee: 2027-02-15 – 2027-02-19"],
  },
];

/** The guide's table: each row's first cell, and the wordings (`code` spans) in its second. */
function table(): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of guideTopic("commits").split("\n")) {
    const m = /^\| (.+?) \| (.+) \|$/.exec(line);
    if (!m || m[1] === "Change" || /^-+$/.test(m[1])) continue;
    rows.set(m[1], [...m[2].matchAll(/`([^`]+)`/g)].map((w) => w[1]));
  }
  return rows;
}

const PLACEHOLDERS: Record<string, string> = {
  "<code>": "[A-Z0-9]{2,4}-[A-Z0-9]{3}",
  "<range>": "\\d{4}-\\d{2}-\\d{2}(?: – \\d{4}-\\d{2}-\\d{2})?",
  "<old range>": "\\d{4}-\\d{2}-\\d{2}(?: – \\d{4}-\\d{2}-\\d{2})?",
  "<day>": "\\d{4}-\\d{2}-\\d{2}",
  "<n>": "[\\d,]+",
  "<fte>": "\\d+(?:\\.\\d+)?",
  "<NEW>": "[A-Z][A-Z0-9]{1,3}",
  "<OLD>": "[A-Z][A-Z0-9]{1,3}",
};

/** A wording as a pattern: `<code>`, `<range>` and the like as what they stand for, any other `<…>` and `…` as any text. */
function pattern(wording: string): RegExp {
  const parts = wording.split(/(<[^>]+>|…)/);
  return new RegExp(
    parts
      .map((p, i) => (i % 2 === 0 ? p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : p === "…" ? ".+" : (PLACEHOLDERS[p] ?? ".+?")))
      .join(""),
  );
}

describe("the guide's commit messages (templates/guide/commits.md)", () => {
  it("are the lines the app writes for each kind of edit", () => {
    for (const c of CASES) expect(bullets(c.edit), c.row).toEqual(c.lines);
  });

  it("word every line as its row of the table does, and every wording in the table is one the app writes", () => {
    const rows = table();
    const used = new Map<string, Set<string>>();
    for (const c of CASES) {
      const wordings = rows.get(c.row);
      expect(wordings, `the table has a row “${c.row}”`).toBeDefined();
      for (const line of c.lines) {
        const matching = (wordings ?? []).filter((w) => pattern(w).test(line));
        expect(matching, `“${line}” is worded as the row “${c.row}” says`).not.toEqual([]);
        for (const w of matching) used.set(c.row, (used.get(c.row) ?? new Set()).add(w));
      }
    }
    for (const [row, wordings] of rows) {
      for (const w of wordings) expect(used.get(row)?.has(w), `the app writes “${w}” (row “${row}”)`).toBe(true);
    }
  });

  it("have the subject the guide says: the one line without its (was …), at most 72 characters; else Roadmap: <n> changes", () => {
    const lines = (n: number): ChangeLine[] => Array.from({ length: n }, (_, i) => ({ kind: "added", text: `Added engineer **P${i}**` }));
    const subject = (edit: (d: DraftState) => void) => {
      const before = base();
      const draft = structuredClone(before);
      edit(draft);
      return commitMessage(describeChanges(before, draft)).split("\n")[0];
    };
    expect(subject((d) => (person(d, "sam-lee").pto = [{ start: day("2026-12-21"), end: day("2026-12-24"), note: "Holiday" }, ...(person(d, "sam-lee").pto ?? []).slice(1)]))).toBe(
      "PTO for Sam Lee: 2026-12-21 – 2026-12-24 (Holiday)",
    );
    const long = subject((d) => (box(d, "pipeline").title = "A pipeline with a title long enough that the commit subject must be cut short"));
    expect([long.length <= 72, long.endsWith("…")]).toEqual([true, true]);
    expect(commitMessage(lines(2)).split("\n")[0]).toBe("Roadmap: 2 changes");
    expect(commitMessage(lines(1200)).split("\n")[0]).toBe("Roadmap: 1,200 changes");
    expect(commitMessage(lines(1)).split("\n").at(-1)).toBe("Saved from the BoxOps web app.");
  });

  it("show an example the app would write", () => {
    const example = /For example:\n\n```\n([\s\S]*?)\n```/.exec(guideTopic("commits"))?.[1];
    const before = base();
    const draft = structuredClone(before);
    person(draft, "jordan-diaz").role = "Lead";
    draft.boxes.push({ id: "bx-0003-data-quality-checks", code: "K7P", title: "Data quality checks", lane: "de-2", start: day("2027-03-01"), end: day("2027-03-19"), type: "project", fte: 1 });
    expect(commitMessage(describeChanges(before, draft))).toBe(`${example}\n\nSaved from the BoxOps web app.`);
  });

  it("list the lines in the order the guide gives", () => {
    const lines = bullets((d) => {
      Object.assign(d.settings, { title: "X" });
      Object.assign(dept(d, "analytics"), { order: 0, name: "Insights" });
      d.departments.splice(d.departments.indexOf(dept(d, "ml")), 1);
      d.departments.push({ id: "platform", code: "PL", name: "Platform", color: "#8a94a6", order: 6, lanes: [{ id: "pl-1", fte: 1 }] } as Department);
      d.boxes.splice(1, 1);
      box(d, "pipeline").description = "x";
      d.boxes.push({ id: "bx-0000-first", code: "Q2W", title: "First", lane: "pl-1", start: day("2027-03-01"), end: day("2027-03-05"), type: "project", fte: 1 });
      d.people.splice(d.people.indexOf(person(d, "alex-kim")), 1);
      person(d, "sam-lee").role = "Lead";
      d.people.unshift({ id: "riley-park", name: "Riley Park", pto: [{ start: day("2027-03-01"), end: day("2027-03-01") }] } as Person);
    });
    expect(lines).toEqual([
      "Added engineer Riley Park",
      "PTO for Riley Park: 2027-03-01",
      "Updated engineer Sam Lee",
      "Removed engineer Alex Kim",
      "Added First (PL-Q2W) to Platform / FTE 1, 2027-03-01 – 2027-03-05",
      "Pipeline (DE-H2B): description edited",
      "Deleted Report (AN-M8T, Analytics / FTE 1, 2027-02-01 – 2027-02-12)",
      "Renamed department Analytics to Insights",
      "Added department Platform (1 lane, 1 FTE)",
      "Deleted department ML",
      "Reordered departments",
      "Team settings: title now “X” (was “Y”)",
    ]);
  });
});

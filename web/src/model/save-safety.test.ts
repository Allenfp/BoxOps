// What a save writes: untouched lines stay byte for byte as written, and list
// entries keep their comments and unknown fields.

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDay } from "./dates";
import type { DraftState } from "./draft";
import { readRoadmapDir } from "./files";
import { loadRoadmap } from "./load";
import { type FileChanges, serializeChanges } from "./serialize";
import type { RoadmapFiles } from "./types";

const SETTINGS = 'format: 1\ntypes: [{id: project, name: Project, color: "#4f7cff"}]\n';
const DEPT = "id: eng\ncode: EN\nname: Eng\nlanes:\n  - id: e1\n  - id: e2\n";
const box = (id: string, code: string, extra = "") =>
  `id: ${id}\ncode: ${code}\ntitle: Box ${code}\nlane: e1\nstart: 2026-01-05\nend: 2026-01-16\ntype: project\n${extra}`;
const ROADMAP: RoadmapFiles = {
  "settings.yaml": SETTINGS,
  "departments/eng.yaml": DEPT,
  "people.yaml": "people:\n  - id: sam\n    name: Sam\n",
  "boxes/b1.yaml": box("b1", "B1X"),
  "boxes/b2.yaml": box("b2", "B2X"),
};

/** The roadmap loaded from these files, as the app's draft starts out. */
function loaded(files: RoadmapFiles): DraftState {
  const { roadmap: r } = loadRoadmap(files);
  return { boxes: r.boxes, departments: r.departments, people: r.people, settings: r.settings };
}
const editBox = (s: DraftState, id: string, patch: object): DraftState => ({ ...s, boxes: s.boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
const editPerson = (s: DraftState, id: string, patch: object): DraftState => ({
  ...s,
  people: s.people.map((p) => (p.id === id ? { ...p, ...patch } : p)),
});
const d = (s: string) => parseDay(s)!;

/** The file changes that save `edit` of the roadmap in `files`. */
function save(files: RoadmapFiles, edit: (s: DraftState) => DraftState): FileChanges {
  const base = loaded(files);
  return serializeChanges(files, base, edit(base));
}

/** Lines of `after` that differ from `before` (same line count expected). */
function changedLines(before: string, after: string): string[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  expect(b.length).toBe(a.length);
  return b.filter((line, i) => line !== a[i]);
}

describe("untouched lines stay as written", () => {
  const shipped = { ...readRoadmapDir(resolve(__dirname, "../../../roadmap")) };
  const fixture = { ...readRoadmapDir(resolve(__dirname, "../../e2e/fixtures/roadmap")) };

  for (const [name, files] of [["roadmap/", shipped], ["the e2e fixture", fixture]] as const) {
    it(`in every file of ${name} when one field changes`, () => {
      const base = loaded(files);
      for (const b of base.boxes) {
        const out = serializeChanges(files, base, editBox(base, b.id, { title: "Changed" }));
        expect(changedLines(files[`boxes/${b.id}.yaml`], out[`boxes/${b.id}.yaml`]!)).toEqual(["title: Changed"]);
      }
      for (const dept of base.departments) {
        const draft = { ...base, departments: base.departments.map((x) => (x.id === dept.id ? { ...x, name: "Changed" } : x)) };
        const path = `departments/${dept.id}.yaml`;
        expect(changedLines(files[path], serializeChanges(files, base, draft)[path]!)).toEqual(["name: Changed"]);
      }
      const person = base.people[0];
      const roster = serializeChanges(files, base, editPerson(base, person.id, { name: "Changed" }))["people.yaml"]!;
      expect(changedLines(files["people.yaml"], roster)).toEqual(["    name: Changed"]);
      const zoom = base.settings.default_zoom === "weeks" ? "months" : "weeks";
      const settings = serializeChanges(files, base, { ...base, settings: { ...base.settings, default_zoom: zoom } })["settings.yaml"]!;
      expect(changedLines(files["settings.yaml"], settings)).toEqual([`default_zoom: ${zoom} # weeks | months | quarters`]);
    });
  }

  it("with a BOM and CRLF line endings, which are kept", () => {
    const text = "﻿" + box("b1", "B1X", "tags: [cost, q1] # flow list\n").replace(/\n/g, "\r\n");
    const out = save({ ...ROADMAP, "boxes/b1.yaml": text }, (s) => editBox(s, "b1", { end: d("2026-01-23") }))["boxes/b1.yaml"]!;
    expect(out).toBe(text.replace("end: 2026-01-16", "end: 2026-01-23"));
  });

  it("in a list written flush with its key", () => {
    const flush = "id: eng\ncode: EN\nname: Eng\nlanes:\n- id: e1\n- id: e2 # contractor\n";
    const out = save({ ...ROADMAP, "departments/eng.yaml": flush }, (s) => ({
      ...s,
      departments: s.departments.map((x) => ({ ...x, lanes: x.lanes.map((l) => (l.id === "e1" ? { ...l, name: "Platform" } : l)) })),
    }));
    expect(out).toEqual({ "departments/eng.yaml": flush.replace("- id: e1\n", "- id: e1\n  name: Platform\n") });
  });

  it("for values YAML would read as numbers, which stay quoted", () => {
    const files = { ...ROADMAP, "boxes/b1.yaml": box("b1", '"234"').replace("Box \"234\"", '"1.10"') };
    const out = save(files, (s) => editBox(s, "b1", { end: d("2026-01-23") }))["boxes/b1.yaml"]!;
    expect(changedLines(files["boxes/b1.yaml"], out)).toEqual(["end: 2026-01-23"]);
    expect(out).toContain('code: "234"\ntitle: "1.10"\n');
  });
});

describe("PTO and rules are merged entry by entry", () => {
  const roster = `people:
  - id: sam
    name: Sam
    pto:
      - start: 2026-07-06 # summer
        end: 2026-07-10
        approved_by: dana # not an app field
      - start: 2026-12-21 # holidays
        end: 2026-12-31
        note: Holidays
  - id: kim
    name: Kim
    pto:
      - end: 2026-08-07 # written end first
        start: 2026-08-03
`;
  const files = { ...ROADMAP, "people.yaml": roster };
  const pto = (s: DraftState, id: string) => s.people.find((p) => p.id === id)!.pto!;

  it("keeping comments, unknown fields and key order on entries that stay", () => {
    const removed = save(files, (s) => editPerson(s, "sam", { pto: pto(s, "sam").slice(1) }))["people.yaml"];
    expect(removed).toBe(roster.replace(/      - start: 2026-07-06[^]*?dana # not an app field\n/, ""));
    const edited = save(files, (s) => editPerson(s, "sam", { pto: [pto(s, "sam")[0], { ...pto(s, "sam")[1], end: d("2027-01-01") }] }))["people.yaml"];
    expect(edited).toBe(roster.replace("end: 2026-12-31", "end: 2027-01-01"));
    const added = save(files, (s) => editPerson(s, "sam", { pto: [...pto(s, "sam"), { start: d("2027-02-01"), end: d("2027-02-05") }] }))["people.yaml"];
    expect(added).toBe(roster.replace("        note: Holidays\n", "        note: Holidays\n      - start: 2027-02-01\n        end: 2027-02-05\n"));
  });

  it("leaving everyone else's entries alone", () => {
    const out = save(files, (s) => editPerson(s, "sam", { role: "Lead" }))["people.yaml"];
    expect(out).toBe(roster.replace("    name: Sam\n", "    name: Sam\n    role: Lead\n"));
  });

  it("and rules keep how they're written (DE-M8T or M8T, comments)", () => {
    const rules = "relations:\n  - type: after # waits for B2X\n    box: EN-B2X\n";
    const withRules = { ...ROADMAP, "boxes/b1.yaml": box("b1", "B1X", rules), "boxes/b3.yaml": box("b3", "B3X") };
    const out = save(withRules, (s) => {
      const b1 = s.boxes.find((b) => b.id === "b1")!;
      return editBox(s, "b1", { relations: [...b1.relations!, { type: "before", box: "B3X" }] });
    })["boxes/b1.yaml"];
    expect(out).toBe(box("b1", "B1X", `${rules}  - type: before\n    box: B3X\n`));
  });
});

describe("an empty roster", () => {
  const add = (s: DraftState): DraftState => ({ ...s, people: [...s.people, { id: "ana", name: "Ana" }] });

  it("written `people: []` grows one engineer per entry", () => {
    expect(save({ ...ROADMAP, "people.yaml": "# Nobody yet.\npeople: []\n" }, add)["people.yaml"]).toBe("# Nobody yet.\npeople:\n  - id: ana\n    name: Ana\n");
  });

  it("is written `people: []` when the last engineer goes", () => {
    expect(save(ROADMAP, (s) => ({ ...s, people: [] }))["people.yaml"]).toBe("people: []\n");
  });
});

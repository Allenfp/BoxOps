// What a save writes, and what it refuses to write: files the loader couldn't
// fully read, roadmaps in another data format, and files other than the one
// an item came from. Also that untouched lines stay byte for byte as written.

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readRoadmapDir } from "../../cli/git";
import { parseDay } from "./dates";
import type { DraftState } from "./draft";
import { loadRoadmap } from "./parse";
import { type FileChanges, serializeChanges, UnsafeWrite } from "./serialize";
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

const shipped = (await readRoadmapDir(fileURLToPath(new URL("../../../roadmap", import.meta.url)))).files;
const fixture = (await readRoadmapDir(fileURLToPath(new URL("../../e2e/fixtures/roadmap", import.meta.url)))).files;

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

/** The files (and their problems) a save of `edit` refuses to write. */
function refused(files: RoadmapFiles, edit: (s: DraftState) => DraftState) {
  try {
    save(files, edit);
  } catch (e) {
    if (e instanceof UnsafeWrite) return e.files;
    throw e;
  }
  throw new Error("the save went through");
}

/** Lines of `after` that differ from `before` (same line count expected). */
function changedLines(before: string, after: string): string[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  expect(b.length).toBe(a.length);
  return b.filter((line, i) => line !== a[i]);
}

describe("files the loader couldn't fully read", () => {
  const badRoster = { ...ROADMAP, "people.yaml": "people:\n  - id: sam\n    name: Sam\n  - name: No id\n" };

  it("are never written; edits to other files still save", () => {
    expect(refused(badRoster, (s) => editPerson(s, "sam", { role: "Lead" }))).toEqual([
      { path: "people.yaml", problems: ["person 2, id: required text is missing"] },
    ]);
    expect(Object.keys(save(badRoster, (s) => editBox(s, "b1", { title: "Renamed" })))).toEqual(["boxes/b1.yaml"]);
  });

  it("include files with a YAML syntax error: a save refuses instead of crashing", () => {
    const broken = { ...ROADMAP, "people.yaml": "people:\n  - id: sam\n\tname: Sam\n" };
    const [file, ...more] = refused(broken, (s) => ({ ...s, people: [{ id: "ana", name: "Ana" }] }));
    expect([file.path, more]).toEqual(["people.yaml", []]);
    expect(file.problems).toEqual([expect.stringMatching(/^YAML syntax error: .* at line 3, column 1$/)]);
  });

  it("include files with a YAML alias, which reads fine but couldn't be edited without what it stands for", () => {
    const aliased = { ...ROADMAP, "boxes/b1.yaml": box("b1", "B1X", "description: *t\n").replace("title: Box B1X", "title: &t Billing rewrite") };
    const { roadmap, issues } = loadRoadmap(aliased);
    expect(roadmap.boxes.find((b) => b.id === "b1")).toMatchObject({ title: "Billing rewrite", description: "Billing rewrite" });
    const problem = "*t is a YAML alias of the value marked &t: the app can't edit one without the other, so it doesn't save this file; write the value out in full";
    expect(issues).toEqual([expect.objectContaining({ path: "boxes/b1.yaml", message: problem, line: 8, lossy: true })]);
    expect(refused(aliased, (s) => editBox(s, "b1", { title: "Billing v2" }))).toEqual([{ path: "boxes/b1.yaml", problems: [problem] }]);
    // An anchor nothing refers to is just a name.
    expect(loadRoadmap({ ...ROADMAP, "boxes/b1.yaml": box("b1", "B1X").replace("title: Box", "title: &t Box") }).issues).toEqual([]);
  });

  it("include a department whose lane another department already has", () => {
    const files = { ...ROADMAP, "departments/ops.yaml": "id: ops\ncode: OP\nname: Ops\nlanes:\n  - id: e2\n  - id: o1\n" };
    const out = refused(files, (s) => ({ ...s, departments: s.departments.map((x) => (x.id === "ops" ? { ...x, name: "Operations" } : x)) }));
    expect(out).toEqual([{ path: "departments/ops.yaml", problems: ['lane "e2" is already used in department "eng", so it\'s left out here'] }]);
  });
});

describe("the data format", () => {
  it("must be this BoxOps's to save anything", () => {
    for (const settings of [SETTINGS.replace("format: 1\n", ""), SETTINGS.replace("format: 1", "format: 2")]) {
      const out = refused({ ...ROADMAP, "settings.yaml": settings }, (s) => editBox(s, "b1", { title: "Renamed" }));
      expect(out.map((f) => f.path)).toEqual(["settings.yaml"]);
    }
  });

  it("starts a settings.yaml written from scratch", () => {
    const { "settings.yaml": _, ...files } = ROADMAP;
    const base = loaded(files);
    const draft = { ...base, settings: { ...base.settings, title: "Ours" } };
    const current = { ...loadRoadmap(files), formatStatus: "current" as const };
    expect(serializeChanges(files, base, draft, current)["settings.yaml"]).toMatch(/^format: 1\ntitle: Ours\n/);
  });
});

describe("each item is written to the file it was loaded from", () => {
  for (const copy of ["boxes/a-copy.yaml", "boxes/z-copy.yaml"]) {
    it(`a box, with a copy of its file at ${copy}`, () => {
      const files = { ...ROADMAP, [copy]: box("b1", "C0P").replace("Box C0P", "Copy") };
      expect(Object.keys(save(files, (s) => editBox(s, "b1", { end: d("2026-01-23") })))).toEqual(["boxes/b1.yaml"]);
      expect(save(files, (s) => ({ ...s, boxes: s.boxes.filter((b) => b.id !== "b1") }))).toEqual({ "boxes/b1.yaml": null });
    });
  }
  for (const copy of ["departments/a-copy.yaml", "departments/z-copy.yaml"]) {
    it(`a department, with a copy of its file at ${copy}`, () => {
      const files = { ...ROADMAP, [copy]: DEPT.replace("name: Eng", "name: Copy") };
      const out = save(files, (s) => ({ ...s, departments: s.departments.map((x) => ({ ...x, name: "Engineering" })) }));
      expect(out).toEqual({ "departments/eng.yaml": DEPT.replace("name: Eng", "name: Engineering") });
    });
  }

  it("including one whose file is .yml", () => {
    const { "boxes/b1.yaml": text, ...rest } = ROADMAP;
    expect(Object.keys(save({ ...rest, "boxes/b1.yml": text }, (s) => editBox(s, "b1", { title: "Renamed" })))).toEqual(["boxes/b1.yml"]);
  });

  it("but deleting one isn't saved while a skipped copy (.yml beside .yaml) would come back in its place", () => {
    const boxes = { ...ROADMAP, "boxes/b1.yml": box("b1", "OLD").replace("Box OLD", "Old copy") };
    expect(refused(boxes, (s) => ({ ...s, boxes: s.boxes.filter((b) => b.id !== "b1") }))).toEqual([
      {
        path: "boxes/b1.yml",
        problems: [
          'id: "b1" is already used by boxes/b1.yaml, so this file is skipped',
          'deleting box "b1" would bring this copy back in its place: delete or rename this file first',
        ],
      },
    ]);
    // Editing it is saved as ever, and so is deleting it beside a copy that wouldn't load anyway.
    expect(Object.keys(save(boxes, (s) => editBox(s, "b1", { title: "Renamed" })))).toEqual(["boxes/b1.yaml"]);
    const broken = { ...boxes, "boxes/b1.yml": "id: b1\ncode: [\n" };
    expect(save(broken, (s) => ({ ...s, boxes: s.boxes.filter((b) => b.id !== "b1") }))).toEqual({ "boxes/b1.yaml": null });

    const depts = { ...ROADMAP, "departments/eng.yml": DEPT.replace("name: Eng", "name: Old copy") };
    const out = refused(depts, (s) => ({ ...s, boxes: [], departments: [] }));
    expect(out.map((f) => [f.path, f.problems.at(-1)])).toEqual([["departments/eng.yml", 'deleting department "eng" would bring this copy back in its place: delete or rename this file first']]);
  });
});

describe("untouched lines stay as written", () => {

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
    const text = "\uFEFF" + box("b1", "B1X", "tags: [cost, q1] # flow list\n").replace(/\n/g, "\r\n");
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

  it("in a file whose lists are mostly indented, but for one written flush", () => {
    const roster = "people:\n  - id: sam\n    name: Sam\n    pto:\n    - start: 2026-12-14\n      end: 2026-12-18\n  - id: alex\n    name: Alex\n  - id: jo\n    name: Jo\n";
    const out = save({ ...ROADMAP, "people.yaml": roster }, (s) => editPerson(s, "jo", { role: "SRE" }))["people.yaml"]!;
    // yaml writes every list of a file the same way: only the flush one changes.
    expect(out).toBe(roster.replace("    - start: 2026-12-14\n      end", "      - start: 2026-12-14\n        end").concat("    role: SRE\n"));
    // And the other way round: mostly flush, one list indented.
    const flush = "people:\n- id: sam\n  name: Sam\n  pto:\n    - start: 2026-12-14\n      end: 2026-12-18\n- id: alex\n  name: Alex\n- id: jo\n  name: Jo\n";
    const back = save({ ...ROADMAP, "people.yaml": flush }, (s) => editPerson(s, "jo", { role: "SRE" }))["people.yaml"]!;
    expect(back).toBe(flush.replace("    - start: 2026-12-14\n      end", "  - start: 2026-12-14\n    end").concat("  role: SRE\n"));
  });

  it("in indented lists, beside a description that only looks like a flush list", () => {
    const files = { ...ROADMAP, "boxes/b1.yaml": box("b1", "B1X", "engineers:\n  - sam\nrelations:\n  - type: before\n    box: B2X\n") };
    const described = { ...files, ...save(files, (s) => editBox(s, "b1", { description: "Acceptance criteria:\n- first\n- second" })) } as RoadmapFiles;
    expect(described["boxes/b1.yaml"]).toContain("    box: B2X\ndescription: |-\n  Acceptance criteria:\n  - first\n  - second\n");
    const out = save(described, (s) => editBox(s, "b1", { title: "Renamed" }))["boxes/b1.yaml"]!;
    expect(changedLines(described["boxes/b1.yaml"], out)).toEqual(["title: Renamed"]);
  });

  it("for values YAML would read as numbers, which stay quoted", () => {
    const files = { ...ROADMAP, "boxes/b1.yaml": box("b1", '"234"').replace("Box \"234\"", '"1.10"') };
    const out = save(files, (s) => editBox(s, "b1", { end: d("2026-01-23") }))["boxes/b1.yaml"]!;
    expect(changedLines(files["boxes/b1.yaml"], out)).toEqual(["end: 2026-01-23"]);
    expect(out).toContain('code: "234"\ntitle: "1.10"\n');
  });
});

describe("a file rewritten with what it already says", () => {
  const bomCrlf = (files: RoadmapFiles) => Object.fromEntries(Object.entries(files).map(([p, t]) => [p, `\uFEFF${t.replace(/\n/g, "\r\n")}`]));
  /** Every item with one field changed, so a save from here back to the files rewrites every file. */
  const stale = (s: DraftState): DraftState => ({
    boxes: s.boxes.map((b) => ({ ...b, title: `${b.title} (old)` })),
    departments: s.departments.map((x) => ({ ...x, name: `${x.name} (old)` })),
    people: s.people.map((p) => ({ ...p, name: `${p.name} (old)` })),
    settings: { ...s.settings, title: `${s.settings.title} (old)` },
  });

  for (const [name, files] of [["roadmap/ (and its settings.yaml template)", shipped], ["the e2e fixture", fixture], ["roadmap/ with a BOM and CRLF line endings", bomCrlf(shipped)]] as const) {
    it(`comes out byte for byte the same, for every file of ${name}`, () => {
      const draft = loaded(files);
      expect(Object.keys(serializeChanges(files, draft, stale(draft))).sort()).toEqual(Object.keys(files).sort());
      expect(serializeChanges(files, stale(draft), draft)).toEqual({});
    });
  }
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

  it("keeping them on an entry moved in its place, which still overlaps where it was", () => {
    const moved = save(files, (s) => editPerson(s, "sam", { pto: [{ ...pto(s, "sam")[0], start: d("2026-07-08"), end: d("2026-07-14") }, pto(s, "sam")[1]] }));
    expect(moved["people.yaml"]).toBe(roster.replace("start: 2026-07-06 # summer", "start: 2026-07-08 # summer").replace("end: 2026-07-10", "end: 2026-07-14"));
  });

  it("never handing a removed entry's fields or comments to one added in the same save", () => {
    const wedding = { start: d("2027-05-03"), end: d("2027-05-07"), note: "Wedding" };
    const entry = "      - start: 2027-05-03\n        end: 2027-05-07\n        note: Wedding\n";
    // The first entry goes: the new one comes last, where the second entry now is.
    const first = save(files, (s) => editPerson(s, "sam", { pto: [pto(s, "sam")[1], wedding] }))["people.yaml"];
    expect(first).toBe(roster.replace(/      - start: 2026-07-06[^]*?dana # not an app field\n/, "").replace("        note: Holidays\n", `        note: Holidays\n${entry}`));
    // The last one goes: the new one comes in where it was.
    const last = save(files, (s) => editPerson(s, "sam", { pto: [pto(s, "sam")[0], wedding] }))["people.yaml"];
    expect(last).toBe(roster.replace("      - start: 2026-12-21 # holidays\n        end: 2026-12-31\n        note: Holidays\n", entry));
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

  describe("a rule removed and another added in one save", () => {
    const after = "  - type: after # vendor contract signed first, see LEGAL-7\n    box: B2X\n    reviewed: 2026-09-01\n";
    const during = "  - type: during # while B3X runs\n    box: B3X\n    reviewed: 2026-09-02\n";
    const rules = `relations:\n${after}${during}`;
    const withRules = { ...ROADMAP, "boxes/b1.yaml": box("b1", "B1X", rules), "boxes/b3.yaml": box("b3", "B3X"), "boxes/b4.yaml": box("b4", "B4X") };
    const relations = (s: DraftState) => s.boxes.find((b) => b.id === "b1")!.relations!;

    it("the new one is written as new, wherever the removed one was", () => {
      // Deleting box B2X takes the first rule with it.
      const first = save(withRules, (s) => editBox({ ...s, boxes: s.boxes.filter((b) => b.id !== "b2") }, "b1", { relations: [relations(s)[1], { type: "before", box: "B4X" }] }));
      expect(first["boxes/b1.yaml"]).toBe(box("b1", "B1X", `relations:\n${during}  - type: before\n    box: B4X\n`));
      // The last one goes, and a rule of the same type comes in where it was.
      const last = save(withRules, (s) => editBox(s, "b1", { relations: [relations(s)[0], { type: "during", box: "B4X" }] }));
      expect(last["boxes/b1.yaml"]).toBe(box("b1", "B1X", `relations:\n${after}  - type: during\n    box: B4X\n`));
    });

    it("but one given another type is the same rule, comment and all", () => {
      const out = save(withRules, (s) => editBox(s, "b1", { relations: [{ ...relations(s)[0], type: "starts_with" }, relations(s)[1]] }));
      expect(out["boxes/b1.yaml"]).toBe(box("b1", "B1X", rules.replace("type: after #", "type: starts_with #")));
    });
  });
});

describe("plain lists (tags, engineers, links) are merged item by item", () => {
  const tagged = box("b1", "B1X", "engineers:\n  - sam # lead\n  - kim\ntags:\n  - iceberg # the table format\n  - q4\n");
  const files = {
    ...ROADMAP,
    "people.yaml": "people:\n  - id: sam\n    name: Sam\n  - id: kim\n    name: Kim\n  - id: ana\n    name: Ana\n",
    "boxes/b1.yaml": tagged,
  };

  it("keeping the comment beside an item that stays, or that's edited in its place", () => {
    const out = save(files, (s) => editBox(s, "b1", { tags: ["iceberg", "q1"], engineers: ["sam", "ana"] }))["boxes/b1.yaml"];
    expect(out).toBe(tagged.replace("  - q4\n", "  - q1\n").replace("  - kim\n", "  - ana\n"));
    const fewer = save(files, (s) => editBox(s, "b1", { tags: ["iceberg"], engineers: ["sam", "kim", "ana"] }))["boxes/b1.yaml"];
    expect(fewer).toBe(tagged.replace("  - q4\n", "").replace("  - kim\n", "  - kim\n  - ana\n"));
  });

  it("never handing a removed item's comment to a new one", () => {
    const out = save(files, (s) => editBox(s, "b1", { tags: ["q4", "delta"], engineers: ["kim", "ana"] }))["boxes/b1.yaml"];
    expect(out).toBe(
      tagged.replace("  - sam # lead\n  - kim\n", "  - kim\n  - ana\n").replace("  - iceberg # the table format\n  - q4\n", "  - q4\n  - delta\n"),
    );
  });
});

describe("titles and names", () => {
  it("are written without spaces at either end, and spaces alone are no change", () => {
    expect(save(ROADMAP, (s) => editBox(s, "b1", { title: "  Box B1X " }))).toEqual({});
    expect(save(ROADMAP, (s) => editBox(s, "b1", { title: " Renamed " }))["boxes/b1.yaml"]).toBe(ROADMAP["boxes/b1.yaml"].replace("title: Box B1X", "title: Renamed"));
  });
});

describe("an empty roster", () => {
  const add = (s: DraftState): DraftState => ({ ...s, people: [...s.people, { id: "ana", name: "Ana" }] });

  it("can be written `people:` or `people: []`, and grows one engineer per entry", () => {
    for (const empty of ["# Nobody yet.\npeople:\n", "# Nobody yet.\npeople: []\n"]) {
      expect(loadRoadmap({ ...ROADMAP, "people.yaml": empty }).issues).toEqual([]);
      expect(save({ ...ROADMAP, "people.yaml": empty }, add)["people.yaml"]).toBe("# Nobody yet.\npeople:\n  - id: ana\n    name: Ana\n");
    }
  });

  it("keeps a comment beside `people:`, at the top of the list", () => {
    expect(save({ ...ROADMAP, "people.yaml": "people: # the whole team\n" }, add)["people.yaml"]).toBe(
      "people:\n  # the whole team\n  - id: ana\n    name: Ana\n",
    );
  });

  it("is written `people: []` when the last engineer goes", () => {
    expect(save(ROADMAP, (s) => ({ ...s, people: [] }))["people.yaml"]).toBe("people: []\n");
  });
});

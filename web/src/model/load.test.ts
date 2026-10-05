// One row per rule in docs/data-format.md "What the validator checks" (and the
// edge cases around them): a file as written → the exact problems reported,
// and whether the file becomes lossy (left partly out, so the app won't write it).

import { describe, expect, it } from "vitest";
import { loadRoadmap } from "./load";
import type { RoadmapFiles } from "./types";

/** `key: value` lines; values are YAML as written (null leaves the key out). */
const lines = (fields: Record<string, string | null>) =>
  Object.entries(fields)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}: ${v}\n`)
    .join("");
const settings = (over: Record<string, string | null> = {}) =>
  lines({ format: "1", types: '[{id: project, name: Project, color: "#4f7cff"}]', statuses: "[{id: late, name: Late}]", ...over });
const dept = (over: Record<string, string | null> = {}) =>
  lines({ id: "eng", code: "EN", name: "Eng", lanes: "[{id: e1}, {id: e2, fte: 0.5}]", ...over });
const box = (over: Record<string, string | null> = {}) =>
  lines({ id: "b1", code: "B1X", title: "One", lane: "e1", start: "2026-01-05", end: "2026-01-30", type: "project", ...over });
const people = (list: string) => `people: ${list}\n`;

const VALID: RoadmapFiles = {
  "settings.yaml": settings(),
  "departments/eng.yaml": dept(),
  "people.yaml": people("[{id: sam, name: Sam, department: eng}]"),
  "boxes/b1.yaml": box(),
  "boxes/b2.yaml": box({ id: "b2", code: "B2X" }),
};

/** VALID with some files replaced (null deletes one). */
function load(over: Record<string, string | null>) {
  const files = { ...VALID };
  for (const [path, text] of Object.entries(over)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return loadRoadmap(files);
}

type Row = [rule: string, files: Record<string, string | null>, issues: [path: string, message: string, lossy?: "lossy"][]];

const ROWS: Row[] = [
  // Files
  ["YAML that doesn't parse", { "boxes/b1.yaml": "id: [unclosed\n" }, [["boxes/b1.yaml", "YAML syntax error: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1", "lossy"]]],
  ["a file that isn't a mapping at the top level", { "boxes/b1.yaml": "- id: b1\n" }, [["boxes/b1.yaml", "expected a YAML mapping (key: value lines) at the top level", "lossy"]]],
  ["an unexpected file", { "notes.md": "# Notes\n" }, [["notes.md", "unexpected file; roadmap files live in departments/ or boxes/"]]],
  ["people.yml instead of people.yaml", { "people.yml": "people: []\n" }, [["people.yml", "rename this file to people.yaml"]]],
  // settings.yaml
  ["settings.yaml missing", { "settings.yaml": null }, [["settings.yaml", "missing; using defaults"]]],
  ["fiscal_year_start_month outside 1-12", { "settings.yaml": settings({ fiscal_year_start_month: "13" }) }, [["settings.yaml", "fiscal_year_start_month: expected a month number from 1 to 12", "lossy"]]],
  ["default_zoom not weeks, months or quarters", { "settings.yaml": settings({ default_zoom: "days" }) }, [["settings.yaml", "default_zoom: expected one of weeks, months, quarters", "lossy"]]],
  ["a type without a colour", { "settings.yaml": settings({ types: "[{id: project, name: Project}]" }) }, [["settings.yaml", 'type "project", color: required text is missing', "lossy"]]],
  ["types that aren't a list", { "settings.yaml": settings({ types: "project" }) }, [["settings.yaml", "types: expected a list", "lossy"]]],
  ["a type id that isn't valid", { "settings.yaml": settings({ types: '[{id: project, name: Project, color: "#4f7cff"}, {id: Big Bet, name: Big bet, color: "#8a94a6"}]' }) }, [["settings.yaml", 'type "Big Bet", id: "Big Bet" must be lowercase letters, digits, dashes or underscores', "lossy"]]],
  ["title that YAML reads as true or false", { "settings.yaml": settings({ title: "True" }) }, [["settings.yaml", 'title: YAML reads True as true or false, not text; put it in quotes: title: "True"', "lossy"]]],
  // departments
  ["a department id that doesn't match the file name", { "departments/ops.yaml": dept({ id: "operations", code: "OP", lanes: "[{id: o1}]" }) }, [["departments/ops.yaml", "id: \"operations\" doesn't match the file name \"ops\", so this file is skipped", "lossy"]]],
  ["a department id that isn't valid", { "departments/Ops.yaml": dept({ id: "Ops", code: "OP", lanes: "[{id: o1}]" }) }, [["departments/Ops.yaml", 'id: "Ops" must be lowercase letters, digits, dashes or underscores', "lossy"]]],
  ["a department without a name", { "departments/ops.yaml": dept({ id: "ops", code: "OP", name: null, lanes: "[{id: o1}]" }) }, [["departments/ops.yaml", "name: required text is missing", "lossy"]]],
  ["a department without a code", { "departments/eng.yaml": dept({ code: null }) }, [["departments/eng.yaml", "code: required text is missing"]]],
  ["a malformed department code", { "departments/eng.yaml": dept({ code: "e" }) }, [["departments/eng.yaml", 'code: "e" must be 2–4 capital letters or digits, starting with a letter']]],
  ["a department code used twice", { "departments/ops.yaml": dept({ id: "ops", name: "Ops", lanes: "[{id: o1}]" }) }, [["departments/eng.yaml", 'code: "EN" is also used by department "ops"'], ["departments/ops.yaml", 'code: "EN" is also used by department "eng"']]],
  ["a department order that isn't a number", { "departments/eng.yaml": dept({ order: "first" }) }, [["departments/eng.yaml", "order: expected a number", "lossy"]]],
  ["collapsed that isn't true or false", { "departments/eng.yaml": dept({ collapsed: "yes" }) }, [["departments/eng.yaml", "collapsed: expected true or false", "lossy"]]],
  ["a malformed lane date", { "departments/eng.yaml": dept({ lanes: "[{id: e1, start: 2026-13-01}, {id: e2}]" }) }, [["departments/eng.yaml", 'lane "e1", start: "2026-13-01" is not a valid YYYY-MM-DD date', "lossy"]]],
  ["a lane date on a weekend", { "departments/eng.yaml": dept({ lanes: "[{id: e1, end: 2026-01-31}, {id: e2}]" }) }, [["departments/eng.yaml", 'lane "e1", end: Saturday — roadmap dates must be weekdays']]],
  ["a lane end before its start", { "departments/eng.yaml": dept({ lanes: "[{id: e1, start: 2026-02-02, end: 2026-01-30}, {id: e2}]" }) }, [["departments/eng.yaml", 'lane "e1", end is before start, so the end is left out', "lossy"]]],
  ["a lane that isn't a mapping", { "departments/eng.yaml": dept({ lanes: "[{id: e1}, e2]" }) }, [["departments/eng.yaml", "lane 2: expected a mapping", "lossy"]]],
  ["a lane id used twice in a department", { "departments/eng.yaml": dept({ lanes: "[{id: e1}, {id: e1, fte: 0.5}]" }) }, [["departments/eng.yaml", 'lane "e1", id: "e1" appears twice in this department, so the second one is skipped', "lossy"]]],
  ["a lane id used in two departments", { "departments/ops.yaml": dept({ id: "ops", code: "OP", name: "Ops", lanes: "[{id: e2}]" }) }, [["departments/ops.yaml", "lane \"e2\" is already used in department \"eng\", so it's left out here", "lossy"], ["departments/eng.yaml", 'lane "e2" is also used in department "ops"']]],
  // boxes
  ["a box without a title", { "boxes/b1.yaml": box({ title: null }) }, [["boxes/b1.yaml", "title: required text is missing", "lossy"]]],
  ["a box id that doesn't match the file name", { "boxes/b1.yaml": box({ id: "b9" }) }, [["boxes/b1.yaml", "id: \"b9\" doesn't match the file name \"b1\", so this file is skipped", "lossy"]]],
  ["a box id used twice (.yaml and .yml)", { "boxes/b1.yml": box({ code: "B3X" }) }, [["boxes/b1.yml", 'id: "b1" is already used by boxes/b1.yaml, so this file is skipped', "lossy"]]],
  ["a malformed box code", { "boxes/b1.yaml": box({ code: "B1" }) }, [["boxes/b1.yaml", 'code: "B1" must be exactly 3 capital letters or digits', "lossy"]]],
  ["a box code YAML reads as a number", { "boxes/b1.yaml": box({ code: "2E5" }) }, [["boxes/b1.yaml", 'code: YAML reads 2E5 as a number, not text; put it in quotes: code: "2E5"', "lossy"]]],
  ["a box code used twice", { "boxes/b2.yaml": box({ id: "b2" }) }, [["boxes/b1.yaml", 'code: "B1X" is also used by b2'], ["boxes/b2.yaml", 'code: "B1X" is also used by b1']]],
  ["a malformed box date", { "boxes/b1.yaml": box({ start: "2026-02-30" }) }, [["boxes/b1.yaml", 'start: "2026-02-30" is not a valid YYYY-MM-DD date', "lossy"]]],
  ["a box date on a weekend", { "boxes/b1.yaml": box({ start: "2026-01-03", end: "2026-01-04" }) }, [["boxes/b1.yaml", "start: Saturday — roadmap dates must be weekdays"], ["boxes/b1.yaml", "end: Sunday — roadmap dates must be weekdays"]]],
  ["a box end before its start", { "boxes/b1.yaml": box({ end: "2026-01-02" }) }, [["boxes/b1.yaml", "end (2026-01-02) is before start (2026-01-05)", "lossy"]]],
  ["a box in a lane that doesn't exist", { "boxes/b1.yaml": box({ lane: "nope" }) }, [["boxes/b1.yaml", 'lane: "nope" does not exist in any department, so the box is skipped', "lossy"]]],
  ["a box type that isn't in settings", { "boxes/b1.yaml": box({ type: "spike" }) }, [["boxes/b1.yaml", 'type: "spike" is not defined in settings.yaml']]],
  ["a box status that isn't in settings", { "boxes/b1.yaml": box({ status: "done" }) }, [["boxes/b1.yaml", 'status: "done" is not defined in settings.yaml']]],
  ["a box fte other than 0.5, 1, 1.5 or 2", { "boxes/b1.yaml": box({ fte: "3" }) }, [["boxes/b1.yaml", "fte: expected one of 0.5, 1, 1.5, 2", "lossy"]]],
  ["engineers who aren't in people.yaml", { "boxes/b1.yaml": box({ engineers: "[ghost]" }) }, [["boxes/b1.yaml", 'engineers: "ghost" is not in people.yaml']]],
  ["an engineer id YAML reads as a number", { "boxes/b1.yaml": box({ engineers: "[1042]" }) }, [["boxes/b1.yaml", 'engineers: YAML reads 1042 as a number, not text; put it in quotes: "1042"', "lossy"]]],
  ["a rule with an unknown type", { "boxes/b1.yaml": box({ relations: "[{type: soon, box: B2X}]" }) }, [["boxes/b1.yaml", 'rule "soon B2X", type: "soon" must be one of before, after, during, starts_with, ends_with, overlaps, apart', "lossy"]]],
  ["a rule whose box isn't a code", { "boxes/b1.yaml": box({ relations: "[{type: before, box: second}]" }) }, [["boxes/b1.yaml", "rule \"before second\", box: \"second\" isn't a box code", "lossy"]]],
  ["a rule pointing at a code no box has", { "boxes/b1.yaml": box({ relations: "[{type: before, box: ZZZ}]" }) }, [["boxes/b1.yaml", 'relations: no box has code "ZZZ"']]],
  ["a rule pointing at its own box", { "boxes/b1.yaml": box({ relations: "[{type: before, box: EN-B1X}]" }) }, [["boxes/b1.yaml", "relations: a box can't have a rule about itself"]]],
  ["tags that aren't a list", { "boxes/b1.yaml": box({ tags: "cost" }) }, [["boxes/b1.yaml", "tags: expected a list of text", "lossy"]]],
  ["a title YAML reads as a number", { "boxes/b1.yaml": box({ title: "1.10" }) }, [["boxes/b1.yaml", 'title: YAML reads 1.10 as a number, not text; put it in quotes: title: "1.10"', "lossy"]]],
  ["a description that is a mapping", { "boxes/b1.yaml": box({ description: "{a: b}" }) }, [["boxes/b1.yaml", "description: expected text, not a mapping", "lossy"]]],
  // people.yaml
  ["people that aren't a list", { "people.yaml": "people: sam\n" }, [["people.yaml", "people: expected a list", "lossy"]]],
  ["a person without an id", { "people.yaml": people("[{name: Sam}]") }, [["people.yaml", "person 1, id: required text is missing", "lossy"]]],
  ["a person id used twice", { "people.yaml": people("[{id: sam, name: Sam}, {id: sam, name: Sam Two}]") }, [["people.yaml", 'person "sam", id: "sam" appears twice, so the second entry is skipped', "lossy"]]],
  ["a person's department that doesn't exist", { "people.yaml": people("[{id: sam, name: Sam, department: ops}]") }, [["people.yaml", 'person "sam", department: "ops" does not exist']]],
  ["an invalid email", { "people.yaml": people("[{id: sam, name: Sam, email: sam.example.com}]") }, [["people.yaml", "person \"sam\", email: \"sam.example.com\" doesn't look like an email address"]]],
  ["a person id YAML reads as a number", { "people.yaml": people("[{id: 1042, name: Sam}]"), "boxes/b1.yaml": box() }, [["people.yaml", 'person "1042", id: YAML reads 1042 as a number, not text; put it in quotes: id: "1042"', "lossy"]]],
  ["PTO with a malformed date", { "people.yaml": people("[{id: sam, name: Sam, pto: [{start: 2026-12-14, end: 2026-12-32}]}]") }, [["people.yaml", 'person "sam", PTO "2026-12-14", end: "2026-12-32" is not a valid YYYY-MM-DD date', "lossy"]]],
  ["PTO on a weekend", { "people.yaml": people("[{id: sam, name: Sam, pto: [{start: 2026-12-12, end: 2026-12-14}]}]") }, [["people.yaml", 'person "sam", PTO "2026-12-12", start: Saturday — roadmap dates must be weekdays']]],
  ["PTO ending before it starts", { "people.yaml": people("[{id: sam, name: Sam, pto: [{start: 2026-12-14, end: 2026-12-11}]}]") }, [["people.yaml", 'person "sam", PTO "2026-12-14", end (2026-12-11) is before start (2026-12-14)', "lossy"]]],
  ["dates under a %YAML 1.1 header, which reads them as timestamps", { "people.yaml": "%YAML 1.1\n---\n" + people("[{id: sam, name: Sam, pto: [{start: 2026-12-14, end: 2026-12-18}]}]") }, [["people.yaml", 'person "sam", PTO 1, start: YAML reads 2026-12-14 as a date, not text; put it in quotes: start: "2026-12-14"', "lossy"], ["people.yaml", 'person "sam", PTO 1, end: YAML reads 2026-12-18 as a date, not text; put it in quotes: end: "2026-12-18"', "lossy"]]],
  ["PTO that isn't a list", { "people.yaml": people("[{id: sam, name: Sam, pto: 2026-12-14}]") }, [["people.yaml", 'person "sam", pto: expected a list', "lossy"]]],
  // An empty string, an empty list or a key with nothing after it means the field isn't set.
  ["empty optional fields", { "boxes/b1.yaml": box({ status: '""', epic: '""', engineers: "[]", fte: '""', relations: "" }), "departments/eng.yaml": dept({ color: '""', order: "", collapsed: "" }), "people.yaml": people('[{id: sam, name: Sam, department: "", email: "", pto: []}]') }, []],
  ["an empty roster", { "people.yaml": "# Nobody yet.\npeople:\n" }, []],
  ["an empty file", { "people.yaml": "" }, []],
];

describe("what the validator checks", () => {
  it("a valid roadmap has no problems", () => {
    expect(load({}).issues).toEqual([]);
  });

  it.each(ROWS)("%s", (_, files, expected) => {
    const { issues, lossy } = load(files);
    expect(issues.map((i) => [i.path, i.message, ...(i.lossy ? ["lossy"] : [])])).toEqual(expected);
    expect([...lossy.keys()]).toEqual([...new Set(expected.filter((e) => e[2]).map((e) => e[0]))]);
  });
});

describe("what the loader makes of it", () => {
  it("drops invalid values (the file is then lossy) and treats empty ones as not set", () => {
    const { roadmap } = load({
      "settings.yaml": settings({ title: '""' }),
      "departments/eng.yaml": dept({ color: '""', lanes: '[{id: e1, name: ""}]' }),
      "boxes/b1.yaml": box({ fte: "3", status: '""' }),
      "people.yaml": "people:\n",
    });
    expect(roadmap.settings.title).toBe("Roadmap");
    expect(roadmap.departments[0].color).toBe("#8a94a6");
    expect(roadmap.departments[0].lanes).toEqual([{ id: "e1", name: undefined, fte: 1 }]);
    const b1 = roadmap.boxes.find((b) => b.id === "b1")!;
    expect([b1.fte, b1.status]).toEqual([1, undefined]);
    expect(roadmap.people).toEqual([]);
  });

  it("keeps quoted values that look like numbers as they are", () => {
    const { roadmap, issues } = load({ "boxes/b1.yaml": box({ code: '"234"', title: '"1.10"', engineers: '["1042"]' }), "people.yaml": people('[{id: "1042", name: Sam}]') });
    expect(issues).toEqual([]);
    const b1 = roadmap.boxes.find((b) => b.id === "b1")!;
    expect([b1.code, b1.title, b1.engineers]).toEqual(["234", "1.10", ["1042"]]);
  });

  it("gives problems a line number", () => {
    const { issues } = load({ "people.yaml": "people:\n  - id: sam\n    name: Sam\n    email: nope\n" });
    expect(issues.map((i) => [i.message, i.line])).toEqual([['person "sam", email: "nope" doesn\'t look like an email address', 4]]);
  });
});

describe("copied files", () => {
  // Someone copies a file to start a new one and forgets to change its id.
  for (const copy of ["boxes/a-copy.yaml", "boxes/z-copy.yaml"]) {
    it(`a box copied to ${copy} never stands in for the original`, () => {
      const { roadmap, issues, lossy, sources } = load({ [copy]: box({ title: "Copy", code: "C0P" }) });
      expect(roadmap.boxes.find((b) => b.id === "b1")!.title).toBe("One");
      expect(sources.boxes.get("b1")).toBe("boxes/b1.yaml");
      const name = copy.slice(6, -5);
      expect(issues.map((i) => [i.path, i.message])).toEqual([[copy, `id: "b1" doesn't match the file name "${name}", so this file is skipped`]]);
      expect([...lossy.keys()]).toEqual([copy]);
    });
  }
  for (const copy of ["departments/a-copy.yaml", "departments/z-copy.yaml"]) {
    it(`a department copied to ${copy} never stands in for the original`, () => {
      const { roadmap, issues, lossy, sources } = load({ [copy]: dept({ name: "Copy", lanes: "[{id: c1}]" }) });
      expect(roadmap.departments.map((d) => [d.id, d.name, d.lanes.length])).toEqual([["eng", "Eng", 2]]);
      expect(sources.departments.get("eng")).toBe("departments/eng.yaml");
      expect(issues.map((i) => i.path)).toEqual([copy]);
      expect([...lossy.keys()]).toEqual([copy]);
    });
  }
});

describe("issue keys", () => {
  it("stay the same when an entry before the problem is removed or added", () => {
    const keys = (list: string) => load({ "people.yaml": people(list) }).issues.map((i) => i.key);
    const bad = "{id: kim, name: Kim, email: nope}";
    const before = keys(`[{id: sam, name: Sam}, ${bad}]`);
    expect(before).toHaveLength(1);
    expect(keys(`[${bad}]`)).toEqual(before);
    expect(keys(`[{id: ana, name: Ana}, {id: sam, name: Sam}, ${bad}]`)).toEqual(before);
    expect(keys(`[{id: sam, name: Sam}, {id: kim, name: Kim, email: "kim@"}]`)).not.toEqual(before);
  });
});

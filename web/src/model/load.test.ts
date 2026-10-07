// One row per rule in templates/guide/format.md "What the validator checks" (and the
// edge cases around them): a file as written → the exact problems reported,
// and whether the file becomes lossy (left partly out, so the app won't write it).

import { describe, expect, it } from "vitest";
import { loadRoadmap } from "./parse";
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
  ["settings.yaml missing", { "settings.yaml": null }, [["settings.yaml", 'missing: every roadmap needs a settings.yaml with at least "format: 1"']]],
  ["format missing", { "settings.yaml": settings({ format: null }) }, [["settings.yaml", 'format: missing; add "format: 1" at the top of this file']]],
  ["format newer than this BoxOps reads", { "settings.yaml": settings({ format: "2" }) }, [["settings.yaml", "format: 2 needs a newer BoxOps (this one reads format 1)"]]],
  ["format not a whole number", { "settings.yaml": settings({ format: '"1"' }) }, [["settings.yaml", 'format: expected a whole number, like "format: 1"']]],
  ["format 0 or below", { "settings.yaml": settings({ format: "0" }) }, [["settings.yaml", "format: 0 isn’t supported; this BoxOps reads format 1"]]],
  ["fiscal_year_start_month outside 1-12", { "settings.yaml": settings({ fiscal_year_start_month: "13" }) }, [["settings.yaml", "fiscal_year_start_month: expected a month number from 1 to 12", "lossy"]]],
  ["default_zoom not weeks, months or quarters", { "settings.yaml": settings({ default_zoom: "days" }) }, [["settings.yaml", "default_zoom: expected one of weeks, months, quarters", "lossy"]]],
  ["a type without a colour", { "settings.yaml": settings({ types: "[{id: project, name: Project}]" }) }, [["settings.yaml", 'type "project", color: required text is missing', "lossy"]]],
  ["a type colour that is a CSS name", { "settings.yaml": settings({ types: "[{id: project, name: Project, color: red}]" }) }, [["settings.yaml", 'type "project", color: "red" must be a hex colour like "#4f7cff"', "lossy"]]],
  ["a type colour in short hex", { "settings.yaml": settings({ types: '[{id: project, name: Project, color: "#abc"}]' }) }, [["settings.yaml", 'type "project", color: "#abc" must be a hex colour like "#4f7cff"', "lossy"]]],
  ["a type colour that is a url()", { "settings.yaml": settings({ types: '[{id: project, name: Project, color: "url(https://x.example/p.png)"}]' }) }, [["settings.yaml", 'type "project", color: "url(https://x.example/p.png)" must be a hex colour like "#4f7cff"', "lossy"]]],
  ["a type id used twice", { "settings.yaml": settings({ types: '[{id: project, name: Project, color: "#4f7cff"}, {id: project, name: Other, color: "#8a94a6"}]' }) }, [["settings.yaml", 'type "project", id: "project" appears twice, so the second one is skipped', "lossy"]]],
  ["a flag without a name", { "settings.yaml": settings({ statuses: "[{id: late}]" }) }, [["settings.yaml", 'flag "late", name: required text is missing', "lossy"]]],
  ["a flag id used twice", { "settings.yaml": settings({ statuses: "[{id: late, name: Late}, {id: late, name: Later}]" }) }, [["settings.yaml", 'flag "late", id: "late" appears twice, so the second one is skipped', "lossy"]]],
  ["types that aren't a list", { "settings.yaml": settings({ types: "project" }) }, [["settings.yaml", "types: expected a list", "lossy"]]],
  ["a type id that isn't valid", { "settings.yaml": settings({ types: '[{id: project, name: Project, color: "#4f7cff"}, {id: Big Bet, name: Big bet, color: "#8a94a6"}]' }) }, [["settings.yaml", 'type "Big Bet", id: "Big Bet" must be lowercase letters, digits, dashes or underscores', "lossy"]]],
  ["title that YAML reads as true or false", { "settings.yaml": settings({ title: "True" }) }, [["settings.yaml", 'title: YAML reads True as true or false, not text; put it in quotes: title: "True"', "lossy"]]],
  // departments
  ["a department id that doesn’t match the file name", { "departments/ops.yaml": dept({ id: "operations", code: "OP", lanes: "[{id: o1}]" }) }, [["departments/ops.yaml", "id: \"operations\" doesn’t match the file name \"ops\", so this file is skipped", "lossy"]]],
  ["a department id that isn't valid", { "departments/Ops.yaml": dept({ id: "Ops", code: "OP", lanes: "[{id: o1}]" }) }, [["departments/Ops.yaml", 'id: "Ops" must be lowercase letters, digits, dashes or underscores', "lossy"]]],
  ["a department without a name", { "departments/ops.yaml": dept({ id: "ops", code: "OP", name: null, lanes: "[{id: o1}]" }) }, [["departments/ops.yaml", "name: required text is missing", "lossy"]]],
  ["a department without a code", { "departments/eng.yaml": dept({ code: null }) }, [["departments/eng.yaml", "code: required text is missing"]]],
  ["a malformed department code", { "departments/eng.yaml": dept({ code: "e" }) }, [["departments/eng.yaml", 'code: "e" must be 2–4 capital letters or digits, starting with a letter']]],
  ["a department id used twice (.yaml and .yml)", { "departments/eng.yml": dept({ name: "Copy", lanes: "[{id: c1}]" }) }, [["departments/eng.yml", 'id: "eng" is already used by departments/eng.yaml, so this file is skipped', "lossy"]]],
  ["a department code used twice", { "departments/ops.yaml": dept({ id: "ops", name: "Ops", lanes: "[{id: o1}]" }) }, [["departments/eng.yaml", 'code: "EN" is also used by department "ops"'], ["departments/ops.yaml", 'code: "EN" is also used by department "eng"']]],
  ["a department colour that isn't #rrggbb", { "departments/eng.yaml": dept({ color: "blue" }) }, [["departments/eng.yaml", 'color: "blue" must be a hex colour like "#4f7cff"', "lossy"]]],
  ["a department order that isn't a number", { "departments/eng.yaml": dept({ order: "first" }) }, [["departments/eng.yaml", "order: expected a number", "lossy"]]],
  ["collapsed that isn't true or false", { "departments/eng.yaml": dept({ collapsed: "yes" }) }, [["departments/eng.yaml", "collapsed: expected true or false", "lossy"]]],
  ["a lane fte other than 0.5 or 1", { "departments/eng.yaml": dept({ lanes: "[{id: e1, fte: 0.75}, {id: e2, fte: 2}]" }) }, [["departments/eng.yaml", 'lane "e1", fte: expected 0.5 or 1', "lossy"], ["departments/eng.yaml", 'lane "e2", fte: expected 0.5 or 1', "lossy"]]],
  ["a malformed lane date", { "departments/eng.yaml": dept({ lanes: "[{id: e1, start: 2026-13-01}, {id: e2}]" }) }, [["departments/eng.yaml", 'lane "e1", start: "2026-13-01" is not a valid YYYY-MM-DD date', "lossy"]]],
  ["a lane date on a weekend", { "departments/eng.yaml": dept({ lanes: "[{id: e1, end: 2026-01-31}, {id: e2}]" }) }, [["departments/eng.yaml", 'lane "e1", end: Saturday — roadmap dates must be weekdays']]],
  ["a lane end before its start", { "departments/eng.yaml": dept({ lanes: "[{id: e1, start: 2026-02-02, end: 2026-01-30}, {id: e2}]" }) }, [["departments/eng.yaml", 'lane "e1", end is before start, so the end is left out', "lossy"]]],
  ["a lane id that isn't valid", { "departments/eng.yaml": dept({ lanes: "[{id: e1}, {id: e2}, {id: Big Lane}]" }) }, [["departments/eng.yaml", 'lane "Big Lane", id: "Big Lane" must be lowercase letters, digits, dashes or underscores', "lossy"]]],
  ["a lane without an id", { "departments/eng.yaml": dept({ lanes: "[{id: e1}, {id: e2}, {name: Spare}]" }) }, [["departments/eng.yaml", "lane 3, id: required text is missing", "lossy"]]],
  ["a lane that isn't a mapping", { "departments/eng.yaml": dept({ lanes: "[{id: e1}, e2]" }) }, [["departments/eng.yaml", "lane 2: expected a mapping", "lossy"]]],
  ["a lane id used twice in a department", { "departments/eng.yaml": dept({ lanes: "[{id: e1}, {id: e1, fte: 0.5}]" }) }, [["departments/eng.yaml", 'lane "e1", id: "e1" appears twice in this department, so the second one is skipped', "lossy"]]],
  ["a lane id used in two departments", { "departments/ops.yaml": dept({ id: "ops", code: "OP", name: "Ops", lanes: "[{id: e2}]" }) }, [["departments/ops.yaml", "lane \"e2\" is already used in department \"eng\", so it’s left out here", "lossy"], ["departments/eng.yaml", 'lane "e2" is also used in department "ops"']]],
  ["a file name Windows reserves", { "departments/aux.yaml": dept({ id: "aux", code: "AX", name: "Aux", lanes: "[{id: x1}]" }) }, [["departments/aux.yaml", "id: \"aux\" can’t be a file name on Windows, so the repo can’t be checked out there"]]],
  // boxes
  ["a box without a title", { "boxes/b1.yaml": box({ title: null }) }, [["boxes/b1.yaml", "title: required text is missing", "lossy"]]],
  ["a box id that doesn’t match the file name", { "boxes/b1.yaml": box({ id: "b9" }) }, [["boxes/b1.yaml", "id: \"b9\" doesn’t match the file name \"b1\", so this file is skipped", "lossy"]]],
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
  ["an engineer listed twice", { "boxes/b1.yaml": box({ engineers: "[sam, sam]" }) }, [["boxes/b1.yaml", 'engineers: "sam" is listed twice']]],
  ["an engineer id YAML reads as a number", { "boxes/b1.yaml": box({ engineers: "[1042]" }) }, [["boxes/b1.yaml", 'engineers: YAML reads 1042 as a number, not text; put it in quotes: "1042"', "lossy"]]],
  ["a rule with an unknown type", { "boxes/b1.yaml": box({ relations: "[{type: soon, box: B2X}]" }) }, [["boxes/b1.yaml", 'rule "soon B2X", type: "soon" must be one of before, after, during, starts_with, ends_with, overlaps, apart', "lossy"]]],
  ["a rule whose box isn't a code", { "boxes/b1.yaml": box({ relations: "[{type: before, box: second}]" }) }, [["boxes/b1.yaml", "rule \"before second\", box: \"second\" isn’t a box code", "lossy"]]],
  ["a rule pointing at a code no box has", { "boxes/b1.yaml": box({ relations: "[{type: before, box: ZZZ}]" }) }, [["boxes/b1.yaml", 'relations: no box has code "ZZZ"']]],
  ["a rule pointing at its own box", { "boxes/b1.yaml": box({ relations: "[{type: before, box: EN-B1X}]" }) }, [["boxes/b1.yaml", "relations: a box can’t have a rule about itself"]]],
  ["the same rule twice", { "boxes/b1.yaml": box({ relations: "[{type: before, box: B2X}, {type: before, box: EN-B2X}]" }) }, [["boxes/b1.yaml", 'rule "before EN-B2X": the same rule is listed twice']]],
  ["an epic that isn’t an http(s) link", { "boxes/b1.yaml": box({ epic: "jira.example.com/browse/X-1" }) }, [["boxes/b1.yaml", "epic: \"jira.example.com/browse/X-1\" isn’t an http(s) link", "lossy"]]],
  ["a link that isn’t an http(s) link", { "boxes/b1.yaml": box({ links: '[https://example.com, "javascript:alert(1)"]' }) }, [["boxes/b1.yaml", "links: \"javascript:alert(1)\" isn’t an http(s) link", "lossy"]]],
  ["tags that aren't a list", { "boxes/b1.yaml": box({ tags: "cost" }) }, [["boxes/b1.yaml", "tags: expected a list of text", "lossy"]]],
  ["a title YAML reads as a number", { "boxes/b1.yaml": box({ title: "1.10" }) }, [["boxes/b1.yaml", 'title: YAML reads 1.10 as a number, not text; put it in quotes: title: "1.10"', "lossy"]]],
  ["a description that is a mapping", { "boxes/b1.yaml": box({ description: "{a: b}" }) }, [["boxes/b1.yaml", "description: expected text, not a mapping", "lossy"]]],
  // people.yaml
  ["people that aren't a list", { "people.yaml": "people: sam\n" }, [["people.yaml", "people: expected a list", "lossy"]]],
  ["a person without an id", { "people.yaml": people("[{name: Sam}]") }, [["people.yaml", "person 1, id: required text is missing", "lossy"]]],
  ["a person id that isn't valid", { "people.yaml": people("[{id: Sam Lee, name: Sam}]") }, [["people.yaml", 'person "Sam Lee", id: "Sam Lee" must be lowercase letters, digits, dashes or underscores', "lossy"]]],
  ["a person id used twice", { "people.yaml": people("[{id: sam, name: Sam}, {id: sam, name: Sam Two}]") }, [["people.yaml", 'person "sam", id: "sam" appears twice, so the second entry is skipped', "lossy"]]],
  ["a person's department that doesn't exist", { "people.yaml": people("[{id: sam, name: Sam, department: ops}]") }, [["people.yaml", 'person "sam", department: "ops" does not exist']]],
  ["an invalid email", { "people.yaml": people("[{id: sam, name: Sam, email: sam.example.com}]") }, [["people.yaml", "person \"sam\", email: \"sam.example.com\" doesn’t look like an email address"]]],
  ["a person id YAML reads as a number", { "people.yaml": people("[{id: 1042, name: Sam}]"), "boxes/b1.yaml": box() }, [["people.yaml", 'person "1042", id: YAML reads 1042 as a number, not text; put it in quotes: id: "1042"', "lossy"]]],
  ["PTO without a start", { "people.yaml": people("[{id: sam, name: Sam, pto: [{end: 2026-12-18}]}]") }, [["people.yaml", 'person "sam", PTO 1, start: required text is missing', "lossy"]]],
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
      "settings.yaml": settings({ title: '""', types: "[{id: project, name: Project, color: red}]" }),
      "departments/eng.yaml": dept({ color: '""', lanes: '[{id: e1, fte: 0.75, name: ""}]' }),
      "boxes/b1.yaml": box({ fte: "3", status: '""', epic: "ftp://example.com/x", links: "[https://example.com, javascript:void(0)]" }),
      "people.yaml": "people:\n",
    });
    expect(roadmap.settings.title).toBe("Roadmap");
    expect(roadmap.settings.types).toEqual([{ id: "project", name: "Project", color: "#8a94a6" }]);
    expect(roadmap.departments[0].color).toBe("#8a94a6");
    expect(roadmap.departments[0].lanes).toEqual([{ id: "e1", name: undefined, fte: 1 }]);
    const b1 = roadmap.boxes.find((b) => b.id === "b1")!;
    expect([b1.fte, b1.status, b1.epic, b1.links]).toEqual([1, undefined, undefined, ["https://example.com"]]);
    expect(roadmap.people).toEqual([]);
  });

  it("keeps quoted values that look like numbers as they are", () => {
    const { roadmap, issues } = load({ "boxes/b1.yaml": box({ code: '"234"', title: '"1.10"', engineers: '["1042"]' }), "people.yaml": people('[{id: "1042", name: Sam}]') });
    expect(issues).toEqual([]);
    const b1 = roadmap.boxes.find((b) => b.id === "b1")!;
    expect([b1.code, b1.title, b1.engineers]).toEqual(["234", "1.10", ["1042"]]);
  });

  it("says when YAML read a word as null, and how to quote it", () => {
    const { issues } = load({ "boxes/b1.yaml": box({ title: "Null" }), "people.yaml": people("[{id: sam, name: ~}]") });
    expect(issues.map((i) => i.message)).toEqual([
      'person "sam", name: YAML reads ~ as empty (null), not text; put it in quotes: name: "~"',
      'title: YAML reads Null as empty (null), not text; put it in quotes: title: "Null"',
    ]);
    // Nothing after the key is still just missing.
    expect(load({ "boxes/b1.yaml": box({ title: "" }) }).issues.map((i) => i.message)).toEqual(["title: required text is missing"]);
  });

  it("gives problems a line number", () => {
    const { issues } = load({ "people.yaml": "people:\n  - id: sam\n    name: Sam\n    email: nope\n" });
    expect(issues.map((i) => [i.message, i.line])).toEqual([['person "sam", email: "nope" doesn’t look like an email address', 4]]);
  });
});

describe("data format", () => {
  const status = (over: Record<string, string | null>) => {
    const { roadmap, formatStatus } = load(over);
    return [roadmap.format, formatStatus];
  };

  it("is read from settings.yaml: missing means 0, a newer one is reported", () => {
    expect(status({})).toEqual([1, "current"]);
    expect(status({ "settings.yaml": settings({ format: null }) })).toEqual([0, "older"]);
    expect(status({ "settings.yaml": null })).toEqual([0, "older"]);
    expect(status({ "settings.yaml": settings({ format: "2" }) })).toEqual([2, "newer"]);
    expect(status({ "settings.yaml": settings({ format: "one" }) })).toEqual([null, "unknown"]);
    expect(status({ "settings.yaml": settings({ format: "0" }) })).toEqual([null, "unknown"]);
    expect(status({ "settings.yaml": settings({ format: "-1" }) })).toEqual([null, "unknown"]);
    expect(status({ "settings.yaml": "format: [1\n" })).toEqual([null, "unknown"]);
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
      expect(issues.map((i) => [i.path, i.message])).toEqual([[copy, `id: "b1" doesn’t match the file name "${name}", so this file is skipped`]]);
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

  it("of a code three boxes share stay the same when one of them is deleted", () => {
    const shared = { "boxes/b2.yaml": box({ id: "b2" }), "boxes/b3.yaml": box({ id: "b3" }) };
    const keys = (files: Record<string, string | null>) => load(files).issues.map((i) => i.key);
    const all = keys(shared);
    expect(all).toHaveLength(3);
    expect(all).toEqual(expect.arrayContaining(keys({ ...shared, "boxes/b1.yaml": null })));
  });
});

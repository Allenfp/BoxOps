import { describe, expect, it } from "vitest";
import type { Box, Department, Person } from "../model/types";
import { keepPlace, peopleRows, tableRows, twoLines } from "./tableModel";

const dept = (id: string): Department => ({ id, code: id.toUpperCase(), name: id, color: "#4f7cff", order: 1, collapsed: false, lanes: [{ id: `${id}-1`, fte: 1 }] });
const box = (code: string): Box => ({ id: code, code, title: code, lane: "l", start: 0, end: 0, type: "t", fte: 1 });
const person: Person = { id: "sam", name: "Sam Lee", department: "de" };
const entry = { person, index: 0, pto: { start: 0, end: 4 } };
const [de, an, ml] = [dept("de"), dept("an"), dept("ml")];

describe("tableRows", () => {
  const boxes = new Map([
    ["de", [box("A1F"), box("K7P")].map((b) => ({ box: b, key: `b:${b.code}`, held: false }))],
    ["an", []],
    ["ml", [{ box: box("Q2R"), key: "b:Q2R", held: false }]],
  ]);
  const pto = new Map([["de", [{ entry, key: "p1", held: false }]]]);
  const rows = (o: Partial<Parameters<typeof tableRows>[0]> = {}) =>
    tableRows({ departments: [de, an, ml], boxes, pto, collapsed: new Set(), searching: false, addPto: (d) => d.id === "de", addDepartment: true, ...o });

  it("lists each department's heading, boxes (or that it has none), PTO and Add PTO, then Add department", () => {
    const r = rows();
    expect(r.keys).toEqual(["g:de", "b:A1F", "b:K7P", "p1", "a:de", "g:an", "e:an", "g:ml", "b:Q2R", "add-dept"]);
    expect(r.kinds).toEqual(["group", "box", "box", "pto", "add-pto", "group", "empty", "group", "box", "add-dept"]);
    // A <tbody> each: its rows' indexes.
    expect(r.groups).toEqual([
      { id: "de", start: 0, end: 5 },
      { id: "an", start: 5, end: 7 },
      { id: "ml", start: 7, end: 9 },
      { id: "add-dept", start: 9, end: 10 },
    ]);
  });

  it("a collapsed department is its heading alone, unless searching opens it", () => {
    expect(rows({ collapsed: new Set(["de"]) }).keys.slice(0, 3)).toEqual(["g:de", "g:an", "e:an"]);
    expect(rows({ collapsed: new Set(["de"]), searching: true }).keys.slice(0, 4)).toEqual(["g:de", "b:A1F", "b:K7P", "p1"]);
  });

  it("searching leaves out departments with nothing that matches, Add PTO and Add department", () => {
    expect(rows({ searching: true }).keys).toEqual(["g:de", "b:A1F", "b:K7P", "p1", "g:ml", "b:Q2R"]);
    expect(rows({ addDepartment: false }).keys.at(-1)).toBe("b:Q2R");
  });
});

describe("peopleRows", () => {
  const sam = { person, key: "r1", held: false };
  const groups = [
    { id: "de", name: "Data", color: "#000", total: 1, people: [sam] },
    { id: "an", name: "Analytics", color: "#000", total: 0, people: [] },
  ];

  it("lists each department's heading, then its engineers (or that it has none); Add department last", () => {
    const r = peopleRows({ groups, collapsed: new Set(), searching: false, addDepartment: true });
    expect(r.keys).toEqual(["g:de", "r1", "g:an", "e:an", "add-dept"]);
    expect(r.kinds).toEqual(["group", "person", "group", "empty", "add-dept"]);
    expect(r.rows[0]).toMatchObject({ shown: 1, total: 1 });
  });

  it("a person's row takes two lines with notes, or PTO past one entry; one line otherwise", () => {
    const pto = (n: number) => Array.from({ length: n }, (_, i) => ({ start: 100 + i * 10, end: 101 + i * 10 }));
    const people = [
      { ...person, id: "a" },
      { ...person, id: "b", notes: "On call in March" },
      { ...person, id: "c", notes: "  " },
      { ...person, id: "d", pto: pto(1) },
      { ...person, id: "e", pto: pto(2) },
      { ...person, id: "f", pto: pto(3) },
    ];
    expect(people.map(twoLines)).toEqual([false, true, false, false, true, true]);
    const g = [{ id: "de", name: "Data", color: "#000", total: 6, people: people.map((p, i) => ({ person: p, key: `r${i}`, held: false })) }];
    expect(peopleRows({ groups: g, collapsed: new Set(), searching: false, addDepartment: false }).kinds).toEqual([
      "group",
      "person",
      "person-2",
      "person",
      "person",
      "person-2",
      "person-2",
    ]);
  });

  it("a collapsed department is its heading alone; searching shows only departments with matches, open", () => {
    expect(peopleRows({ groups, collapsed: new Set(["de"]), searching: false, addDepartment: false }).keys).toEqual(["g:de", "g:an", "e:an"]);
    expect(peopleRows({ groups, collapsed: new Set(["de"]), searching: true, addDepartment: true }).keys).toEqual(["g:de", "r1"]);
  });
});

describe("keepPlace", () => {
  const id = (s: string) => s;

  it("keeps an item where it was, after the item that came before it then", () => {
    // B was second; an edit sorts it last.
    expect(keepPlace(["A", "C", "D", "B"], id, ["A", "B", "C", "D"], "B")).toEqual(["A", "B", "C", "D"]);
    // First it stays first.
    expect(keepPlace(["B", "C", "A"], id, ["A", "B", "C"], "A")).toEqual(["A", "B", "C"]);
  });

  it("goes after the nearest item before it that's still there", () => {
    expect(keepPlace(["A", "D", "C"], id, ["A", "B", "C", "D"], "C")).toEqual(["A", "C", "D"]);
  });

  it("leaves the order alone with no key, or one that's new to the list or not in it", () => {
    expect(keepPlace(["C", "A", "B"], id, ["A", "B", "C"], null)).toEqual(["C", "A", "B"]);
    expect(keepPlace(["C", "A", "B"], id, ["A", "B"], "C")).toEqual(["C", "A", "B"]);
    expect(keepPlace(["A", "B"], id, ["A", "B", "C"], "C")).toEqual(["A", "B"]);
  });
});

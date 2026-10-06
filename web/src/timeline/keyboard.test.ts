import { describe, expect, it } from "vitest";
import { parseDay } from "../model/dates";
import type { Department } from "../model/types";
import { type NavRow, boxName, laneName, navigate, nearest, ptoName } from "./keyboard";
import { laneSequence } from "./keyMove";

const d = (s: string) => parseDay(s)!;
const label = {};
const at = (start: string, end: string) => ({ start: d(start), end: d(end) });

// Data Engineering as the timeline draws it: a heading, lanes (name and + labels, then boxes in
// time order), an empty lane, the extra area, PTO; then the next department's heading.
const rows: NavRow[] = [
  { heading: true, cells: [label, label] },
  { heading: false, cells: [label, label, at("2026-08-03", "2026-11-27"), at("2026-12-07", "2027-01-15")] },
  { heading: false, cells: [label, label, at("2026-09-14", "2026-10-23"), at("2026-10-26", "2027-02-26")] },
  { heading: false, cells: [label, label, at("2026-05-04", "2026-07-31"), at("2026-09-01", "2026-10-30"), at("2026-11-02", "2026-12-11")] },
  { heading: false, cells: [label, label] },
  { heading: false, cells: [at("2026-10-01", "2026-12-31")] },
  { heading: false, cells: [] },
  { heading: false, cells: [label] },
  { heading: true, cells: [label, label] },
];
const OCT = d("2026-10-15");

describe("navigate", () => {
  it("goes along a row, without wrapping; Home and End to its ends", () => {
    expect(navigate(rows, { row: 2, col: 2 }, "right", OCT)).toEqual({ row: 2, col: 3 });
    expect(navigate(rows, { row: 2, col: 3 }, "right", OCT)).toBeNull();
    expect(navigate(rows, { row: 2, col: 2 }, "left", OCT)).toEqual({ row: 2, col: 1 });
    expect(navigate(rows, { row: 2, col: 0 }, "left", OCT)).toBeNull();
    expect(navigate(rows, { row: 3, col: 3 }, "home", OCT)).toEqual({ row: 3, col: 0 });
    expect(navigate(rows, { row: 3, col: 0 }, "end", OCT)).toEqual({ row: 3, col: 4 });
    expect(navigate(rows, { row: 3, col: 0 }, "home", OCT)).toBeNull();
  });

  it("from the labels into the boxes, lands on the one nearest the day given (what's on screen), not the earliest", () => {
    expect(navigate(rows, { row: 3, col: 1 }, "right", OCT)).toEqual({ row: 3, col: 3 });
    expect(navigate(rows, { row: 3, col: 1 }, "right", d("2026-06-01"))).toEqual({ row: 3, col: 2 });
    // Between boxes: the one less time away.
    expect(navigate(rows, { row: 3, col: 1 }, "right", d("2027-03-01"))).toEqual({ row: 3, col: 4 });
  });

  it("up and down go to the cell nearest in time, skipping rows with nothing to focus", () => {
    expect(navigate(rows, { row: 2, col: 2 }, "up", d("2026-09-14"))).toEqual({ row: 1, col: 2 });
    expect(navigate(rows, { row: 2, col: 2 }, "down", d("2026-09-14"))).toEqual({ row: 3, col: 3 });
    // A row with no boxes: its first cell.
    expect(navigate(rows, { row: 3, col: 3 }, "down", d("2026-09-14"))).toEqual({ row: 4, col: 0 });
    // The extra area's row has only a box; the PTO row (after an empty one) only its +.
    expect(navigate(rows, { row: 4, col: 0 }, "down", OCT)).toEqual({ row: 5, col: 0 });
    expect(navigate(rows, { row: 5, col: 0 }, "down", OCT)).toEqual({ row: 7, col: 0 });
    expect(navigate(rows, { row: 8, col: 0 }, "down", OCT)).toBeNull();
    expect(navigate(rows, { row: 0, col: 0 }, "up", OCT)).toBeNull();
  });

  it("from a label, up and down stay in the label column", () => {
    expect(navigate(rows, { row: 1, col: 1 }, "down", OCT)).toEqual({ row: 2, col: 1 });
    expect(navigate(rows, { row: 0, col: 1 }, "down", OCT)).toEqual({ row: 1, col: 1 });
    expect(navigate(rows, { row: 4, col: 1 }, "down", OCT)).toEqual({ row: 5, col: 0 });
    expect(navigate(rows, { row: 2, col: 1 }, "down", OCT)).toEqual({ row: 3, col: 1 });
    expect(navigate(rows, { row: 7, col: 0 }, "down", OCT)).toEqual({ row: 8, col: 0 });
  });

  it("Page Up and Down go to the department heading above or below; first and last to the grid's ends", () => {
    expect(navigate(rows, { row: 3, col: 2 }, "pageDown", OCT)).toEqual({ row: 8, col: 0 });
    // From inside a department, Page Up goes to its own heading; from there, to the one before.
    expect(navigate(rows, { row: 3, col: 2 }, "pageUp", OCT)).toEqual({ row: 0, col: 0 });
    expect(navigate(rows, { row: 7, col: 0 }, "pageUp", OCT)).toEqual({ row: 0, col: 0 });
    expect(navigate(rows, { row: 8, col: 1 }, "pageUp", OCT)).toEqual({ row: 0, col: 0 });
    expect(navigate(rows, { row: 0, col: 1 }, "pageUp", OCT)).toBeNull();
    expect(navigate(rows, { row: 8, col: 0 }, "pageDown", OCT)).toBeNull();
    expect(navigate(rows, { row: 5, col: 0 }, "first", OCT)).toEqual({ row: 0, col: 0 });
    expect(navigate(rows, { row: 5, col: 0 }, "last", OCT)).toEqual({ row: 8, col: 1 });
    expect(navigate(rows, { row: 8, col: 1 }, "last", OCT)).toBeNull();
  });

  it("nearest prefers a cell the day falls in, then the least time away, then the earlier", () => {
    const cells = [label, at("2026-10-01", "2026-10-09"), at("2026-10-19", "2026-10-23")];
    expect(nearest(cells, d("2026-10-05"))).toBe(1);
    expect(nearest(cells, d("2026-10-13"))).toBe(1);
    expect(nearest(cells, d("2026-10-15"))).toBe(2);
    expect(nearest(cells, d("2026-10-14"))).toBe(1); // 5 days either way
    expect(nearest([label], OCT)).toBe(-1);
  });
});

describe("names", () => {
  it("a box: what, when, how big (its scale too), who, and what needs attention", () => {
    const base = { title: "Dagster 2.x upgrade", code: "DE-D9U", ...at("2026-09-14", "2026-10-23"), fte: 1, scale: 30, engineers: [], rules: 0, clash: false, updated: false };
    expect(boxName(base)).toBe("Dagster 2.x upgrade, DE-D9U, 2026-09-14 to 2026-10-23, 1 FTE, scale 30, no engineer assigned");
    expect(
      boxName({ ...base, title: "", jira: "DATA-42", fte: 1.5, scale: 45, engineers: ["Sam Lee", "Alex Kim"], flag: "At risk", rules: 2, clash: true, updated: true }),
    ).toBe("Untitled, DATA-42 (DE-D9U), 2026-09-14 to 2026-10-23, 1.5 FTE, scale 45, Sam Lee, Alex Kim, At risk, breaks 2 rules, someone else also changed it");
    expect(boxName({ ...base, ...at("2026-10-07", "2026-10-07"), scale: 1, rules: 1, updated: true })).toBe(
      "Dagster 2.x upgrade, DE-D9U, 2026-10-07, 1 FTE, scale 1, no engineer assigned, breaks a rule, changed by someone else",
    );
  });

  it("a PTO block, and a lane", () => {
    expect(ptoName("Sam Lee", { ...at("2026-12-14", "2026-12-25"), note: "Holiday" })).toBe("PTO, Sam Lee, 2026-12-14 to 2026-12-25, 10 working days, Holiday");
    expect(ptoName("Sam Lee", at("2026-12-14", "2026-12-14"))).toBe("PTO, Sam Lee, 2026-12-14, 1 working day");
    const dept: Department = { id: "de", code: "DE", name: "Data Engineering", color: "#000", order: 1, collapsed: false, lanes: [{ id: "de-1", fte: 1 }, { id: "de-2", fte: 0.5, name: "Contractor" }] };
    expect(laneName([dept], "de-1")).toBe("Data Engineering / FTE 1");
    expect(laneName([dept], "de-2")).toBe("Data Engineering / Contractor");
  });
});

describe("laneSequence", () => {
  it("lists the lanes of open departments, top to bottom", () => {
    const dept = (id: string, lanes: string[]): Department => ({ id, code: id.toUpperCase(), name: id, color: "#000", order: 1, collapsed: false, lanes: lanes.map((l) => ({ id: l, fte: 1 })) });
    const all = [dept("a", ["a-1", "a-2"]), dept("b", ["b-1"]), dept("c", []), dept("d", ["d-1"])];
    expect(laneSequence(all, new Set(["b"]))).toEqual([
      { lane: "a-1", dept: "a" },
      { lane: "a-2", dept: "a" },
      { lane: "d-1", dept: "d" },
    ]);
  });
});

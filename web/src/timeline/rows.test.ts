import { describe, expect, it } from "vitest";
import { parseDay } from "../model/dates";
import type { Box, Department, Person } from "../model/types";
import { layoutDepartment } from "./layout";
import { OVERFLOW, boxRows, deptGridRows, drawRange, overlaps } from "./rows";

const d = (s: string) => parseDay(s)!;
const dept: Department = {
  id: "eng",
  code: "EN",
  name: "Eng",
  color: "#000",
  order: 1,
  collapsed: false,
  lanes: [
    { id: "a", fte: 1 },
    { id: "b", fte: 1 },
  ],
};
const box = (id: string, lane: string, start: string, end: string, fte = 1): Box => ({
  id,
  code: id.toUpperCase().padEnd(3, "X").slice(0, 3),
  title: id,
  lane,
  start: d(start),
  end: d(end),
  fte,
  type: "project",
});
const sam: Person = {
  id: "sam",
  name: "Sam Lee",
  department: "eng",
  pto: [
    { start: d("2026-12-14"), end: d("2026-12-25") },
    { start: d("2026-08-03"), end: d("2026-08-07") },
  ],
};
const pto = (sam.pto ?? []).map((p, index) => ({ person: sam, index, pto: p }));

// Two lanes, then a box that fits in neither (the extra area): "late" before "early" in the list.
const boxes = [
  box("late", "a", "2026-11-02", "2026-11-27"),
  box("early", "a", "2026-09-07", "2026-10-02"),
  box("own", "b", "2026-09-07", "2026-11-27"),
  box("over", "a", "2026-09-14", "2026-09-25"),
];
const layout = layoutDepartment(dept, boxes);
const keys = (rows: Map<string, { box: Box }[]>) => Object.fromEntries([...rows].map(([row, list]) => [row, list.map((x) => x.box.id)]));

describe("boxRows", () => {
  it("puts each box in the row of the lane it's drawn in, in time order; one that fits nowhere, in the extra area", () => {
    expect(keys(boxRows(layout, boxes))).toEqual({ a: ["early", "late"], b: ["own"], [OVERFLOW]: ["over"] });
  });

  it("draws a box dragged to another lane in that lane's row, not its own; moved only in time, it stays", () => {
    const late = boxes[0];
    expect(keys(boxRows(layout, boxes, { box: late, lane: "b" }))).toEqual({ a: ["early"], b: ["own", "late"], [OVERFLOW]: ["over"] });
    expect(keys(boxRows(layout, boxes, { box: late, lane: "a" }))).toEqual(keys(boxRows(layout, boxes)));
  });
});

describe("deptGridRows", () => {
  const o = { layout, rows: boxRows(layout, boxes), boxes, collapsed: false, chart: true, editable: true, pto, addPto: true };
  const cells = (rows: ReturnType<typeof deptGridRows>) => rows.map((r) => [r.heading, ...r.cells.map((c) => c.key)]);

  it("is the heading, each lane (name, +, boxes in time order), the extra area and PTO (+, blocks in time order)", () => {
    expect(cells(deptGridRows(dept, o))).toEqual([
      [true, "dept:eng", "dept-edit:eng"],
      [false, "lane:a", "lane-add:a", "box:early", "box:late"],
      [false, "lane:b", "lane-add:b", "box:own"],
      [false, "box:over"],
      [false, "pto-add:eng", "pto:sam#1", "pto:sam#0"],
    ]);
    // Boxes and PTO blocks carry their dates, for up and down.
    const rows = deptGridRows(dept, o);
    expect(rows[1].cells[2]).toEqual({ key: "box:early", start: d("2026-09-07"), end: d("2026-10-02") });
    expect(rows[4].cells[1]).toEqual({ key: "pto:sam#1", start: d("2026-08-03"), end: d("2026-08-07") });
  });

  it("leaves out what isn't there: no ✎, no PTO +, no PTO row, no extra area", () => {
    const fits = boxes.slice(0, 3);
    const l = layoutDepartment(dept, fits);
    const rows = deptGridRows(dept, { ...o, layout: l, rows: boxRows(l, fits), boxes: fits, editable: false, pto: null });
    expect(cells(rows)).toEqual([
      [true, "dept:eng"],
      [false, "lane:a", "lane-add:a", "box:early", "box:late"],
      [false, "lane:b", "lane-add:b", "box:own"],
    ]);
    expect(cells(deptGridRows(dept, { ...o, addPto: false })).at(-1)).toEqual([false, "pto:sam#1", "pto:sam#0"]);
  });

  it("collapsed, is one row: the heading and its chart, or its boxes by start", () => {
    expect(cells(deptGridRows(dept, { ...o, collapsed: true }))).toEqual([[true, "dept:eng", "dept-edit:eng", "chart:eng"]]);
    expect(cells(deptGridRows(dept, { ...o, collapsed: true, chart: false }))).toEqual([
      [true, "dept:eng", "dept-edit:eng", "box:early", "box:own", "box:over", "box:late"],
    ]);
  });
});

describe("drawRange", () => {
  it("covers the screen and at least half of it again on each side", () => {
    for (const [scroll, size] of [[0, 800], [1234, 800], [5000, 1440], [37, 300]]) {
      const [from, to] = drawRange(scroll, size);
      expect(from).toBeLessThanOrEqual(scroll - size / 2);
      expect(to).toBeGreaterThanOrEqual(scroll + size + size / 2);
    }
  });

  it("changes only in steps of half a screen, so a little scrolling draws nothing again", () => {
    expect(drawRange(1000, 800)).toEqual([400, 2400]);
    expect(drawRange(1199, 800)).toEqual([400, 2400]);
    expect(drawRange(1201, 800)).toEqual([800, 2800]);
    expect(drawRange(1201, 800)).toEqual(drawRange(1599, 800));
    // A small screen still draws 200 px steps either side.
    expect(drawRange(0, 100)).toEqual([-200, 400]);
  });
});

describe("overlaps", () => {
  it("counts both ends; a box running right across the days drawn overlaps them", () => {
    const [from, to] = [d("2026-10-05"), d("2026-10-30")];
    expect(overlaps(d("2026-09-28"), d("2026-10-05"), from, to)).toBe(true);
    expect(overlaps(d("2026-10-30"), d("2026-11-06"), from, to)).toBe(true);
    expect(overlaps(d("2026-01-05"), d("2027-11-26"), from, to)).toBe(true);
    expect(overlaps(d("2026-09-28"), d("2026-10-02"), from, to)).toBe(false);
    expect(overlaps(d("2026-11-02"), d("2026-11-06"), from, to)).toBe(false);
  });
});

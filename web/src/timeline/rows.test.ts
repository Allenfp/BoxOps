import { describe, expect, it } from "vitest";
import { parseDay } from "../model/dates";
import type { Box, Department } from "../model/types";
import { layoutDepartment } from "./layout";
import { OVERFLOW, boxRows } from "./rows";

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

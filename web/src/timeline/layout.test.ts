import { describe, expect, it } from "vitest";
import type { Box, Department } from "../model/types";
import { laneAtSlot, layoutDepartment } from "./layout";

const dept: Department = {
  id: "eng",
  name: "Eng",
  color: "#000",
  order: 1,
  collapsed: false,
  lanes: [
    { id: "a", fte: 1 },
    { id: "b", fte: 1 },
    { id: "c", fte: 0.5 },
  ],
};
const box = (id: string, lane: string, start: number, end: number, fte = 1): Box => ({
  id,
  title: id,
  lane,
  start,
  end,
  fte,
  type: "project",
  status: "planned",
});

describe("layoutDepartment", () => {
  it("sizes lanes in half-FTE slots", () => {
    const l = layoutDepartment(dept, []);
    expect([...l.lanes.values()]).toEqual([
      { slot: 0, slots: 2 },
      { slot: 2, slots: 2 },
      { slot: 4, slots: 1 },
    ]);
    expect(l.capacity).toBe(5);
    expect(laneAtSlot(l, 3)).toBe("b");
    expect(laneAtSlot(l, 5)).toBeUndefined();
  });

  it("a 2-FTE box covers its lane and the one below", () => {
    const l = layoutDepartment(dept, [box("big", "a", 0, 10, 2)]);
    expect(l.boxes.get("big")).toEqual({ slot: 0, slots: 4, overflow: false });
    expect(l.height).toBe(5);
  });

  it("two half boxes share a lane; a third is over capacity", () => {
    const l = layoutDepartment(dept, [box("h1", "a", 0, 10, 0.5), box("h2", "a", 5, 15, 0.5), box("h3", "a", 6, 8, 0.5)]);
    expect(l.boxes.get("h1")).toEqual({ slot: 0, slots: 1, overflow: false });
    expect(l.boxes.get("h2")).toEqual({ slot: 1, slots: 1, overflow: false });
    expect(l.boxes.get("h3")).toEqual({ slot: 5, slots: 1, overflow: true });
    expect(l.height).toBe(6);
  });

  it("a big box can't extend into a busy lane", () => {
    const l = layoutDepartment(dept, [box("x", "b", 0, 20), box("big", "a", 5, 10, 2)]);
    expect(l.boxes.get("x")!.overflow).toBe(false);
    expect(l.boxes.get("big")!.overflow).toBe(true);
  });

  it("boxes one after another reuse the lane", () => {
    const l = layoutDepartment(dept, [box("p", "a", 0, 4), box("q", "a", 5, 9)]);
    expect(l.boxes.get("q")).toEqual({ slot: 0, slots: 2, overflow: false });
  });

  it("a 1-FTE box doesn't fit a half lane", () => {
    const l = layoutDepartment(dept, [box("w", "c", 0, 4)]);
    expect(l.boxes.get("w")!.overflow).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { Box, Department } from "../model/types";
import { laneAtSlot, layoutDepartment } from "./layout";

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
    { id: "c", fte: 0.5 },
  ],
};
const threeFte: Department = { ...dept, lanes: [{ id: "a", fte: 1 }, { id: "b", fte: 1 }, { id: "c", fte: 1 }] };

const box = (id: string, lane: string, start: number, end: number, fte = 1): Box => ({
  id,
  code: id.toUpperCase().padEnd(3, "X").slice(0, 3),
  title: id,
  lane,
  start,
  end,
  fte,
  type: "project",
  status: "planned",
});
const overflowed = (l: ReturnType<typeof layoutDepartment>) => [...l.boxes].filter(([, p]) => p.overflow).map(([id]) => id);

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
    expect(l.overCapacity).toBe(false);
  });

  it("boxes stay in their own lane when there's room", () => {
    const l = layoutDepartment(threeFte, [box("p", "a", 0, 9), box("q", "b", 0, 9), box("r", "c", 0, 9)]);
    expect(["p", "q", "r"].map((id) => l.boxes.get(id)!.slot)).toEqual([0, 2, 4]);
  });

  it("boxes one after another reuse the lane", () => {
    const l = layoutDepartment(dept, [box("p", "a", 0, 4), box("q", "a", 5, 9)]);
    expect(l.boxes.get("q")).toEqual({ slot: 0, slots: 2, overflow: false });
  });

  it("a busy lane sends a box to free space elsewhere, not over capacity", () => {
    const l = layoutDepartment(threeFte, [box("p", "a", 0, 9), box("q", "a", 0, 9)]);
    expect(overflowed(l)).toEqual([]);
    expect(l.overCapacity).toBe(false);
  });

  // 1.5 + 1 + 0.5 = 3 FTE in a 3-FTE department must fit, whatever lanes the
  // boxes are in and whichever starts first.
  it("1.5 + 1 + 0.5 always fits in 3 FTE", () => {
    const lanes = ["a", "b", "c"];
    const sizes = [1.5, 1, 0.5];
    const starts = [
      [0, 0, 0],
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
      [0, 2, 1],
    ];
    for (const la of lanes) {
      for (const lb of lanes) {
        for (const lc of lanes) {
          for (const s of starts) {
            const boxes = [box("x", la, s[0], 20, sizes[0]), box("y", lb, s[1], 20, sizes[1]), box("z", lc, s[2], 20, sizes[2])];
            const l = layoutDepartment(threeFte, boxes);
            expect({ lanes: [la, lb, lc], starts: s, overflow: overflowed(l), over: l.overCapacity }).toEqual({
              lanes: [la, lb, lc],
              starts: s,
              overflow: [],
              over: false,
            });
            expect(l.peakFte).toBe(3);
          }
        }
      }
    }
  });

  it("3.5 FTE at once in 3 FTE is over capacity", () => {
    const l = layoutDepartment(threeFte, [box("x", "a", 0, 9, 1.5), box("y", "b", 0, 9, 1.5), box("z", "c", 5, 9, 0.5)]);
    expect(l.overCapacity).toBe(true);
    expect(l.peakFte).toBe(3.5);
    expect(overflowed(l)).toEqual(["z"]);
  });

  it("over capacity only counts boxes running on the same day", () => {
    // 2 + 2 FTE, but one ends the day before the other starts.
    const l = layoutDepartment(threeFte, [box("x", "a", 0, 9, 2), box("y", "b", 10, 19, 2)]);
    expect(l.overCapacity).toBe(false);
    expect(l.peakFte).toBe(2);
  });

  it("a half lane can't hold a 1-FTE box when nothing else is free", () => {
    const l = layoutDepartment(dept, [box("p", "a", 0, 4), box("q", "b", 0, 4), box("w", "c", 0, 4)]);
    expect(l.overCapacity).toBe(true); // 3 FTE in 2.5
    expect(overflowed(l)).toEqual(["w"]);
  });
});

describe("fully booked departments", () => {
  it("finds an arrangement when placing one box at a time can't", async () => {
    const { parseDay } = await import("../model/dates");
    // Data Engineering as it was on 2026-10-03: 3.5 FTE of lanes, fully booked
    // at times. Placing one box at a time stranded On-call rotation Q4.
    const de: Department = {
      ...dept,
      lanes: [
        { id: "de-1", fte: 1 },
        { id: "de-2", fte: 1 },
        { id: "de-3", fte: 1 },
        { id: "de-4", fte: 0.5 },
      ],
    };
    const rows: [string, string, string, string, number][] = [
      ["terraform-cleanup", "de-4", "2026-08-19", "2026-10-16", 1],
      ["legacy-sunset", "de-4", "2026-05-04", "2026-07-31", 1],
      ["warehouse-migration", "de-1", "2026-08-03", "2026-11-27", 0.5],
      ["fivetran-cost-review", "de-1", "2026-12-07", "2027-01-15", 1.5],
      ["dagster-upgrade", "de-2", "2026-09-14", "2026-10-23", 1],
      ["cdc-pipeline", "de-2", "2026-10-26", "2027-02-26", 1],
      ["on-call-q4", "de-3", "2026-09-29", "2026-12-29", 0.5],
      ["streaming-spike", "de-3", "2027-01-04", "2027-02-11", 1],
    ];
    const boxes = rows.map(([id, lane, s, e, fte]) => box(id, lane, parseDay(s)!, parseDay(e)!, fte));
    const l = layoutDepartment(de, boxes);
    expect(l.overCapacity).toBe(false);
    expect(l.peakFte).toBe(3.5);
    expect(overflowed(l)).toEqual([]);
    // Nothing drawn on top of anything else.
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b || a.end < b.start || b.end < a.start) continue;
        const pa = l.boxes.get(a.id)!;
        const pb = l.boxes.get(b.id)!;
        expect(pa.slot + pa.slots <= pb.slot || pb.slot + pb.slots <= pa.slot).toBe(true);
      }
    }
  });
});

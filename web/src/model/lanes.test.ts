import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { layoutDepartment } from "../timeline/layout";
import { parseDay } from "./dates";
import type { DraftState } from "./draft";
import { readRoadmapDir } from "./files";
import { capacityOn } from "./lanes";
import { loadRoadmap } from "./load";
import { capacityStretches } from "./report";
import { serializeChanges } from "./serialize";
import { describeChanges } from "./summary";
import type { Box, Department } from "./types";

const d = (s: string) => parseDay(s)!;
const files = readRoadmapDir(resolve(__dirname, "../../e2e/fixtures/roadmap"));
const { roadmap } = loadRoadmap(files);
const base: DraftState = { boxes: roadmap.boxes, departments: roadmap.departments, people: roadmap.people };

// Two lanes; the contractor's lane closes after Oct 30.
const dept: Department = {
  id: "eng",
  code: "EN",
  name: "Eng",
  color: "#000",
  order: 1,
  collapsed: false,
  lanes: [
    { id: "a", fte: 1 },
    { id: "c", name: "Contractor", fte: 1, end: d("2026-10-30") },
  ],
};
const box = (id: string, lane: string, start: string, end: string): Box => ({
  id,
  code: id.toUpperCase().padEnd(3, "X").slice(0, 3),
  title: id,
  lane,
  start: d(start),
  end: d(end),
  fte: 1,
  type: "project",
});

describe("lane dates", () => {
  it("count towards capacity only while the lane is open", () => {
    expect(capacityOn(dept, d("2026-10-30"))).toBe(2);
    expect(capacityOn(dept, d("2026-11-02"))).toBe(1);

    const fits = layoutDepartment(dept, [box("x", "a", "2026-10-05", "2026-10-30"), box("y", "c", "2026-10-05", "2026-10-30")]);
    expect(fits.overCapacity).toBe(false);
    // The same two boxes a month later: only one lane is open.
    const late = layoutDepartment(dept, [box("x", "a", "2026-11-02", "2026-11-27"), box("y", "c", "2026-11-02", "2026-11-27")]);
    expect(late.overCapacity).toBe(true);
    expect(late.boxes.get("x")).toMatchObject({ slot: 0, overflow: false });
    expect(late.boxes.get("y")).toMatchObject({ overflow: true }); // never drawn in the closed lane

    // A box in the closed lane moves to an open one when there's room.
    const moved = layoutDepartment(dept, [box("y", "c", "2026-11-02", "2026-11-27")]);
    expect(moved.boxes.get("y")).toMatchObject({ slot: 0, overflow: false });
    expect(moved.overCapacity).toBe(false);
  });

  it("over-capacity stretches follow the lanes open each day", () => {
    const boxes = [box("x", "a", "2026-10-26", "2026-11-06"), box("y", "c", "2026-10-26", "2026-11-06")];
    expect(capacityStretches(boxes, dept.lanes, (load, cap) => load > cap)).toEqual([
      { from: d("2026-11-02"), to: d("2026-11-06"), fte: 2, capacity: 1 },
    ]);
    const opening = [{ id: "n", fte: 1, start: d("2026-11-02") }];
    expect(capacityStretches([box("z", "n", "2026-10-26", "2026-11-06")], opening, (load, cap) => load > cap)).toEqual([
      { from: d("2026-10-26"), to: d("2026-10-30"), fte: 1, capacity: 0 },
    ]);
  });

  it("load, save and describe", () => {
    const text = files["departments/data-eng.yaml"].replace("  - id: de-4\n", "  - id: de-4\n    start: 2026-11-07\n    end: 2027-03-31\n");
    const { issues } = loadRoadmap({ ...files, "departments/data-eng.yaml": text });
    expect(issues.map((i) => i.message)).toEqual(["lanes[3].start: Saturday — roadmap dates must be weekdays"]);

    const draft: DraftState = {
      ...base,
      departments: base.departments.map((x) =>
        x.id === "data-eng" ? { ...x, lanes: x.lanes.map((l) => (l.id === "de-4" ? { ...l, end: d("2027-03-31") } : l)) } : x,
      ),
    };
    const out = serializeChanges(files, base, draft)["departments/data-eng.yaml"]!;
    expect(out).toContain("    fte: 0.5\n    end: 2027-03-31\n");
    expect(loadRoadmap({ ...files, "departments/data-eng.yaml": out }).roadmap.departments.find((x) => x.id === "data-eng")!.lanes[3].end).toBe(
      d("2027-03-31"),
    );
    expect(describeChanges(base, draft, roadmap.settings).map((l) => l.text)).toEqual([
      "Lane **Contractor** in Data Engineering now runs until 2027-03-31 (was always open)",
    ]);
  });
});

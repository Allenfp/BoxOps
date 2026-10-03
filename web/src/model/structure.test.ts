import { describe, expect, it } from "vitest";
import type { DraftState } from "./draft";
import { addDepartment, addLane, moveDepartment, moveLane, newLaneId, removeDepartment, removeLane } from "./structure";
import type { Box, Department } from "./types";

const dept = (id: string, order: number, lanes: string[]): Department => ({
  id,
  name: id.toUpperCase(),
  color: "#4f7cff",
  order,
  collapsed: false,
  lanes: lanes.map((l) => ({ id: l, fte: 1 })),
});
const box = (id: string, lane: string): Box => ({ id, title: id, lane, start: 1, end: 2, fte: 1, type: "p", status: "s" });

const state: DraftState = {
  departments: [dept("eng", 1, ["de-1", "de-2"]), dept("ops", 2, ["ops-a"])],
  boxes: [box("b1", "de-1"), box("b2", "de-2"), box("b3", "ops-a")],
  people: [{ id: "sam", name: "Sam", department: "ops" }],
};

describe("lane ids", () => {
  it("follow a department's pattern, else its id", () => {
    expect(newLaneId(state.departments[0], state)).toBe("de-3");
    expect(newLaneId(state.departments[1], state)).toBe("ops-1");
    expect(newLaneId(dept("ml", 3, []), state)).toBe("ml-1");
  });
});

describe("departments", () => {
  it("adds one at the end with a lane, an unused colour and a unique id", () => {
    const { state: s, id } = addDepartment(state, "Data Platform");
    const d = s.departments.find((x) => x.id === id)!;
    expect(id).toBe("data-platform");
    expect(d).toMatchObject({ name: "Data Platform", order: 3, lanes: [{ id: "data-platform-1", fte: 1 }] });
    expect(d.color).not.toBe("#4f7cff");
    expect(addDepartment(s, "Data platform").id).toBe("data-platform-2");
  });

  it("moves up and down by swapping neighbours", () => {
    const s = moveDepartment(state, "ops", -1);
    expect(s.departments.map((d) => [d.id, d.order])).toEqual([
      ["ops", 1],
      ["eng", 2],
    ]);
    expect(moveDepartment(s, "ops", -1)).toBe(s); // already first
  });

  it("removing one moves its boxes and leaves its engineers without a department", () => {
    const s = removeDepartment(state, "ops", "de-2");
    expect(s.departments.map((d) => d.id)).toEqual(["eng"]);
    expect(s.boxes.find((b) => b.id === "b3")!.lane).toBe("de-2");
    expect(s.people[0].department).toBeUndefined();
  });

  it("won't remove one with boxes unless told where they go", () => {
    expect(() => removeDepartment(state, "ops")).toThrow(/choose a lane/);
    expect(() => removeDepartment(state, "ops", "ops-a")).toThrow(/choose a lane/);
    const empty = { ...state, boxes: state.boxes.filter((b) => b.lane !== "ops-a") };
    expect(removeDepartment(empty, "ops").departments).toHaveLength(1);
  });
});

describe("lanes", () => {
  it("adds, reorders and removes, moving boxes out first", () => {
    const { state: s, laneId } = addLane(state, "eng", 0.5);
    expect(laneId).toBe("de-3");
    expect(s.departments[0].lanes.at(-1)).toEqual({ id: "de-3", fte: 0.5 });
    expect(moveLane(s, "de-3", -1).departments[0].lanes.map((l) => l.id)).toEqual(["de-1", "de-3", "de-2"]);

    expect(() => removeLane(s, "de-1")).toThrow(/choose a lane/);
    const r = removeLane(s, "de-1", "de-3");
    expect(r.departments[0].lanes.map((l) => l.id)).toEqual(["de-2", "de-3"]);
    expect(r.boxes.find((b) => b.id === "b1")!.lane).toBe("de-3");
    expect(removeLane(s, "de-3").departments[0].lanes).toHaveLength(2); // empty lane: no target needed
  });
});

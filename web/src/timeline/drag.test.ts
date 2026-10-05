import { describe, expect, it } from "vitest";
import { formatDay, parseDay, workdays } from "../model/dates";
import type { Department } from "../model/types";
import { dragDays, dropLane, dropSlot, movedDates, previewSlot } from "./drag";
import { layoutDepartment } from "./layout";
import { PX_PER_DAY } from "./scale";

const d = (s: string) => parseDay(s)!;
const dates = (start: string, end: string) => ({ start: d(start), end: d(end) });
const text = (r: { start: number; end: number }) => `${formatDay(r.start)} – ${formatDay(r.end)}`;

describe("dragDays", () => {
  it("snaps to a working day at weeks and months zoom, and to a week at quarters", () => {
    expect(dragDays(PX_PER_DAY.weeks * 3.4, PX_PER_DAY.weeks, "weeks")).toBe(3);
    expect(dragDays(PX_PER_DAY.months * 10, PX_PER_DAY.months, "months")).toBe(10);
    expect(dragDays(-PX_PER_DAY.months * 2.6, PX_PER_DAY.months, "months")).toBe(-3);
    expect(dragDays(PX_PER_DAY.quarters * 3, PX_PER_DAY.quarters, "quarters")).toBe(5);
    expect(dragDays(PX_PER_DAY.quarters * 2, PX_PER_DAY.quarters, "quarters")).toBe(0);
    expect(dragDays(-PX_PER_DAY.quarters * 8, PX_PER_DAY.quarters, "quarters")).toBe(-10);
    expect(Object.is(dragDays(-1, PX_PER_DAY.months, "months"), 0)).toBe(true);
  });
});

describe("movedDates", () => {
  // Dagster: Mon 2026-09-14 – Fri 2026-10-23, 30 working days.
  const dagster = dates("2026-09-14", "2026-10-23");

  it("moves in working days, keeping the number of them, across weekends", () => {
    expect(text(movedDates(dagster, "move", 1))).toBe("2026-09-15 – 2026-10-26");
    expect(text(movedDates(dagster, "move", 5))).toBe("2026-09-21 – 2026-10-30");
    expect(text(movedDates(dagster, "move", -1))).toBe("2026-09-11 – 2026-10-22");
    for (const n of [-7, -1, 0, 1, 3, 10, 55]) {
      const m = movedDates(dagster, "move", n);
      expect(workdays(m.start, m.end)).toBe(30);
    }
    // A Friday plus one is the Monday after.
    expect(text(movedDates(dates("2026-10-02", "2026-10-02"), "move", 1))).toBe("2026-10-05 – 2026-10-05");
  });

  it("moves one end, never past the other: at least one working day stays", () => {
    expect(text(movedDates(dagster, "end", 1))).toBe("2026-09-14 – 2026-10-26");
    expect(text(movedDates(dagster, "end", -5))).toBe("2026-09-14 – 2026-10-16");
    expect(text(movedDates(dagster, "end", -100))).toBe("2026-09-14 – 2026-09-14");
    expect(text(movedDates(dagster, "start", -1))).toBe("2026-09-11 – 2026-10-23");
    expect(text(movedDates(dagster, "start", 100))).toBe("2026-10-23 – 2026-10-23");
    const day = dates("2026-10-07", "2026-10-07");
    expect(movedDates(day, "end", -1)).toEqual(day);
    expect(movedDates(day, "start", 1)).toEqual(day);
  });

  it("at quarters zoom a drag moves whole weeks, so the weekday stays", () => {
    const m = movedDates(dagster, "move", dragDays(PX_PER_DAY.quarters * 11, PX_PER_DAY.quarters, "quarters"));
    expect(text(m)).toBe("2026-09-28 – 2026-11-06");
  });
});

describe("where a dragged box lands", () => {
  // Data Engineering: three 1-FTE lanes and a half one (slots 0–1, 2–3, 4–5 and 6).
  const de: Department = {
    id: "data-eng",
    code: "DE",
    name: "Data Engineering",
    color: "#000",
    order: 1,
    collapsed: false,
    lanes: [
      { id: "de-1", fte: 1 },
      { id: "de-2", fte: 1 },
      { id: "de-3", fte: 1 },
      { id: "de-4", fte: 0.5 },
    ],
  };
  const layout = layoutDepartment(de, []);
  const SLOT = 22;

  it("the top of a box held by its lower half is above the pointer", () => {
    expect(dropSlot(3, 0, 2, 7)).toBe(3);
    expect(dropSlot(3, 2, 4, 7)).toBe(1);
    // …and never past the last lane, nor above the first.
    expect(dropSlot(6, 0, 4, 7)).toBe(3);
    expect(dropSlot(0, 3, 4, 7)).toBe(0);
    // A box taller than the department sits at its top.
    expect(dropSlot(1, 0, 4, 2)).toBe(0);
  });

  it("a sideways drag keeps the box's own lane, whichever half of a 2-FTE box was held", () => {
    // Held in the middle, over de-2's first slot: the pointer is in the lane below the box's top.
    expect(dropLane(layout, { slot: 2, dy: 0 }, { slot: 2, need: 4, own: "de-1" }, SLOT)).toBe("de-1");
    expect(dropLane(layout, { slot: 3, dy: SLOT / 2 }, { slot: 3, need: 4, own: "de-1" }, SLOT)).toBe("de-1");
    // Drawn away from its own lane by the layout: still its own lane.
    expect(dropLane(layout, { slot: 4, dy: -3 }, { slot: 0, need: 2, own: "de-1" }, SLOT)).toBe("de-1");
  });

  it("moved up or down, the lane is the one under the box's top, kept inside the department", () => {
    expect(dropLane(layout, { slot: 4, dy: 2 * SLOT }, { slot: 2, need: 4, own: "de-1" }, SLOT)).toBe("de-2");
    expect(dropLane(layout, { slot: 6, dy: 4 * SLOT }, { slot: 0, need: 4, own: "de-1" }, SLOT)).toBe("de-2");
    expect(dropLane(layout, { slot: 6, dy: 4 * SLOT }, { slot: 0, need: 1, own: "de-1" }, SLOT)).toBe("de-4");
    expect(dropLane(layout, { slot: 1, dy: -2 * SLOT }, { slot: 1, need: 3, own: "de-3" }, SLOT)).toBe("de-1");
    // Over the extra area, or outside the department's lanes: no lane, so the last one stays.
    expect(dropLane(layout, { slot: 7, dy: 3 * SLOT }, { slot: 0, need: 2, own: "de-1" }, SLOT)).toBeUndefined();
    expect(dropLane(layout, { slot: -1, dy: -3 * SLOT }, { slot: 0, need: 2, own: "de-1" }, SLOT)).toBeUndefined();
  });

  it("is drawn from its lane's top, or higher where it would run past the last lane", () => {
    expect(previewSlot(layout, "de-2", 2)).toBe(2);
    expect(previewSlot(layout, "de-3", 3)).toBe(4);
    expect(previewSlot(layout, "de-3", 4)).toBe(3);
    expect(previewSlot(layout, "de-4", 1)).toBe(6);
    expect(previewSlot(layout, "de-4", 4)).toBe(3);
  });
});

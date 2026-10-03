import { describe, expect, it } from "vitest";
import { formatDay, parseDay } from "./dates";
import type { Box } from "./types";
import { workload } from "./workload";

const d = (s: string) => parseDay(s)!;
const box = (id: string, start: string, end: string, fte: number, engineers: string[]): Box => ({
  id,
  title: id,
  lane: "l",
  start: d(start),
  end: d(end),
  fte,
  engineers,
  type: "project",
  status: "planned",
});

describe("workload", () => {
  const boxes = [
    box("a", "2026-10-05", "2026-10-16", 1, ["sam"]), // two weeks, full time
    box("b", "2026-10-12", "2026-10-23", 1.5, ["sam", "alex"]), // 0.75 each
    box("c", "2026-11-02", "2026-11-06", 0.5, ["sam"]),
    box("d", "2026-10-05", "2026-10-09", 1, ["alex"]),
  ];

  it("splits a box's FTE across its engineers and finds stretches over 1 FTE", () => {
    const w = workload("sam", boxes, d("2026-10-13"));
    expect(w.boxes.map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(w.today).toBe(1.75);
    expect(w.peak).toBe(1.75);
    expect(w.over.map((o) => [formatDay(o.from), formatDay(o.to), o.fte])).toEqual([["2026-10-12", "2026-10-16", 1.75]]);
  });

  it("is fine at exactly 1 FTE; on a weekend, today means the coming Monday", () => {
    const w = workload("alex", boxes, d("2026-10-10")); // Saturday → Mon Oct 12, when box b starts
    expect(w.peak).toBe(1);
    expect(w.over).toEqual([]);
    expect(w.today).toBe(0.75);
  });

  it("someone on nothing carries nothing", () => {
    expect(workload("nobody", boxes, d("2026-10-13"))).toEqual({ boxes: [], today: 0, peak: 0, over: [] });
  });
});

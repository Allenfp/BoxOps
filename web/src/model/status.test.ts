import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDay } from "./dates";
import { DEFAULT_SETTINGS, loadRoadmap } from "./load";
import { readRoadmapDir } from "./files";
import { amount, boxScale, percent, scaleStats } from "./scale";
import { flagName, progress } from "./status";

const d = (s: string) => parseDay(s)!;

describe("status", () => {
  it("progress follows the dates, inclusive at both ends", () => {
    const box = { start: d("2026-10-05"), end: d("2026-10-09") };
    expect(progress(box, d("2026-10-02"))).toBe("upcoming");
    expect(progress(box, d("2026-10-05"))).toBe("underway");
    expect(progress(box, d("2026-10-09"))).toBe("underway");
    expect(progress(box, d("2026-10-12"))).toBe("finished");
  });

  it("names flags, and no flag", () => {
    expect(flagName(DEFAULT_SETTINGS, undefined)).toBe("On track");
    expect(flagName(DEFAULT_SETTINGS, "blocked")).toBe("Blocked");
  });
});

describe("boxScale", () => {
  it("is FTE × working days", () => {
    // Mon Oct 5 – Fri Oct 16: 10 working days.
    expect(boxScale({ fte: 1.5, start: parseDay("2026-10-05")!, end: parseDay("2026-10-16")! })).toBe(15);
    expect(boxScale({ fte: 0.5, start: parseDay("2026-10-05")!, end: parseDay("2026-10-07")! })).toBe(1.5);
  });
});

describe("scaleStats", () => {
  const { roadmap } = loadRoadmap(readRoadmapDir(resolve(__dirname, "../../e2e/fixtures/roadmap")));

  it("puts a box's scale in person-weeks, -months and -quarters, and its share of the department", () => {
    const dagster = roadmap.boxes.find((b) => b.id === "bx-c93d-dagster-upgrade")!; // 1 FTE × 30 days in Data Engineering (3.5 FTE)
    const s = scaleStats(dagster, roadmap.departments);
    expect(s.scale).toBe(30);
    expect([amount(s.in.week), amount(s.in.month), amount(s.in.quarter)]).toEqual(["6", "1.5", "0.5"]);
    expect(s.dept?.name).toBe("Data Engineering");
    expect(percent(s.dept!.share)).toBe("29%");
    expect(percent(0.031)).toBe("3.1%");
  });
});

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readRoadmapDir } from "../../cli/git";
import { parseDay } from "./dates";
import { loadRoadmap } from "./parse";
import { amount, boxScale, percent, scaleSentence, scaleStats } from "./scale";

describe("boxScale", () => {
  it("is FTE × working days", () => {
    // Mon Oct 5 – Fri Oct 16: 10 working days.
    expect(boxScale({ fte: 1.5, start: parseDay("2026-10-05")!, end: parseDay("2026-10-16")! })).toBe(15);
    expect(boxScale({ fte: 0.5, start: parseDay("2026-10-05")!, end: parseDay("2026-10-07")! })).toBe(1.5);
  });
});

const fixture = (await readRoadmapDir(fileURLToPath(new URL("../../e2e/fixtures/roadmap", import.meta.url)))).files;

describe("scaleStats", () => {
  const { roadmap } = loadRoadmap(fixture);

  it("puts a box's scale in person-weeks, -months and -quarters, and its share of the department", () => {
    const dagster = roadmap.boxes.find((b) => b.id === "bx-c93d-dagster-upgrade")!; // 1 FTE × 30 days in Data Engineering (3.5 FTE)
    const s = scaleStats(dagster, roadmap.departments);
    expect(s.scale).toBe(30);
    expect([amount(s.in.week), amount(s.in.month), amount(s.in.quarter)]).toEqual(["6", "1.5", "0.5"]);
    expect(s.dept?.name).toBe("Data Engineering");
    expect(percent(s.dept!.share)).toBe("29%");
    expect(percent(0.031)).toBe("3.1%");
    expect(scaleSentence(dagster, roadmap.departments)).toBe(
      "Scale 30 (1 FTE × 30 working days): about 6 weeks, 1.5 months or 0.5 quarters; 29% of Data Engineering while it runs.",
    );
  });
});

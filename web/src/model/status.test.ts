import { describe, expect, it } from "vitest";
import { parseDay } from "./dates";
import { DEFAULT_SETTINGS } from "./load";
import { boxScale } from "./scale";
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

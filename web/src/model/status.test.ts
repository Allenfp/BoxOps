import { describe, expect, it } from "vitest";
import { parseDay } from "./dates";
import { DEFAULT_SETTINGS } from "./load";
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

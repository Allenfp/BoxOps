import { describe, expect, it } from "vitest";
import { formatDay, nextWorkday, parseDay } from "../model/dates";
import type { Box } from "../model/types";
import { PX_PER_DAY, makeScale, timelineRange } from "./scale";

const d = (s: string) => parseDay(s)!;

describe("makeScale", () => {
  // Thu 2026-10-01 to (not including) Mon 2027-01-04.
  const scale = makeScale(d("2026-10-01"), d("2027-01-04"), "weeks");

  it("counts working days only: a weekend takes no room", () => {
    expect(scale.x(d("2026-10-01"))).toBe(0);
    expect(scale.x(d("2026-10-02"))).toBe(PX_PER_DAY.weeks);
    // Saturday, Sunday and Monday are all at Monday's left edge.
    for (const day of ["2026-10-03", "2026-10-04", "2026-10-05"]) expect(scale.x(d(day))).toBe(2 * PX_PER_DAY.weeks);
    expect(scale.span(d("2026-10-02"), d("2026-10-05"))).toBe(2 * PX_PER_DAY.weeks);
    expect(scale.width).toBe((22 + 21 + 23 + 1) * PX_PER_DAY.weeks); // October from the 1st, November, December, Fri 2027-01-01
  });

  it("dayAt and x round-trip for every working day, at every zoom", () => {
    for (const zoom of ["weeks", "months", "quarters"] as const) {
      const s = makeScale(d("2026-10-01"), d("2027-01-04"), zoom);
      for (let day = s.start; day < s.end; day++) {
        // A weekend day is found as the Monday after.
        expect(formatDay(s.dayAt(s.x(day) + s.pxPerDay / 2))).toBe(formatDay(nextWorkday(day)));
      }
    }
    expect(formatDay(scale.dayAt(2 * PX_PER_DAY.weeks + 1))).toBe("2026-10-05");
    expect(formatDay(scale.dayAt(2 * PX_PER_DAY.weeks - 1))).toBe("2026-10-02");
  });
});

describe("timelineRange", () => {
  const box = (start: string, end: string) => ({ start: d(start), end: d(end) }) as Box;

  it("starts and ends on quarter boundaries, with room either side", () => {
    const [start, end] = timelineRange([box("2026-09-14", "2026-10-23")], d("2026-10-03"), 1);
    expect(formatDay(start)).toBe("2026-07-01");
    expect(formatDay(end)).toBe("2027-04-01");
  });

  it("uses fiscal quarters when the year starts in another month", () => {
    // A fiscal year from February: quarters start in Feb, May, Aug and Nov. 45 days before
    // 2026-09-14 is in the quarter from May; 90 days after 2027-02-26, in the one from May.
    const [start, end] = timelineRange([box("2026-09-14", "2027-02-26")], d("2026-10-03"), 2);
    expect(formatDay(start)).toBe("2026-05-01");
    expect(formatDay(end)).toBe("2027-08-01");
  });
});

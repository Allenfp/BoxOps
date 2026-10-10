import { describe, expect, it } from "vitest";
import { formatDay, nextWorkday, parseDay } from "../model/dates";
import type { Box } from "../model/types";
import { PX_PER_DAY, headerBands, labelsCut, makeScale, timelineRange } from "./scale";

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

describe("the labels along the top", () => {
  it("have a short form, a month's or quarter's name without its year", () => {
    const [months] = headerBands(makeScale(d("2026-08-03"), d("2026-11-01"), "months"), 1);
    expect(months.map((s) => [s.label, s.short])).toEqual([
      ["Aug 2026", "Aug"],
      ["Sep 2026", "Sep"],
      ["Oct 2026", "Oct"],
    ]);
    const [quarters] = headerBands(makeScale(d("2026-07-01"), d("2027-01-01"), "quarters"), 1);
    expect(quarters.map((s) => [s.label, s.short])).toEqual([
      ["Q3 2026", "Q3"],
      ["Q4 2026", "Q4"],
    ]);
    // A fiscal year from February: named by the year it ends in.
    const [fiscal] = headerBands(makeScale(d("2026-08-03"), d("2026-11-02"), "quarters"), 2);
    expect(fiscal.map((s) => [s.label, s.short])).toEqual([
      ["FY27 Q3", "Q3"],
      ["FY27 Q4", "Q4"],
    ]);
  });

  describe("labelsCut", () => {
    // Months zoom, 14.7 px a working day: July (23 working days) runs to 338.1 px, August (21) to
    // 646.8, September (22) to 970.2. A label 60 px wide as drawn, its short form 30.
    const scale = makeScale(d("2026-07-01"), d("2026-10-01"), "months");
    const [months] = headerBands(scale, 1);
    const width = (label: string) => (label.length > 3 ? 60 : 30);
    const cut = (left: number, right: number) => Object.fromEntries([...labelsCut(months, scale, left, right, width)].map(([day, c]) => [formatDay(day), c]));

    it("leaves a label whole where what's on screen of its cell has room for it", () => {
      expect(cut(0, 1000)).toEqual({});
      expect(cut(277, 708)).toEqual({}); // 61 px of July and of September on screen
    });

    it("at the label column's edge: short, then nothing, as the cell's days scroll by", () => {
      expect(cut(279, 1000)).toEqual({ "2026-07-01": "short" }); // 59 px
      expect(cut(307, 1000)).toEqual({ "2026-07-01": "short" }); // 31 px
      expect(cut(309, 1000)).toEqual({ "2026-07-01": "none" }); // 29 px
      expect(cut(400, 1000)).toEqual({ "2026-07-01": "none" }); // gone under the column
    });

    it("at the screen's edge: nothing, then short, then whole, as the cell comes on", () => {
      expect(cut(0, 650)).toEqual({ "2026-09-01": "none" }); // 3 px
      expect(cut(0, 678)).toEqual({ "2026-09-01": "short" }); // 31 px
      expect(cut(0, 706)).toEqual({ "2026-09-01": "short" }); // 59 px
      expect(cut(0, 708)).toEqual({});
      expect(cut(0, 300)).toEqual({ "2026-08-01": "none", "2026-09-01": "none" }); // not on screen
    });

    it("cuts to nothing a label without a short form", () => {
      const cell = { start: d("2026-09-01"), end: d("2026-10-01"), label: "Sep 2026" };
      expect([...labelsCut([cell], scale, 0, 690, width)]).toEqual([[d("2026-09-01"), "none"]]);
    });
  });

  describe("labelsCut for the dates under them, each at its cell's start (sticky: false)", () => {
    // Weeks zoom, 40 px a working day: Wednesday 2026-07-01's cell runs to 40 px, Thursday's to 80,
    // Friday's to 120, Monday 2026-07-06's to 160. A date as drawn 7 px a digit, and 12 px of padding.
    const scale = makeScale(d("2026-07-01"), d("2026-10-01"), "weeks");
    const days = headerBands(scale, 1)[1].slice(0, 4);
    const width = (label: string) => label.length * 7 + 12;
    const cut = (left: number, right: number) =>
      Object.fromEntries([...labelsCut(days, scale, left, right, width, { sticky: false })].map(([day, c]) => [formatDay(day), c]));

    it("leaves a date whole where it's all on screen", () => {
      expect(days.map((s) => s.label)).toEqual(["1", "2", "3", "6"]);
      expect(cut(0, 160)).toEqual({});
      expect(cut(40, 139)).toEqual({ "2026-07-01": "none" }); // Monday's "6" from 120 to 139
    });

    it("at the label column's edge: nothing once its cell starts under it, though the rest of the cell has room", () => {
      expect(cut(0.5, 160)).toEqual({ "2026-07-01": "none" });
      expect(cut(39, 160)).toEqual({ "2026-07-01": "none" });
      expect(cut(41, 160)).toEqual({ "2026-07-01": "none", "2026-07-02": "none" });
      // The names along the top stay at the column's edge: there, 30 px of Wednesday's cell would be room.
      expect([...labelsCut(days, scale, 10, 160, width)]).toEqual([]);
    });

    it("at the screen's edge: nothing, then whole, as its cell comes on", () => {
      expect(cut(0, 120)).toEqual({ "2026-07-06": "none" }); // not on screen
      expect(cut(0, 138)).toEqual({ "2026-07-06": "none" }); // 18 px
      expect(cut(0, 139)).toEqual({}); // 19 px
    });

    it("cuts to nothing a date its cell is too narrow for, on screen or not", () => {
      // Months zoom from Friday 2027-01-01: the first week's cell is that day alone (14.7 px), named by its Monday.
      const months = makeScale(d("2027-01-01"), d("2027-04-01"), "months");
      const weeks = headerBands(months, 1)[1].slice(0, 2);
      expect(weeks.map((s) => s.label)).toEqual(["28", "4"]);
      expect([...labelsCut(weeks, months, 0, 1000, width, { sticky: false })]).toEqual([[d("2027-01-01"), "none"]]);
    });
  });
});

import { describe, expect, it } from "vitest";
import { formatDay, parseDay } from "./dates";
import { overStretches } from "./report";

const d = (s: string) => parseDay(s)!;
const item = (start: string, end: string, fte: number) => ({ start: d(start), end: d(end), fte });
const fmt = (xs: ReturnType<typeof overStretches>) => xs.map((s) => [formatDay(s.from), formatDay(s.to), s.fte]);

describe("overStretches", () => {
  it("finds working-day stretches over the limit, one per level", () => {
    const items = [
      item("2026-10-05", "2026-10-23", 1.5),
      item("2026-10-12", "2026-10-16", 1),
      item("2026-10-14", "2026-10-30", 1),
    ];
    // Over 3 FTE only Wed–Fri Oct 14–16 (1.5 + 1 + 1).
    expect(fmt(overStretches(items, 3))).toEqual([["2026-10-14", "2026-10-16", 3.5]]);
    // Over 2 FTE: 2.5 on Oct 12–13, 3.5 on Oct 14–16, 2.5 again on Oct 19–23.
    expect(fmt(overStretches(items, 2))).toEqual([
      ["2026-10-12", "2026-10-13", 2.5],
      ["2026-10-14", "2026-10-16", 3.5],
      ["2026-10-19", "2026-10-23", 2.5],
    ]);
  });

  it("exactly at the limit is fine, and back-to-back work doesn't overlap", () => {
    expect(overStretches([item("2026-10-05", "2026-10-09", 1), item("2026-10-12", "2026-10-16", 1)], 1)).toEqual([]);
  });

  it("a stretch running over a weekend stays one stretch", () => {
    const items = [item("2026-10-08", "2026-10-13", 1), item("2026-10-08", "2026-10-13", 1)];
    expect(fmt(overStretches(items, 1))).toEqual([["2026-10-08", "2026-10-13", 2]]);
  });

  it("finds stretches at exactly a level (a full department)", async () => {
    const { levelStretches } = await import("./report");
    const items = [item("2026-10-05", "2026-10-16", 1), item("2026-10-12", "2026-10-23", 1)];
    expect(fmt(levelStretches(items, (f) => f === 2))).toEqual([["2026-10-12", "2026-10-16", 2]]);
  });
});

describe("formatReport", () => {
  it("lists every engineer's bookings with their share, even when nobody is over", async () => {
    const { buildReport, formatReport } = await import("./report");
    const text = formatReport(
      buildReport({
        settings: { title: "t", fiscal_year_start_month: 1, default_zoom: "months", types: [], statuses: [] },
        departments: [{ id: "eng", code: "EN", name: "Eng", color: "#000", order: 1, collapsed: false, lanes: [{ id: "e1", fte: 1 }] }],
        people: [
          { id: "sam", name: "Sam", department: "eng" },
          { id: "ana", name: "Ana" },
        ],
        boxes: [
          { id: "b1", code: "PIP", title: "Pipes", lane: "e1", start: d("2026-10-05"), end: d("2026-10-16"), fte: 1.5, engineers: ["sam", "ana"], type: "p", status: "s" },
        ],
      }),
    );
    expect(text).toContain("Engineer bookings (FTE is their share of the box)\n  Sam (sam), eng\n    2026-10-05 – 2026-10-16  0.75 FTE  Pipes (PIP)\n  Ana (ana)\n");
    expect(text).toContain("Engineers over 1 FTE\n  none");
    expect(text).toContain("Eng (eng): 1 FTE of lanes, 1 boxes\n    OVER CAPACITY 2026-10-05 – 2026-10-16: 1.5 FTE planned of 1");
  });
});

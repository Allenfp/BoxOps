import { describe, expect, it } from "vitest";
import { headerBands, makeScale, packRows } from "../timeline/scale";
import { formatDay, makeDay, parseDay, quarterLabel, startOfQuarter, startOfWeek, today } from "./dates";
import { loadRoadmap } from "./load";
import type { Box } from "./types";

describe("dates", () => {
  it("round-trips ISO days and rejects impossible ones", () => {
    expect(formatDay(parseDay("2026-10-03")!)).toBe("2026-10-03");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("2026-2-3")).toBeNull();
  });

  it("uses the local calendar day for today", () => {
    // 23:30 local on Oct 3 must still be Oct 3, whatever the UTC date is.
    expect(formatDay(today(new Date(2026, 9, 3, 23, 30)))).toBe("2026-10-03");
  });

  it("starts weeks on Monday", () => {
    expect(formatDay(startOfWeek(parseDay("2026-10-04")!))).toBe("2026-09-28"); // Sunday
  });

  it("handles fiscal quarters", () => {
    const oct3 = parseDay("2026-10-03")!;
    expect(formatDay(startOfQuarter(oct3))).toBe("2026-10-01");
    expect(quarterLabel(startOfQuarter(oct3))).toBe("Q4 2026");
    // FY starting in February: Nov–Jan is Q4 of FY27, Aug–Oct is Q3.
    expect(formatDay(startOfQuarter(oct3, 2))).toBe("2026-08-01");
    expect(quarterLabel(makeDay(2026, 8, 1), 2)).toBe("FY27 Q3");
    expect(quarterLabel(makeDay(2027, 2, 1), 2)).toBe("FY28 Q1");
  });
});

describe("timeline", () => {
  const box = (id: string, start: string, end: string): Box => ({
    id,
    code: id.toUpperCase().padEnd(3, "X"),
    title: id,
    lane: "l",
    start: parseDay(start)!,
    end: parseDay(end)!,
    type: "project",
    status: "planned",
    fte: 1,
  });

  it("stacks only overlapping boxes", () => {
    const { row, rows } = packRows([
      box("a", "2026-01-01", "2026-01-31"),
      box("b", "2026-02-01", "2026-02-28"), // touches a, no overlap
      box("c", "2026-01-15", "2026-02-10"), // overlaps both
    ]);
    expect(rows).toBe(2);
    expect(row.get("a")).toBe(0);
    expect(row.get("c")).toBe(1);
    expect(row.get("b")).toBe(0);
  });

  it("builds header bands that tile the range", () => {
    const scale = makeScale(makeDay(2026, 10, 1), makeDay(2027, 1, 1), "quarters");
    const [quarters, months] = headerBands(scale, 1);
    expect(quarters.map((s) => s.label)).toEqual(["Q4 2026"]);
    expect(months.map((s) => s.label)).toEqual(["Oct", "Nov", "Dec"]);
    expect(months[0].start).toBe(scale.start);
    expect(months[2].end).toBe(scale.end);
  });
});

describe("loadRoadmap", () => {
  const settings = "format: 1\ntypes: [{id: project, name: Project, color: '#000000'}]\nstatuses: [{id: planned, name: Planned}]\n";
  const dept = "id: eng\ncode: EN\nname: Eng\nlanes: [{id: e1}, {id: e2, fte: 0.5}]\n";

  it("loads a valid roadmap", () => {
    const { roadmap, issues } = loadRoadmap({
      "settings.yaml": settings,
      "departments/eng.yaml": dept,
      "boxes/b1.yaml": "id: b1\ncode: B1X\ntitle: One\nlane: e2\nstart: 2026-01-05\nend: 2026-01-30\ntype: project\nstatus: planned\n",
    });
    expect(issues).toEqual([]);
    expect(roadmap.departments[0].lanes).toEqual([
      { id: "e1", name: undefined, fte: 1 },
      { id: "e2", name: undefined, fte: 0.5 },
    ]);
    expect(formatDay(roadmap.boxes[0].end)).toBe("2026-01-30");
  });

  it("reports bad boxes without dropping the rest", () => {
    const { roadmap, issues } = loadRoadmap({
      "settings.yaml": settings,
      "departments/eng.yaml": dept,
      "boxes/ok.yaml": "id: ok\ncode: OKX\ntitle: OK\nlane: e1\nstart: 2026-01-05\nend: 2026-01-06\ntype: project\nstatus: planned\n",
      "boxes/ghost.yaml": "id: ghost\ncode: GHO\ntitle: G\nlane: nope\nstart: 2026-01-05\nend: 2026-01-06\ntype: project\nstatus: planned\n",
      "boxes/back.yaml": "id: back\ncode: BAK\ntitle: B\nlane: e1\nstart: 2026-02-05\nend: 2026-01-06\ntype: project\nstatus: planned\n",
      "boxes/broken.yaml": "id: [unclosed\n",
    });
    expect(roadmap.boxes.map((b) => b.id)).toEqual(["ok"]);
    expect(issues.map((i) => i.path).sort()).toEqual(["boxes/back.yaml", "boxes/broken.yaml", "boxes/ghost.yaml"]);
  });
});

describe("working days", async () => {
  const { workIndex, dayOfWorkIndex, workdays, addWorkdays, nextWorkday, prevWorkday } = await import("./dates");
  const d = (s: string) => parseDay(s)!;

  it("numbers weekdays consecutively and skips weekends", () => {
    const fri = d("2026-10-02");
    expect(workIndex(d("2026-10-05")) - workIndex(fri)).toBe(1); // Fri → Mon
    expect(workIndex(d("2026-10-03"))).toBe(workIndex(d("2026-10-05"))); // Sat = next Mon
    for (const s of ["2026-10-01", "2026-10-02", "2026-10-05", "1969-12-29", "1960-06-15"]) {
      expect(dayOfWorkIndex(workIndex(d(s)))).toBe(d(s));
    }
  });

  it("counts and moves by working days", () => {
    expect(workdays(d("2026-10-05"), d("2026-10-16"))).toBe(10); // two full weeks
    expect(workdays(d("2026-10-02"), d("2026-10-05"))).toBe(2); // Fri + Mon
    expect(workdays(d("2026-10-03"), d("2026-10-04"))).toBe(0); // a weekend
    expect(formatDay(addWorkdays(d("2026-10-02"), 1))).toBe("2026-10-05");
    expect(formatDay(addWorkdays(d("2026-10-05"), -1))).toBe("2026-10-02");
    expect(formatDay(nextWorkday(d("2026-10-04")))).toBe("2026-10-05");
    expect(formatDay(prevWorkday(d("2026-10-04")))).toBe("2026-10-02");
    expect(formatDay(prevWorkday(d("2026-10-02")))).toBe("2026-10-02");
  });
});

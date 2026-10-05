import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readRoadmapDir } from "../../cli/git";
import { parseDay } from "../model/dates";
import { loadRoadmap } from "../model/parse";
import type { Box } from "../model/types";
import { boxFacts, consequences, ptoFacts } from "./consequences";
import { fitsInLane } from "./keyboard";
import { layoutDepartment } from "./layout";

const fixture = (await readRoadmapDir(fileURLToPath(new URL("../../e2e/fixtures/roadmap", import.meta.url)))).files;
const { roadmap } = loadRoadmap(fixture);
const d = (s: string) => parseDay(s)!;
const DAGSTER = "bx-c93d-dagster-upgrade";
const dagster = roadmap.boxes.find((b) => b.id === DAGSTER)!;

/** The roadmap with Dagster placed so; what holds for it then. */
function facts(at: Partial<Box>, boxes = roadmap.boxes, people = roadmap.people) {
  const box = { ...boxes.find((b) => b.id === DAGSTER)!, ...at };
  const state = { boxes: boxes.map((b) => (b.id === DAGSTER ? box : b)), departments: roadmap.departments, people };
  return boxFacts(state, box, ["data-eng", "analytics"]);
}

describe("what moving a box would do", () => {
  const before = facts({});

  it("says a department going further over capacity, and back within it", () => {
    // Its last day on CDC's first: 5 FTE on 2026-10-26.
    const later = facts({ start: d("2026-09-15"), end: d("2026-10-26") });
    expect(consequences(before, later)).toEqual(["Data Engineering is over capacity then: 5 FTE against 3.5, 2026-10-26."]);
    expect(consequences(later, before)).toEqual(["Data Engineering is over capacity then: 4 FTE against 3.5, 2026-10-01 to 2026-11-27."]);
    // Moved to Analytics' open lane: Data Engineering isn't over while it runs, nor is Analytics.
    const moved = facts({ lane: "an-3" });
    expect(consequences(before, moved)).toEqual(["Data Engineering is within capacity again."]);
    // Nothing that changed: nothing to say.
    expect(consequences(before, facts({ lane: "de-3" }))).toEqual([]);
  });

  it("says a rule broken, and kept again", () => {
    const ruled = roadmap.boxes.map((b) => (b.id === DAGSTER ? { ...b, relations: [{ type: "before" as const, box: "C4P" }] } : b));
    const ok = facts({}, ruled);
    const broken = facts({ end: d("2026-10-26") }, ruled);
    expect(consequences(ok, broken)).toContain(
      "Breaks a rule: DE-D9U Dagster 2.x upgrade should finish before DE-C4P CDC pipeline for orders DB starts, but it ends 2026-10-26 and the other starts 2026-10-26.",
    );
    expect(consequences(broken, ok)).toContain("Keeps the rule again: DE-D9U Dagster 2.x upgrade should finish before DE-C4P CDC pipeline for orders DB starts.");
  });

  it("says an engineer on it being on PTO then, and no longer", () => {
    const boxes = roadmap.boxes.map((b) => (b.id === DAGSTER ? { ...b, engineers: ["sam-lee"] } : b));
    const people = roadmap.people.map((p) => (p.id === "sam-lee" ? { ...p, pto: [{ start: d("2026-10-26"), end: d("2026-10-30") }] } : p));
    const clear = facts({}, boxes, people);
    const clash = facts({ end: d("2026-10-26") }, boxes, people);
    expect(consequences(clear, clash)).toContain("Sam Lee is on PTO 2026-10-26 to 2026-10-30 then.");
    expect(consequences(clash, clear)).toContain("No longer during Sam Lee’s PTO.");
  });

  it("for PTO: the person's boxes it overlaps", () => {
    const sam = { ...roadmap.people.find((p) => p.id === "sam-lee")!, pto: [{ start: d("2026-12-14"), end: d("2026-12-18") }] };
    const boxes = roadmap.boxes.map((b) => (b.id === DAGSTER ? { ...b, engineers: ["sam-lee"] } : b));
    const away = ptoFacts(boxes, sam, sam.pto[0]);
    const onIt = ptoFacts(boxes, sam, { start: d("2026-10-19"), end: d("2026-10-23") });
    expect(consequences(away, onIt)).toEqual(["Sam Lee is booked on Dagster 2.x upgrade then."]);
    expect(consequences(onIt, away)).toEqual(["No longer during Dagster 2.x upgrade."]);
  });
});

describe("fitsInLane", () => {
  const de = roadmap.departments.find((x) => x.id === "data-eng")!;
  const deBoxes = roadmap.boxes.filter((b) => de.lanes.some((l) => l.id === b.lane));
  const layout = layoutDepartment(de, deBoxes);

  it("is false where other boxes are drawn then, or the box needs more room than is left", () => {
    expect(fitsInLane(de, layout, deBoxes, dagster, "de-2")).toBe(true); // its own place
    expect(fitsInLane(de, layout, deBoxes, dagster, "de-3")).toBe(false); // Terraform cleanup is drawn there
    expect(fitsInLane(de, layout, deBoxes, dagster, "de-4")).toBe(false); // a 1-FTE box in the half lane at the bottom
    expect(fitsInLane(de, layout, deBoxes, { ...dagster, start: d("2027-03-01"), end: d("2027-03-05") }, "de-3")).toBe(true);
    expect(fitsInLane(de, layout, deBoxes, { ...dagster, fte: 0.5, start: d("2027-03-01"), end: d("2027-03-05") }, "de-4")).toBe(true);
  });

  it("is false where the lane is closed then", () => {
    const closing = { ...de, lanes: de.lanes.map((l) => (l.id === "de-3" ? { ...l, end: d("2027-01-29") } : l)) };
    const at = { ...dagster, start: d("2027-03-01"), end: d("2027-03-05") };
    expect(fitsInLane(closing, layoutDepartment(closing, deBoxes), deBoxes, at, "de-3")).toBe(false);
  });
});

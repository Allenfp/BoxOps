import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readRoadmapDir } from "../../cli/git";
import { parseDay } from "./dates";
import type { DraftState } from "./draft";
import { loadRoadmap } from "./parse";
import { packRows, ptoClashes } from "./pto";
import { serializeChanges } from "./serialize";
import { describeChanges } from "./summary";
import type { TimeOff } from "./types";

const files = (await readRoadmapDir(resolve(__dirname, "../../e2e/fixtures/roadmap"))).files;
const { roadmap } = loadRoadmap(files);
const base: DraftState = { boxes: roadmap.boxes, departments: roadmap.departments, people: roadmap.people, settings: roadmap.settings };
const d = (s: string) => parseDay(s)!;
const withPto = (id: string, pto: TimeOff[]): DraftState => ({
  ...base,
  people: base.people.map((p) => (p.id === id ? { ...p, pto } : p)),
});

describe("PTO", () => {
  it("loads from people.yaml and reports bad entries", () => {
    const people = `people:
  - id: sam-lee
    name: Sam Lee
    department: data-eng
    pto:
      - start: 2026-12-14
        end: 2026-12-25
        note: Holiday
      - start: 2026-12-12
        end: 2026-12-14
      - start: 2026-11-10
        end: 2026-11-02
      - nope
`;
    const { roadmap: r, issues } = loadRoadmap({ ...files, "people.yaml": people });
    const sam = r.people.find((p) => p.id === "sam-lee")!;
    expect(sam.pto).toEqual([
      { start: d("2026-12-14"), end: d("2026-12-25"), note: "Holiday" },
      { start: d("2026-12-12"), end: d("2026-12-14"), note: undefined },
    ]);
    expect(issues.map((i) => i.message)).toEqual([
      'person "sam-lee", PTO "2026-12-12", start: Saturday — roadmap dates must be weekdays',
      'person "sam-lee", PTO "2026-11-10", end (2026-11-02) is before start (2026-11-10)',
      'person "sam-lee", PTO 4: expected a mapping',
    ]);
  });

  it("is written under the person, and removing the last one drops the key", () => {
    const draft = withPto("sam-lee", [{ start: d("2026-12-14"), end: d("2026-12-25"), note: " Holiday " }]);
    const text = serializeChanges(files, base, draft)["people.yaml"]!;
    expect(text).toContain(
      "  - id: sam-lee\n    name: Sam Lee\n    department: data-eng\n    pto:\n      - start: 2026-12-14\n        end: 2026-12-25\n        note: Holiday\n  - id:",
    );
    const saved = { ...files, "people.yaml": text };
    const loaded = loadRoadmap(saved).roadmap;
    const savedBase = { boxes: loaded.boxes, departments: loaded.departments, people: loaded.people, settings: loaded.settings };
    const cleared = { ...savedBase, people: savedBase.people.map((p) => (p.id === "sam-lee" ? { ...p, pto: [] } : p)) };
    expect(serializeChanges(saved, savedBase, cleared)["people.yaml"]).toBe(files["people.yaml"]);
  });

  it("describes additions, moves and removals", () => {
    const one = withPto("sam-lee", [{ start: d("2026-12-14"), end: d("2026-12-25"), note: "Holiday" }]);
    expect(describeChanges(base, one).map((l) => l.text)).toEqual([
      "PTO for **Sam Lee**: 2026-12-14 – 2026-12-25 (Holiday)",
    ]);
    const moved = withPto("sam-lee", [{ start: d("2026-12-21"), end: d("2026-12-25"), note: "Holiday" }]);
    expect(describeChanges(one, moved).map((l) => l.text)).toEqual([
      "PTO for **Sam Lee**: 2026-12-21 – 2026-12-25 (Holiday) (was 2026-12-14 – 2026-12-25)",
    ]);
    expect(describeChanges(one, base).map((l) => l.text)).toEqual([
      "Removed PTO for **Sam Lee**: 2026-12-14 – 2026-12-25",
    ]);
  });

  it("packs overlapping blocks into rows and finds engineers booked while away", () => {
    const a = { pto: { start: d("2026-10-12"), end: d("2026-10-23") } };
    const b = { pto: { start: d("2026-10-19"), end: d("2026-10-21") } };
    const c = { pto: { start: d("2026-10-26"), end: d("2026-10-30") } };
    const { rows, count } = packRows([c, b, a]);
    expect([rows.get(a), rows.get(b), rows.get(c), count]).toEqual([0, 1, 0, 2]);

    const draft = withPto("alex-kim", [a.pto]);
    const boxes = draft.boxes.map((x) => (x.id === "bx-c93d-dagster-upgrade" ? { ...x, engineers: ["alex-kim"] } : x));
    expect(ptoClashes(boxes, draft.people).map((x) => `${x.person.id}:${x.box.id}`)).toEqual([
      "alex-kim:bx-c93d-dagster-upgrade",
    ]);
  });
});

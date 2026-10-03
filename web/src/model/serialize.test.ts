import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDay } from "./dates";
import type { DraftState } from "./draft";
import { readRoadmapDir } from "./files";
import { loadRoadmap } from "./load";
import { applyChanges, serializeChanges } from "./serialize";
import { describeChanges } from "./summary";

const files = readRoadmapDir(resolve(__dirname, "../../../roadmap"));
const { roadmap } = loadRoadmap(files);
const base: DraftState = { boxes: roadmap.boxes, departments: roadmap.departments };

const editBox = (id: string, patch: object): DraftState => ({
  ...base,
  boxes: base.boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)),
});

describe("serializeChanges", () => {
  it("writes nothing when nothing changed", () => {
    expect(serializeChanges(files, base, base)).toEqual({});
  });

  it("changes only the edited lines of a box file", () => {
    const draft = editBox("bx-c93d-dagster-upgrade", { start: parseDay("2026-09-24")!, end: parseDay("2026-11-02")! });
    const out = serializeChanges(files, base, draft);
    const path = "boxes/bx-c93d-dagster-upgrade.yaml";
    expect(Object.keys(out)).toEqual([path]);
    const before = files[path].split("\n");
    const after = out[path]!.split("\n");
    const diff = after.filter((line, i) => line !== before[i]);
    expect(diff).toEqual(["start: 2026-09-24", "end: 2026-11-02"]);
  });

  it("adds, clears and deletes optional fields and files", () => {
    let draft = editBox("bx-a1f0-warehouse-migration", { epic: undefined, tags: ["iceberg", "q4"] });
    draft = { ...draft, boxes: draft.boxes.filter((b) => b.id !== "bx-b27c-fivetran-cost-review") };
    draft = {
      ...draft,
      boxes: [
        ...draft.boxes,
        { id: "bx-0001-new-thing", title: "New: thing", lane: "an-3", start: 100, end: 120, type: "project", status: "planned" },
      ],
    };
    const out = serializeChanges(files, base, draft);
    expect(out["boxes/bx-b27c-fivetran-cost-review.yaml"]).toBeNull();
    expect(out["boxes/bx-a1f0-warehouse-migration.yaml"]).not.toContain("epic:");
    expect(out["boxes/bx-a1f0-warehouse-migration.yaml"]).toContain("tags:\n  - iceberg\n  - q4\n");
    expect(out["boxes/bx-0001-new-thing.yaml"]).toBe(
      'id: bx-0001-new-thing\ntitle: "New: thing"\nlane: an-3\nstart: 1970-04-11\nend: 1970-05-01\ntype: project\nstatus: planned\n',
    );
    const { issues } = loadRoadmap(applyChanges(files, out));
    expect(issues).toEqual([]);
  });

  it("renames a lane without touching the rest of the department file", () => {
    const original = "# Data team lanes\nid: eng\nname: Eng\nlanes:\n  - id: e1 # first hire\n    fte: 1\n  - id: e2\n    fte: 0.5\n";
    const dept = { id: "eng", name: "Eng", color: "#8a94a6", order: 0, collapsed: false, lanes: [{ id: "e1", fte: 1 }, { id: "e2", fte: 0.5 }] };
    const b: DraftState = { boxes: [], departments: [dept] };
    const d: DraftState = { boxes: [], departments: [{ ...dept, lanes: [{ id: "e1", fte: 1, name: "Platform" }, dept.lanes[1]] }] };
    const out = serializeChanges({ "departments/eng.yaml": original }, b, d);
    expect(out["departments/eng.yaml"]).toBe(
      "# Data team lanes\nid: eng\nname: Eng\nlanes:\n  - id: e1 # first hire\n    fte: 1\n    name: Platform\n  - id: e2\n    fte: 0.5\n",
    );
  });
});

describe("describeChanges", () => {
  it("says what happened in plain words", () => {
    const draft = editBox("bx-c93d-dagster-upgrade", {
      start: parseDay("2026-09-24")!,
      end: parseDay("2026-11-02")!,
      lane: "de-4",
      status: "in_progress",
    });
    const [line] = describeChanges(base, draft, roadmap.settings);
    expect(line.text).toBe(
      "**Dagster 2.x upgrade**: moved from Data Engineering / FTE 2 to Data Engineering / Contractor; " +
        "rescheduled to Sep 24, 2026 – Nov 2, 2026 (was Sep 14, 2026 – Oct 23, 2026); status At risk → In progress",
    );
  });
});

describe("commitMessage", () => {
  it("uses a clean one-line subject", async () => {
    const { commitMessage } = await import("./summary");
    const one = commitMessage([
      { kind: "changed", text: "**Dagster 2.x upgrade**: rescheduled to Sep 24, 2026 – Nov 2, 2026 (was Sep 14, 2026 – Oct 23, 2026)" },
    ]);
    expect(one.split("\n")[0]).toBe("Dagster 2.x upgrade: rescheduled to Sep 24, 2026 – Nov 2, 2026");
    const long = commitMessage([
      { kind: "changed", text: "**A very long box title that goes on**: moved from Data Engineering / FTE 2 to Analytics / Open req (Q1); status At risk → Done" },
    ]);
    expect(long.split("\n")[0].length).toBeLessThanOrEqual(72);
    expect(long.split("\n")[0].endsWith("…")).toBe(true);
    expect(commitMessage([{ kind: "added", text: "a" }, { kind: "deleted", text: "b" }]).split("\n")[0]).toBe("Roadmap: 2 changes");
  });
});

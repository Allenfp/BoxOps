import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDay } from "./dates";
import type { DraftState } from "./draft";
import { readRoadmapDir } from "./files";
import { loadRoadmap } from "./load";
import { applyChanges, serializeChanges } from "./serialize";
import { describeChanges } from "./summary";

// The fixed sample roadmap the browser tests use, minus its roster (tests below add their own).
const { "people.yaml": _roster, ...files } = readRoadmapDir(resolve(__dirname, "../../e2e/fixtures/roadmap"));
const { roadmap } = loadRoadmap(files);
const base: DraftState = { boxes: roadmap.boxes, departments: roadmap.departments, people: roadmap.people };

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
        { id: "bx-0001-new-thing", code: "NEW", title: "New: thing", lane: "an-3", start: 102, end: 120, type: "project", status: "blocked", fte: 1 },
      ],
    };
    const out = serializeChanges(files, base, draft);
    expect(out["boxes/bx-b27c-fivetran-cost-review.yaml"]).toBeNull();
    expect(out["boxes/bx-a1f0-warehouse-migration.yaml"]).not.toContain("epic:");
    expect(out["boxes/bx-a1f0-warehouse-migration.yaml"]).toContain("tags:\n  - iceberg\n  - q4\n");
    expect(out["boxes/bx-0001-new-thing.yaml"]).toBe(
      'id: bx-0001-new-thing\ncode: NEW\ntitle: "New: thing"\nlane: an-3\nstart: 1970-04-13\nend: 1970-05-01\ntype: project\nstatus: blocked\n',
    );
    const { issues } = loadRoadmap(applyChanges(files, out));
    expect(issues).toEqual([]);
  });

  it("renames a lane without touching the rest of the department file", () => {
    const original = "# Data team lanes\nid: eng\ncode: EN\nname: Eng\nlanes:\n  - id: e1 # first hire\n    fte: 1\n  - id: e2\n    fte: 0.5\n";
    const dept = { id: "eng", code: "EN", name: "Eng", color: "#8a94a6", order: 0, collapsed: false, lanes: [{ id: "e1", fte: 1 }, { id: "e2", fte: 0.5 }] };
    const b: DraftState = { boxes: [], departments: [dept], people: [] };
    const d: DraftState = { boxes: [], departments: [{ ...dept, lanes: [{ id: "e1", fte: 1, name: "Platform" }, dept.lanes[1]] }], people: [] };
    const out = serializeChanges({ "departments/eng.yaml": original }, b, d);
    expect(out["departments/eng.yaml"]).toBe(
      "# Data team lanes\nid: eng\ncode: EN\nname: Eng\nlanes:\n  - id: e1 # first hire\n    name: Platform\n    fte: 1\n  - id: e2\n    fte: 0.5\n",
    );
  });
});

describe("describeChanges", () => {
  it("says what happened in plain words", () => {
    const draft = editBox("bx-c93d-dagster-upgrade", {
      start: parseDay("2026-09-24")!,
      end: parseDay("2026-11-02")!,
      lane: "de-4",
      status: undefined,
    });
    const [line] = describeChanges(base, draft, roadmap.settings);
    expect(line.text).toBe(
      "**Dagster 2.x upgrade** (DE-D9U): moved from Data Engineering / FTE 2 to Data Engineering / Contractor; " +
        "rescheduled to Sep 24, 2026 – Nov 2, 2026 (was Sep 14, 2026 – Oct 23, 2026); status At risk → On track",
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
      { kind: "changed", text: "**A very long box title that goes on**: moved from Data Engineering / FTE 2 to Analytics / Open req (Q1); status At risk → On track" },
    ]);
    expect(long.split("\n")[0].length).toBeLessThanOrEqual(72);
    expect(long.split("\n")[0].endsWith("…")).toBe(true);
    expect(commitMessage([{ kind: "added", text: "a" }, { kind: "deleted", text: "b" }]).split("\n")[0]).toBe("Roadmap: 2 changes");
  });
});

describe("fte, engineers and the roster", () => {
  const people = "people:\n  - id: sam-lee\n    name: Sam Lee\n    department: data-eng\n";
  const withPeople = { ...files, "people.yaml": people };

  it("loads and validates them", () => {
    const ok = loadRoadmap({
      ...withPeople,
      "boxes/bx-c93d-dagster-upgrade.yaml": files["boxes/bx-c93d-dagster-upgrade.yaml"] + "fte: 2\nengineers:\n  - sam-lee\n",
    });
    expect(ok.issues).toEqual([]);
    const dag = ok.roadmap.boxes.find((b) => b.id === "bx-c93d-dagster-upgrade")!;
    expect(dag.fte).toBe(2);
    expect(dag.engineers).toEqual(["sam-lee"]);
    expect(ok.roadmap.boxes.find((b) => b.id !== dag.id)!.fte).toBe(1); // default

    const bad = loadRoadmap({
      ...withPeople,
      "boxes/bx-c93d-dagster-upgrade.yaml": files["boxes/bx-c93d-dagster-upgrade.yaml"] + "fte: 3\n",
      "boxes/bx-d4e1-cdc-pipeline.yaml": files["boxes/bx-d4e1-cdc-pipeline.yaml"] + "engineers: [ghost]\n",
    });
    expect(bad.issues.map((i) => i.message)).toEqual([
      "fte: expected one of 0.5, 1, 1.5, 2",
      'engineers: "ghost" is not in people.yaml',
    ]);
  });

  it("writes fte only when it isn't 1, and engineers as a list", () => {
    const { roadmap: r } = loadRoadmap(withPeople);
    const b: DraftState = { boxes: r.boxes, departments: r.departments, people: r.people };
    const d: DraftState = {
      ...b,
      boxes: b.boxes.map((x) => (x.id === "bx-c93d-dagster-upgrade" ? { ...x, fte: 1.5, engineers: ["sam-lee"] } : x)),
    };
    const out = serializeChanges(withPeople, b, d);
    expect(out["boxes/bx-c93d-dagster-upgrade.yaml"]).toContain("status: at_risk\nfte: 1.5\nengineers:\n  - sam-lee\n");
    const back = { ...d, boxes: d.boxes.map((x) => (x.id === "bx-c93d-dagster-upgrade" ? { ...x, fte: 1 } : x)) };
    expect(serializeChanges(withPeople, b, back)["boxes/bx-c93d-dagster-upgrade.yaml"]).not.toContain("fte:");
  });

  it("clearing a flag removes the status line; setting one adds it", () => {
    const { roadmap: r } = loadRoadmap(withPeople);
    const b: DraftState = { boxes: r.boxes, departments: r.departments, people: r.people };
    const set = (id: string, status: string | undefined) => ({ ...b, boxes: b.boxes.map((x) => (x.id === id ? { ...x, status } : x)) });
    const cleared = serializeChanges(withPeople, b, set("bx-c93d-dagster-upgrade", undefined))["boxes/bx-c93d-dagster-upgrade.yaml"];
    expect(cleared).not.toContain("status");
    const blocked = serializeChanges(withPeople, b, set("bx-d4e1-cdc-pipeline", "blocked"))["boxes/bx-d4e1-cdc-pipeline.yaml"];
    expect(blocked).toMatch(/^type: \w+\nstatus: blocked\n/m);
  });

  it("adds engineers to people.yaml, keeping the existing entries as written", () => {
    const { roadmap: r } = loadRoadmap(withPeople);
    const b: DraftState = { boxes: r.boxes, departments: r.departments, people: r.people };
    const d: DraftState = { ...b, people: [...b.people, { id: "priya-shah", name: "Priya Shah", department: "analytics" }] };
    expect(serializeChanges(withPeople, b, d)["people.yaml"]).toBe(
      people + "  - id: priya-shah\n    name: Priya Shah\n    department: analytics\n",
    );
    // A roadmap without a roster gets a new file.
    const none = { boxes: r.boxes, departments: r.departments, people: [] };
    expect(serializeChanges(files, none, { ...none, people: [{ id: "a", name: "A" }] })["people.yaml"]).toBe(
      "people:\n  - id: a\n    name: A\n",
    );
    expect(describeChanges(b, d, r.settings)[0].text).toBe("Added engineer **Priya Shah**");
  });
});

describe("weekday dates", () => {
  it("flags a weekend start or end without dropping the box", () => {
    const { roadmap: r, issues } = loadRoadmap({
      ...files,
      "boxes/bx-c93d-dagster-upgrade.yaml": files["boxes/bx-c93d-dagster-upgrade.yaml"]
        .replace("start: 2026-09-14", "start: 2026-09-12")
        .replace("end: 2026-10-23", "end: 2026-10-25"),
    });
    expect(issues.map((i) => i.message)).toEqual([
      "start: Saturday — roadmap dates must be weekdays",
      "end: Sunday — roadmap dates must be weekdays",
    ]);
    expect(r.boxes.some((b) => b.id === "bx-c93d-dagster-upgrade")).toBe(true);
  });
});

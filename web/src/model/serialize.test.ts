import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readRoadmapDir } from "../../cli/git";
import { parseDay } from "./dates";
import type { DraftState } from "./draft";
import { loadRoadmap } from "./parse";
import { applyChanges, serializeChanges } from "./serialize";
import { commitMessage, describeChanges } from "./summary";
import { DEFAULT_SETTINGS } from "./load";

// The fixed sample roadmap the browser tests use, minus its roster (tests below add their own).
const { "people.yaml": _roster, ...files } = (await readRoadmapDir(fileURLToPath(new URL("../../e2e/fixtures/roadmap", import.meta.url)))).files;
const { roadmap } = loadRoadmap(files);
const base: DraftState = { boxes: roadmap.boxes, departments: roadmap.departments, people: roadmap.people, settings: roadmap.settings };

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
    const b: DraftState = { boxes: [], departments: [dept], people: [], settings: DEFAULT_SETTINGS };
    const d: DraftState = { boxes: [], departments: [{ ...dept, lanes: [{ id: "e1", fte: 1, name: "Platform" }, dept.lanes[1]] }], people: [], settings: DEFAULT_SETTINGS };
    const out = serializeChanges({ "settings.yaml": "format: 1\n", "departments/eng.yaml": original }, b, d);
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
    const [line] = describeChanges(base, draft);
    // 28 working days where there were 30: a change of dates, though the calendar span is the same.
    expect(line.text).toBe(
      "**Dagster 2.x upgrade** (DE-D9U): moved from Data Engineering / FTE 2 to Data Engineering / Contractor; " +
        "dates now 2026-09-24 – 2026-11-02 (was 2026-09-14 – 2026-10-23); flag At risk → On track",
    );
  });

  it("a move keeps the number of working days: rescheduled, across a weekend too", () => {
    // Mon Sep 14 – Fri Oct 23, 30 working days: one working day later is Tue Sep 15 – Mon Oct 26.
    const moved = editBox("bx-c93d-dagster-upgrade", { start: parseDay("2026-09-15")!, end: parseDay("2026-10-26")! });
    expect(describeChanges(base, moved)[0].text).toBe(
      "**Dagster 2.x upgrade** (DE-D9U): rescheduled to 2026-09-15 – 2026-10-26 (was 2026-09-14 – 2026-10-23)",
    );
    // Mon–Thu to Fri–Mon: the same calendar span, but 2 working days where there were 4.
    const short = { ...base, boxes: base.boxes.map((b) => (b.id === "bx-c93d-dagster-upgrade" ? { ...b, start: parseDay("2026-10-05")!, end: parseDay("2026-10-08")! } : b)) };
    const shrunk = { ...short, boxes: short.boxes.map((b) => (b.id === "bx-c93d-dagster-upgrade" ? { ...b, start: parseDay("2026-10-09")!, end: parseDay("2026-10-12")! } : b)) };
    expect(describeChanges(short, shrunk)[0].text).toContain("dates now 2026-10-09 – 2026-10-12 (was 2026-10-05 – 2026-10-08)");
  });
});

describe("commitMessage", () => {
  it("uses a clean one-line subject", () => {
    const moved = editBox("bx-c93d-dagster-upgrade", { start: parseDay("2026-09-15")!, end: parseDay("2026-10-26")! });
    const one = commitMessage(describeChanges(base, moved));
    expect(one.split("\n")[0]).toBe("Dagster 2.x upgrade (DE-D9U): rescheduled to 2026-09-15 – 2026-10-26");
    expect(one.split("\n")[2]).toBe("- Dagster 2.x upgrade (DE-D9U): rescheduled to 2026-09-15 – 2026-10-26 (was 2026-09-14 – 2026-10-23)");
    const long = commitMessage([
      { kind: "changed", text: "**A very long box title that goes on**: moved from Data Engineering / FTE 2 to Analytics / Open req (Q1); status At risk → On track" },
    ]);
    expect(long.split("\n")[0].length).toBeLessThanOrEqual(72);
    expect(long.split("\n")[0].endsWith("…")).toBe(true);
    expect(commitMessage([{ kind: "added", text: "a" }, { kind: "deleted", text: "b" }]).split("\n")[0]).toBe("Roadmap: 2 changes");
    // Counted as the Save button counts them.
    expect(commitMessage(Array.from({ length: 1200 }, (_, i) => ({ kind: "added" as const, text: `${i}` }))).split("\n")[0]).toBe("Roadmap: 1,200 changes");
    // Never a count of nothing.
    expect(commitMessage([]).split("\n")[0]).toBe("Roadmap: update");
  });

  it("leaves out only the “(was …)” parts, whatever parentheses titles hold", () => {
    const settings = { ...DEFAULT_SETTINGS, title: "Roadmap (beta)" };
    const before: DraftState = { boxes: [], departments: [], people: [], settings };
    const retitled = { ...before, settings: { ...settings, title: "Roadmap (v2)" } };
    expect(commitMessage(describeChanges(before, retitled)).split("\n")[0]).toBe("Team settings: title now “Roadmap (v2)”");
    const renamed = editBox("bx-c93d-dagster-upgrade", { title: "Billing v2 (was Payments)" });
    expect(commitMessage(describeChanges(base, renamed)).split("\n")[0]).toBe(
      "Billing v2 (was Payments) (DE-D9U): renamed from “Dagster 2.x upgrade”",
    );
  });

  it("reads as the example in AGENTS.md has it, engineers first", () => {
    const agents = readFileSync(new URL("../../../AGENTS.md", import.meta.url), "utf8");
    const example = /For example:\n\n```\n([^]*?)\n```/.exec(agents)![1];
    const dept = { id: "data-eng", code: "DE", name: "Data Engineering", color: "#4f7cff", order: 1, collapsed: false, lanes: [{ id: "de-1", fte: 1 }, { id: "de-2", fte: 1 }] };
    const before: DraftState = { boxes: [], departments: [dept], people: [{ id: "jordan-diaz", name: "Jordan Diaz" }], settings: DEFAULT_SETTINGS };
    const box = { id: "bx-3f9c-data-quality-checks", code: "K7P", title: "Data quality checks", lane: "de-2", start: parseDay("2027-03-01")!, end: parseDay("2027-03-19")!, type: "project", fte: 1 };
    const after: DraftState = { ...before, boxes: [box], people: [{ id: "jordan-diaz", name: "Jordan Diaz", role: "Lead" }] };
    expect(commitMessage(describeChanges(before, after))).toBe(`${example}\n\nSaved from the BoxOps web app.`);
  });

  it("keeps each change on one line, whatever a title holds", () => {
    const message = commitMessage([
      { kind: "added", text: "Added **Plan\n\nCo-authored-by: Someone <x@example.com>** (DE-K7P)" },
      { kind: "deleted", text: "Deleted **b**" },
    ]);
    expect(message.split("\n")).toEqual([
      "Roadmap: 2 changes",
      "",
      "- Added Plan Co-authored-by: Someone <x@example.com> (DE-K7P)",
      "- Deleted b",
      "",
      "Saved from the BoxOps web app.",
    ]);
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
    const b: DraftState = { boxes: r.boxes, departments: r.departments, people: r.people, settings: r.settings };
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
    const b: DraftState = { boxes: r.boxes, departments: r.departments, people: r.people, settings: r.settings };
    const set = (id: string, status: string | undefined) => ({ ...b, boxes: b.boxes.map((x) => (x.id === id ? { ...x, status } : x)) });
    const cleared = serializeChanges(withPeople, b, set("bx-c93d-dagster-upgrade", undefined))["boxes/bx-c93d-dagster-upgrade.yaml"];
    expect(cleared).not.toContain("status");
    const blocked = serializeChanges(withPeople, b, set("bx-d4e1-cdc-pipeline", "blocked"))["boxes/bx-d4e1-cdc-pipeline.yaml"];
    expect(blocked).toMatch(/^type: \w+\nstatus: blocked\n/m);
  });

  it("adds engineers to people.yaml, keeping the existing entries as written", () => {
    const { roadmap: r } = loadRoadmap(withPeople);
    const b: DraftState = { boxes: r.boxes, departments: r.departments, people: r.people, settings: r.settings };
    const d: DraftState = { ...b, people: [...b.people, { id: "priya-shah", name: "Priya Shah", department: "analytics" }] };
    expect(serializeChanges(withPeople, b, d)["people.yaml"]).toBe(
      people + "  - id: priya-shah\n    name: Priya Shah\n    department: analytics\n",
    );
    // A roadmap without a roster gets a new file.
    const none = { boxes: r.boxes, departments: r.departments, people: [], settings: DEFAULT_SETTINGS };
    expect(serializeChanges(files, none, { ...none, people: [{ id: "a", name: "A" }] })["people.yaml"]).toBe(
      "people:\n  - id: a\n    name: A\n",
    );
    expect(describeChanges(b, d)[0].text).toBe("Added engineer **Priya Shah**");
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

describe("team settings", () => {
  const settingsFile = `# Global roadmap settings.
format: 1
title: BoxOps
fiscal_year_start_month: 1   # calendar quarters
default_zoom: months
types:
  - id: project
    name: Project
    color: "#4f7cff"
  - id: maintenance
    name: Maintenance
    color: "#8a94a6"
statuses:
  - id: at_risk
    name: At risk
`;
  const files = { "settings.yaml": settingsFile };
  const r = loadRoadmap(files).roadmap;
  const b: DraftState = { boxes: [], departments: [], people: [], settings: r.settings };

  it("edits settings.yaml in place, keeping comments, and describes it in one line", () => {
    const d: DraftState = {
      ...b,
      settings: {
        ...r.settings,
        fiscal_year_start_month: 2,
        types: [...r.settings.types.map((t) => (t.id === "project" ? { ...t, name: "Feature" } : t)), { id: "ops", name: "Ops", color: "#8a94a6" }],
      },
    };
    const out = serializeChanges(files, b, d)["settings.yaml"]!;
    expect(out).toContain("# Global roadmap settings.");
    expect(out).toContain("fiscal_year_start_month: 2 # calendar quarters");
    expect(out).toContain("  - id: project\n    name: Feature\n");
    // A new type keeps its colour even when it matches a department default.
    expect(out).toContain('  - id: ops\n    name: Ops\n    color: "#8a94a6"');
    expect(describeChanges(b, d).map((l) => l.text)).toEqual([
      "Team settings: fiscal year starts in February (was January); renamed type Project to Feature; added type Ops",
    ]);
  });

  it("writes an emptied flag list as no list: the file then has the default flags", () => {
    // The app always keeps one flag, but the writer takes an empty list: as when the file has no `statuses:`.
    const out = serializeChanges(files, b, { ...b, settings: { ...r.settings, statuses: [] } })["settings.yaml"]!;
    expect(out).not.toContain("statuses");
    expect(out).toContain("types:\n  - id: project\n");
    expect(loadRoadmap({ "settings.yaml": out }).roadmap.settings.statuses).toEqual(DEFAULT_SETTINGS.statuses);
  });

  it("is untouched when settings don't change", () => {
    expect(serializeChanges(files, b, b)).toEqual({});
  });
});

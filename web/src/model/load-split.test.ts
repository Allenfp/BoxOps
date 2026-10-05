// Loading in two phases (parseFile per file, then assemble across files)
// gives exactly what the loader gave before the split (load-before-split.ts):
// the same roadmap, problems in the same order with the same lines and keys,
// lossy files and sources, for the repo's roadmap, the browser tests' fixture,
// a generated 2,000-box roadmap and one full of problems that span files.

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readRoadmapDir } from "../../cli/git";
import { generateRoadmap } from "../../scripts/gen-roadmap";
import { loadRoadmap as loadBeforeSplit } from "./load-before-split";
import { loadRoadmap } from "./parse";
import type { RoadmapFiles } from "./types";

const folder = (path: string) => readRoadmapDir(fileURLToPath(new URL(path, import.meta.url)));
/** As JSON, maps as their entries in order: key order counts too. */
const json = (value: unknown) => JSON.stringify(value, (_, v: unknown) => (v instanceof Map ? [...v] : v));

/** The fixture with problems in every check that spans files, in an order that interleaves them. */
function messy(files: RoadmapFiles): RoadmapFiles {
  const out = { ...files };
  const box = (id: string) => out[`boxes/${id}.yaml`];
  const dagster = box("bx-c93d-dagster-upgrade");
  // Departments: a .yml twin of a department, and one sharing a lane and a code with another.
  out["departments/analytics.yml"] = out["departments/analytics.yaml"];
  out["departments/zz-ops.yaml"] = out["departments/data-eng.yaml"].replace("id: data-eng", "id: zz-ops").replace("- id: de-1", "- id: zz-1");
  // A person in a department that doesn't exist, between people who are fine.
  out["people.yaml"] = out["people.yaml"].replace("    department: data-eng\n", "    department: nowhere\n");
  // Boxes: a copy under another name, a .yml twin, a shared code, missing lane, type, flag,
  // engineer and rule target, a rule about itself, and a file that doesn't parse.
  out["boxes/bx-0000-copy.yaml"] = dagster;
  out["boxes/bx-c93d-dagster-upgrade.yml"] = dagster;
  out["boxes/bx-0a7c-terraform-cleanup.yaml"] = box("bx-0a7c-terraform-cleanup")
    .replace(/^code: .*$/m, "code: D9U")
    .replace(/^type: .*$/m, "type: nope\nstatus: nope")
    .concat("relations:\n  - type: before\n    box: ZZZ\n  - type: after\n    box: D9U\n");
  out["boxes/bx-1b8d-revenue-mart.yaml"] = box("bx-1b8d-revenue-mart").replace(/^lane: .*$/m, "lane: nowhere");
  out["boxes/bx-2c9e-exec-dashboards.yaml"] = box("bx-2c9e-exec-dashboards").concat("engineers:\n  - ghost\n  - alex-kim\n  - ghost-2\n");
  out["boxes/bx-3d0f-attribution-model.yaml"] = "id: [unclosed\n";
  // Files that aren't roadmap files.
  out["notes.md"] = "# Notes\n";
  out["people.yml"] = "people: []\n";
  return out;
}

const repo = await folder("../../../roadmap");
const fixture = await folder("../../e2e/fixtures/roadmap");

describe("loading in two phases", () => {
  const cases: [string, RoadmapFiles, string[]][] = [
    ["the repo's roadmap", repo.files, repo.ignored],
    ["the browser tests' fixture", fixture.files, fixture.ignored],
    ["a generated 2,000-box roadmap", generateRoadmap(2000, "2026-10-03"), []],
    ["a roadmap with problems across files", messy(fixture.files), ["README.md", "notes.md"]],
    ["a roadmap without settings.yaml or people.yaml", Object.fromEntries(Object.entries(fixture.files).filter(([p]) => p !== "settings.yaml" && p !== "people.yaml")), []],
  ];

  it.each(cases)("loads %s exactly as before the split", (_, files, ignored) => {
    const before = loadBeforeSplit(files, ignored);
    const after = loadRoadmap(files, ignored);
    expect(after).toStrictEqual(before);
    expect(json(after)).toBe(json(before));
  });

  it("covers the problems it means to", () => {
    const { issues } = loadRoadmap(messy(fixture.files), ["README.md"]);
    const messages = issues.map((i) => i.message).join("\n");
    for (const part of ["already used by", "is already used in department", "is also used in department", 'is also used by department "data-eng"', 'department: "nowhere"', "doesn't match the file name", 'code: "D9U" is also used by', "does not exist in any department", "is not defined in settings.yaml", 'engineers: "ghost"', 'no box has code "ZZZ"', "can't have a rule about itself", "YAML syntax error", "unexpected file", "rename this file"]) {
      expect(messages).toContain(part);
    }
  });
});

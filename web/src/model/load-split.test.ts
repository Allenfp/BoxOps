// Loading the app's way (loadFolder: parseFile per blob, kept, or taken as
// JSON from the build; then assemble across files) gives exactly what
// loadRoadmap does: the same roadmap, problems in the same order with the
// same lines and keys, lossy files and sources, for the browser tests'
// fixture, a generated 2,000-box roadmap and one full of problems that span
// files.

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readRoadmapDir } from "../../cli/git";
import { hashFolder } from "../../cli/site";
import { generateRoadmap } from "../../scripts/gen-roadmap";
import { type ParsedFile, forgetParsed, loadFolder, loadFolderNow, rememberParsed } from "./load";
import { loadRoadmap, parseFile } from "./parse";
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

const fixture = await folder("../../e2e/fixtures/roadmap");

describe("the roadmap with problems across files", () => {
  it("has the problems it means to", () => {
    const { issues } = loadRoadmap(messy(fixture.files), ["README.md"]);
    const messages = issues.map((i) => i.message).join("\n");
    for (const part of ["already used by", "is already used in department", "is also used in department", 'is also used by department "data-eng"', 'department: "nowhere"', "doesn't match the file name", 'code: "D9U" is also used by', "does not exist in any department", "is not defined in settings.yaml", 'engineers: "ghost"', 'no box has code "ZZZ"', "can't have a rule about itself", "YAML syntax error", "unexpected file", "rename this file"]) {
      expect(messages).toContain(part);
    }
  });
});

describe("loading in the app", () => {
  const cases: [string, RoadmapFiles][] = [
    ["the browser tests' fixture", fixture.files],
    ["a generated 2,000-box roadmap", generateRoadmap(2000, "2026-10-03")],
    // Copies of a file share its blob: what it parses to depends on the path too.
    ["a roadmap with problems across files", messy(fixture.files)],
  ];

  it.each(cases)("loads %s as loadRoadmap does, parsing each blob once", async (_, all) => {
    forgetParsed();
    const folder = await hashFolder(all);
    const expected = loadRoadmap(folder.files, folder.ignored);
    const first = await loadFolder(folder);
    expect(first).toStrictEqual(expected);
    expect(json(first)).toBe(json(expected));
    // Again: every file comes from what the first load parsed, but for a blob at more than one path.
    const again = loadFolderNow(folder)!;
    expect(json(again)).toBe(json(expected));
    const shas = Object.values(folder.blobs);
    const once = (b: { id: string }) => shas.filter((sha) => sha === folder.blobs[again.sources.boxes.get(b.id)!]).length === 1;
    expect(again.roadmap.boxes.filter(once).every((b) => first.roadmap.boxes.includes(b))).toBe(true);
    expect(again.roadmap.boxes.filter(once).length).toBeGreaterThan(again.roadmap.boxes.length - 2);
  });

  it.each(cases)("loads %s from what the build parsed, as JSON", async (_, all) => {
    forgetParsed();
    const folder = await hashFolder(all);
    const parsed: Record<string, ParsedFile> = {};
    for (const [path, sha] of Object.entries(folder.blobs)) parsed[sha] = parseFile(path, folder.files[path]);
    const fromBuild = JSON.parse(JSON.stringify(parsed)) as Record<string, ParsedFile>;
    rememberParsed(fromBuild);
    const loaded = await loadFolder(folder);
    // JSON leaves out keys whose value is undefined: nothing else differs.
    expect(loaded).toEqual(loadRoadmap(folder.files, folder.ignored));
    expect(json(loaded)).toBe(json(loadRoadmap(folder.files, folder.ignored)));
    // Taken as given, not parsed again.
    const box = loaded.roadmap.boxes[0];
    const from = fromBuild[folder.blobs[loaded.sources.boxes.get(box.id)!]];
    expect(from.kind === "box" && from.box).toBe(box);
  });

  it("parses a changed file again and keeps the others", async () => {
    forgetParsed();
    const folder = await hashFolder(fixture.files);
    const first = await loadFolder(folder);
    const path = "boxes/bx-c93d-dagster-upgrade.yaml";
    const edited = await hashFolder({ ...fixture.files, [path]: fixture.files[path].replace("Dagster 2.x upgrade", "Dagster 3 upgrade") });
    const next = await loadFolder(edited);
    expect(next.roadmap.boxes.find((b) => b.id === "bx-c93d-dagster-upgrade")?.title).toBe("Dagster 3 upgrade");
    expect(next.roadmap.boxes.filter((b) => first.roadmap.boxes.includes(b))).toHaveLength(first.roadmap.boxes.length - 1);
  });
});

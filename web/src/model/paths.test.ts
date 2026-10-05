import { describe, expect, it } from "vitest";
import { loadRoadmap } from "./load";
import { isHiddenPath, isRoadmapPath } from "./paths";

/** Does the loader take this file as a roadmap file (rather than report it as unexpected or misnamed)? */
const loaderReads = (path: string) =>
  !loadRoadmap({ [path]: "x: 1\n" }).issues.some((i) => i.path === path && /unexpected file|rename this file/.test(i.message));

describe("isRoadmapPath", () => {
  const paths = {
    yes: ["settings.yaml", "people.yaml", "departments/eng.yaml", "departments/eng.yml", "boxes/bx-1a2b-x.yaml", "boxes/b1.yml"],
    no: [
      "settings.yml",
      "people.yml",
      "README.md",
      ".template.yaml",
      "notes/x.yaml",
      "boxes/sub/b1.yaml",
      "boxes/.b1.yaml",
      "departments/.eng.yml",
      "boxes/b1.json",
      "boxes/b1.YAML",
      "Boxes/b1.yaml",
      "boxes/",
      "boxes/.yaml",
      "/settings.yaml",
    ],
  };

  it("names exactly the files the loader reads", () => {
    for (const path of [...paths.yes, ...paths.no]) expect([path, isRoadmapPath(path)]).toEqual([path, loaderReads(path)]);
    expect(paths.yes.every(isRoadmapPath)).toBe(true);
    expect(paths.no.some(isRoadmapPath)).toBe(false);
  });

  it("the loader reports files a reader found but didn't read", () => {
    const { issues } = loadRoadmap({}, ["README.md", "settings.yml", "boxes/sub/b1.yaml"]);
    expect(issues.filter((i) => i.path !== "settings.yaml").map((i) => [i.path, i.message])).toEqual([
      ["README.md", "unexpected file; roadmap files live in departments/ or boxes/"],
      ["boxes/sub/b1.yaml", "unexpected file; roadmap files live in departments/ or boxes/"],
      ["settings.yml", "rename this file to settings.yaml"],
    ]);
  });
});

describe("isHiddenPath", () => {
  it("is any path with a part starting with a dot", () => {
    expect([".DS_Store", "boxes/.#b1.yaml", ".github/x.yaml", "a/.b/c"].every(isHiddenPath)).toBe(true);
    expect(["boxes/b1.yaml", "a.b/c", "boxes/b.1.yaml"].some(isHiddenPath)).toBe(false);
  });
});

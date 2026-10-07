// The files staged in cutover/ (see its README) for the commit that moves the
// live demo to its own repository: each is the live file with the cutover's
// changes made and nothing else, so copying it over the live one then undoes
// no change made since. When a live file changes, this fails until its staged
// copy is made again: copy the live file over it, then make the changes below.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** A file's text, by its path from the repository's top level. */
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/**
 * Each staged file, by the path it replaces, and the cutover's changes to the
 * live one: [before, after]. null for a file the cutover replaces whole (as
 * pages.yml will be), which has no live version to follow.
 */
const STAGED: Record<string, [string, string][] | null> = {
  "web/vite.config.ts": [
    ["else this repo's roadmap/. */", "else the browser tests' roadmap (e2e/fixtures/roadmap). */"],
    ['  : resolve(REPO_DIR, "roadmap");', '  : resolve(WEB_DIR, "e2e/fixtures/roadmap");'],
  ],
  "web/scripts/roadmap-dir.ts": [
    [
      "// only argument (`npm run validate -- <dir>`), else ../roadmap. The folder is\n" +
        "// read from disk with cli/git.ts's reader: a symlink, a file that isn't UTF-8\n" +
        "// or one over the size limits stops the check (exit 1) before anything is\n" +
        "// validated.\n",
      "// only argument (`npm run validate -- <dir>`), else the browser tests' roadmap\n" +
        "// (e2e/fixtures/roadmap). The folder is read from disk with cli/git.ts's\n" +
        "// reader: a symlink, a file that isn't UTF-8 or one over the size limits stops\n" +
        "// the check (exit 1) before anything is validated.\n",
    ],
    ["(default: ../roadmap)`", "(default: e2e/fixtures/roadmap)`"],
    ['resolve("../roadmap")', 'resolve("e2e/fixtures/roadmap")'],
  ],
};

/** Every file git tracks under cutover/ but its README (not a .DS_Store Finder left), by the path it replaces. */
function stagedFiles(): string[] {
  const listed = execFileSync("git", ["ls-files", "-z", "--", "cutover"], { cwd: new URL("../..", import.meta.url), encoding: "utf8" });
  return listed
    .split("\0")
    .filter((path) => path && path !== "cutover/README.md")
    .map((path) => path.slice("cutover/".length))
    .sort();
}

describe("the files staged for the cutover (cutover/)", () => {
  for (const [path, changes] of Object.entries(STAGED)) {
    if (changes === null) continue;
    it(`stages ${path}: the live file with the cutover's changes, and nothing else`, () => {
      let expected = read(path);
      for (const [before, after] of changes) {
        expect(expected.split(before).length - 1, `${path} holds “${before}” once`).toBe(1);
        expected = expected.replace(before, () => after);
      }
      expect(read(`cutover/${path}`), `cutover/${path} is out of date: copy ${path} over it, then make this test's changes again`).toBe(expected);
    });
  }

  it("stages only those, and its README names each", () => {
    expect(stagedFiles(), "the files git tracks in cutover/ (git add a new one)").toEqual(Object.keys(STAGED).sort());
    const readme = read("cutover/README.md");
    for (const path of Object.keys(STAGED)) expect(readme).toContain(`\`${path}\``);
  });
});

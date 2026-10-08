// The push ruleset docs/adopting.md has an admin make ("Rulesets"), as it and
// the starter's README give it: its restricted paths cover every path with up
// to two parts whose names start with "." (each further pair of paths the
// docs offer, one more), and its allowed exception lets through the files a
// save writes (isRoadmapPath). GitHub matches with Ruby's File.fnmatch and
// FNM_PATHNAME, its docs say; whether with FNM_DOTMATCH, under which `*` and
// `**/` match a name starting with ".", they don't, so both are checked, with
// Ruby's fnmatch ported.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRoadmapPath } from "../src/model/paths";

/** A file's text, by its path from the repository's top level. */
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** Restrict file paths. */
const RESTRICTED = ["**/*", "**/.*", "**/.*/**/*", "**/.*/**/.*", "**/.*/**/.*/**/*"];
/** The pair adopting.md offers for paths with three parts starting with ".". */
const THIRD = ["**/.*/**/.*/**/.*", "**/.*/**/.*/**/.*/**/*"];
/** Its allowed exception. */
const EXCEPTIONS = ["roadmap/**/*"];

// Ruby's `File.fnmatch(pattern, path, File::FNM_PATHNAME)`, with
// `File::FNM_DOTMATCH` too when `dotmatch` (dir.c's fnmatch and
// fnmatch_helper): `*` and `?` stay within a part, `**/` is any number of
// parts, and without FNM_DOTMATCH none of them matches a part's leading ".".
// No escapes or brackets: GitHub takes no backslashes, and no pattern here has
// brackets.
function fnmatch(pattern: string, path: string, dotmatch: boolean): boolean {
  if (/[[\\]/.test(pattern)) throw new Error(`not ported: ${pattern}`);
  const end = (text: string, i: number) => i >= text.length || text[i] === "/";
  // One part of the pattern, from p, against one of the path, from s: whether it matches, and where each stopped.
  const part = (p: number, s: number): [boolean, number, number] => {
    if (!dotmatch && path[s] === "." && pattern[p] !== ".") return [false, p, s];
    let pStar = -1;
    let sStar = -1;
    for (;;) {
      if (pattern[p] === "*") {
        while (pattern[p] === "*") p++;
        if (end(pattern, p)) return [true, p, s];
        if (end(path, s)) return [false, p, s];
        pStar = p;
        sStar = s;
        continue;
      }
      if (pattern[p] === "?") {
        if (end(path, s)) return [false, p, s];
        p++;
        s++;
        continue;
      }
      if (end(path, s)) return [end(pattern, p), p, s];
      if (!end(pattern, p) && pattern[p] === path[s]) {
        p++;
        s++;
        continue;
      }
      if (pStar < 0) return [false, p, s];
      p = pStar;
      s = ++sStar;
    }
  };
  let p = 0;
  let s = 0;
  let pAny = -1;
  let sAny = -1;
  for (;;) {
    if (pattern.startsWith("**/", p)) {
      while (pattern.startsWith("**/", p)) p += 3;
      pAny = p;
      sAny = s;
    }
    const [matched, pAt, sAt] = part(p, s);
    p = pAt;
    s = sAt;
    if (matched) {
      while (s < path.length && path[s] !== "/") s++;
      if (p < pattern.length && s < path.length) {
        p++;
        s++;
        continue;
      }
      if (p >= pattern.length && s >= path.length) return true;
    }
    // `**/` takes one more part of the path, unless it starts with ".".
    if (pAny >= 0 && (dotmatch || path[sAny] !== ".")) {
      while (sAny < path.length && path[sAny] !== "/") sAny++;
      if (sAny < path.length) {
        p = pAny;
        s = ++sAny;
        continue;
      }
    }
    return false;
  }
}

/** Whether the ruleset refuses an editor's commit that changes `path`. */
const refused = (path: string, dotmatch: boolean, restricted = RESTRICTED) =>
  restricted.some((p) => fnmatch(p, path, dotmatch)) && !EXCEPTIONS.some((p) => fnmatch(p, path, dotmatch));

/** How many of a path's parts start with ".". */
const hidden = (path: string) => path.split("/").filter((name) => name.startsWith(".")).length;

/** Every path of 1 to 5 parts, each `x` or `.x`. */
const PATHS = [1, 2, 3, 4, 5].flatMap((n) =>
  Array.from({ length: 2 ** n }, (_, bits) => Array.from({ length: n }, (_, i) => ((bits >> i) & 1 ? ".x" : "x")).join("/")),
);

describe("the push ruleset", () => {
  it("is the one adopting.md and the starter's README give", () => {
    const section = (path: string, from: string, to: string) => {
      const text = read(path);
      const start = text.indexOf(from);
      const stop = text.indexOf(to, start);
      expect([path, start >= 0 && stop > start]).toEqual([path, true]);
      return text.slice(start, stop);
    };
    const adopting = section("docs/adopting.md", "2. **New push ruleset**", "3. **Require signed commits**");
    const starter = section("starter/README.md", "4. **Settings → Rulesets:**", "5. **Dependabot**");
    for (const [name, text] of [
      ["adopting.md", adopting],
      ["starter/README.md", starter],
    ]) {
      for (const p of [...RESTRICTED, ...EXCEPTIONS]) expect(text, `${name} gives ${p}`).toContain(`\`${p}\``);
    }
    for (const p of THIRD) expect(adopting, `adopting.md offers ${p}`).toContain(`\`${p}\``);
  });

  it("is read as Ruby's fnmatch reads it (its docs' examples, and GitHub's)", () => {
    // [pattern, path, matched without FNM_DOTMATCH, with it], as Ruby 2.6 answers with FNM_PATHNAME.
    const examples: [string, string, boolean, boolean][] = [
      ["**/foo", "a/b/c/foo", true, true],
      ["**/foo", "a/.b/c/foo", false, true],
      ["*/*", "dave/.profile", false, true],
      ["*", "dave/.profile", false, false],
      ["**/*.rb", "main.rb", true, true],
      ["**/*.rb", "lib/song.rb", true, true],
      ["qa/*", "qa/foo", true, true],
      ["qa/*", "qa/foo/bar", false, false],
      ["qa/**/*", "qa/foo/bar/foobar/hello-world", true, true],
      ["test/demo/**/*", "test/demo/a/b.txt", true, true],
      ["**/gradle/wrapper/*.jar", "a/gradle/wrapper/g.jar", true, true],
      [".github/**", ".github/dependabot.yml", true, true],
      [".github/**", ".github/workflows/deploy.yml", false, false],
      ["**/*", ".envrc", false, true],
      ["**/.*", ".envrc", true, true],
      ["roadmap/**/*", "roadmap/.envrc", false, true],
      ["roadmap/boxes/*.yaml", "roadmap/boxes/.b1.yaml", false, true],
      ["roadmap/boxes/*.yaml", "roadmap/boxes/sub/b1.yaml", false, false],
    ];
    for (const [pattern, path, plain, dot] of examples) {
      expect([pattern, path, fnmatch(pattern, path, false), fnmatch(pattern, path, true)]).toEqual([pattern, path, plain, dot]);
    }
  });

  it("refuses every path with up to two parts starting with “.”, whichever way GitHub reads them", () => {
    for (const path of PATHS) {
      expect([path, refused(path, true)]).toEqual([path, true]);
      // Read without FNM_DOTMATCH, three such parts or more get through, as adopting.md says, unless
      // the pair it offers for three is added.
      expect([path, refused(path, false)]).toEqual([path, hidden(path) <= 2]);
      expect([path, refused(path, false, [...RESTRICTED, ...THIRD])]).toEqual([path, hidden(path) <= 3]);
    }
    const tools = [
      "README.md",
      "AGENTS.md",
      "CLAUDE.md",
      "package.json",
      ".envrc",
      ".npmrc",
      ".mcp.json",
      ".boxops/boxops.mjs",
      ".github/workflows/deploy.yml",
      ".claude/settings.json",
      ".vscode/tasks.json",
      ".husky/pre-commit",
      ".devcontainer/.env",
      ".config/.husky/pre-commit",
      "docs/.claude/skills/x/SKILL.md",
    ];
    for (const path of tools) expect([path, refused(path, false), refused(path, true)]).toEqual([path, true, true]);
  });

  it("lets through every file a save writes", () => {
    for (const path of ["settings.yaml", "people.yaml", "departments/eng.yaml", "departments/eng.yml", "boxes/bx-1a2b-x.yaml", "boxes/b1.yml"]) {
      expect([path, isRoadmapPath(path), refused(`roadmap/${path}`, false), refused(`roadmap/${path}`, true)]).toEqual([path, true, false, false]);
    }
  });
});

// The changelog's check (scripts/check-changelog.mjs), run as CI and the
// release workflow run it: CHANGELOG.md as it is; a changelog in the form,
// whose release section becomes the release's notes; and each way out of it.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanUp, tempDir } from "../cli/test-release";

afterEach(cleanUp);

const SCRIPT = fileURLToPath(new URL("./check-changelog.mjs", import.meta.url));

/** A section's fixed lines, then its changes. */
const section = (heading: string, o: { format?: number; guard?: number; security?: string } = {}) => `${heading}

- Security: ${o.security ?? "none"}
- Data format: ${o.format ?? 1} (unchanged)
- Workflow changes: none
- Action inputs and outputs: unchanged
- AGENTS.md block: 1 (unchanged)
- Launcher: 1 (unchanged) · Guard: ${o.guard ?? 1} (unchanged)
- Node and runner: Node.js 22.12 or later; tested on ubuntu-24.04, ubuntu-24.04-arm and ubuntu-26.04
- Open tabs: will reload

### Changes

- Something got better.
`;

const GOOD = `# Changelog

Releases, newest first.

${section("## Unreleased")}
${section("## 0.2.0 — 2026-11-02", { security: "a link in a box's notes could run script" })}
${section("## 0.1.0 — 2026-10-20")}`;

/** As main's is when 0.2.0 is released: its release pull request made Unreleased its section. */
const RELEASED = GOOD.replace(`${section("## Unreleased")}\n`, "");

/** Runs the check on `text` with these arguments; its exit code and output. */
function check(text: string, args: string[] = [], env: Record<string, string> = {}) {
  const dir = tempDir();
  const file = join(dir, "CHANGELOG.md");
  writeFileSync(file, text);
  const r = spawnSync(process.execPath, [SCRIPT, ...args, file], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "", ...env } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, dir, file };
}

/** The problems the check finds in `text`, without the file's name. */
const problems = (text: string, args: string[] = []) =>
  check(text, args)
    .stderr.split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^.*CHANGELOG\.md:/, ""));

describe("the changelog's check", () => {
  it("passes CHANGELOG.md as it is, from web/ as CI runs it", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("CHANGELOG.md: in the changelog’s form.\n");
    expect(r.status).toBe(0);
  });

  it("passes a changelog in the form, and writes a release's notes: its section but the heading", () => {
    expect(check(GOOD)).toMatchObject({ code: 0, stderr: "" });
    const notes = join(tempDir(), "out", "notes.md");
    const r = check(RELEASED, ["--release", "0.2.0", "--notes", notes]);
    expect(r).toMatchObject({ code: 0, stderr: "" });
    expect(r.stdout).toContain(`with 0.2.0’s section (its notes in ${notes})`);
    expect(readFileSync(notes, "utf8")).toBe(section("", { security: "a link in a box's notes could run script" }).trimStart());
  });

  it("wants the release's section, and it the newest", () => {
    expect(problems(RELEASED, ["--release", "0.3.0"])).toEqual(["1: no section for 0.3.0 (“## 0.3.0 — YYYY-MM-DD”): move Unreleased’s there in the release pull request"]);
    expect(problems(RELEASED, ["--release", "0.1.0"])).toEqual([`${RELEASED.split("\n").indexOf("## 0.1.0 — 2026-10-20") + 1}: 0.1.0 isn’t the newest version here (0.2.0 is)`]);
  });

  it("wants the release's section on top: changes in an Unreleased section above it would ship under notes that don't say so", () => {
    const notes = join(tempDir(), "notes.md");
    const r = check(GOOD, ["--release", "0.2.0", "--notes", notes]);
    expect(r.code).toBe(1);
    expect(r.stderr.split("\n").filter(Boolean).map((line) => line.replace(/^.*CHANGELOG\.md:/, ""))).toEqual([
      `${GOOD.split("\n").indexOf("## Unreleased") + 1}: “## Unreleased” is above 0.2.0: move its changes into 0.2.0’s section in the release pull request, so 0.2.0’s notes say what it ships`,
    ]);
    expect(existsSync(notes)).toBe(false);
  });

  it("checks the top section's numbers against a build's BUILD.json", () => {
    const build = join(tempDir(), "BUILD.json");
    writeFileSync(build, JSON.stringify({ format: 2, agentsBlock: 1, launcher: 1, guard: 2 }));
    expect(problems(GOOD, ["--build-json", build])).toEqual([
      "5: Data format: the top section says “1 (unchanged)”, but this build’s is 2 (BUILD.json)",
      "5: Guard: the top section says 1, but this build’s is 2 (BUILD.json)",
    ]);
    writeFileSync(build, JSON.stringify({ format: 1, agentsBlock: 1, launcher: 1, guard: 1 }));
    expect(check(GOOD, ["--build-json", build])).toMatchObject({ code: 0, stderr: "" });
  });

  it("checks a release's own section's numbers, with --release, whatever is above it", () => {
    // Unreleased says data format 2; 0.2.0, the release, 1.
    const text = GOOD.replace("- Data format: 1 (unchanged)", "- Data format: 2 (was 1): run `node .boxops/boxops.mjs migrate`");
    const at = (heading: string) => text.split("\n").indexOf(heading) + 1;
    const build = join(tempDir(), "BUILD.json");
    writeFileSync(build, JSON.stringify({ format: 2, agentsBlock: 1, launcher: 1, guard: 1 }));
    expect(check(text, ["--build-json", build])).toMatchObject({ code: 0, stderr: "" });
    expect(problems(text, ["--release", "0.2.0", "--build-json", build])).toEqual([
      `${at("## Unreleased")}: “## Unreleased” is above 0.2.0: move its changes into 0.2.0’s section in the release pull request, so 0.2.0’s notes say what it ships`,
      `${at("## 0.2.0 — 2026-11-02")}: Data format: 0.2.0’s section says “1 (unchanged)”, but this build’s is 2 (BUILD.json)`,
    ]);
    // Released, 0.2.0's section on top: its numbers are checked.
    const released = text.replace(/## Unreleased\n[\s\S]*?(?=## 0\.2\.0)/, "");
    expect(problems(released, ["--release", "0.2.0", "--build-json", build])).toEqual([
      `${released.split("\n").indexOf("## 0.2.0 — 2026-11-02") + 1}: Data format: 0.2.0’s section says “1 (unchanged)”, but this build’s is 2 (BUILD.json)`,
    ]);
    writeFileSync(build, JSON.stringify({ format: 1, agentsBlock: 1, launcher: 1, guard: 1 }));
    expect(check(released, ["--release", "0.2.0", "--build-json", build])).toMatchObject({ code: 0, stderr: "" });
  });

  it("finds headings and dates out of form, versions out of order or twice, Unreleased not first", () => {
    const text = `# Changelog

${section("## 0.1.0 — 2026-10-20")}
${section("## Unreleased")}
${section("## 0.2.0 - 2026-11-02")}
${section("## 0.3.0 — 2026-02-30")}
${section("## 0.3.0 — 2026-03-01")}`;
    const at = (heading: string) => text.split("\n").indexOf(heading) + 1;
    expect(problems(text)).toEqual([
      `${at("## 0.2.0 - 2026-11-02")}: “## 0.2.0 - 2026-11-02” isn’t “## Unreleased” or “## X.Y.Z — YYYY-MM-DD” (an em dash, with a space each side)`,
      `${at("## 0.3.0 — 2026-02-30")}: 2026-02-30 isn’t a day`,
      `${at("## Unreleased")}: Unreleased goes first, above every version`,
      `${at("## 0.3.0 — 2026-02-30")}: 0.3.0 is newer than 0.1.0 above it: newest first`,
      `${at("## 0.3.0 — 2026-03-01")}: 0.3.0 is here twice`,
    ]);
  });

  it("finds a fixed line missing or out of order, a launcher's line without the guard, no changes", () => {
    const missing = GOOD.replace("- Workflow changes: none\n", "");
    expect(problems(missing)[0]).toMatch(/^9: Unreleased: “- Workflow changes: …” goes here \(the fixed lines: Security, Data format, Workflow changes, /);
    const empty = GOOD.replace("- Security: none\n", "- Security: \n");
    expect(problems(empty)[0]).toMatch(/^7: Unreleased: “- Security: …” goes here/);
    const noGuard = GOOD.replace("- Launcher: 1 (unchanged) · Guard: 1 (unchanged)", "- Launcher: 1 (unchanged)");
    expect(problems(noGuard)).toEqual(["12: Unreleased: the launcher’s line says the guard’s too: “- Launcher: N (…) · Guard: N (…)”"]);
    const noChanges = GOOD.replace("### Changes\n\n- Something got better.\n\n## 0.2.0", "## 0.2.0");
    expect(problems(noChanges)).toEqual(["15: Unreleased: after the fixed lines, a blank line, “### Changes”, a blank line and the changes, one “- ” item or more"]);
  });

  it("wants # Changelog first and LF line ends, and says each problem as an annotation in GitHub Actions", () => {
    expect(problems(GOOD.replace("# Changelog", "# Changes"))).toEqual(["1: should start with “# Changelog”"]);
    expect(problems(GOOD.replaceAll("\n", "\r\n"))[0]).toBe("1: has CR line ends; use LF");
    const r = check(GOOD.replace("# Changelog", "# Changes"), [], { GITHUB_ACTIONS: "true" });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(`::error file=${r.file},line=1,title=Changelog::should start with “# Changelog”`);
  });

  it("says how to run it when run wrong", () => {
    expect(check(GOOD, ["--notes", "x.md"])).toMatchObject({ code: 2, stderr: expect.stringContaining("Usage: node scripts/check-changelog.mjs") });
    expect(check(GOOD, ["--release", "0.2.0-rc.1"])).toMatchObject({ code: 2, stderr: expect.stringContaining("--release 0.2.0-rc.1: give X.Y.Z") });
    expect(check(GOOD, ["--bogus"])).toMatchObject({ code: 2 });
  });
});

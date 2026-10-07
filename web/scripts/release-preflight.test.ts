// The release workflow's first step, preflight's "From main, at the commit
// reviewed if given; …" (.github/workflows/release.yml), run with bash as the
// runner runs it, in a checkout of web/package.json, CHANGELOG.md and the
// changelog's check, with a stand-in `gh` for the tag's lookup: it releases
// main only, and only at the commit reviewed when one is given; the version,
// web/package.json and the changelog's top section agree; the tag is new.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { cleanUp, tempDir } from "../cli/test-release";

afterEach(cleanUp);

const WORKFLOW = fileURLToPath(new URL("../../.github/workflows/release.yml", import.meta.url));
const CHECK = fileURLToPath(new URL("./check-changelog.mjs", import.meta.url));

/** The step: its environment as release.yml gives it, and its script. */
function preflightStep(): { env: Record<string, string>; run: string } {
  const steps = (parse(readFileSync(WORKFLOW, "utf8")) as { jobs: { preflight: { steps: { id?: string; env?: Record<string, string>; run?: string }[] } } }).jobs.preflight.steps;
  const step = steps.find((s) => s.id === "versions");
  return { env: step?.env ?? {}, run: step?.run ?? "" };
}

/** The folder jq is in (the step uses it, as GitHub's runners have it), from this PATH. */
const JQ = (process.env.PATH ?? "").split(":").find((d) => d && existsSync(join(d, "jq")));

const SHA = "5ca1ab1e".padEnd(40, "0");

/** A changelog with these sections (headings), each in the form. */
const changelog = (...headings: string[]) =>
  `# Changelog\n\n${headings
    .map(
      (h) =>
        `${h}\n\n- Security: none\n- Data format: 1 (unchanged)\n- Workflow changes: none\n- Action inputs and outputs: unchanged\n- AGENTS.md block: 1 (unchanged)\n- Launcher: 1 (unchanged) · Guard: 1 (unchanged)\n- Node and runner: Node.js 22.12 or later\n- Open tabs: will reload\n\n### Changes\n\n- Something got better.\n`,
    )
    .join("\n")}`;

/**
 * Runs the step for `version` (and the commit reviewed, `commit`) in a
 * checkout whose web/package.json says 0.2.0 and whose CHANGELOG.md is
 * `text`, on `ref` at SHA; the tag there if `tagged`. What it did.
 */
function preflight(o: { version: string; commit?: string; text?: string; ref?: string; tagged?: boolean }) {
  expect(JQ, "jq, which the step uses, is installed").toBeDefined();
  const work = tempDir();
  mkdirSync(join(work, "web", "scripts"), { recursive: true });
  writeFileSync(join(work, "web", "package.json"), JSON.stringify({ name: "boxops-roadmap", version: "0.2.0" }));
  copyFileSync(CHECK, join(work, "web", "scripts", "check-changelog.mjs"));
  writeFileSync(join(work, "CHANGELOG.md"), o.text ?? changelog("## 0.2.0 — 2026-11-02", "## 0.1.0 — 2026-10-20"));
  const stand = join(work, "stand-in");
  mkdirSync(stand);
  const answer = o.tagged ? 'echo \'{"ref":"refs/tags/x"}\'' : "echo 'gh: Not Found (HTTP 404)' >&2; exit 1";
  writeFileSync(join(stand, "gh"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${join(stand, "gh.log")}'\n${answer}\n`, { mode: 0o755 });
  const temp = join(work, "runner-temp");
  mkdirSync(temp);
  const output = join(work, "output");
  writeFileSync(output, "");
  const step = preflightStep();
  writeFileSync(join(work, "preflight.sh"), step.run);
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", join(work, "preflight.sh")], {
    cwd: work,
    encoding: "utf8",
    env: {
      // sha256sum is in /sbin on macOS.
      PATH: `${stand}:${dirname(process.execPath)}:${JQ}:/usr/bin:/bin:/usr/sbin:/sbin`,
      V: o.version,
      REVIEWED: o.commit ?? "",
      GH_TOKEN: "token",
      GITHUB_REF: o.ref ?? "refs/heads/main",
      GITHUB_SHA: SHA,
      GITHUB_REPOSITORY: "Allenfp/BoxOps",
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: temp,
    },
  });
  const notes = join(temp, "notes", "notes.md");
  return {
    code: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    output: readFileSync(output, "utf8"),
    notes: existsSync(notes) ? readFileSync(notes, "utf8") : undefined,
    gh: existsSync(join(stand, "gh.log")) ? readFileSync(join(stand, "gh.log"), "utf8").trim().split("\n") : [],
  };
}

describe("the release workflow's preflight", () => {
  it("takes the version, and the commit reviewed (optional), as the run's inputs", () => {
    const workflow = parse(readFileSync(WORKFLOW, "utf8")) as { on: { workflow_dispatch: { inputs: Record<string, { required: boolean; type: string; default?: string }> } } };
    expect(workflow.on.workflow_dispatch.inputs.version).toMatchObject({ required: true, type: "string" });
    expect(workflow.on.workflow_dispatch.inputs.commit).toMatchObject({ required: false, type: "string", default: "" });
    expect(preflightStep().env).toEqual({ V: "${{ inputs.version }}", REVIEWED: "${{ inputs.commit }}", GH_TOKEN: "${{ github.token }}" });
  });

  it("passes main, its version's section on top as the notes, and a new tag; at the commit reviewed, when one is given", () => {
    for (const commit of [undefined, SHA.slice(0, 7), SHA.slice(0, 12).toUpperCase(), SHA]) {
      const r = preflight({ version: "0.2.0", commit });
      expect([commit, r.code, r.stderr]).toEqual([commit, 0, ""]);
      expect(r.stdout).toContain(`Releasing BoxOps 0.2.0 from main@${SHA.slice(0, 12)}.`);
      expect(r.notes?.startsWith("- Security: none\n")).toBe(true);
      expect(r.output).toBe(`notes=${createHash("sha256").update(r.notes ?? "").digest("hex")}\n`);
      expect(r.gh).toEqual(["api repos/Allenfp/BoxOps/git/ref/tags/v0.2.0 --silent"]);
    }
    // A release candidate's notes are its version's.
    expect(preflight({ version: "0.2.0-rc.1", commit: SHA }).code).toBe(0);
  });

  it("stops when main has moved on from the commit reviewed, or what's given isn't a commit", () => {
    const moved = preflight({ version: "0.2.0", commit: "0ddba11" });
    expect(moved.code).toBe(1);
    expect(moved.stdout).toContain(`::error title=main has moved on::This run is for main at ${SHA}, not 0ddba11, the commit reviewed: see what was merged since, then run the workflow again.`);
    expect([moved.notes, moved.gh]).toEqual([undefined, []]);
    for (const commit of ["main", "5ca1ab", `${SHA}0`, "5ca1ab1e "]) {
      const r = preflight({ version: "0.2.0", commit });
      expect([commit, r.code]).toEqual([commit, 1]);
      expect(r.stdout).toContain(`::error title=Not a commit::The commit given, ${commit}, isn’t 7 to 40 hex digits of one.`);
    }
  });

  it("stops off main, for a version that isn't web/package.json's, for Unreleased above the version, and for a tag that's there", () => {
    const branch = preflight({ version: "0.2.0", ref: "refs/heads/release-prep" });
    expect([branch.code, branch.stdout]).toEqual([1, expect.stringContaining("::error title=Releases come from main::This run is for refs/heads/release-prep.")]);
    const version = preflight({ version: "0.3.0" });
    expect([version.code, version.stdout]).toEqual([1, expect.stringContaining("::error title=web/package.json says 0.2.0::")]);
    const unreleased = preflight({ version: "0.2.0", text: changelog("## Unreleased", "## 0.2.0 — 2026-11-02") });
    expect(unreleased.code).toBe(1);
    expect(unreleased.stderr).toContain("“## Unreleased” is above 0.2.0: move its changes into 0.2.0’s section in the release pull request");
    expect(unreleased.notes).toBeUndefined();
    const tagged = preflight({ version: "0.2.0", tagged: true });
    expect([tagged.code, tagged.stdout]).toEqual([1, expect.stringContaining("::error title=v0.2.0 exists::")]);
  });
});

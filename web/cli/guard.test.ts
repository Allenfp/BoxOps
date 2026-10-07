// The Pages guard: the starter's deploy.yml step "Check the GitHub Pages
// settings" (`# boxops-guard: 1`, in Path B's deploy.yml too), run with bash
// as the runner runs it, against a stand-in `gh` that answers as GitHub
// does: Pages not set up (404), no access (401, 403: an IP allow list, or
// the job's token), GitHub failing (500) or out of reach, a branch as the
// source, a public site for a repository that isn't public, and all well.

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { carried, starterFiles } from "./embedded";
import { contractNumber } from "./pins";
import { GUARD } from "./release";
import { cleanUp, tempDir } from "./test-release";

// Each test runs the step with bash many times, and it starts jq and the stand-in gh: up to 3
// seconds on a quiet machine, and several times that under load, near or past vitest's 5.
vi.setConfig({ testTimeout: 30_000 });

afterEach(cleanUp);

interface Step {
  name?: string;
  shell?: string;
  env?: Record<string, string>;
  run?: string;
}

/** The guard step of a deploy.yml. */
function guardStep(deploy: string): Step {
  const steps = (parse(deploy) as { jobs: { deploy: { steps: Step[] } } }).jobs.deploy.steps;
  const step = steps.find((s) => s.name === "Check the GitHub Pages settings");
  expect(step).toBeDefined();
  return step as Step;
}

/** What `gh api repos/acme/roadmap/pages` does: prints `body` (JSON), or fails with `error` on stderr. */
type Answer = { body: unknown } | { error: string };

/** The folder jq is in (the guard uses it, as GitHub's runners have it), from this PATH. */
const JQ_DIR = (process.env.PATH ?? "").split(":").find((d) => d && existsSync(join(d, "jq")));

/** Runs the guard, as bash with -e and pipefail, for a repository of this visibility; its exit code and output. */
function guard(answer: Answer, visibility: string, allowPublicSite?: string) {
  expect(JQ_DIR, "jq, which the guard uses, is installed").toBeDefined();
  const dir = tempDir();
  const respond = "body" in answer ? `cat <<'JSON'\n${JSON.stringify(answer.body)}\nJSON\n` : `printf '%s\\n' '${answer.error}' >&2\nexit 1\n`;
  writeFileSync(join(dir, "gh"), `#!/bin/sh\n[ "$*" = "api repos/acme/roadmap/pages" ] || { echo "unexpected: gh $*" >&2; exit 99; }\n${respond}`, { mode: 0o755 });
  const step = guardStep(starterFiles()[".github/workflows/deploy.yml"]);
  writeFileSync(join(dir, "guard.sh"), step.run ?? "");
  const env = {
    PATH: `${dir}:${JQ_DIR}:/usr/bin:/bin`,
    GH_TOKEN: "token",
    GITHUB_REPOSITORY: "acme/roadmap",
    RUNNER_TEMP: dir,
    VISIBILITY: visibility,
    ALLOW_PUBLIC_SITE: allowPublicSite ?? step.env?.ALLOW_PUBLIC_SITE ?? "",
  };
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", join(dir, "guard.sh")], { encoding: "utf8", env });
  return { code: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

const pages = (o: { build_type?: string; public?: boolean | null } = {}) => ({
  body: { url: "https://api.github.com/repos/acme/roadmap/pages", build_type: "workflow", public: false, html_url: "https://example.pages.github.io/", ...o },
});

describe("the Pages guard (deploy.yml)", () => {
  it("is guard 1 in the starter's deploy.yml and Path B's, the same step, run by bash with its token and the repository's visibility", () => {
    const step = guardStep(starterFiles()[".github/workflows/deploy.yml"]);
    expect(guardStep(carried("templates/path-b/deploy.yml"))).toEqual(step);
    expect(contractNumber(starterFiles()[".github/workflows/deploy.yml"], "guard")).toBe(GUARD);
    expect(step.shell).toBe("bash");
    expect(step.env).toEqual({
      GH_TOKEN: "${{ github.token }}",
      VISIBILITY: "${{ github.event.repository.visibility }}",
      ALLOW_PUBLIC_SITE: "false",
    });
  });

  it("lets a private repository publish to its private site, and a public one to a public site", () => {
    expect(guard(pages(), "private")).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(guard(pages(), "internal")).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(guard(pages({ public: true }), "public")).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("says Pages isn't set up (404), and tells that apart from no access (401, 403) and GitHub failing", () => {
    expect(guard({ error: "gh: Not Found (HTTP 404)" }, "private")).toEqual({
      code: 1,
      stdout:
        "::error title=GitHub Pages isn't set up::Settings → Pages → Source: GitHub Actions, then Visibility: Private. Re-run this workflow afterwards. Nothing was published.",
      stderr: "",
    });
    for (const status of [401, 403]) {
      expect(guard({ error: `gh: Resource not accessible by integration (HTTP ${status})` }, "private")).toMatchObject({
        code: 1,
        stdout: `::error title=Couldn't read the Pages settings (HTTP ${status})::If your organization uses an IP allow list, run this workflow on a runner with an allowed IP address (README → Enterprise). Otherwise check this job still has pages: write. Nothing was published.`,
      });
    }
    expect(guard({ error: "gh: Server Error (HTTP 500)" }, "private")).toMatchObject({
      code: 1,
      stdout: "::error title=GitHub API problem (500)::Couldn't read the Pages settings: gh: Server Error (HTTP 500). Re-run later. Nothing was published.",
    });
    expect(guard({ error: "error connecting to api.github.com" }, "private")).toMatchObject({
      code: 1,
      stdout: "::error title=GitHub API problem (no response)::Couldn't read the Pages settings: error connecting to api.github.com. Re-run later. Nothing was published.",
    });
  });

  it("won't publish from a branch source, or a roadmap that isn't public to a public site, unless told to", () => {
    expect(guard(pages({ build_type: "legacy" }), "private")).toMatchObject({
      code: 1,
      stdout: "::error title=Pages source isn't GitHub Actions::Settings → Pages → Source: GitHub Actions (it is 'legacy'). Nothing was published.",
    });
    const refused = (visibility: string) =>
      `::error title=Refusing to publish to a public site::This repository is ${visibility}, but its Pages site is public: Settings → Pages → Visibility: Private, then re-run. Nothing was published.`;
    expect(guard(pages({ public: true }), "private")).toMatchObject({ code: 1, stdout: refused("private") });
    expect(guard(pages({ public: true }), "internal")).toMatchObject({ code: 1, stdout: refused("internal") });
    // GitHub not saying whether the site is public, or the event not saying how visible the repository is: refused.
    expect(guard(pages({ public: null }), "private")).toMatchObject({ code: 1, stdout: refused("private") });
    expect(guard(pages({ public: true }), "")).toMatchObject({ code: 1, stdout: refused("not public") });
    expect(guard(pages({ public: true }), "private", "true")).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});

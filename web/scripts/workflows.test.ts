// The rules every workflow here keeps (this repository's, the starter's, Path
// B's and the cutover's): no permissions but what each job asks for, a time
// limit on every job, checkouts that keep no credentials, and every action
// pinned to a commit with its version beside it, the same everywhere. And
// the release workflow's own: only its publish job holds the deploy key, in
// the `release` environment, and runs no code from this repository; it
// releases what CI tested.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, REPO), "utf8");

/** Every workflow file git tracks, by path from the repository's top level. */
const FILES = execFileSync("git", ["ls-files", "-z", "--", ".github/workflows", "starter/.github/workflows", "templates/path-b", "cutover/.github/workflows"], { cwd: REPO, encoding: "utf8" })
  .split("\0")
  .filter((p) => /\.ya?ml$/.test(p));

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  name?: string;
  uses?: string;
  permissions?: Record<string, string>;
  "timeout-minutes"?: number;
  environment?: string | { name: string };
  steps?: Step[];
  needs?: string | string[];
  with?: Record<string, unknown>;
  outputs?: Record<string, string>;
  env?: Record<string, string>;
}
interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

const workflow = (path: string) => parse(read(path)) as Workflow;

describe("every workflow", () => {
  it("is found: this repository's, the starter's, Path B's and the cutover's", () => {
    expect(FILES).toEqual(
      expect.arrayContaining([
        ".github/workflows/ci.yml",
        ".github/workflows/pages.yml",
        ".github/workflows/release.yml",
        "starter/.github/workflows/deploy.yml",
        "starter/.github/workflows/check.yml",
        "templates/path-b/deploy.yml",
        "cutover/.github/workflows/pages.yml",
      ]),
    );
  });

  for (const path of FILES) {
    it(`${path}: grants nothing by default; each job asks for its permissions and has a time limit`, () => {
      const w = workflow(path);
      expect(w.permissions, "the workflow's permissions").toEqual({});
      for (const [id, job] of Object.entries(w.jobs)) {
        expect(job.permissions, `${id}'s permissions`).toBeDefined();
        // A job that calls another workflow takes that workflow's limits.
        if (!job.uses) expect(job["timeout-minutes"], `${id}'s timeout-minutes`).toBeGreaterThan(0);
      }
    });

    it(`${path}: checks out without keeping credentials, and pins each action to a commit, its version beside it`, () => {
      const text = read(path);
      for (const job of Object.values(workflow(path).jobs)) {
        for (const step of job.steps ?? []) {
          if (step.uses?.startsWith("actions/checkout@")) expect(step.with?.["persist-credentials"], `${step.name ?? step.uses}`).toBe(false);
        }
      }
      for (const line of text.split("\n").filter((l) => /^\s*(-\s+)?uses:\s/.test(l))) {
        const ref = /uses:\s*(\S+)/.exec(line)?.[1] ?? "";
        if (ref.startsWith("./")) continue; // this repository's own: a local action or workflow
        if (ref.startsWith("Allenfp/BoxOps@")) {
          // The release a roadmap repository pins: a placeholder until a release fills it in.
          expect(line).toMatch(/uses: Allenfp\/BoxOps@<RELEASE_COMMIT_SHA> # v\d+\.\d+\.\d+$/);
          continue;
        }
        expect(line, `${path}: ${line.trim()}`).toMatch(/uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
      }
    });
  }

  it("pin each action to one commit and version, wherever it's used", () => {
    // Each action's pins ("<commit> <version>"), and the files each is in.
    const pins = new Map<string, Map<string, Set<string>>>();
    for (const path of FILES) {
      for (const m of read(path).matchAll(/uses: ([\w.-]+\/[\w.-]+)@([0-9a-f]{40}) # (v\S+)/g)) {
        const refs = pins.get(m[1]) ?? new Map<string, Set<string>>();
        pins.set(m[1], refs);
        refs.set(`${m[2]} ${m[3]}`, (refs.get(`${m[2]} ${m[3]}`) ?? new Set()).add(path));
      }
    }
    for (const [action, refs] of pins) {
      const where = [...refs].map(([ref, paths]) => `${ref} in ${[...paths].join(", ")}`).join(" | ");
      expect([...refs.keys()], `${action}: ${where}`).toHaveLength(1);
    }
    expect([...pins.keys()].sort()).toEqual([
      "actions/attest",
      "actions/checkout",
      "actions/deploy-pages",
      "actions/download-artifact",
      "actions/setup-node",
      "actions/upload-artifact",
      "actions/upload-pages-artifact",
    ]);
  });
});

describe("Dependabot's pull requests", () => {
  interface Update {
    "package-ecosystem": string;
    directories?: string[];
    groups?: Record<string, { patterns?: string[] }>;
  }

  it("move an action's pins in every folder of workflows at once: none is left behind to fail the test above", () => {
    const actions = (parse(read(".github/dependabot.yml")) as { updates: Update[] }).updates.find((u) => u["package-ecosystem"] === "github-actions");
    // Dependabot reads .github/workflows for "/", and any other folder's own *.yml files.
    const folders = [...new Set(FILES.map((p) => p.slice(0, p.lastIndexOf("/"))))].map((d) => (d === ".github/workflows" ? "/" : `/${d}`));
    expect([...(actions?.directories ?? [])].sort()).toEqual(folders.sort());
    expect(actions?.groups).toEqual({ "github-actions": { patterns: ["actions/*"] } });
  });
});

describe("CI's unit tests", () => {
  it("paste printed commands into zsh as well as bash: the test job installs it first, and has them fail without it", () => {
    const test = workflow(".github/workflows/ci.yml").jobs.test;
    const steps = test.steps ?? [];
    // GitHub's Ubuntu runners haven't zsh; cli/test-shell.ts would leave it out without a word.
    const install = steps.findIndex((s) => /apt-get install .*\bzsh$/m.test(s.run ?? ""));
    const tests = steps.flatMap((s, i) => (s.run === "npm test" ? [i] : []));
    expect(tests).toHaveLength(3);
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(Math.min(...tests));
    expect(test.env).toEqual({ BOXOPS_TEST_ZSH: "1" });
  });
});

describe("the release workflow", () => {
  const release = workflow(".github/workflows/release.yml");
  const ci = workflow(".github/workflows/ci.yml");

  it("runs by hand with a version, one at a time, and never on its own", () => {
    expect(Object.keys(release.on)).toEqual(["workflow_dispatch"]);
    expect((release.on.workflow_dispatch as { inputs: Record<string, { required: boolean }> }).inputs.version.required).toBe(true);
    expect(parse(read(".github/workflows/release.yml")).concurrency).toEqual({ group: "release", "cancel-in-progress": false });
  });

  it("releases what CI tested: ci.yml on this commit, with the version, builds the tree it ships", () => {
    expect(release.jobs.verify).toMatchObject({ needs: "preflight", uses: "./.github/workflows/ci.yml", with: { version: "${{ inputs.version }}" } });
    expect((ci.on.workflow_call as { inputs: Record<string, unknown> }).inputs.version).toBeDefined();
    const upload = ci.jobs["release-tree"].steps?.find((s) => s.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.with).toMatchObject({ name: "release-tree", path: "build/" });
    expect(release.jobs.publish.needs).toEqual(["preflight", "verify", "reproduce"]);
  });

  it("publishes the notes of the version's own section, on top, whose numbers CI checks against the tree it builds", () => {
    const preflight = release.jobs.preflight.steps?.find((s) => s.run?.includes("check-changelog.mjs"));
    expect(preflight?.run).toContain('node web/scripts/check-changelog.mjs --release "$base" --notes "$RUNNER_TEMP/notes/notes.md"');
    const numbers = ci.jobs["release-tree"].steps?.find((s) => s.run?.includes("check-changelog.mjs"));
    expect(numbers?.env).toEqual({ VERSION: "${{ inputs.version }}" });
    expect(numbers?.run).toContain('node scripts/check-changelog.mjs --release "${VERSION%%-rc.*}" --build-json ../build/release/BUILD.json');
  });

  it("checks what it ships against the tested tree's and the rebuild's job outputs, which no later job can change", () => {
    // Any job of the run could upload an artifact under a name already used:
    // the tree id and SHA256SUMS' digest come as outputs of the jobs that built them.
    const called = (ci.on.workflow_call as { outputs: Record<string, { value: string }> }).outputs;
    expect(called.tree.value).toBe("${{ jobs.release-tree.outputs.tree }}");
    expect(called.sums.value).toBe("${{ jobs.release-tree.outputs.sums }}");
    expect(called.sbom.value).toBe("${{ jobs.release-tree.outputs.sbom }}");
    expect(ci.jobs["release-tree"].outputs).toEqual({
      tree: "${{ steps.tree.outputs.tree }}",
      sums: "${{ steps.tree.outputs.sums }}",
      sbom: "${{ steps.tree.outputs.sbom }}",
    });
    expect(release.jobs.reproduce.outputs).toEqual({ tree: "${{ steps.rebuilt.outputs.tree }}", sums: "${{ steps.rebuilt.outputs.sums }}" });
    expect(release.jobs.preflight.outputs).toEqual({ notes: "${{ steps.versions.outputs.notes }}" });
    const steps = release.jobs.publish.steps ?? [];
    expect(steps.filter((s) => s.uses?.startsWith("actions/download-artifact@")).map((s) => s.with?.name)).toEqual(["release-tree", "release-notes"]);
    const check = steps.find((s) => s.env?.TESTED_TREE);
    expect(check?.env).toEqual({
      TESTED_TREE: "${{ needs.verify.outputs.tree }}",
      TESTED_SUMS: "${{ needs.verify.outputs.sums }}",
      TESTED_SBOM: "${{ needs.verify.outputs.sbom }}",
      REBUILT_TREE: "${{ needs.reproduce.outputs.tree }}",
      REBUILT_SUMS: "${{ needs.reproduce.outputs.sums }}",
      NOTES_SHA256: "${{ needs.preflight.outputs.notes }}",
    });
    expect(check?.run).toContain('echo "$TESTED_SUMS  built/SHA256SUMS" | sha256sum --check --quiet --strict -');
    expect(check?.run).toContain('echo "$TESTED_SBOM  built/sbom.spdx.json" | sha256sum --check --quiet --strict -');
    expect(check?.run).toContain('echo "$NOTES_SHA256  notes/notes.md" | sha256sum --check --quiet --strict -');
    expect(check?.run).toContain('if [ "$tree" != "$TESTED_TREE" ]; then');
  });

  it("tests the tree publish ships: the browser tests and smoke runs check what they download against the same job outputs", () => {
    const shipped = (release.jobs.publish.steps ?? []).find((s) => s.env?.TESTED_TREE)?.run ?? "";
    for (const [id, build] of [
      ["e2e", "../build"],
      ["smoke", "build"],
    ]) {
      const steps = ci.jobs[id].steps ?? [];
      const at = steps.findIndex((s) => s.uses?.startsWith("actions/download-artifact@"));
      expect(steps[at]?.with, id).toEqual({ name: "release-tree", path: "build" });
      // Right after the download, before anything uses it.
      const check = steps[at + 1];
      expect(check?.env, id).toEqual({ SUMS: "${{ needs.release-tree.outputs.sums }}", TREE: "${{ needs.release-tree.outputs.tree }}" });
      expect(check?.run, id).toContain(`[ "$(cat ${build}/TREE)" != "$TREE" ]`);
      // publish's own checks, of this job's copy.
      for (const line of [
        `echo "$SUMS  ${build}/SHA256SUMS" | sha256sum --check --quiet --strict -`,
        `(cd ${build}/release && sha256sum --check --quiet --strict ../SHA256SUMS)`,
        `[ "$(find ${build}/release -type f | wc -l)" -eq "$(wc -l <${build}/SHA256SUMS)" ]`,
      ]) {
        expect(check?.run, id).toContain(line);
        expect(shipped).toContain(line.replaceAll(`${build}/`, "built/").replace("$SUMS", "$TESTED_SUMS"));
      }
    }
  });

  it("attests the files before it pushes the commit and the tag, so no tag is ever out without its attestations", () => {
    const steps = release.jobs.publish.steps ?? [];
    const push = steps.findIndex((s) => s.env?.DEPLOY_KEY);
    const attests = steps.flatMap((s, i) => (s.uses?.startsWith("actions/attest@") ? [i] : []));
    expect(attests).toHaveLength(2);
    expect(push).toBeGreaterThan(Math.max(...attests));
    // Then the GitHub release, on the tag pushed.
    expect(steps.findIndex((s) => s.run?.includes("gh release create"))).toBeGreaterThan(push);
  });

  it("holds the deploy key in its publish job alone, in the release environment, which runs nothing from this repository", () => {
    const text = read(".github/workflows/release.yml");
    expect(text.match(/secrets\.RELEASE_DEPLOY_KEY/g)).toHaveLength(1);
    const publish = release.jobs.publish;
    expect(publish.environment).toBe("release");
    expect(Object.values(release.jobs).filter((j) => j.environment)).toEqual([publish]);
    expect(publish.permissions).toEqual({ contents: "write", "id-token": "write", attestations: "write" });
    const steps = publish.steps ?? [];
    // GitHub's own actions only, and no checkout: nothing of this repository is there to run.
    expect([...new Set(steps.filter((s) => s.uses).map((s) => s.uses?.split("@")[0]))]).toEqual(["actions/download-artifact", "actions/attest"]);
    const scripts = steps.map((s) => s.run ?? "").join("\n");
    // No command runs node, npm or a script file (as a command, or in $(…)).
    expect(scripts).not.toMatch(/(^|[;&|(]|\$\()\s*((npm|npx|node|tsx|bash|sh|source)\b|\.\/|\.\s)/m);
    expect(steps.find((s) => s.env?.DEPLOY_KEY)?.run).toContain('git push --atomic "$remote" "$commit:refs/heads/releases" "$commit:refs/tags/v$V"');
    // Every other job reads only.
    for (const [id, job] of Object.entries(release.jobs)) if (id !== "publish") expect(job.permissions, id).toEqual({ contents: "read" });
  });
});

// Path B (templates/path-b/): the starter's workflows for organizations that
// allow only GitHub's own actions, with git and Node.js running the pinned
// release in place of `uses:`. Checked against the starter's workflows
// (only the BoxOps step differs), the step the starter's README shows, the
// tools that read pins, and the step's script itself, run with bash against
// a stand-in for github.com (git told to fetch from a local repository).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { permissionFindings } from "./doctor";
import { carried, starterFiles } from "./embedded";
import { findPins, rewritePins } from "./pins";
import { cleanUp, readOutputs, tempDir } from "./test-release";
import { TestRepo } from "./test-repo";

const repos: TestRepo[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.remove();
  cleanUp();
});

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Workflow {
  jobs: Record<string, { steps: Step[] }>;
}

const WORKFLOWS = ["deploy.yml", "check.yml"] as const;
const pathB = (name: (typeof WORKFLOWS)[number]) => carried(`templates/path-b/${name}`);
const starter = (name: (typeof WORKFLOWS)[number]) => starterFiles()[`.github/workflows/${name}`];
const isSetupNode = (s: Step) => s.uses?.startsWith("actions/setup-node@") ?? false;
const isBoxOps = (s: Step) => (s.uses ?? "").startsWith("Allenfp/BoxOps@") || s.env?.BOXOPS_ACTION !== undefined;

/** The Path B step of a Path B workflow. */
function pathBStep(name: (typeof WORKFLOWS)[number]): Step {
  const steps = Object.values((parse(pathB(name)) as Workflow).jobs).flatMap((j) => j.steps);
  const found = steps.filter((s) => s.env?.BOXOPS_ACTION !== undefined);
  expect(found).toHaveLength(1);
  return found[0];
}

describe("Path B's workflows", () => {
  for (const name of WORKFLOWS) {
    it(`${name} is the starter's, with setup-node and a step of git and Node.js in place of uses: Allenfp/BoxOps`, () => {
      const mine = parse(pathB(name)) as Workflow;
      const theirs = parse(starter(name)) as Workflow;
      // The BoxOps step stands for itself; Path B's setup-node goes right before its own.
      const swap = (w: Workflow, b: boolean) => {
        for (const job of Object.values(w.jobs)) {
          const steps = job.steps;
          job.steps = steps.filter((s, i) => {
            if (!b || !isSetupNode(s)) return true;
            expect(isBoxOps(steps[i + 1] ?? {}), "setup-node comes right before the BoxOps step").toBe(true);
            return false;
          });
          job.steps = job.steps.map((s) => (isBoxOps(s) ? ({ boxops: s.id ?? null } as Step) : s));
        }
        return w;
      };
      expect(swap(mine, true)).toEqual(swap(theirs, false));
      expect(Object.values(mine.jobs).flatMap((j) => j.steps).filter((s) => "boxops" in s)).toHaveLength(1);
    });
  }

  it("pin the release on a BOXOPS_ACTION line the launcher, doctor and upgrade read, with the starter's permissions", () => {
    for (const name of WORKFLOWS) {
      expect(findPins(pathB(name))).toEqual([expect.objectContaining({ repo: "Allenfp/BoxOps", ref: "<RELEASE_COMMIT_SHA>", tag: "v0.1.0", pathB: true })]);
      const pinned = rewritePins(pathB(name), "a".repeat(40), "v0.2.0");
      expect(findPins(pinned)).toEqual([expect.objectContaining({ ref: "a".repeat(40), tag: "v0.2.0", pathB: true })]);
    }
    const findings = permissionFindings({ ".github/workflows/deploy.yml": pathB("deploy.yml"), ".github/workflows/check.yml": pathB("check.yml") });
    expect(findings.map((f) => f.level)).toEqual(["ok", "ok"]);
    // Same script in both, but for its last line: check mode in check.yml.
    const [deploy, check] = [pathBStep("deploy.yml"), pathBStep("check.yml")];
    expect(deploy.id).toBe("boxops");
    expect(deploy.run?.split("\n").slice(0, -2)).toEqual(check.run?.split("\n").slice(0, -2));
    expect(deploy.run?.trimEnd().split("\n").pop()).toBe('node "$dir/dist/action.mjs" --releases-file "$RUNNER_TEMP/boxops-releases.json"');
    expect(check.run?.trimEnd().split("\n").pop()).toBe('node "$dir/dist/action.mjs" --mode check');
  });

  it("are the steps the starter's README shows", () => {
    const readme = starterFiles()["README.md"];
    const block = /```yaml\n([\s\S]*?)\n {2}```/.exec(readme.slice(readme.indexOf("(Path B)")))?.[1];
    expect(block).toBeDefined();
    const deploy = pathB("deploy.yml");
    const steps = deploy.slice(deploy.indexOf("      - uses: actions/setup-node@"), deploy.indexOf("      - uses: actions/upload-pages-artifact@")).trimEnd();
    // In the README the block sits in a list item: two spaces more on each line.
    expect(block?.split("\n").map((l) => l.replace(/^ {2}/, ""))).toEqual(steps.split("\n"));
  });
});

describe("Path B's step", () => {
  const node = dirname(process.execPath);

  /**
   * A stand-in github.com (git fetches https://github.com/<repo> from
   * `<dir>/<repo>`), holding a release of Allenfp/BoxOps on its `releases`
   * branch whose dist/action.mjs notes its arguments and sets the `site`
   * output; and the git configuration that sends git there.
   */
  function standIn(action = "process.exitCode = 0;") {
    const dir = tempDir();
    const release = new TestRepo();
    repos.push(release);
    const sha = release.commit({
      "action.yml": "runs:\n  using: node24\n  main: dist/action.mjs\n",
      "dist/action.mjs": `import { appendFileSync, writeFileSync } from "node:fs";\nwriteFileSync(process.env.ARGS_FILE, JSON.stringify(process.argv.slice(2)));\nappendFileSync(process.env.GITHUB_OUTPUT, "site<<EOF\\n/site\\nEOF\\n");\n${action}\n`,
    });
    release.git(["branch", "-m", "main", "releases"]);
    mkdirSync(join(dir, "Allenfp"));
    execFileSync("git", ["clone", "-q", "--bare", release.dir, join(dir, "Allenfp", "BoxOps")], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
    const config = join(tempDir(), "gitconfig");
    writeFileSync(config, `[url "file://${dir}/"]\n\tinsteadOf = https://github.com/\n`);
    return { sha, config };
  }

  /** Runs a Path B workflow's step as the runner would (bash, -e, pipefail), with BOXOPS_ACTION `pin`. */
  function runStep(name: (typeof WORKFLOWS)[number], pin: string, config: string) {
    const temp = tempDir();
    const script = join(temp, "step.sh");
    writeFileSync(script, pathBStep(name).run ?? "");
    const env = {
      PATH: `${node}:/usr/bin:/bin`,
      HOME: temp,
      GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_NOSYSTEM: "1",
      RUNNER_TEMP: temp,
      GITHUB_OUTPUT: join(temp, "output"),
      ARGS_FILE: join(temp, "args.json"),
      BOXOPS_ACTION: pin,
    };
    writeFileSync(env.GITHUB_OUTPUT, "");
    const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], { encoding: "utf8", env });
    let args: string[] | null = null;
    try {
      args = JSON.parse(readFileSync(env.ARGS_FILE, "utf8")) as string[];
    } catch {
      args = null;
    }
    return { code: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim(), args, outputs: readOutputs(env.GITHUB_OUTPUT), temp };
  }

  it("fetches the pinned commit with git and runs its dist/action.mjs: the releases file in deploy.yml, check mode in check.yml", () => {
    const { sha, config } = standIn();
    const deploy = runStep("deploy.yml", `Allenfp/BoxOps@${sha}`, config);
    expect([deploy.code, deploy.args, deploy.outputs.site]).toEqual([0, ["--releases-file", join(deploy.temp, "boxops-releases.json")], "/site"]);
    expect(execFileSync("git", ["-C", join(deploy.temp, "boxops-action"), "rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(sha);
    const check = runStep("check.yml", `Allenfp/BoxOps@${sha}`, config);
    expect([check.code, check.args]).toEqual([0, ["--mode", "check"]]);
  });

  it("passes the action's failure on, and stops before running anything for a pin that isn't a commit, or one GitHub hasn't", () => {
    const failing = standIn("process.exitCode = 1;");
    expect(runStep("deploy.yml", `Allenfp/BoxOps@${failing.sha}`, failing.config)).toMatchObject({ code: 1, args: ["--releases-file", expect.any(String)] });
    const { config } = standIn();
    expect(runStep("deploy.yml", "Allenfp/BoxOps@v0.1.0", config)).toMatchObject({
      code: 1,
      stdout: "::error title=BoxOps::BOXOPS_ACTION is 'Allenfp/BoxOps@v0.1.0': it must be <owner>/<repository>@<40-character commit SHA>",
      args: null,
    });
    const missing = runStep("deploy.yml", `Allenfp/BoxOps@${"c".repeat(40)}`, config);
    expect(missing.code).not.toBe(0);
    expect(missing.args).toBe(null);
  });
});

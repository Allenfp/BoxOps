// The release workflow's last step, "Publish the GitHub release"
// (.github/workflows/release.yml), run with bash as the runner runs it,
// against a stand-in `gh` that keeps the repository's releases in a file and
// answers as GitHub's CLI does: the release made as a draft, then published,
// GitHub's latest only if no published release but a withdrawn one is of a
// later version; a draft an earlier attempt left made again; and, on a
// re-run, a published release taken as done only if it's this run's.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { cleanUp, tempDir } from "../cli/test-release";

// Each test runs the step with bash, which starts the stand-in gh (Node, and jq) many times: up to
// 2 seconds on a quiet machine, and several times that under load, near or past vitest's 5.
vi.setConfig({ testTimeout: 30_000 });

afterEach(cleanUp);

const WORKFLOW = fileURLToPath(new URL("../../.github/workflows/release.yml", import.meta.url));

/** The step's script, as release.yml has it. */
function publishScript(): string {
  const steps = (parse(readFileSync(WORKFLOW, "utf8")) as { jobs: { publish: { steps: { name?: string; run?: string }[] } } }).jobs.publish.steps;
  const step = steps.find((s) => s.name === "Publish the GitHub release");
  expect(step?.run).toBeDefined();
  return step?.run ?? "";
}

/** A release as the stand-in keeps it (much as GitHub's API gives one). */
interface Release {
  tag_name: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  latest?: boolean;
  author: { login: string };
  body: string;
  assets: { name: string; digest: string }[];
}

/** The folder jq is in (the step uses it, as GitHub's runners have it), from this PATH. */
const JQ = (process.env.PATH ?? "").split(":").find((d) => d && existsSync(join(d, "jq")));

/**
 * The stand-in gh: what the step asks of it, against the releases in
 * releases.json beside it, each call noted in gh.log. What it makes is made
 * as GitHub's own workflow token makes it, by github-actions[bot].
 */
const STAND_IN = `
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";
const dir = process.env.GH_STAND_IN;
const file = join(dir, "releases.json");
const releases = JSON.parse(readFileSync(file, "utf8"));
const save = () => writeFileSync(file, JSON.stringify(releases, null, 2));
const args = process.argv.slice(2);
appendFileSync(join(dir, "gh.log"), args.join(" ") + "\\n");
const fail = (message) => { process.stderr.write(message + "\\n"); process.exit(1); };
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const find = (tag) => releases.find((r) => r.tag_name === tag);
const [a, b, tag] = args;
if (a === "release" && b === "view") {
  const r = find(tag);
  if (!r) fail("release not found");
  if (flag("--json") !== "isDraft" || flag("--jq") !== ".isDraft") fail("unexpected: gh " + args.join(" "));
  console.log(String(r.draft));
} else if (a === "api") {
  const m = /^repos\\/([^/]+\\/[^/]+)\\/releases\\/tags\\/(.+)$/.exec(b);
  const r = m && m[1] === process.env.GH_REPO ? releases.find((x) => x.tag_name === m[2] && !x.draft) : undefined;
  if (!r) fail("gh: Not Found (HTTP 404)");
  console.log(JSON.stringify(r));
} else if (a === "release" && b === "delete") {
  if (args[3] !== "--yes" || !find(tag)) fail("unexpected: gh " + args.join(" "));
  releases.splice(releases.indexOf(find(tag)), 1);
  save();
} else if (a === "release" && b === "create") {
  if (find(tag)) fail("a release with the same tag name already exists: " + tag);
  if (!args.includes("--verify-tag") || !args.includes("--draft")) fail("unexpected: gh " + args.join(" "));
  const files = args.slice(3).filter((x, i, all) => !x.startsWith("--") && !["--title", "--notes-file"].includes(all[i - 1]));
  releases.push({
    tag_name: tag, name: flag("--title"), draft: true, prerelease: args.includes("--prerelease"),
    author: { login: "github-actions[bot]" }, body: readFileSync(flag("--notes-file"), "utf8"),
    assets: files.map((f) => ({ name: basename(f), digest: "sha256:" + createHash("sha256").update(readFileSync(f)).digest("hex") })),
  });
  save();
} else if (a === "release" && b === "list") {
  const want = ["--exclude-drafts", "--exclude-pre-releases"];
  if (!want.every((w) => args.includes(w)) || flag("--json") !== "tagName,name") fail("unexpected: gh " + args.join(" "));
  const list = releases.filter((r) => !r.draft && !r.prerelease).map((r) => ({ tagName: r.tag_name, name: r.name }));
  const jq = spawnSync("jq", ["-r", flag("--jq")], { input: JSON.stringify(list), encoding: "utf8" });
  if (jq.status !== 0) fail("jq: " + jq.stderr);
  process.stdout.write(jq.stdout);
} else if (a === "release" && b === "edit") {
  const r = find(tag);
  if (!r) fail("release not found");
  for (const x of args.slice(3)) {
    const m = /^--(draft|latest)=(true|false)$/.exec(x);
    if (!m) fail("unexpected: gh " + args.join(" "));
    r[m[1]] = m[2] === "true";
  }
  if (r.latest) for (const other of releases) if (other !== r) delete other.latest;
  save();
} else {
  fail("unexpected: gh " + args.join(" "));
}
`;

/** A release already there, as GitHub's API gives it. */
const published = (tag: string, o: Partial<Release> = {}): Release => ({
  tag_name: tag,
  name: `BoxOps ${tag.slice(1)}`,
  draft: false,
  prerelease: /-rc\./.test(tag),
  author: { login: "github-actions[bot]" },
  body: "",
  assets: [],
  ...o,
});

const COMMIT = "c0ffee".padEnd(40, "1");
const SOURCE = "50ce".padEnd(40, "2");

/** The publish job's folder: the release's files in assets/, preflight's notes in notes/. */
function jobFolder(version: string, security = "none"): string {
  const work = tempDir();
  mkdirSync(join(work, "assets"));
  mkdirSync(join(work, "notes"));
  for (const [name, text] of Object.entries({ [`boxops-${version}.tar.gz`]: "tarball", "boxops.mjs": "tool", SHA256SUMS: "sums", "sbom.spdx.json": "{}" })) {
    writeFileSync(join(work, "assets", name), `${text} of ${version}\n`);
  }
  writeFileSync(join(work, "notes", "notes.md"), `- Security: ${security}\n- Data format: 1 (unchanged)\n\n### Changes\n\n- Something got better.\n`);
  return work;
}

/** Runs the step in `work` (jobFolder) for `version`, as run `run` of the workflow, with these releases there; what it did. */
function publish(work: string, version: string, releases: Release[], run = "4242") {
  expect(JQ, "jq, which the step uses, is installed").toBeDefined();
  const stand = join(work, "stand-in");
  if (!existsSync(stand)) {
    mkdirSync(stand);
    writeFileSync(join(stand, "gh.mjs"), STAND_IN);
    writeFileSync(join(stand, "gh"), `#!/bin/sh\nexec '${process.execPath}' '${join(stand, "gh.mjs")}' "$@"\n`, { mode: 0o755 });
  }
  writeFileSync(join(stand, "releases.json"), JSON.stringify(releases));
  writeFileSync(join(stand, "gh.log"), "");
  const temp = join(work, "runner-temp");
  mkdirSync(temp, { recursive: true });
  writeFileSync(join(work, "publish.sh"), publishScript());
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", join(work, "publish.sh")], {
    cwd: work,
    encoding: "utf8",
    env: {
      // sha256sum is in /sbin on macOS.
      PATH: `${stand}:${JQ}:/usr/bin:/bin:/usr/sbin:/sbin`,
      GH_STAND_IN: stand,
      V: version,
      COMMIT,
      GH_TOKEN: "token",
      GH_REPO: "Allenfp/BoxOps",
      GITHUB_REPOSITORY: "Allenfp/BoxOps",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_SHA: SOURCE,
      GITHUB_RUN_ID: run,
      RUNNER_TEMP: temp,
    },
  });
  return {
    code: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    calls: readFileSync(join(stand, "gh.log"), "utf8").trim().split("\n").filter(Boolean),
    releases: JSON.parse(readFileSync(join(stand, "releases.json"), "utf8")) as Release[],
  };
}

/** The gh calls that changed something, by their first two words. */
const changes = (calls: string[]) => calls.map((c) => c.split(" ").slice(0, 2).join(" ")).filter((c) => !["release view", "release list"].includes(c) && !c.startsWith("api "));

describe("the release workflow's publish step", () => {
  it("makes the release a draft with the files and the notes, then publishes it: GitHub's latest, if no other is newer", () => {
    const work = jobFolder("0.1.1");
    const r = publish(work, "0.1.1", [published("v0.1.0")]);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(changes(r.calls)).toEqual(["release create", "release edit"]);
    expect(r.calls).toContain("release edit v0.1.1 --draft=false --latest=true");
    const made = r.releases.find((x) => x.tag_name === "v0.1.1");
    expect(made).toMatchObject({ name: "BoxOps 0.1.1", draft: false, prerelease: false, latest: true });
    expect(made?.assets.map((a) => a.name).sort()).toEqual(["SHA256SUMS", "boxops-0.1.1.tar.gz", "boxops.mjs", "sbom.spdx.json"]);
    expect(made?.body).toBe(
      [
        `    uses: Allenfp/BoxOps@${COMMIT} # v0.1.1`,
        "",
        `The release commit \`${COMMIT}\` (branch \`releases\`), built from main at \`${SOURCE}\` by https://github.com/Allenfp/BoxOps/actions/runs/4242.`,
        "What runs in a roadmap repository's workflow: `dist/action.mjs`, `dist/boxops.mjs` (unminified) and git. No network, no token, no npm, no build.",
        "Check that `boxops.mjs`, the tarball or any file of the release commit came from this workflow: `gh attestation verify <file> -R Allenfp/BoxOps --signer-workflow Allenfp/BoxOps/.github/workflows/release.yml`",
        "",
        readFileSync(join(work, "notes", "notes.md"), "utf8"),
      ].join("\n"),
    );
    expect(r.stdout).toContain("Published BoxOps 0.1.1 (GitHub's latest release: true): https://github.com/Allenfp/BoxOps/releases/tag/v0.1.1");
  });

  it("titles a release that fixes a security problem so, from its notes' Security: line", () => {
    const r = publish(jobFolder("0.1.1", "a link in a box's notes could run script"), "0.1.1", [published("v0.1.0")]);
    expect(r.code).toBe(0);
    expect(r.releases.find((x) => x.tag_name === "v0.1.1")?.name).toBe("Security: BoxOps 0.1.1");
  });

  it("doesn't make a patch of an older minor GitHub's latest, nor a release candidate; a withdrawn release doesn't count", () => {
    const patch = publish(jobFolder("0.1.2"), "0.1.2", [published("v0.2.0"), published("v0.1.1"), published("v0.1.0")]);
    expect(patch.code).toBe(0);
    expect(patch.calls).toContain("release edit v0.1.2 --draft=false --latest=false");
    // Version order, not text order: 0.10.0 is newer than 0.9.0.
    const ten = publish(jobFolder("0.10.0"), "0.10.0", [published("v0.9.0"), published("v0.2.0")]);
    expect(ten.calls).toContain("release edit v0.10.0 --draft=false --latest=true");
    // 0.2.0 was withdrawn: 0.1.2 is the newest release one should move to.
    const withdrawn = publish(jobFolder("0.1.2"), "0.1.2", [published("v0.2.0", { name: "Withdrawn: BoxOps 0.2.0" }), published("v0.1.1")]);
    expect(withdrawn.calls).toContain("release edit v0.1.2 --draft=false --latest=true");
    const candidate = publish(jobFolder("0.2.0-rc.1"), "0.2.0-rc.1", [published("v0.1.0")]);
    expect(candidate.code).toBe(0);
    expect(candidate.calls.filter((c) => c.startsWith("release create"))).toEqual([expect.stringContaining("release create v0.2.0-rc.1 --verify-tag --draft --prerelease --title BoxOps 0.2.0-rc.1")]);
    expect(candidate.calls).not.toContainEqual(expect.stringMatching(/^release list/));
    expect(candidate.calls).toContain("release edit v0.2.0-rc.1 --draft=false --latest=false");
  });

  it("makes again a draft an earlier attempt of the run left", () => {
    const work = jobFolder("0.1.1");
    const r = publish(work, "0.1.1", [published("v0.1.0"), published("v0.1.1", { draft: true, assets: [{ name: "boxops.mjs", digest: "sha256:00" }] })]);
    expect(r.code).toBe(0);
    expect(changes(r.calls)).toEqual(["release delete", "release create", "release edit"]);
    expect(r.releases.find((x) => x.tag_name === "v0.1.1")?.assets).toHaveLength(4);
  });

  it("run again, goes on from a release this run published, and from no other: another's, other files, another run's", () => {
    const work = jobFolder("0.1.1");
    const first = publish(work, "0.1.1", [published("v0.1.0")]);
    expect(first.code).toBe(0);
    const ours = first.releases;
    const again = publish(work, "0.1.1", ours);
    expect(again).toMatchObject({ code: 0, stderr: "" });
    expect(again.stdout).toContain("v0.1.1 is published already, by an earlier attempt of this run.");
    expect(changes(again.calls)).toEqual([]);

    const error = "::error title=v0.1.1 has a release this run didn't make::";
    const edited = (change: (r: Release) => void) => {
      const copy = JSON.parse(JSON.stringify(ours)) as Release[];
      change(copy.find((x) => x.tag_name === "v0.1.1") as Release);
      return copy;
    };
    // Made by someone who can push here (the maintainer, a token pasted into the demo), with this run's files and notes.
    const theirs = publish(work, "0.1.1", edited((r) => (r.author = { login: "Allenfp" })));
    expect(theirs.code).toBe(1);
    expect(theirs.stdout).toContain(`${error}Its author (Allenfp), files or notes aren't this run's.`);
    expect(changes(theirs.calls)).toEqual([]);
    // A file that isn't this run's, or one more.
    const other = publish(work, "0.1.1", edited((r) => (r.assets[1].digest = `sha256:${createHash("sha256").update("another").digest("hex")}`)));
    expect(other.code).toBe(1);
    expect(other.stdout).toContain(error);
    const more = publish(work, "0.1.1", edited((r) => r.assets.push({ name: "extra.zip", digest: "sha256:00" })));
    expect(more.code).toBe(1);
    // Another run's notes.
    const another = publish(work, "0.1.1", ours, "4243");
    expect(another.code).toBe(1);
    expect(another.stdout).toContain(error);
    expect(changes(another.calls)).toEqual([]);
    // Nothing of the job's own folder was touched.
    expect(readdirSync(join(work, "assets")).sort()).toEqual(["SHA256SUMS", "boxops-0.1.1.tar.gz", "boxops.mjs", "sbom.spdx.json"]);
  });
});

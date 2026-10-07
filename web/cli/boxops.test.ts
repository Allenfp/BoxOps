import { readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildReport, formatReport } from "../src/model/report";
import { loadRoadmap } from "../src/model/parse";
import { main } from "./boxops";
import type { Io, LaunchContext } from "./context";
import { ID, SAMPLE, capture, cleanUp, sampleRepo, tempDir } from "./test-release";
import { type Entry, TestRepo } from "./test-repo";

const repos: TestRepo[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.remove();
  cleanUp();
});

/** A checked-out repository with these entries (default: the sample roadmap). */
function checkout(entries: Record<string, Entry> = sampleRepo()): TestRepo {
  const repo = new TestRepo();
  repos.push(repo);
  repo.commit(entries, "Add the example project");
  repo.checkout();
  return repo;
}

async function run(argv: string[], o: Partial<Io> = {}, ctx: LaunchContext = {}) {
  const io = capture(o);
  const code = await main(argv, ctx, io);
  return { code, stdout: io.stdout.join("\n"), stderr: io.stderr.join("\n"), io };
}

describe("validate", () => {
  it("ends in — OK and exits 0 on a clean roadmap", async () => {
    const repo = checkout();
    const r = await run(["validate"], { cwd: repo.dir });
    expect([r.code, r.stdout, r.stderr]).toEqual([0, "1 departments, 2 lanes, 1 boxes — OK", ""]);
  });

  it("lists problems with paths relative to where it was typed, and exits 1", async () => {
    const repo = checkout(sampleRepo({ "roadmap/boxes/bx-0000-x.yaml": "id: bx-0000-x\n", "roadmap/notes.txt": "x\n" }));
    const r = await run(["validate"], { cwd: join(repo.dir, "roadmap") }, { root: repo.dir });
    expect(r.code).toBe(1);
    expect(r.stderr.split("\n")).toEqual([
      "boxes/bx-0000-x.yaml:1: code: required text is missing",
      "boxes/bx-0000-x.yaml:1: title: required text is missing",
      "boxes/bx-0000-x.yaml:1: lane: required text is missing",
      "boxes/bx-0000-x.yaml:1: type: required text is missing",
      "boxes/bx-0000-x.yaml:1: start: required text is missing",
      "boxes/bx-0000-x.yaml:1: end: required text is missing",
      "notes.txt: unexpected file; roadmap files live in departments/ or boxes/",
    ]);
    expect(r.stdout).toBe("1 departments, 2 lanes, 1 boxes — 7 issue(s)");
  });

  it("exits 3 on another data format, with the same lines", async () => {
    for (const settings of ["title: Old\n", "format: 2\n"]) {
      const repo = checkout(sampleRepo({ "roadmap/settings.yaml": settings }));
      const r = await run(["validate"], { cwd: repo.dir });
      expect(r.code).toBe(3);
      expect(r.stdout).toMatch(/— \d issue\(s\)$/);
    }
  });

  it("exits 2 without a roadmap folder or with a bad option, and 1 on an unreadable folder", async () => {
    const empty = tempDir();
    expect(await run(["validate"], { cwd: empty })).toMatchObject({ code: 2, stderr: `boxops validate: No roadmap folder at ${join(empty, "roadmap")}` });
    expect(await run(["validate", "--frobnicate"], { cwd: empty })).toMatchObject({
      code: 2,
      stderr: "boxops validate: Unknown option --frobnicate (this command takes --root, --roadmap, --json)",
    });
    const repo = checkout();
    symlinkSync("/etc/hosts", join(repo.dir, "roadmap", "boxes", "link.yaml"));
    const r = await run(["validate"], { cwd: repo.dir });
    expect([r.code, r.stderr]).toEqual([1, "roadmap/boxes/link.yaml: is a symlink; a roadmap folder holds plain files only"]);
  });

  it("--json says the same for programs", async () => {
    const repo = checkout(sampleRepo({ "roadmap/notes.txt": "x\n" }));
    const r = await run(["validate", "--json"], { cwd: repo.dir });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({
      ok: false,
      readable: true,
      format: 1,
      formatStatus: "current",
      reads: 1,
      departments: 1,
      lanes: 2,
      boxes: 1,
      people: 1,
      problems: [{ path: "notes.txt", message: "unexpected file; roadmap files live in departments/ or boxes/" }],
      result: "1 departments, 2 lanes, 1 boxes — 1 issue(s)",
    });
    expect(r.stderr).toBe("");
  });

  it("takes a folder, --root and --roadmap", async () => {
    const repo = checkout(Object.fromEntries(Object.entries(SAMPLE).map(([p, t]) => [`plan/${p}`, t])));
    expect((await run(["validate", "--roadmap", "plan"], { cwd: repo.dir })).code).toBe(0);
    expect((await run(["validate", "--root", repo.dir, "--roadmap=plan"])).code).toBe(0);
    expect((await run(["validate", join(repo.dir, "plan")])).code).toBe(0);
  });
});

describe("report", () => {
  it("prints model/report.ts's text, byte for byte", async () => {
    const repo = checkout();
    const r = await run(["report"], { cwd: repo.dir });
    expect([r.code, r.stdout]).toEqual([0, formatReport(buildReport(loadRoadmap(SAMPLE).roadmap))]);
  });

  it("--json: dates as YYYY-MM-DD", async () => {
    const repo = checkout();
    const json = JSON.parse((await run(["report", "--json"], { cwd: repo.dir })).stdout);
    expect(json.people[0]).toEqual({
      id: "example-ada",
      name: "Ada Example",
      department: "Engineering",
      bookings: [{ box: { id: "bx-1a2b-example-project", code: "ENG-K7P", title: "Example project (delete me)", start: "2026-11-02", end: "2026-11-13" }, fte: 1 }],
      over: [],
    });
    expect(json.departments[0]).toMatchObject({ id: "engineering", fte: 2, boxes: 1, over: [] });
  });
});

describe("build", () => {
  it("writes what the action writes: the release's app and roadmap.json, from HEAD", async () => {
    const repo = checkout();
    repo.git(["remote", "add", "origin", "https://github.com/acme/roadmap.git"]);
    const out = join(tempDir(), "site");
    const r = await run(["build", "--out", out], { cwd: repo.dir });
    expect(r.code).toBe(0);
    expect(r.stdout.split("\n")[0]).toBe("1 departments, 2 lanes, 1 boxes — OK");
    expect(readdirSync(out).sort()).toEqual(["assets", "favicon.svg", "index.html", "roadmap.json"]);
    const bundle = JSON.parse(readFileSync(join(out, "roadmap.json"), "utf8"));
    expect(bundle.source).toMatchObject({ repo: "acme/roadmap", branch: "main", commit: repo.git(["rev-parse", "HEAD"]), tree: repo.git(["rev-parse", "HEAD:roadmap"]) });
    expect(bundle.source.local).toBeUndefined();
    expect(bundle.app).toEqual({ version: ID.version, build: ID.build, time: ID.time });
  });

  it("--worktree reads the files on disk (local); --commit reads that commit", async () => {
    const repo = checkout();
    const first = repo.git(["rev-parse", "HEAD"]);
    repo.commit({ ...sampleRepo(), "roadmap/people.yaml": "people: []\n" }, "Remove Ada");
    repo.checkout();
    writeFileSync(join(repo.dir, "roadmap", "people.yaml"), "people: [] # not committed\n");
    const site = async (...flags: string[]) => {
      const out = join(tempDir(), "site");
      const r = await run(["build", "--out", out, ...flags], { cwd: repo.dir });
      return { code: r.code, bundle: JSON.parse(readFileSync(join(out, "roadmap.json"), "utf8")) };
    };
    const disk = await site("--worktree");
    expect([disk.bundle.source.local, disk.bundle.source.tree, disk.bundle.files["people.yaml"]]).toEqual([true, null, "people: [] # not committed\n"]);
    const old = await site("--commit", first);
    expect([old.bundle.source.commit, old.bundle.files["people.yaml"]]).toEqual([first, SAMPLE["people.yaml"]]);
    expect(old.code).toBe(0);
    expect((await run(["build", "--out", "x", "--commit", "HEAD", "--worktree"], { cwd: repo.dir })).stderr).toBe("boxops build: Give --commit or --worktree, not both");
  });

  it("writes the site with problems (exit 1), but nothing in another data format (exit 3) or into a folder that isn't empty", async () => {
    const broken = checkout(sampleRepo({ "roadmap/notes.txt": "x\n" }));
    const out = join(tempDir(), "site");
    const r = await run(["build", "--out", out], { cwd: broken.dir });
    expect([r.code, readdirSync(out).includes("roadmap.json")]).toEqual([1, true]);
    const again = await run(["build", "--out", out], { cwd: broken.dir });
    expect([again.code, again.stderr.split("\n").pop()]).toEqual([2, `boxops build: ${out} isn’t empty; give a new or empty folder`]);
    const old = checkout(sampleRepo({ "roadmap/settings.yaml": "title: Old\n" }));
    const none = join(tempDir(), "none");
    const f = await run(["build", "--out", none], { cwd: old.dir });
    expect(f.code).toBe(3);
    expect(f.stderr.split("\n").pop()).toBe("This roadmap is in data format 0; BoxOps 0.1.0 reads format 1. Run `node .boxops/boxops.mjs migrate`, commit and push. Nothing was written");
    expect(() => readdirSync(none)).toThrow();
    const { "roadmap/settings.yaml": _, ...noSettings } = sampleRepo();
    const m = await run(["build", "--out", none], { cwd: checkout(noSettings).dir });
    expect([m.code, m.stderr.split("\n").pop()]).toEqual([3, "roadmap/settings.yaml is missing: every roadmap needs one, with at least `format: 1`. Add it, commit and push. Nothing was written"]);
    expect(() => readdirSync(none)).toThrow();
  });

  it("needs a release beside it, this build's", async () => {
    const repo = checkout();
    const r = await run(["build", "--out", join(tempDir(), "s")], { cwd: repo.dir, cliDir: tempDir() });
    expect([r.code, r.stderr]).toEqual([2, expect.stringMatching(/^boxops build: No BUILD.json beside /)]);
  });
});

describe("migrate", () => {
  const OLD = "# Team settings\r\ntitle: Old # keep this comment\r\nfiscal_year_start_month: 1\r\n";

  it("--check says what it would change, and changes nothing (exit 1)", async () => {
    const repo = checkout(sampleRepo({ "roadmap/settings.yaml": OLD }));
    const r = await run(["migrate", "--check"], { cwd: repo.dir });
    expect([r.code, r.stdout]).toEqual([1, "roadmap/ is in data format 0; this BoxOps reads 1. `node .boxops/boxops.mjs migrate` would change settings.yaml (0 → 1: stamps format: 1 in settings.yaml)."]);
    expect(readFileSync(join(repo.dir, "roadmap", "settings.yaml"), "utf8")).toBe(OLD);
  });

  it("stamps the format, keeping comments and CRLF, validates, and is idempotent", async () => {
    const repo = checkout(sampleRepo({ "roadmap/settings.yaml": OLD }));
    const r = await run(["migrate"], { cwd: repo.dir });
    expect(r.stdout.split("\n")).toEqual([
      "Migrated roadmap/ from data format 0 to 1 (0 → 1: stamps format: 1 in settings.yaml): changed settings.yaml. Review and commit them.",
      "1 departments, 2 lanes, 1 boxes — OK",
    ]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(repo.dir, "roadmap", "settings.yaml"), "utf8")).toBe("# Team settings\r\nformat: 1\r\ntitle: Old # keep this comment\r\nfiscal_year_start_month: 1\r\n");
    expect(repo.git(["status", "--porcelain"])).toBe("M roadmap/settings.yaml");
    const again = await run(["migrate"], { cwd: repo.dir });
    expect(again.stdout.split("\n")[0]).toBe("roadmap/ is in data format 1, the one this BoxOps reads: nothing to migrate.");
    expect((await run(["migrate", "--check"], { cwd: repo.dir })).code).toBe(0);
    expect(readdirSync(join(repo.dir, "roadmap")).filter((n) => n.startsWith("."))).toEqual([]);
  });

  it("refuses a newer format (exit 3)", async () => {
    const repo = checkout(sampleRepo({ "roadmap/settings.yaml": "format: 2\n" }));
    expect(await run(["migrate"], { cwd: repo.dir })).toMatchObject({
      code: 3,
      stderr: "This roadmap is in data format 2, newer than this BoxOps reads (1): upgrade BoxOps rather than migrating",
    });
  });
});

describe("sync, guide, version, help", () => {
  it("sync writes, then --check passes; --check on an old block fails", async () => {
    const root = tempDir();
    const first = await run(["sync", "--check", "--root", root]);
    expect([first.code, first.stdout]).toEqual([1, "Not this release’s: AGENTS.md (new), .boxops/boxops.mjs (new), CLAUDE.md (new). Run `node .boxops/boxops.mjs sync`."]);
    expect((await run(["sync", "--root", root])).stdout).toBe(
      "Wrote AGENTS.md (new), .boxops/boxops.mjs (new), CLAUDE.md (new) (BoxOps block 1, launcher 1). Review and commit them.",
    );
    expect(await run(["sync", "--check", "--root", root])).toMatchObject({ code: 0, stdout: "AGENTS.md’s BoxOps block (1), the launcher (1) and CLAUDE.md are this release’s." });
  });

  it("the commands that warn do when the repository's BoxOps files are older, reading only plain files", async () => {
    const repo = checkout(sampleRepo({ "AGENTS.md": "<!-- boxops:begin block=0 -->\n<!-- boxops:end -->\n", ".github/workflows/deploy.yml": "# boxops-guard: 0\n" }));
    const r = await run(["validate"], { cwd: repo.dir }, { root: repo.dir, launcher: 0 });
    expect(r.code).toBe(0);
    expect(r.stderr.split("\n")).toEqual([
      "boxops: the launcher is 0; this BoxOps writes 1: run `node .boxops/boxops.mjs sync`",
      "boxops: AGENTS.md’s BoxOps block is 0; this BoxOps writes 1: run `node .boxops/boxops.mjs sync`",
      "boxops: the Pages guard in deploy.yml is 0; this BoxOps expects 1: run `node .boxops/boxops.mjs doctor`",
    ]);
    // Not again when the launcher has said so (it checks against the release's BUILD.json).
    expect(await run(["validate"], { cwd: repo.dir }, { root: repo.dir, launcher: 0, checked: true })).toMatchObject({ code: 0, stderr: "" });
    // Never through a symlink (to /dev/zero, say, a read would never end): the same files, linked to, aren't read.
    for (const path of ["AGENTS.md", ".github/workflows/deploy.yml"]) {
      const elsewhere = join(tempDir(), "file");
      writeFileSync(elsewhere, readFileSync(join(repo.dir, path)));
      rmSync(join(repo.dir, path));
      symlinkSync(elsewhere, join(repo.dir, path));
    }
    const linked = await run(["validate"], { cwd: repo.dir }, { root: repo.dir });
    expect([linked.code, linked.stderr]).toEqual([0, ""]);
  });

  it("guide prints a topic, or all of them; an unknown topic is a usage error", async () => {
    expect((await run(["guide", "commits"])).stdout).toMatch(/^# BoxOps guide: commit messages/);
    expect((await run(["guide"])).stdout).toMatch(/^BoxOps 0\.1\.0: the guide for this release/);
    expect(await run(["guide", "nope"])).toMatchObject({ code: 2, stderr: "boxops guide: No guide topic \"nope\": overview, recipes, commits, format, upgrading" });
  });

  it("version names the release, and the pin when the launcher gives it", async () => {
    expect((await run(["version"])).stdout).toBe("BoxOps 0.1.0 (build 0.1.0+0123456789ab, data format 1)");
    expect((await run(["version"], {}, { repo: "Allenfp/BoxOps", sha: "abcdef0".padEnd(40, "1") })).stdout).toBe(
      "BoxOps 0.1.0 (Allenfp/BoxOps@abcdef0, build 0.1.0+0123456789ab, data format 1)",
    );
    expect((await run(["--version"])).code).toBe(0);
  });

  it("help lists the commands; no command or an unknown one exits 2", async () => {
    const help = await run(["help"]);
    expect(help.code).toBe(0);
    for (const c of ["validate", "report", "preview", "guide", "migrate", "sync", "doctor", "upgrade", "build", "init", "version"]) expect(help.stdout).toContain(`  ${c}`);
    expect(help.stdout).not.toMatch(/^ {2}action/m);
    expect((await run([])).code).toBe(2);
    expect(await run(["deploy"])).toMatchObject({ code: 2, stderr: expect.stringContaining('boxops: no command "deploy"') });
  });

  it("action runs the action, with Path B's flags", async () => {
    const r = await run(["action", "--mode", "check"]);
    expect(r.code).toBe(1);
    expect(r.stdout.split("\n")[0]).toBe("::error title=BoxOps::This isn’t GitHub Actions (GITHUB_ACTIONS isn’t true): the action runs only in a workflow");
  });
});

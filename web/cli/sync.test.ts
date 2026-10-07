import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRoadmap } from "../src/model/parse";
import { carried, collectEmbedded, embedded, starterFiles } from "./embedded";
import { TOPICS, guideTopic, wholeGuide } from "./guide";
import { contractNumber, findPins } from "./pins";
import { AGENTS_BLOCK, GUARD, LAUNCHER } from "./release";
import { agentsBlock, applySync, hasReleaseBlock, isReleaseLauncher, launcherText, planSync, withAgentsBlock } from "./sync";
import { cleanUp, tempDir } from "./test-release";

afterEach(cleanUp);

const BLOCK = agentsBlock().text;

describe("the starter (starter/)", () => {
  it("has the 13 files of a roadmap repository", () => {
    expect(Object.keys(starterFiles()).sort()).toEqual([
      ".boxops/boxops.mjs",
      ".github/dependabot.yml",
      ".github/workflows/check.yml",
      ".github/workflows/deploy.yml",
      ".gitignore",
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      "roadmap/boxes/bx-1a2b-example-project.yaml",
      "roadmap/boxes/bx-3c4d-example-maintenance.yaml",
      "roadmap/departments/engineering.yaml",
      "roadmap/people.yaml",
      "roadmap/settings.yaml",
    ]);
  });

  it("is what sync writes: its AGENTS.md block, launcher and CLAUDE.md are this release's", () => {
    const files = starterFiles();
    expect(withAgentsBlock(files["AGENTS.md"])).toBe(files["AGENTS.md"]);
    expect(files["AGENTS.md"]).toContain(BLOCK);
    expect(files[".boxops/boxops.mjs"]).toBe(launcherText());
    expect(files["CLAUDE.md"]).toBe("@AGENTS.md\n");
  });

  it("carries this release's contract numbers: launcher, guard, block", () => {
    const files = starterFiles();
    expect(contractNumber(files[".boxops/boxops.mjs"], "launcher")).toBe(LAUNCHER);
    expect(files[".boxops/boxops.mjs"]).toContain(`const LAUNCHER = ${LAUNCHER};`);
    expect(contractNumber(files[".github/workflows/deploy.yml"], "guard")).toBe(GUARD);
    expect(contractNumber(files["AGENTS.md"], "block")).toBe(AGENTS_BLOCK);
  });

  it("pins BoxOps on one line in each workflow, to a placeholder init and publishing fill in", () => {
    const files = starterFiles();
    for (const wf of [".github/workflows/deploy.yml", ".github/workflows/check.yml"]) {
      expect(findPins(files[wf])).toEqual([expect.objectContaining({ repo: "Allenfp/BoxOps", ref: "<RELEASE_COMMIT_SHA>", tag: "v0.1.0", pathB: false })]);
    }
  });

  it("has a sample roadmap that validates in this BoxOps's format, on weekdays", () => {
    const roadmap = Object.fromEntries(
      Object.entries(starterFiles())
        .filter(([p]) => p.startsWith("roadmap/"))
        .map(([p, t]) => [p.slice("roadmap/".length), t]),
    );
    const loaded = loadRoadmap(roadmap);
    expect([loaded.issues, loaded.formatStatus, loaded.roadmap.boxes.length, loaded.roadmap.people.length]).toEqual([[], "current", 2, 2]);
    expect(loaded.roadmap.boxes.every((b) => b.title.endsWith("(delete me)"))).toBe(true);
  });

  it("has a launcher that runs: its syntax is Node's", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "launcher.mjs"), launcherText());
    execFileSync(process.execPath, ["--check", join(dir, "launcher.mjs")]);
  });
});

describe("guide", () => {
  it("has every topic, and with no topic all but the file format", () => {
    for (const t of TOPICS) expect(guideTopic(t).length).toBeGreaterThan(500);
    const whole = wholeGuide("0.1.0");
    expect(whole).toMatch(/^BoxOps 0\.1\.0: the guide for this release\. Topics: overview, recipes, commits, format, upgrading/);
    for (const t of ["overview", "recipes", "commits", "upgrading"] as const) expect(whole).toContain(guideTopic(t).trimEnd());
    expect(whole).not.toContain("## settings.yaml");
  });

  it("reads the same in a terminal as on GitHub: no HTML entities", () => {
    for (const t of TOPICS) expect([t, guideTopic(t).match(/&#?\w+;/g)]).toEqual([t, null]);
    expect(carried("templates/agents-block.md")).not.toMatch(/&#?\w+;/);
  });

  it("tells a roadmap repository's reader to use the launcher, never npm or web/", () => {
    for (const t of TOPICS) expect(guideTopic(t)).not.toMatch(/\bnpm\b|cd web|\bweb\//);
    expect(guideTopic("format")).toContain("`node .boxops/boxops.mjs validate`");
    expect(guideTopic("format")).toMatch(/^# BoxOps guide: the file format\n/);
  });

  it("gives examples of a new box that the starter's roadmap takes as they are", () => {
    const roadmap = Object.fromEntries(
      Object.entries(starterFiles())
        .filter(([p]) => p.startsWith("roadmap/"))
        .map(([p, t]) => [p.slice("roadmap/".length), t]),
    );
    for (const text of [guideTopic("recipes"), carried("templates/agents-block.md")]) {
      const example = /```yaml\n((?:\s*\w+: .*\n)+?)\s*```/.exec(text.slice(text.indexOf("Add a box")))?.[1].replace(/^ {2}/gm, "");
      const id = /^id: (.+)$/m.exec(example ?? "")?.[1];
      const loaded = loadRoadmap({ ...roadmap, [`boxes/${id}.yaml`]: example ?? "" });
      expect([id, loaded.issues, loaded.roadmap.boxes.length]).toEqual(["bx-3f9c-q3-planning", [], 3]);
    }
  });

  it("carries the files git tracks, as on disk, and nothing untracked", () => {
    const dir = tempDir();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, stdio: "pipe" });
    git("init", "-q");
    const write = (files: Record<string, string>) => {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(join(dir, path, ".."), { recursive: true });
        writeFileSync(join(dir, path), text);
      }
    };
    write({
      "templates/agents-block.md": "block\n",
      "templates/old.md": "old\n",
      "templates/gone.md": "gone\n",
      "starter/README.md": "readme\n",
      "starter/.github/workflows/deploy.yml": "deploy\n",
      "docs/data-format.md": "not carried\n",
    });
    git("add", "-A");
    git("-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "Start");
    // Edited, added but not committed, deleted: as on disk. Never tracked: left out.
    write({ "starter/README.md": "edited\n", "starter/new.md": "new\n", "starter/.DS_Store": "junk", "templates/agents-block.md~": "backup\n", "starter/notes.swp": "x" });
    git("add", "starter/new.md");
    git("rm", "-q", "templates/old.md");
    rmSync(join(dir, "templates/gone.md"));
    expect(collectEmbedded(dir)).toEqual({
      "starter/.github/workflows/deploy.yml": "deploy\n",
      "starter/README.md": "edited\n",
      "starter/new.md": "new\n",
      "templates/agents-block.md": "block\n",
    });
    expect(() => collectEmbedded(tempDir())).toThrow(/^Can’t list the files git tracks in /);
  });

  it("carries the files it needs, and only plain text", () => {
    const paths = Object.keys(embedded());
    expect(paths).toContain("templates/agents-block.md");
    expect(paths).toContain("templates/guide/format.md");
    expect(paths.filter((p) => !p.startsWith("templates/") && !p.startsWith("starter/"))).toEqual([]);
    expect(carried("starter/CLAUDE.md")).toBe("@AGENTS.md\n");
    expect(() => carried("web/package.json")).toThrow("BoxOps doesn’t carry web/package.json");
  });
});

describe("withAgentsBlock", () => {
  it("replaces the block between the markers, keeping everything around it", () => {
    const old = "# Notes\n\nIntro.\n<!-- boxops:begin block=0 — old -->\nold text\n<!-- boxops:end -->\n\n## Team notes\nKeep me.\n";
    expect(withAgentsBlock(old)).toBe(`# Notes\n\nIntro.\n${BLOCK}\n\n## Team notes\nKeep me.\n`);
    expect(withAgentsBlock(withAgentsBlock(old))).toBe(withAgentsBlock(old));
  });

  it("puts it after the first heading of a file without one, or at the top", () => {
    expect(withAgentsBlock("# Ours\n\nRules.\n")).toBe(`# Ours\n\n${BLOCK}\n\nRules.\n`);
    expect(withAgentsBlock("Rules.\n")).toBe(`${BLOCK}\n\nRules.\n`);
  });

  it("keeps CRLF line ends", () => {
    const old = "# Ours\r\n<!-- boxops:begin block=0 -->\r\nx\r\n<!-- boxops:end -->\r\nNotes\r\n";
    const out = withAgentsBlock(old);
    expect(out).toBe(`# Ours\r\n${BLOCK.replace(/\n/g, "\r\n")}\r\nNotes\r\n`);
    expect(/[^\r]\n/.test(out)).toBe(false);
  });

  it("refuses one marker without the other", () => {
    expect(() => withAgentsBlock("<!-- boxops:begin block=1 -->\nno end\n")).toThrow("AGENTS.md has one BoxOps marker without the other");
    expect(() => withAgentsBlock("<!-- boxops:end -->\n<!-- boxops:begin block=1 -->\n")).toThrow("one BoxOps marker without the other");
  });
});

describe("isReleaseLauncher and hasReleaseBlock (doctor's and the action's checks)", () => {
  it("take only what sync would leave as it is, with LF or CRLF", () => {
    const launcher = launcherText();
    expect([isReleaseLauncher(launcher), isReleaseLauncher(launcher.replace(/\n/g, "\r\n"))]).toEqual([true, true]);
    for (const other of [`${launcher}// one more line\n`, launcher.replace("(launcher: 1)", "(launcher: 2)"), "// BoxOps launcher (launcher: 1)\n", ""]) {
      expect(isReleaseLauncher(other)).toBe(false);
    }
    const agents = starterFiles()["AGENTS.md"];
    expect([hasReleaseBlock(agents), hasReleaseBlock(agents.replace(/\n/g, "\r\n")), hasReleaseBlock(`${agents}- Our own rule.\n`)]).toEqual([true, true, true]);
    for (const other of [agents.replace("Never force-push.", "Force-push."), agents.replace("<!-- boxops:end -->", ""), "# Ours\n", ""]) {
      expect(hasReleaseBlock(other)).toBe(false);
    }
  });
});

describe("planSync and applySync", () => {
  it("writes AGENTS.md, the launcher and CLAUDE.md into a bare repository, then has nothing to do", () => {
    const root = tempDir();
    const changes = planSync(root);
    expect(changes.map((c) => [c.path, c.created])).toEqual([
      ["AGENTS.md", true],
      [".boxops/boxops.mjs", true],
      ["CLAUDE.md", true],
    ]);
    applySync(root, changes);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(carried("starter/AGENTS.md"));
    expect(readFileSync(join(root, ".boxops/boxops.mjs"), "utf8")).toBe(launcherText());
    expect(planSync(root)).toEqual([]);
  });

  it("updates an old block and launcher, keeps the team's notes, and never touches CLAUDE.md or the workflows", () => {
    const root = tempDir();
    mkdirSync(join(root, ".boxops"));
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "# Ours\n<!-- boxops:begin block=0 -->\nold\n<!-- boxops:end -->\n## Team notes\nBe kind.\n");
    writeFileSync(join(root, ".boxops/boxops.mjs"), "// BoxOps launcher (launcher: 0)\n");
    writeFileSync(join(root, "CLAUDE.md"), "Our own CLAUDE.md\n");
    writeFileSync(join(root, ".github/workflows/deploy.yml"), "name: Ours\n");
    const changes = planSync(root);
    expect(changes.map((c) => [c.path, c.created])).toEqual([
      ["AGENTS.md", false],
      [".boxops/boxops.mjs", false],
    ]);
    applySync(root, changes);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(`# Ours\n${BLOCK}\n## Team notes\nBe kind.\n`);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe("Our own CLAUDE.md\n");
    expect(readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8")).toBe("name: Ours\n");
  });

  it("takes a launcher checked out with CRLF (Git for Windows' default) for this release's, and keeps CRLF in one it rewrites", () => {
    const root = tempDir();
    applySync(root, planSync(root));
    const launcher = join(root, ".boxops/boxops.mjs");
    writeFileSync(launcher, launcherText().replace(/\n/g, "\r\n"));
    expect(planSync(root)).toEqual([]);
    writeFileSync(launcher, "// BoxOps launcher (launcher: 0)\r\nold\r\n");
    const changes = planSync(root);
    expect(changes.map((c) => [c.path, c.created, c.text])).toEqual([[".boxops/boxops.mjs", false, launcherText().replace(/\n/g, "\r\n")]]);
    applySync(root, changes);
    expect(planSync(root)).toEqual([]);
    // With LF, as git checks it out elsewhere: LF.
    writeFileSync(launcher, "// BoxOps launcher (launcher: 0)\nold\n");
    expect(planSync(root).map((c) => c.text)).toEqual([launcherText()]);
  });

  it("leaves a CLAUDE.md that's there alone, whatever it is: a symlink to AGENTS.md, even one to nothing", () => {
    for (const target of ["AGENTS.md", "nowhere.md"]) {
      const root = tempDir();
      mkdirSync(join(root, ".boxops"));
      writeFileSync(join(root, "AGENTS.md"), "# Ours\n<!-- boxops:begin block=0 -->\nold\n<!-- boxops:end -->\n");
      writeFileSync(join(root, ".boxops/boxops.mjs"), "// BoxOps launcher (launcher: 0)\n");
      symlinkSync(target, join(root, "CLAUDE.md"));
      const changes = planSync(root);
      expect([target, changes.map((c) => [c.path, c.created])]).toEqual([
        target,
        [
          ["AGENTS.md", false],
          [".boxops/boxops.mjs", false],
        ],
      ]);
      applySync(root, changes);
      expect(readlinkSync(join(root, "CLAUDE.md"))).toBe(target);
      expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(`# Ours\n${BLOCK}\n`);
      expect(planSync(root)).toEqual([]);
    }
  });

  it("won't write through a symlink", () => {
    const root = tempDir();
    const elsewhere = tempDir();
    writeFileSync(join(elsewhere, "AGENTS.md"), "# x\n");
    symlinkSync(join(elsewhere, "AGENTS.md"), join(root, "AGENTS.md"));
    expect(() => planSync(root)).toThrow("AGENTS.md isn’t a plain file (it’s a symlink); sync won’t write through it");
    const other = tempDir();
    symlinkSync(elsewhere, join(other, ".boxops"));
    expect(() => planSync(other)).toThrow(".boxops isn’t a folder; sync won’t write through it");
  });
});

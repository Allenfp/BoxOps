// The starter (starter/) made for a release (cli/starter.ts), and the same
// files whichever way a roadmap repository gets them: `init`, and `sync` for
// the files it keeps.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./boxops";
import { starterFiles, trackedFiles } from "./embedded";
import { findPins } from "./pins";
import { HERE } from "./release";
import { SOURCE_PLACEHOLDER, docLinks, renderStarter } from "./starter";
import { ID, capture, cleanUp, fakeGitHub, releaseFiles, tempDir } from "./test-release";

afterEach(cleanUp);

const A = "a".repeat(40);
const S = "5".repeat(40);
const RELEASE = { repo: "Allenfp/BoxOps", sha: A, tag: "v0.1.0", source: S };

/** Every file under `dir` (path from it, "/"-separated → text). */
function readTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    out[file.slice(dir.length + 1).split("\\").join("/")] = readFileSync(file, "utf8");
  }
  return out;
}

describe("renderStarter", () => {
  it("fills in every pin and README.md's links to BoxOps' docs, and changes nothing else", () => {
    const files = starterFiles();
    const made = renderStarter(files, RELEASE);
    expect(Object.keys(made)).toEqual(Object.keys(files));
    for (const [path, text] of Object.entries(made)) {
      expect(text, path).not.toMatch(/<(?:RELEASE|SOURCE)_COMMIT_SHA>/);
      const before = files[path].split("\n");
      const after = text.split("\n");
      expect(after.length, path).toBe(before.length);
      for (const [i, line] of after.entries()) {
        if (line !== before[i]) expect(line, `${path}:${i + 1}`).toMatch(new RegExp(`Allenfp/BoxOps@${A} # v0\\.1\\.0$|github\\.com/Allenfp/BoxOps/(blob|tree)/${S}/`));
      }
    }
    for (const wf of [".github/workflows/deploy.yml", ".github/workflows/check.yml"]) {
      expect(findPins(made[wf])).toEqual([expect.objectContaining({ repo: "Allenfp/BoxOps", ref: A, tag: "v0.1.0", pathB: false })]);
    }
    // README.md's links go to the docs as of the release (its tag's commit holds no docs), never main.
    expect(made["README.md"]).toContain(`https://github.com/Allenfp/BoxOps/blob/${S}/docs/adopting.md`);
    expect(made["README.md"]).not.toMatch(/github\.com\/Allenfp\/BoxOps\/(blob|tree)\/(?![0-9a-f]{40}\/)/);
  });

  it("pins a mirror, and a release candidate", () => {
    const made = renderStarter(starterFiles(), { ...RELEASE, repo: "acme/boxops-mirror", tag: "v0.2.0-rc.1" });
    expect(made[".github/workflows/check.yml"]).toContain(`      - uses: acme/boxops-mirror@${A} # v0.2.0-rc.1\n`);
    // The docs stay BoxOps' own.
    expect(made["README.md"]).toContain(`https://github.com/Allenfp/BoxOps/blob/${S}/docs/adopting.md`);
  });

  it("refuses what isn't a release, and a placeholder it can't fill in", () => {
    const files = starterFiles();
    expect(() => renderStarter(files, { ...RELEASE, sha: "v0.1.0" })).toThrow('"v0.1.0" isn’t a release commit (40 lowercase hex)');
    expect(() => renderStarter(files, { ...RELEASE, tag: "0.1.0" })).toThrow('"0.1.0" isn’t a release tag (vX.Y.Z)');
    expect(() => renderStarter(files, { ...RELEASE, source: "" })).toThrow('"" isn’t the commit the release was built from (40 lowercase hex)');
    expect(() => renderStarter(files, { ...RELEASE, repo: "BoxOps" })).toThrow('"BoxOps" isn’t a repository (owner/name)');
    expect(() => renderStarter({ "AGENTS.md": "See <RELEASE_COMMIT_SHA>.\n" }, RELEASE)).toThrow(
      "starter/AGENTS.md still has <RELEASE_COMMIT_SHA> once made for v0.1.0: it’s on a line BoxOps doesn’t fill in",
    );
  });
});

/**
 * Pages of BoxOps' docs that starter/ links to and that aren't written yet.
 * A release needs none (AGENTS.md, Releases): its `init` would write links to
 * nothing, and publish-starter refuses to publish them.
 */
const TO_WRITE: string[] = [];

describe("starter/'s links to BoxOps' docs", () => {
  it("go to pages git tracks here, but those still to write (and those aren't written)", () => {
    const repo = resolve(HERE, "../..");
    const links = [...docLinks(starterFiles(), SOURCE_PLACEHOLDER)];
    expect(links.map(([path]) => path)).toContain("templates/path-b");
    const missing = links.filter(([path, kind]) => {
      const files = trackedFiles(repo, [path]);
      return kind === "blob" ? !files.includes(path) : !files.length || files.some((f) => !f.startsWith(`${path}/`));
    });
    expect(missing.map(([path]) => path).sort()).toEqual(TO_WRITE);
  });
});

describe("a new roadmap repository", () => {
  it("is the starter made for the release, from init; sync writes the same AGENTS.md, launcher and CLAUDE.md", async () => {
    const gh = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.1.0": A } }, files: { [A]: releaseFiles(ID) } });
    const io = capture({ fetch: gh.fetch });
    expect(await main(["init", "acme-roadmap"], {}, io)).toBe(0);
    const made = renderStarter(starterFiles(), { ...RELEASE, source: ID.source });
    const inited = readTree(join(io.cwd, "acme-roadmap"));
    expect(inited).toEqual(made);

    const synced = tempDir();
    expect(await main(["sync", "--root", synced], {}, capture())).toBe(0);
    expect(readTree(synced)).toEqual({ "AGENTS.md": made["AGENTS.md"], ".boxops/boxops.mjs": made[".boxops/boxops.mjs"], "CLAUDE.md": made["CLAUDE.md"] });
    expect(await main(["sync", "--check", "--root", join(io.cwd, "acme-roadmap")], {}, capture())).toBe(0);
  });

  it("isn't made from a commit whose BUILD.json names no commit it was built from", async () => {
    const gh = fakeGitHub({ files: { [A]: releaseFiles({ ...ID, source: "" }) } });
    const io = capture({ fetch: gh.fetch });
    expect(await main(["init", "acme-roadmap", "--action", `Allenfp/BoxOps@${A}`], {}, io)).toBe(2);
    expect(io.stderr).toEqual([`boxops init: Allenfp/BoxOps@${A.slice(0, 12)}’s BUILD.json names no commit it was built from: it isn’t a release`]);
    expect(readdirSync(io.cwd)).toEqual([]);
  });
});

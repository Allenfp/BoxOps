// publish-starter (web/scripts/publish-starter.ts) against a stand-in BoxOps
// clone: a commit of main with starter/ and the docs it links to, a release
// commit built from it (BUILD.json naming it) and its tag. What it writes is
// what that release's `init` writes, and `sync` too for the files it keeps.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main as boxops } from "../cli/boxops";
import { starterFiles } from "../cli/embedded";
import { buildJsonText, makeBuildJson } from "../cli/release";
import { renderStarter } from "../cli/starter";
import { ID, capture, cleanUp, fakeGitHub, releaseFiles, tempDir } from "../cli/test-release";
import { TestRepo } from "../cli/test-repo";
import { main, publishStarter } from "./publish-starter";

const repos: TestRepo[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.remove();
  cleanUp();
  vi.restoreAllMocks();
});

/** Every file under `dir` (path from it, "/"-separated → text). */
function readTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) out[join(entry.parentPath, entry.name).slice(dir.length + 1)] = readFileSync(join(entry.parentPath, entry.name), "utf8");
  }
  return out;
}

interface Upstream {
  repo: TestRepo;
  /** The commit of main the release was built from. */
  source: string;
  release: string;
}

/**
 * A BoxOps clone: main (starter/ as this checkout has it, or `starter`, and
 * the docs it links to unless `docs` is false), then a release commit of
 * version `version` built from it, tagged v0.1.0 (or `tag` names another
 * commit, or there's no tag).
 */
function upstream(o: { starter?: Record<string, string>; docs?: boolean; version?: string; tag?: "release" | "main" | "none" } = {}): Upstream {
  const repo = new TestRepo();
  repos.push(repo);
  const entries: Record<string, string> = {};
  for (const [path, text] of Object.entries(o.starter ?? starterFiles())) entries[`starter/${path}`] = text;
  if (o.docs !== false) Object.assign(entries, { "docs/adopting.md": "# Adopting BoxOps\n", "templates/path-b/deploy.yml": "name: Deploy roadmap\n" });
  const source = repo.commit(entries, "Main");
  repo.git(["branch", "source", source]);
  const tool = Buffer.from("export async function main() { return 0; }\n");
  const build = buildJsonText(makeBuildJson({ ...ID, version: o.version ?? "0.1.0", source }, { "dist/boxops.mjs": tool }));
  const release = repo.commit({ "BUILD.json": build, "dist/boxops.mjs": tool }, `BoxOps ${o.version ?? "0.1.0"}`, []);
  if (o.tag !== "none") repo.git(["tag", "v0.1.0", o.tag === "main" ? source : release]);
  return { repo, source, release };
}

describe("publish-starter", () => {
  it("writes the starter made for the release, as its init does (and sync, for what sync keeps), from the source commit's starter/", async () => {
    const { repo, source, release } = upstream();
    const out = join(tempDir(), "starter");
    expect(publishStarter({ repoDir: repo.dir, tag: "v0.1.0", commit: release, out })).toEqual({
      files: Object.keys(starterFiles()).sort(),
      source,
      tagChecked: true,
    });
    const published = readTree(out);
    expect(published).toEqual(renderStarter(starterFiles(), { repo: "Allenfp/BoxOps", sha: release, tag: "v0.1.0", source }));

    // That release's init: the same files.
    const gh = fakeGitHub({ tags: { "Allenfp/BoxOps": { "v0.1.0": release } }, files: { [release]: releaseFiles({ ...ID, source }) } });
    const io = capture({ fetch: gh.fetch });
    expect(await boxops(["init", "acme-roadmap"], {}, io)).toBe(0);
    expect(readTree(join(io.cwd, "acme-roadmap"))).toEqual(published);
    // And sync, for AGENTS.md, the launcher and CLAUDE.md.
    const synced = tempDir();
    expect(await boxops(["sync", "--root", synced], {}, capture())).toBe(0);
    expect(readTree(synced)).toEqual({ "AGENTS.md": published["AGENTS.md"], ".boxops/boxops.mjs": published[".boxops/boxops.mjs"], "CLAUDE.md": published["CLAUDE.md"] });
  });

  it("reads starter/ from the commit the release was built from, not from this checkout", () => {
    const starter = { ...starterFiles(), "README.md": `${starterFiles()["README.md"]}\nThe release's own words.\n` };
    const { repo, release } = upstream({ starter });
    const out = join(tempDir(), "starter");
    publishStarter({ repoDir: repo.dir, tag: "v0.1.0", commit: release, out });
    expect(readFileSync(join(out, "README.md"), "utf8")).toMatch(/The release's own words\.\n$/);
  });

  it("checks the release before writing anything: its commit, BUILD.json, tag, source, and the docs the starter links to", () => {
    const fresh = () => join(tempDir(), "starter");
    const run = (u: Upstream, o: Partial<Parameters<typeof publishStarter>[0]> = {}) => () =>
      publishStarter({ repoDir: u.repo.dir, tag: "v0.1.0", commit: u.release, out: fresh(), ...o });
    const ok = upstream();
    const c = "c".repeat(40);
    expect(run(ok, { commit: c })).toThrow(`This clone hasn’t commit ${c.slice(0, 12)}: fetch first: git fetch origin main releases --tags`);
    expect(run(ok, { commit: ok.source })).toThrow(`${ok.source.slice(0, 12)} has no BUILD.json: it isn’t a BoxOps release commit`);
    expect(run(upstream({ version: "0.2.0" }))).toThrow("is BoxOps 0.2.0, not v0.1.0");
    const elsewhere = upstream({ tag: "main" });
    expect(run(elsewhere)).toThrow(`v0.1.0 is ${elsewhere.source.slice(0, 12)} in this clone, not ${elsewhere.release.slice(0, 12)}`);
    expect(run(ok, { source: c })).toThrow(`${ok.release.slice(0, 12)} was built from ${ok.source.slice(0, 12)}, not ${c.slice(0, 12)}`);
    expect(run(ok, { tag: "0.1.0" })).toThrow('--tag is "0.1.0": give a release tag, like v0.1.0');
    const undocumented = upstream({ docs: false });
    const out = fresh();
    expect(() => publishStarter({ repoDir: undocumented.repo.dir, tag: "v0.1.0", commit: undocumented.release, out })).toThrow(
      `The starter links to docs/adopting.md, templates/path-b in BoxOps, which ${undocumented.source.slice(0, 12)} hasn’t: nothing was written`,
    );
    expect(existsSync(out)).toBe(false);
    const full = fresh();
    mkdirSync(full);
    writeFileSync(join(full, "x"), "");
    expect(run(ok, { out: full })).toThrow(`${full} isn’t empty: give a new or empty folder`);
  });

  it("writes the starter when this clone hasn't the tag, and says it wasn't checked", () => {
    const { repo, release } = upstream({ tag: "none" });
    expect(publishStarter({ repoDir: repo.dir, tag: "v0.1.0", commit: release, out: join(tempDir(), "starter") }).tagChecked).toBe(false);
  });

  it("as a command: prints what it wrote and the commands to publish it, and never pushes", async () => {
    const { repo, release, source } = upstream();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = join(tempDir(), "starter");
    expect(await main(["--tag", "v0.1.0", "--commit", release, "--out", out], repo.dir)).toBe(0);
    const printed = log.mock.calls.map((c) => String(c[0]));
    expect(printed[0]).toMatch(new RegExp(`^Wrote the starter for BoxOps v0\\.1\\.0 to .*starter \\(13 files\\): Allenfp/BoxOps@${release.slice(0, 12)}, built from ${source.slice(0, 12)}\\.$`));
    expect(printed).toContain("Nothing was pushed. To publish it:");
    expect(printed.some((l) => /^ {4}rsync -a --delete --exclude=\.git .*starter\/ \.\/$/.test(l))).toBe(true);
    expect(printed.join("\n")).not.toMatch(/--force/);
    expect(await main(["--tag", "v0.1.0"], repo.dir)).toBe(2);
    expect(error.mock.calls.at(-1)?.[0]).toBe(
      "publish-starter: Usage: npm run publish-starter -- --tag vX.Y.Z --commit <release commit> --out <new folder> [--source <commit>]",
    );
  });
});

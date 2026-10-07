// publish-starter (web/scripts/publish-starter.ts) against a stand-in BoxOps
// clone: a commit of main with starter/ and the docs it links to, a release
// commit built from it (BUILD.json naming it) and its tag. What it writes is
// what that release's `init` writes, and `sync` too for the files it keeps;
// the commands it prints, pasted into bash and zsh from another folder
// against stand-ins for the starter repository and `gh`, publish that
// folder, and stop at a step that fails, changing nothing where they run.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main as boxops } from "../cli/boxops";
import { starterFiles } from "../cli/embedded";
import { buildJsonText, makeBuildJson } from "../cli/release";
import { SOURCE_PLACEHOLDER, docLinks, renderStarter } from "../cli/starter";
import { ID, capture, cleanUp, fakeGitHub, releaseFiles, tempDir } from "../cli/test-release";
import { TestRepo } from "../cli/test-repo";
import { SHELLS, block, paste, shellEnv, standIns, which } from "../cli/test-shell";
import { NO_REPLY, main, publishCommands, publishStarter } from "./publish-starter";

// Each test runs git dozens of times, some pasting commands into a shell too: up to 3 seconds on a
// quiet machine, and several times that under load, near or past vitest's 5.
vi.setConfig({ testTimeout: 30_000 });

const repos: TestRepo[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.remove();
  cleanUp();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Every file under `dir` (path from it, "/"-separated → text), but those in its folder `skip`. */
function readTree(dir: string, skip?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name).slice(dir.length + 1);
    if (entry.isFile() && !(skip && path.startsWith(`${skip}/`))) out[path] = readFileSync(join(entry.parentPath, entry.name), "utf8");
  }
  return out;
}

/** shellEnv's environment with git's identity taken out: only the global configuration's is left, as on a maintainer's machine. */
function configIdentity(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) delete env[key];
  return env;
}

/** The pages of BoxOps' docs starter/ links to (path → blob or tree), as they come in it. */
const DOC_LINKS = [...docLinks(starterFiles(), SOURCE_PLACEHOLDER)];

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
  // A file at each page it links to, and in each folder.
  if (o.docs !== false) for (const [path, kind] of DOC_LINKS) entries[kind === "blob" ? path : `${path}/README.md`] = `# ${path}\n`;
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
      `The starter links to ${DOC_LINKS.map(([path]) => path).join(", ")} in BoxOps, which ${undocumented.source.slice(0, 12)} hasn’t: nothing was written`,
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
    const out = join(tempDir(), "it's here");
    expect(await main(["--tag", "v0.1.0", "--commit", release, "--out", out], repo.dir)).toBe(0);
    const printed = log.mock.calls.map((c) => String(c[0]));
    expect(printed[0]).toMatch(new RegExp(`^Wrote the starter for BoxOps v0\\.1\\.0 to .*it's here \\(13 files\\): Allenfp/BoxOps@${release.slice(0, 12)}, built from ${source.slice(0, 12)}\\.$`));
    // Each block one command whose steps stop at the first that fails; the folder written whole
    // and quoted for the shell, wherever it runs; rsync into the new clone alone.
    const quoted = `'${out.replaceAll("'", `'\\''`)}`;
    // Each commit as the maintainer's no-reply address, checked before anything is pushed.
    const noReply =
      "git log -1 --format='%ae%n%ce' | sort -u | " +
      `awk '!/@users\\.noreply\\.github\\.com$/ && $0 != "noreply@github.com" { print "not a GitHub no-reply address: " $0 > "/dev/stderr"; bad = 1 } END { exit bad }'`;
    expect(printed.slice(1)).toEqual([
      "Nothing was pushed. To publish it:",
      "  The first time (Allenfp/boxops-starter doesn't exist yet), in the folder written:",
      `    cd ${quoted}' && git init -b main && git add -A && \\`,
      '      git config user.email 29790605+Allenfp@users.noreply.github.com && git commit -m "BoxOps starter for v0.1.0" && \\',
      `      ${noReply} && \\`,
      "      gh repo create Allenfp/boxops-starter --public --source . --push && \\",
      "      gh repo edit Allenfp/boxops-starter --template",
      "  Then, on GitHub: Settings → Pages → Source: GitHub Actions, and run Actions → Deploy roadmap.",
      "  Each later release, as a pull request, from a new clone in a temporary folder:",
      "    starter=$(mktemp -d) && \\",
      '      git clone git@github.com:Allenfp/boxops-starter.git "$starter" && \\',
      '      cd "$starter" && git switch -c boxops-v0.1.0 && \\',
      `      [ -d "$starter/.git" ] && rsync -a --delete --exclude=.git ${quoted}/' "$starter/" && \\`,
      '      git add -A && git config user.email 29790605+Allenfp@users.noreply.github.com && git commit -m "Upgrade BoxOps to v0.1.0" && \\',
      `      ${noReply} && \\`,
      "      git push -u origin boxops-v0.1.0 && gh pr create --fill",
      "  Each is one command: paste it whole, and it stops at the first step that fails.",
      "  Each commits as 29790605+Allenfp@users.noreply.github.com, not your global git address, and stops before pushing a commit made as any other.",
      "  Pushing workflow files takes SSH, or a token with the workflow scope.",
    ]);
    expect(() => publishCommands("starter", "v0.1.0")).toThrow("publishCommands: starter isn’t an absolute path");
    expect(await main(["--tag", "v0.1.0"], repo.dir)).toBe(2);
    expect(error.mock.calls.at(-1)?.[0]).toBe(
      "publish-starter: Usage: npm run publish-starter -- --tag vX.Y.Z --commit <release commit> --out <new folder> [--source <commit>]",
    );
  });

  // The printed commands, pasted into each shell as a maintainer would (cli/test-shell.ts), with
  // local repositories standing in for GitHub's.
  for (const shell of SHELLS) {
    it(`pastes into ${shell[0]} with the stand-in for gh first on its PATH, and no GitHub sign-in`, () => {
      const stand = standIns();
      const env = shellEnv(stand);
      expect(Object.keys(env).filter((k) => /TOKEN/.test(k))).toEqual([]);
      const found = paste(shell, "command -v gh >&2\n", tempDir(), env);
      expect([found.status, found.stderr.trim()]).toEqual([0, join(stand, "gh")]);
    });

    it(`prints commands that publish the folder it wrote, pasted into ${shell[0]} wherever it's open: tried with git and rsync`, async () => {
      expect(which("rsync"), "rsync, which the printed commands use, is installed").toBeTruthy();
      const { repo, release } = upstream();
      // npm run in BoxOps' web/, with --out a folder beside the clone: ../../starter-out.
      const top = tempDir();
      const web = join(top, "BoxOps", "web");
      mkdirSync(web, { recursive: true });
      vi.stubEnv("INIT_CWD", web);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      expect(await main(["--tag", "v0.1.0", "--commit", release, "--out", "../../starter-out"], repo.dir)).toBe(0);
      const out = join(top, "starter-out");
      const written = readTree(out);
      expect(Object.keys(written)).toHaveLength(13);
      const printed = log.mock.calls.map((c) => String(c[0]));
      expect(printed[0]).toMatch(/ to \.\.\/\.\.\/starter-out \(13 files\)/);

      // The starter repository as an earlier release left it (a README this one rewrites, a file
      // it hasn't), which git clones and pushes to by its SSH URL.
      const github = new TestRepo();
      repos.push(github);
      github.commit({ "README.md": "The earlier starter\n", "dropped.txt": "Not in this release\n" }, "BoxOps starter for v0.0.9");
      // The maintainer's identity is a personal address, in their global git configuration.
      const stand = standIns();
      const env = configIdentity(
        shellEnv(stand, `[user]\n\tname = Maintainer\n\temail = maintainer@example.com\n[url "${github.dir}"]\n\tinsteadOf = git@github.com:Allenfp/boxops-starter.git\n`),
      );
      const git = (dir: string, args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env }).trim();
      const madeAs = `Maintainer <${NO_REPLY}>, Maintainer <${NO_REPLY}>`;
      /** A commit's files: path → blob SHA. */
      const tree = (dir: string, commit: string) =>
        Object.fromEntries(
          git(dir, ["ls-tree", "-r", commit])
            .split("\n")
            .map((line) => {
              const [meta, path] = line.split("\t");
              return [path, meta.split(" ")[2]];
            }),
        );
      const blobs = Object.fromEntries(Object.entries(written).map(([path, text]) => [path, github.blob(text)]));

      // A later release, from where npm ran: a branch of a new clone holding exactly the folder written.
      const later = paste(shell, block(printed, "Each later release"), web, env);
      expect(later.status, later.stderr).toBe(0);
      expect(git(github.dir, ["log", "-1", "--format=%s", "boxops-v0.1.0"])).toBe("Upgrade BoxOps to v0.1.0");
      expect(git(github.dir, ["log", "-1", "--format=%an <%ae>, %cn <%ce>", "boxops-v0.1.0"])).toBe(madeAs);
      expect(tree(github.dir, "boxops-v0.1.0")).toEqual(blobs);
      expect(readFileSync(join(stand, "gh.log"), "utf8")).toBe("pr create --fill\n");
      expect(readTree(out)).toEqual(written);
      expect(readdirSync(web)).toEqual([]);

      // The first time, from anywhere: the folder written becomes the repository.
      const first = paste(shell, block(printed, "The first time"), top, env);
      expect(first.status, first.stderr).toBe(0);
      expect(git(out, ["log", "--format=%s"])).toBe("BoxOps starter for v0.1.0");
      expect(git(out, ["log", "--format=%an <%ae>, %cn <%ce>"])).toBe(madeAs);
      expect(tree(out, "HEAD")).toEqual(blobs);
      expect(readFileSync(join(stand, "gh.log"), "utf8").split("\n").slice(1, 3)).toEqual([
        "repo create Allenfp/boxops-starter --public --source . --push",
        "repo edit Allenfp/boxops-starter --template",
      ]);
    });

    it(`prints commands that push no commit made as an address but the no-reply one, pasted into ${shell[0]}`, async () => {
      const { repo, release } = upstream();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const out = join(tempDir(), "starter-out");
      expect(await main(["--tag", "v0.1.0", "--commit", release, "--out", out], repo.dir)).toBe(0);
      const printed = log.mock.calls.map((c) => String(c[0]));
      const github = new TestRepo();
      repos.push(github);
      github.commit({ "README.md": "The earlier starter\n" }, "BoxOps starter for v0.0.9");
      // GIT_AUTHOR_EMAIL and GIT_COMMITTER_EMAIL in the environment (shellEnv's) win over `git config user.email`.
      const stand = standIns();
      const env = shellEnv(stand, `[url "${github.dir}"]\n\tinsteadOf = git@github.com:Allenfp/boxops-starter.git\n`);
      const refs = () => execFileSync("git", ["-C", github.dir, "for-each-ref", "--format=%(refname) %(objectname)"], { encoding: "utf8", env }).trim();
      const before = refs();
      for (const heading of ["Each later release", "The first time"]) {
        const pasted = paste(shell, block(printed, heading), tempDir(), env);
        expect(pasted.status, heading).not.toBe(0);
        expect(pasted.stderr, heading).toContain("not a GitHub no-reply address: maintainer@example.com");
      }
      expect(refs()).toBe(before);
      expect(existsSync(join(stand, "gh.log")), "gh was run").toBe(false);
    });

    it(`prints commands that stop at a step that fails, pasted into ${shell[0]}: a failed clone or cd changes nothing where they run`, async () => {
      const { repo, release } = upstream();
      // No stand-in for the starter repository: git refuses its SSH URL, so the clone fails.
      const stand = standIns();
      const env = shellEnv(stand);
      const git = (dir: string, args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env }).trim();
      // BoxOps' clone, where npm ran: a commit, a file git doesn't track, and an origin a push would reach.
      const clone = new TestRepo();
      repos.push(clone);
      clone.commit({ "web/src/app.ts": "export {};\n", "README.md": "# BoxOps\n" }, "BoxOps");
      clone.checkout();
      clone.write({ "web/NOTES.local": "Not committed\n" });
      const origin = tempDir();
      git(origin, ["init", "-q", "--bare"]);
      git(clone.dir, ["remote", "add", "origin", origin]);
      git(clone.dir, ["push", "-q", "origin", "main"]);
      const web = join(clone.dir, "web");
      vi.stubEnv("INIT_CWD", web);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const out = join(tempDir(), "starter-out");
      expect(await main(["--tag", "v0.1.0", "--commit", release, "--out", out], repo.dir)).toBe(0);
      const printed = log.mock.calls.map((c) => String(c[0]));

      /** All a run could change: the clone's files (but .git), its refs, branch and status, and origin's refs. */
      const state = () => ({
        files: readTree(clone.dir, ".git"),
        refs: git(clone.dir, ["for-each-ref", "--format=%(refname) %(objectname)"]),
        head: git(clone.dir, ["symbolic-ref", "HEAD"]),
        status: git(clone.dir, ["status", "--porcelain", "--untracked-files=all"]),
        origin: git(origin, ["for-each-ref", "--format=%(refname) %(objectname)"]),
      });
      const before = state();
      expect(before.status).toBe("?? web/NOTES.local");

      const later = paste(shell, block(printed, "Each later release"), web, env);
      expect(later.status).not.toBe(0);
      expect(later.stderr).toContain("transport 'ssh' not allowed");
      expect(state()).toEqual(before);
      expect(existsSync(join(stand, "gh.log")), "gh was run").toBe(false);

      // The first time, with the folder written gone: its cd fails, and nothing after it runs.
      rmSync(out, { recursive: true });
      const first = paste(shell, block(printed, "The first time"), web, env);
      expect(first.status).not.toBe(0);
      expect(first.stderr).toMatch(/no such file or directory/i);
      expect(state()).toEqual(before);
      expect(existsSync(join(stand, "gh.log")), "gh was run").toBe(false);
    });
  }
});

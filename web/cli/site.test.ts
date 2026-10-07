import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readBundle } from "../src/model/bundle";
import { parseFile } from "../src/model/parse";
import { EXECUTABLE } from "../src/model/paths";
import { RoadmapReadError } from "./git";
import { type ParseCache, appInfo, assembleBundle, buildBundle, buildVersion, hashFolder, repoFromRemote, repoVisibility, withoutCredentials } from "./site";
import { TestRepo } from "./test-repo";

// Most tests make a repository and read it with git many times (one 52 times): up to 3 seconds on a
// quiet machine, and several times that under load, near or past vitest's 5.
vi.setConfig({ testTimeout: 30_000 });

const repos: TestRepo[] = [];
const temps: string[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.remove();
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const APP = { version: "0.1.0", build: "0.1.0+0123456789ab", time: "2026-10-01T00:00:00Z" };
const ROADMAP = { "roadmap/settings.yaml": "format: 1\n", "roadmap/people.yaml": "people: []\n", "roadmap/boxes/b1.yaml": "id: b1\n" };

/** A repo with two commits on main, the second checked out; an origin remote on github.com. */
function repo(): { repo: TestRepo; first: string; second: string } {
  const r = new TestRepo();
  repos.push(r);
  const first = r.commit({ ...ROADMAP, "web/package.json": "{}\n" }, "Initial roadmap", undefined, "Setup");
  const second = r.commit({ ...ROADMAP, "roadmap/boxes/b1.yaml": "id: b1\ntitle: B1\n", "web/package.json": "{}\n" }, "B1: renamed\n\nSaved from the BoxOps web app.");
  r.checkout();
  r.git(["remote", "add", "origin", "git@github.com:planning/roadmap.git"]);
  return { repo: r, first, second };
}

/** A GitHub Actions environment for acme/roadmap, with this event payload (undefined: no payload file). */
function actions(sha: string, payload?: unknown): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "boxops-test-"));
  temps.push(dir);
  const event = join(dir, "event.json");
  if (payload !== undefined) writeFileSync(event, JSON.stringify(payload));
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "acme/roadmap",
    GITHUB_REF_NAME: "main",
    GITHUB_SHA: sha,
    GITHUB_EVENT_PATH: event,
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_RUN_ID: "123",
  };
}

describe("buildBundle in GitHub Actions", () => {
  it("reads git objects at GITHUB_SHA and fills every field", async () => {
    const { repo: r, first, second } = repo();
    r.write({ "roadmap/boxes/b1.yaml": "id: b1\ntitle: not committed\n" }); // never read in Actions
    const env = actions(second, { repository: { full_name: "acme/roadmap", private: false, visibility: "public" } });
    const bundle = await buildBundle({ repoDir: r.dir, app: APP, env });
    const blob = (path: string) => r.git(["rev-parse", `${second}:roadmap/${path}`]);
    const parsed = (path: string, text: string) => {
      const { path: _, ...entry } = parseFile(path, text);
      return entry;
    };
    expect(bundle).toEqual({
      schema: 1,
      format: 1,
      app: APP,
      source: {
        repo: "acme/roadmap",
        branch: "main",
        commit: second,
        dir: "roadmap",
        tree: r.git(["rev-parse", `${second}:roadmap`]),
        visibility: "public",
        private: false,
        readonly: false,
        author: "Sam Lee",
        subject: "B1: renamed",
        date: "2026-10-01T00:02:00Z",
        history: [second, first],
        run: "https://github.com/acme/roadmap/actions/runs/123",
      },
      files: { "boxes/b1.yaml": "id: b1\ntitle: B1\n", "people.yaml": "people: []\n", "settings.yaml": "format: 1\n" },
      blobs: { "boxes/b1.yaml": blob("boxes/b1.yaml"), "people.yaml": blob("people.yaml"), "settings.yaml": blob("settings.yaml") },
      ignored: [],
      notices: [],
      // Each file as this build parses it, by path (without its path), stamped with the build id.
      parsed: {
        parser: APP.build,
        files: {
          "boxes/b1.yaml": parsed("boxes/b1.yaml", "id: b1\ntitle: B1\n"),
          "people.yaml": parsed("people.yaml", "people: []\n"),
          "settings.yaml": parsed("settings.yaml", "format: 1\n"),
        },
      },
    });
    expect(readBundle(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle); // the app reads it as written
    // GITHUB_SHA wins over whatever is checked out.
    const older = await buildBundle({ repoDir: r.dir, app: APP, env: actions(first) });
    expect([older.source.commit, older.files["boxes/b1.yaml"], older.source.history]).toEqual([first, "id: b1\n", [first]]);
  });

  it("takes visibility from the event payload; anything unknown is private", async () => {
    const { repo: r, second } = repo();
    const seen = async (payload?: unknown) => {
      const { source } = await buildBundle({ repoDir: r.dir, app: APP, env: actions(second, payload) });
      return [source.visibility, source.private];
    };
    const repository = (fields: object) => ({ repository: { full_name: "acme/roadmap", ...fields } });
    expect(await seen(repository({ private: false, visibility: "public" }))).toEqual(["public", false]);
    expect(await seen(repository({ private: true, visibility: "private" }))).toEqual(["private", true]);
    expect(await seen(repository({ private: true, visibility: "internal" }))).toEqual(["internal", true]);
    expect(await seen(repository({ private: false }))).toEqual(["public", false]);
    expect(await seen(repository({ visibility: "public" }))).toEqual(["public", true]); // `private` missing: not proven public
    expect(await seen(repository({ private: false, visibility: "internal" }))).toEqual(["internal", true]);
    expect(await seen({ repository: { full_name: "someone/else", private: false, visibility: "public" } })).toEqual([null, true]);
    expect(await seen({ action: "push" })).toEqual([null, true]);
    expect(await seen(undefined)).toEqual([null, true]); // no payload file
    expect(repoVisibility({})).toEqual({ visibility: null, private: true });
  });

  it("reads an executable roadmap file all the same, and says so", async () => {
    const r = new TestRepo();
    repos.push(r);
    const sha = r.commit({ ...ROADMAP, "roadmap/boxes/b1.yaml": { mode: "100755", content: "id: b1\n" } });
    const warnings: string[] = [];
    const bundle = await buildBundle({ repoDir: r.dir, app: APP, env: actions(sha), warn: (m) => warnings.push(m) });
    expect(bundle.files["boxes/b1.yaml"]).toBe("id: b1\n");
    expect(warnings).toEqual([`roadmap/boxes/b1.yaml ${EXECUTABLE}`]);
  });

  it("stops on GitHub Enterprise Server or GHE.com: the app would read, and save to, github.com", async () => {
    const { repo: r, second } = repo();
    for (const server of ["https://ghe.acme.example", "https://octocorp.ghe.com"]) {
      const env = { ...actions(second), GITHUB_SERVER_URL: server };
      await expect(buildBundle({ repoDir: r.dir, app: APP, env })).rejects.toThrow(
        `This runs on ${server}: GitHub Enterprise Server and GHE.com aren’t supported in BoxOps 0.1`,
      );
    }
    const { source } = await buildBundle({ repoDir: r.dir, app: APP, env: { ...actions(second), GITHUB_SERVER_URL: "https://GitHub.com/" } });
    expect(source.repo).toBe("acme/roadmap");
  });

  it("stops on a symlink or submodule in the commit", async () => {
    const r = new TestRepo();
    repos.push(r);
    const sha = r.commit({ ...ROADMAP, "roadmap/settings.yaml": { mode: "120000", content: "../../runner/.config/gcloud/credentials.json" } });
    await expect(buildBundle({ repoDir: r.dir, app: APP, env: actions(sha) })).rejects.toThrow(RoadmapReadError);
    await expect(buildBundle({ repoDir: r.dir, app: APP, env: actions(sha) })).rejects.toThrow("roadmap/settings.yaml: is a symlink");
  });
});

describe("buildBundle locally", () => {
  it("reads HEAD's git objects when roadmap/ is as committed; the repository comes from a github.com origin", async () => {
    const { repo: r, first, second } = repo();
    writeFileSync(join(r.dir, "roadmap", ".DS_Store"), "\0"); // hidden: doesn't count as a change
    const warnings: string[] = [];
    const { source, files } = await buildBundle({ repoDir: r.dir, app: APP, env: {}, warn: (m) => warnings.push(m) });
    expect(source).toMatchObject({ repo: "planning/roadmap", branch: "main", commit: second, visibility: null, private: true, history: [second, first] });
    expect(source.tree).toBe(r.git(["rev-parse", "HEAD:roadmap"]));
    expect(source.local).toBeUndefined();
    expect(source.run).toBeUndefined();
    expect(files["boxes/b1.yaml"]).toBe("id: b1\ntitle: B1\n");
    expect(warnings).toEqual([]);
  });

  it("uses the files on disk when roadmap/ has uncommitted changes: local, no tree", async () => {
    const { repo: r, second } = repo();
    r.write({ "roadmap/boxes/b2.yaml": "id: b2\n" });
    const warnings: string[] = [];
    const { source, files, blobs } = await buildBundle({ repoDir: r.dir, app: APP, env: {}, warn: (m) => warnings.push(m) });
    expect(source).toMatchObject({ commit: second, tree: null, local: true });
    expect(files["boxes/b2.yaml"]).toBe("id: b2\n");
    expect(blobs["boxes/b2.yaml"]).toBe(r.blob("id: b2\n"));
    expect(warnings).toEqual(["roadmap/ has changes that aren’t committed: roadmap.json is built from the files on disk (marked local)"]);
  });

  it("refuses a symlink on disk", async () => {
    const { repo: r } = repo();
    symlinkSync("/etc/hosts", join(r.dir, "roadmap", "boxes", "b2.yaml"));
    await expect(buildBundle({ repoDir: r.dir, app: APP, env: {}, warn: () => {} })).rejects.toThrow("boxes/b2.yaml: is a symlink");
  });

  it("outside a git repository: the files on disk, nothing named", async () => {
    const dir = mkdtempSync(join(tmpdir(), "boxops-test-"));
    temps.push(dir);
    for (const [path, text] of Object.entries(ROADMAP)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    const warnings: string[] = [];
    const { source, files } = await buildBundle({ repoDir: dir, app: APP, env: {}, warn: (m) => warnings.push(m) });
    expect(warnings).toEqual([`${dir} isn’t a git repository (it has no .git folder): roadmap.json is built from the files on disk (marked local)`]);
    expect(Object.keys(files).sort()).toEqual(["boxes/b1.yaml", "people.yaml", "settings.yaml"]);
    expect(source).toMatchObject({ repo: "", branch: "", commit: "", tree: null, local: true, history: [] });
  });

  it("the dev server's bundle (a folder on disk) is always local, and unparsed if it says so", async () => {
    const { repo: r, second } = repo();
    const dev = await buildBundle({ repoDir: r.dir, worktree: join(r.dir, "roadmap"), app: APP, env: {}, warn: () => {}, parsed: false });
    expect(dev.source).toMatchObject({ commit: second, tree: null, local: true, repo: "planning/roadmap" });
    expect(dev.parsed).toBeUndefined();
  });

  it("parses the files unless the app has no build id to stamp them with", async () => {
    const { repo: r } = repo();
    const parsed = (app: typeof APP) => buildBundle({ repoDir: r.dir, app, env: {}, warn: () => {} }).then((b) => b.parsed);
    expect(Object.keys((await parsed(APP))!.files)).toEqual(["boxes/b1.yaml", "people.yaml", "settings.yaml"]);
    expect(await parsed({ ...APP, build: "" })).toBeUndefined();
  });

  it("parses them only under a build id that names the app's code: not a dirty build's, nor one outside git", async () => {
    const folder = await hashFolder({ "settings.yaml": "format: 1\n" });
    const source = { repo: "", branch: "", commit: "", dir: "roadmap", tree: folder.tree, visibility: null, private: true, readonly: false, author: "", subject: "", date: "", history: [] };
    const parsed = (build: string, o?: { parsed?: boolean }) => assembleBundle({ ...APP, build }, source, folder, o).parsed?.parser;
    expect(parsed("0.1.0+0123456789ab")).toBe("0.1.0+0123456789ab");
    expect(parsed("0.1.0+0123456789ab.dirty")).toBeUndefined();
    expect(parsed("0.1.0+unknown")).toBeUndefined();
    // Unless told to (the browser tests, whose app was just built), or told not to.
    expect(parsed("0.1.0+0123456789ab.dirty", { parsed: true })).toBe("0.1.0+0123456789ab.dirty");
    expect(parsed("0.1.0+0123456789ab", { parsed: false })).toBeUndefined();
  });

  it("with a cache (the preview's), parses only the files it hasn't, by path and blob, and keeps the folder's alone", async () => {
    const source = { repo: "", branch: "", commit: "", dir: "roadmap", tree: null, visibility: null, private: true, readonly: false, author: "", subject: "", date: "", history: [] };
    const files = { "settings.yaml": "format: 1\n", "people.yaml": "people: []\n", "boxes/b1.yaml": "id: b1\n" };
    const cache: ParseCache = new Map();
    const first = assembleBundle(APP, source, await hashFolder(files), { cache });
    expect(first).toEqual(assembleBundle(APP, source, await hashFolder(files)));
    expect(cache.size).toBe(3);
    // b1 edited, people.yaml gone, and its text at another path (what a file parses to depends on its path too).
    const next = { "settings.yaml": files["settings.yaml"], "boxes/b1.yaml": "id: b1\ntitle: B1\n", "boxes/b2.yaml": "people: []\n" };
    const second = assembleBundle(APP, source, await hashFolder(next), { cache });
    expect(second).toEqual(assembleBundle(APP, source, await hashFolder(next)));
    expect(second.parsed!.files["settings.yaml"]).toBe(first.parsed!.files["settings.yaml"]); // not parsed again
    expect(second.parsed!.files["boxes/b1.yaml"]).not.toBe(first.parsed!.files["boxes/b1.yaml"]);
    expect([...cache.keys()].map((k) => k.split("\0")[0]).sort()).toEqual(["boxes/b1.yaml", "boxes/b2.yaml", "settings.yaml"]);
  });

  it("warns when origin names no repository, without the credentials its URL holds", async () => {
    const { repo: r } = repo();
    r.git(["remote", "set-url", "origin", "https://sam:ghp_s3cret@gitlab.example/group/sub/roadmap.git"]);
    const warnings: string[] = [];
    const { source } = await buildBundle({ repoDir: r.dir, app: APP, env: {}, warn: (m) => warnings.push(m) });
    expect(source.repo).toBe("");
    expect(warnings).toEqual(["Can’t tell the repository from the origin remote (https://gitlab.example/group/sub/roadmap.git): source.repo is empty"]);
  });

  it("names no repository when origin is on another host: the app talks to github.com only", async () => {
    const { repo: r } = repo();
    for (const [url, host] of [
      ["git@ghe.acme.example:planning/roadmap.git", "ghe.acme.example"],
      ["https://octocorp.ghe.com/planning/roadmap.git", "octocorp.ghe.com"],
      ["https://sam:ghp_s3cret@gitlab.com/planning/roadmap.git", "gitlab.com"],
    ]) {
      r.git(["remote", "set-url", "origin", url]);
      const warnings: string[] = [];
      const { source } = await buildBundle({ repoDir: r.dir, app: APP, env: {}, warn: (m) => warnings.push(m) });
      expect(source.repo).toBe("");
      expect(warnings).toEqual([`origin is on ${host}; BoxOps 0.1 works with github.com only: source.repo is empty`]);
    }
    // GitHub's SSH over port 443 is github.com.
    r.git(["remote", "set-url", "origin", "ssh://git@ssh.github.com:443/planning/roadmap.git"]);
    expect((await buildBundle({ repoDir: r.dir, app: APP, env: {}, warn: () => {} })).source.repo).toBe("planning/roadmap");
  });

  it("caps the history at 50 commits", async () => {
    const { repo: r, second } = repo();
    // 52 more commits of the same tree, quickly.
    let head = second;
    for (let i = 0; i < 52; i++) head = r.git(["commit-tree", `${second}^{tree}`, "-p", head, "-m", `${i}`]);
    r.git(["update-ref", "refs/heads/main", head]);
    const { source } = await buildBundle({ repoDir: r.dir, app: APP, env: {}, warn: () => {} });
    expect(source.history).toHaveLength(50);
    expect(source.history[0]).toBe(source.commit);
    expect(source.history[1]).toBe(r.git(["rev-parse", "HEAD^"]));
  });
});

describe("appInfo", () => {
  it("is defined for the app: the package version (or $BOXOPS_VERSION) plus web/'s tree", () => {
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(__BOXOPS_BUILD__.startsWith(`${buildVersion(version, process.env.BOXOPS_VERSION)}+`)).toBe(true);
    expect(__BOXOPS_BUILD__).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?\+([0-9a-f]{12}|unknown)(\.dirty)?$/);
  });

  it("takes a release's version, package.json's with a pre-release tag or without, and no other", () => {
    expect(buildVersion("0.1.0", undefined)).toBe("0.1.0");
    expect(buildVersion("0.1.0", "")).toBe("0.1.0");
    for (const v of ["0.1.0", "0.1.0-rc.1", "0.1.0-next", "0.1.0-rc.12"]) expect(buildVersion("0.1.0", v)).toBe(v);
    for (const v of ["0.1.1", "0.1.1-rc.1", "v0.1.0", "0.1", "0.1.0-", "0.1.0-rc..1", "0.1.0+build", "0.1.0 ", "0.1.0-rc/1"]) {
      expect(() => buildVersion("0.1.0", v), v).toThrow(`BOXOPS_VERSION is “${v}”: it must be web/package.json’s version, 0.1.0, or that with a pre-release tag, such as 0.1.0-rc.1`);
    }
    const { repo: r } = repo();
    r.commit({ ...ROADMAP, "web/package.json": JSON.stringify({ version: "1.2.3" }) });
    r.checkout();
    const tree = r.git(["rev-parse", "HEAD:web"]).slice(0, 12);
    expect(appInfo(join(r.dir, "web"), r.dir, "1.2.3-rc.2")).toEqual({ version: "1.2.3-rc.2", build: `1.2.3-rc.2+${tree}`, time: "2026-10-01T00:03:00Z" });
    expect(() => appInfo(join(r.dir, "web"), r.dir, "1.2.4")).toThrow("BOXOPS_VERSION is “1.2.4”");
  });

  it("is the version plus web/'s tree, '.dirty' with uncommitted changes there; the time is HEAD's committer date", () => {
    const { repo: r } = repo();
    writeFileSync(join(r.dir, "web", "package.json"), JSON.stringify({ version: "1.2.3" }));
    r.commit({ ...ROADMAP, "web/package.json": JSON.stringify({ version: "1.2.3" }) });
    r.checkout();
    const tree = r.git(["rev-parse", "HEAD:web"]).slice(0, 12);
    expect(appInfo(join(r.dir, "web"))).toEqual({ version: "1.2.3", build: `1.2.3+${tree}`, time: "2026-10-01T00:03:00Z" });
    // A roadmap-only commit leaves the build id alone.
    r.commit({ ...ROADMAP, "roadmap/boxes/b9.yaml": "id: b9\n", "web/package.json": JSON.stringify({ version: "1.2.3" }) });
    r.checkout();
    expect(appInfo(join(r.dir, "web")).build).toBe(`1.2.3+${tree}`);
    writeFileSync(join(r.dir, "web", "new.ts"), "x\n");
    expect(appInfo(join(r.dir, "web")).build).toBe(`1.2.3+${tree}.dirty`);
  });

  it("is known in a `git worktree` checkout too, whose .git is a file", () => {
    const { repo: r } = repo();
    r.commit({ ...ROADMAP, "web/package.json": JSON.stringify({ version: "1.2.3" }) });
    const worktree = mkdtempSync(join(tmpdir(), "boxops-test-"));
    temps.push(worktree);
    rmSync(worktree, { recursive: true });
    r.git(["worktree", "add", "-q", "--detach", worktree, "main"]);
    const tree = r.git(["rev-parse", "HEAD:web"]).slice(0, 12);
    expect(appInfo(join(worktree, "web"))).toEqual({ version: "1.2.3", build: `1.2.3+${tree}`, time: "2026-10-01T00:03:00Z" });
  });

  it("outside a git repository the build is unknown", () => {
    const dir = mkdtempSync(join(tmpdir(), "boxops-test-"));
    temps.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }));
    expect(appInfo(dir)).toEqual({ version: "1.2.3", build: "1.2.3+unknown", time: "" });
  });
});

describe("repoFromRemote", () => {
  it("names the host and owner/repo (buildBundle keeps github.com's only)", () => {
    const cases: Record<string, string> = {
      "git@github.com:acme/roadmap.git": "github.com acme/roadmap",
      "https://github.com/acme/roadmap": "github.com acme/roadmap",
      "https://github.com/acme/roadmap.git/": "github.com acme/roadmap",
      "https://x-access-token:abc@GitHub.com/acme/roadmap.git": "github.com acme/roadmap",
      "github.com:acme/roadmap": "github.com acme/roadmap",
      "git@ghe.acme.internal:planning/roadmap.git": "ghe.acme.internal planning/roadmap",
      "ssh://git@ghe.acme.internal:2222/planning/roadmap.git": "ghe.acme.internal planning/roadmap",
      "https://octocorp.ghe.com/planning/roadmap.git": "octocorp.ghe.com planning/roadmap",
      "/srv/git/roadmap.git": "",
      "file:///srv/git/roadmap.git": "",
      "file:///acme/roadmap.git": "", // a local path, however short
      "file://localhost/acme/roadmap": "",
      "FILE:///acme/roadmap": "",
      "../roadmap/x": "",
      "foo/bar/baz": "", // relative local paths
      "acme/roadmap": "",
      "https://gitlab.example/group/sub/roadmap.git": "",
      "": "",
    };
    for (const [url, name] of Object.entries(cases)) {
      const named = repoFromRemote(url);
      expect([url, named ? `${named.host} ${named.repo}` : ""]).toEqual([url, name]);
    }
  });
});

describe("withoutCredentials", () => {
  it("leaves out a URL's user and password", () => {
    expect(withoutCredentials("https://x-access-token:ghp_abc@github.com/acme/roadmap.git")).toBe("https://github.com/acme/roadmap.git");
    expect(withoutCredentials("ssh://git@ghe.acme.internal:2222/a/b")).toBe("ssh://ghe.acme.internal:2222/a/b");
    expect(withoutCredentials("git@github.com:acme/roadmap.git")).toBe("github.com:acme/roadmap.git");
    expect(withoutCredentials("https://github.com/acme/ro@dmap")).toBe("https://github.com/acme/ro@dmap");
    expect(withoutCredentials("/srv/git/roadmap.git")).toBe("/srv/git/roadmap.git");
  });
});

describe("hashFolder", () => {
  it("gives what a reader would: roadmap files and blobs, other files ignored, git's tree over all of them", async () => {
    const r = new TestRepo();
    repos.push(r);
    const all = { "settings.yaml": "format: 1\n", "boxes/b1.yaml": "id: b1\n", "NOTES.md": "x\n", ".gitkeep": "" };
    const sha = r.commit(Object.fromEntries(Object.entries(all).map(([p, t]) => [`roadmap/${p}`, t])));
    const folder = await hashFolder(all);
    expect(folder.tree).toBe(r.git(["rev-parse", `${sha}:roadmap`]));
    expect(folder.files).toEqual({ "settings.yaml": "format: 1\n", "boxes/b1.yaml": "id: b1\n" });
    expect(folder.blobs["boxes/b1.yaml"]).toBe(r.git(["rev-parse", `${sha}:roadmap/boxes/b1.yaml`]));
    expect(folder.ignored).toEqual(["NOTES.md"]);
  });
});

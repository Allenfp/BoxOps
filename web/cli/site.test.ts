import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBundle } from "../src/model/bundle";
import { RoadmapReadError } from "./git";
import { appInfo, buildBundle, hashFolder, repoFromRemote, repoVisibility } from "./site";
import { TestRepo } from "./test-repo";

const repos: TestRepo[] = [];
const temps: string[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.remove();
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const APP = { version: "0.1.0", build: "0.1.0+0123456789ab", time: "2026-10-01T00:00:00Z" };
const ROADMAP = { "roadmap/settings.yaml": "format: 1\n", "roadmap/people.yaml": "people: []\n", "roadmap/boxes/b1.yaml": "id: b1\n" };

/** A repo with two commits on main, the second checked out; an origin remote on a GitHub Enterprise host. */
function repo(): { repo: TestRepo; first: string; second: string } {
  const r = new TestRepo();
  repos.push(r);
  const first = r.commit({ ...ROADMAP, "web/package.json": "{}\n" }, "Initial roadmap", undefined, "Setup");
  const second = r.commit({ ...ROADMAP, "roadmap/boxes/b1.yaml": "id: b1\ntitle: B1\n", "web/package.json": "{}\n" }, "B1: renamed\n\nSaved from the BoxOps web app.");
  r.checkout();
  r.git(["remote", "add", "origin", "git@ghe.acme.example:planning/roadmap.git"]);
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
      blobs: {
        "boxes/b1.yaml": r.git(["rev-parse", `${second}:roadmap/boxes/b1.yaml`]),
        "people.yaml": r.git(["rev-parse", `${second}:roadmap/people.yaml`]),
        "settings.yaml": r.git(["rev-parse", `${second}:roadmap/settings.yaml`]),
      },
      ignored: [],
      notices: [],
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

  it("stops on a symlink or submodule in the commit", async () => {
    const r = new TestRepo();
    repos.push(r);
    const sha = r.commit({ ...ROADMAP, "roadmap/settings.yaml": { mode: "120000", content: "../../runner/.config/gcloud/credentials.json" } });
    await expect(buildBundle({ repoDir: r.dir, app: APP, env: actions(sha) })).rejects.toThrow(RoadmapReadError);
    await expect(buildBundle({ repoDir: r.dir, app: APP, env: actions(sha) })).rejects.toThrow("roadmap/settings.yaml: is a symlink");
  });
});

describe("buildBundle locally", () => {
  it("reads HEAD's git objects when roadmap/ is as committed; the repository comes from origin on any host", async () => {
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
    expect(warnings).toEqual(["roadmap/ has changes that aren't committed: roadmap.json is built from the files on disk (marked local)"]);
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
    expect(warnings).toEqual([`${dir} isn't a git repository (it has no .git folder): roadmap.json is built from the files on disk (marked local)`]);
    expect(Object.keys(files).sort()).toEqual(["boxes/b1.yaml", "people.yaml", "settings.yaml"]);
    expect(source).toMatchObject({ repo: "", branch: "", commit: "", tree: null, local: true, history: [] });
  });

  it("the dev server's bundle (a folder on disk) is always local", async () => {
    const { repo: r, second } = repo();
    const { source } = await buildBundle({ repoDir: r.dir, worktree: join(r.dir, "roadmap"), app: APP, env: {}, warn: () => {} });
    expect(source).toMatchObject({ commit: second, tree: null, local: true, repo: "planning/roadmap" });
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
  it("is defined for the app: the package version plus web/'s tree", () => {
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(__BOXOPS_BUILD__.startsWith(`${version}+`)).toBe(true);
    expect(__BOXOPS_BUILD__).toMatch(/^\d+\.\d+\.\d+\+([0-9a-f]{12}|unknown)(\.dirty)?$/);
    expect(__BOXOPS_BUILD_TIME__).toMatch(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)?$/);
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

  it("outside a git repository the build is unknown", () => {
    const dir = mkdtempSync(join(tmpdir(), "boxops-test-"));
    temps.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }));
    expect(appInfo(dir)).toEqual({ version: "1.2.3", build: "1.2.3+unknown", time: "" });
  });
});

describe("repoFromRemote", () => {
  it("names owner/repo on any host", () => {
    const cases: Record<string, string> = {
      "git@github.com:acme/roadmap.git": "acme/roadmap",
      "https://github.com/acme/roadmap": "acme/roadmap",
      "https://github.com/acme/roadmap.git/": "acme/roadmap",
      "https://x-access-token:abc@github.com/acme/roadmap.git": "acme/roadmap",
      "git@ghe.acme.internal:planning/roadmap.git": "planning/roadmap",
      "ssh://git@ghe.acme.internal:2222/planning/roadmap.git": "planning/roadmap",
      "https://octocorp.ghe.com/planning/roadmap.git": "planning/roadmap",
      "/srv/git/roadmap.git": "",
      "file:///srv/git/roadmap.git": "",
      "../roadmap/x": "",
      "https://gitlab.example/group/sub/roadmap.git": "",
      "": "",
    };
    for (const [url, name] of Object.entries(cases)) expect([url, repoFromRemote(url)]).toEqual([url, name]);
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

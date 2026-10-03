import { describe, expect, it } from "vitest";
import { GitHub } from "./api";
import { SaveConflict, saveToBranch } from "./save";

type Handler = (body: any) => [number, unknown];

/** A fake GitHub (API + raw files) that records calls and answers from a route table. */
function fakeGitHub(routes: Record<string, Handler>, raw: Record<string, string> = {}) {
  const calls: { route: string; body: any }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    if (url.startsWith("https://raw.githubusercontent.com/")) {
      const text = raw[url.replace("https://raw.githubusercontent.com/", "")];
      return new Response(text ?? "", { status: text === undefined ? 404 : 200 });
    }
    const route = `${init.method ?? "GET"} ${url.replace("https://api.github.com", "")}`;
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ route, body });
    const handler = routes[route];
    const [status, json] = handler ? handler(body) : [404, { message: "Not Found" }];
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { gh: new GitHub("t0ken", fetchImpl), calls, fetchImpl };
}

const R = "/repos/acme/roadmap";
const source = { repo: "acme/roadmap", branch: "main", commit: "base" };
const baseFiles = { "boxes/a.yaml": "id: a\n", "boxes/b.yaml": "id: b\n" };
const changes = { "boxes/a.yaml": "id: a\ntitle: A2\n", "boxes/old.yaml": null };

const routes = (head: string, extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  [`GET ${R}`]: () => [200, { permissions: { push: true } }],
  [`GET ${R}/git/ref/heads/main`]: () => [200, { object: { sha: head } }],
  [`GET ${R}/git/commits/${head}`]: () => [200, { sha: head, tree: { sha: `tree-${head}` } }],
  [`POST ${R}/git/trees`]: () => [201, { sha: "newtree" }],
  [`POST ${R}/git/commits`]: () => [201, { sha: "newcommit" }],
  [`PATCH ${R}/git/refs/heads/main`]: () => [200, {}],
  ...extra,
});

/** Someone else's commit "theirs" touching `theirFiles`. */
function theirCommit(theirFiles: Record<string, string>) {
  const paths = Object.keys(theirFiles);
  return {
    routes: {
      [`GET ${R}/git/trees/tree-theirs?recursive=1`]: () =>
        [200, { tree: paths.map((p) => ({ path: `roadmap/${p}`, type: "blob", sha: p })), truncated: false }] as [number, unknown],
    },
    raw: Object.fromEntries(paths.map((p) => [`acme/roadmap/theirs/roadmap/${p}`, theirFiles[p]])),
  };
}

const save = (gh: GitHub, fetchImpl: typeof fetch, extra: object = {}) =>
  saveToBranch({ gh, source, baseFiles, changes, message: "Update roadmap", fetchImpl, ...extra });

describe("saveToBranch", () => {
  it("commits straight onto the branch when nobody else saved", async () => {
    const { gh, calls, fetchImpl } = fakeGitHub(routes("base"));
    const result = await save(gh, fetchImpl);
    const body = (route: string) => calls.find((c) => c.route === route)!.body;
    expect(body(`POST ${R}/git/trees`)).toEqual({
      base_tree: "tree-base",
      tree: [
        { path: "roadmap/boxes/a.yaml", mode: "100644", type: "blob", content: "id: a\ntitle: A2\n" },
        { path: "roadmap/boxes/old.yaml", mode: "100644", type: "blob", sha: null },
      ],
    });
    expect(body(`POST ${R}/git/commits`)).toEqual({ message: "Update roadmap", tree: "newtree", parents: ["base"] });
    expect(body(`PATCH ${R}/git/refs/heads/main`)).toEqual({ sha: "newcommit", force: false });
    expect(result.commit).toBe("newcommit");
    expect(result.files).toEqual({ "boxes/a.yaml": "id: a\ntitle: A2\n", "boxes/b.yaml": "id: b\n" });
  });

  it("goes on top of someone else's save when we touched different files", async () => {
    const theirs = theirCommit({ "boxes/a.yaml": "id: a\n", "boxes/b.yaml": "id: b\ntitle: B by Sam\n" });
    const { gh, calls, fetchImpl } = fakeGitHub(routes("theirs", theirs.routes), theirs.raw);
    const result = await save(gh, fetchImpl);
    expect(calls.find((c) => c.route === `POST ${R}/git/commits`)!.body.parents).toEqual(["theirs"]);
    expect(calls.find((c) => c.route === `POST ${R}/git/trees`)!.body.base_tree).toBe("tree-theirs");
    expect(result.files["boxes/b.yaml"]).toBe("id: b\ntitle: B by Sam\n");
    expect(result.files["boxes/a.yaml"]).toBe("id: a\ntitle: A2\n");
  });

  it("stops on a file both of us changed, and saves when told to overwrite it", async () => {
    const theirs = theirCommit({ "boxes/a.yaml": "id: a\ntitle: A by Sam\n", "boxes/b.yaml": "id: b\n" });
    const { gh, fetchImpl } = fakeGitHub(routes("theirs", theirs.routes), theirs.raw);
    const err = await save(gh, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(SaveConflict);
    expect(err.paths).toEqual(["boxes/a.yaml"]);
    const result = await save(gh, fetchImpl, { overwrite: ["boxes/a.yaml"] });
    expect(result.files["boxes/a.yaml"]).toBe("id: a\ntitle: A2\n");
  });

  it("retries once when someone saves between our read and write", async () => {
    let patches = 0;
    const { gh, calls, fetchImpl } = fakeGitHub(
      routes("base", {
        [`PATCH ${R}/git/refs/heads/main`]: () =>
          ++patches === 1 ? [422, { message: "Update is not a fast forward" }] : [200, {}],
      }),
    );
    await save(gh, fetchImpl);
    expect(calls.filter((c) => c.route === `POST ${R}/git/commits`)).toHaveLength(2);
  });

  it("explains a protected branch and a read-only token", async () => {
    const prot = fakeGitHub(
      routes("base", { [`PATCH ${R}/git/refs/heads/main`]: () => [422, { message: "Protected branch update failed" }] }),
    );
    await expect(save(prot.gh, prot.fetchImpl)).rejects.toThrow(/protected branch/);
    const ro = fakeGitHub(routes("base", { [`GET ${R}`]: () => [200, { permissions: { push: false } }] }));
    await expect(save(ro.gh, ro.fetchImpl)).rejects.toThrow(/can’t write to acme\/roadmap/);
  });
});

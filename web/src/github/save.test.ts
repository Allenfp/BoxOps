import { describe, expect, it } from "vitest";
import { GitHub } from "./api";
import { openPullRequest } from "./save";

/** A fake api.github.com that records calls and answers from a route table. */
function fakeGitHub(routes: Record<string, (body: any) => [number, unknown]>) {
  const calls: { route: string; body: any }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const route = `${init.method} ${url.replace("https://api.github.com", "")}`;
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ route, body });
    const handler = routes[route];
    const [status, json] = handler ? handler(body) : [404, { message: "Not Found" }];
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { gh: new GitHub("t0ken", fetchImpl), calls };
}

const source = { repo: "acme/roadmap", branch: "main", commit: "c0ffee" };
const happy = {
  "GET /repos/acme/roadmap": () => [200, { default_branch: "main", permissions: { push: true } }],
  "GET /repos/acme/roadmap/git/commits/c0ffee": () => [200, { sha: "c0ffee", tree: { sha: "tree0" } }],
  "POST /repos/acme/roadmap/git/trees": () => [201, { sha: "tree1" }],
  "POST /repos/acme/roadmap/git/commits": () => [201, { sha: "commit1" }],
  "POST /repos/acme/roadmap/git/refs": () => [201, {}],
  "POST /repos/acme/roadmap/pulls": () => [201, { number: 7, html_url: "https://github.com/acme/roadmap/pull/7" }],
} satisfies Record<string, (body: any) => [number, unknown]>;

describe("openPullRequest", () => {
  it("makes one commit on a new branch from the loaded commit and opens a PR", async () => {
    const { gh, calls } = fakeGitHub(happy);
    const steps: string[] = [];
    const pr = await openPullRequest({
      gh,
      source,
      changes: { "boxes/a.yaml": "id: a\n", "boxes/old.yaml": null },
      branch: "roadmap/test",
      title: "Move a",
      body: "- moved a",
      onStep: (s) => steps.push(s),
    });
    expect(pr).toEqual({ number: 7, url: "https://github.com/acme/roadmap/pull/7" });
    expect(steps).toEqual(["Checking access", "Creating commit", "Creating branch", "Opening pull request"]);

    const body = (route: string) => calls.find((c) => c.route === route)!.body;
    expect(body("POST /repos/acme/roadmap/git/trees")).toEqual({
      base_tree: "tree0",
      tree: [
        { path: "roadmap/boxes/a.yaml", mode: "100644", type: "blob", content: "id: a\n" },
        { path: "roadmap/boxes/old.yaml", mode: "100644", type: "blob", sha: null },
      ],
    });
    expect(body("POST /repos/acme/roadmap/git/commits")).toEqual({
      message: "Move a\n\n- moved a",
      tree: "tree1",
      parents: ["c0ffee"],
    });
    expect(body("POST /repos/acme/roadmap/git/refs")).toEqual({ ref: "refs/heads/roadmap/test", sha: "commit1" });
    expect(body("POST /repos/acme/roadmap/pulls")).toEqual({
      title: "Move a",
      body: "- moved a",
      head: "roadmap/test",
      base: "main",
    });
  });

  it("explains a token without write access", async () => {
    const { gh } = fakeGitHub({ ...happy, "GET /repos/acme/roadmap": () => [200, { permissions: { push: false } }] });
    await expect(
      openPullRequest({ gh, source, changes: {}, branch: "b", title: "t", body: "" }),
    ).rejects.toThrow(/can’t write to acme\/roadmap/);
  });

  it("explains a base commit that was never pushed", async () => {
    const { gh } = fakeGitHub({ ...happy, "GET /repos/acme/roadmap/git/commits/c0ffee": () => [422, { message: "No commit found" }] });
    await expect(
      openPullRequest({ gh, source, changes: {}, branch: "b", title: "t", body: "" }),
    ).rejects.toThrow(/isn’t on GitHub\. Push it first/);
  });

  it("explains a taken branch name", async () => {
    const { gh } = fakeGitHub({ ...happy, "POST /repos/acme/roadmap/git/refs": () => [422, { message: "Reference already exists" }] });
    await expect(
      openPullRequest({ gh, source, changes: {}, branch: "taken", title: "t", body: "" }),
    ).rejects.toThrow(/“taken” already exists/);
  });
});

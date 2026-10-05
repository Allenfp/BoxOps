import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeGitHub, OTHER_OWNER_TOKEN, READ_TOKEN, TOKEN } from "../../e2e/fake-github";
import { GitHubClient, GitHubFailure, TIMEOUTS } from "./api";
import { failureMessage } from "./messages";
import { forgetBlobs, fromBundle } from "./read";
import { NewerSaves, SaveConflict, type SaveRequest, commitParts, saveRoadmap } from "./save";

const FILES = {
  "settings.yaml": "format: 1\n",
  "people.yaml": "people: []\n",
  "boxes/a.yaml": "id: a\n",
  "boxes/b.yaml": "id: b\n",
};
const CHANGES = { "boxes/a.yaml": "id: a\ntitle: A2\n", "boxes/b.yaml": null };
const MESSAGE = "Roadmap: 2 changes\n\n- Box a: renamed\n- Deleted box b\n\nSaved from the BoxOps web app.";

/** A repository holding FILES, the snapshot the edits were made on, and a save against them. */
async function setup(o: { visibility?: "public" | "private"; token?: string; wrap?: (g: FakeGitHub) => typeof fetch } = {}) {
  const g = await FakeGitHub.create(FILES, { visibility: o.visibility });
  const base = await fromBundle(await g.bundle(g.head));
  const slept: number[] = [];
  const mutations: { input: Record<string, unknown> }[] = [];
  const inner = o.wrap?.(g) ?? g.fetch;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/graphql")) mutations.push(JSON.parse(String(init?.body)).variables);
    return inner(input, init);
  }) as typeof fetch;
  const gh = new GitHubClient({ token: o.token ?? TOKEN, fetch: fetchImpl, sleep: async (ms) => void slept.push(ms) });
  const save = (extra: Partial<SaveRequest> = {}) => saveRoadmap({ gh, base, changes: CHANGES, message: MESSAGE, ...extra });
  return { g, base, gh, slept, mutations, save };
}

beforeEach(() => forgetBlobs());
const write = TIMEOUTS.write;
afterEach(() => void (TIMEOUTS.write = write));

describe("saveRoadmap", () => {
  for (const visibility of ["public", "private"] as const) {
    it(`commits with one GET and one createCommitOnBranch (${visibility} repository)`, async () => {
      const { g, mutations, save } = await setup({ visibility });
      const result = await save();
      expect(g.requests.map((r) => r.endpoint)).toEqual(["ref", "graphql"]);
      expect(mutations[0].input).toMatchObject({
        branch: { repositoryNameWithOwner: "acme/roadmap", branchName: "main" },
        expectedHeadOid: g.root,
        message: { headline: "Roadmap: 2 changes", body: "- Box a: renamed\n- Deleted box b\n\nSaved from the BoxOps web app." },
        fileChanges: { additions: [{ path: "roadmap/boxes/a.yaml", contents: btoa("id: a\ntitle: A2\n") }], deletions: [{ path: "roadmap/boxes/b.yaml" }] },
      });
      expect(result).toMatchObject({ status: "saved", commit: g.head, parent: g.root, signed: true });
      expect(g.headCommit()).toMatchObject({ message: MESSAGE, signed: true, files: { "settings.yaml": "format: 1\n", "people.yaml": "people: []\n", "boxes/a.yaml": "id: a\ntitle: A2\n" } });
      const after = await g.bundle(g.head);
      expect(result.snapshot.files).toEqual(after.files);
      expect(result.snapshot.blobs).toEqual(after.blobs);
      expect(result.snapshot.source).toMatchObject({ commit: g.head, parent: g.root, tree: null });
      expect(g.forbidden).toEqual([]);
    });
  }

  it("goes on top of someone else's save to other files, validating their files too", async () => {
    const { g, save } = await setup();
    const theirs = g.otherSave({ "boxes/c.yaml": () => "id: c\n" });
    let checked: Record<string, string> = {};
    const result = await save({ validate: (files) => ((checked = files), []) });
    expect(result).toMatchObject({ status: "saved", parent: theirs });
    expect(checked["boxes/c.yaml"]).toBe("id: c\n");
    expect(g.headCommit().files).toEqual({ "settings.yaml": "format: 1\n", "people.yaml": "people: []\n", "boxes/a.yaml": "id: a\ntitle: A2\n", "boxes/c.yaml": "id: c\n" });
    expect(g.calls("blob")).toBe(1);
  });

  it("stops for review when roadmap files changed, before writing anything", async () => {
    const { g, save } = await setup();
    const theirs = g.otherSave({ "boxes/c.yaml": () => "id: c\n" });
    const e = await save({ review: true }).catch((x) => x);
    expect(e).toBeInstanceOf(NewerSaves);
    expect(e.head.source.commit).toBe(theirs);
    expect(e.head.files["boxes/c.yaml"]).toBe("id: c\n");
    expect(g.calls("graphql")).toBe(0);
  });

  it("doesn't stop for review when no roadmap file changed: a commit outside the folder, or another file in it", async () => {
    for (const change of ["outside", "notes"] as const) {
      const { g, base, save } = await setup();
      const theirs = change === "outside" ? g.outsideSave("README.md", "# Notes\n") : g.otherSave({ "NOTES.md": () => "notes\n" });
      // Not even with an unknown tree SHA (a snapshot from a save).
      const result = await save({ review: true, base: { ...base, source: { ...base.source, tree: null } } });
      expect(result, change).toMatchObject({ status: "saved", parent: theirs });
      expect(g.calls("blob"), change).toBe(0);
    }
  });

  it("stops on a file someone else edited, deleted or created too", async () => {
    const cases: [string, Record<string, (t: string) => string | undefined>, Record<string, string | null>][] = [
      ["edited", { "boxes/a.yaml": () => "id: a\ntitle: Theirs\n" }, CHANGES],
      ["deleted", { "boxes/a.yaml": () => undefined }, CHANGES],
      ["created", { "boxes/n.yaml": () => "id: n\ntitle: Theirs\n" }, { "boxes/n.yaml": "id: n\ntitle: Mine\n" }],
    ];
    for (const [what, edits, changes] of cases) {
      const { g, save } = await setup();
      const theirs = g.otherSave(edits);
      const e = await save({ changes }).catch((x) => x);
      expect(e, what).toBeInstanceOf(SaveConflict);
      expect(e.paths, what).toEqual([Object.keys(changes)[0]]);
      expect(e.head.source.commit, what).toBe(theirs);
      expect(g.calls("graphql"), what).toBe(0);
    }
  });

  it("leaves out a deletion someone else already made (GitHub would refuse it)", async () => {
    const { g, mutations, save } = await setup();
    g.otherSave({ "boxes/b.yaml": () => undefined });
    expect(await save()).toMatchObject({ status: "saved" });
    expect((mutations[0].input as { fileChanges: unknown }).fileChanges).toEqual({ additions: [expect.objectContaining({ path: "roadmap/boxes/a.yaml" })], deletions: [] });
  });

  it("sends nothing when the head already has these changes", async () => {
    const { g, save } = await setup();
    expect(await save({ changes: { "boxes/a.yaml": "id: a\n" } })).toMatchObject({ status: "noop" });
    g.otherSave({ "boxes/a.yaml": () => "id: a\ntitle: A2\n", "boxes/b.yaml": () => undefined });
    expect(await save({ review: true })).toMatchObject({ status: "alreadySaved", commit: g.head });
    expect(g.calls("graphql")).toBe(0);
  });

  it("after STALE_DATA re-reads only what changed and goes on top, a second or more later", async () => {
    const { g, slept, save } = await setup();
    let theirs = "";
    g.beforeRefUpdate = () => void (theirs = g.otherSave({ "boxes/c.yaml": () => "id: c\n" }));
    const steps: string[] = [];
    expect(await save({ onProgress: (step) => steps.push(step) })).toMatchObject({ status: "saved", parent: theirs });
    expect(g.calls("graphql")).toBe(2);
    expect(g.calls("blob")).toBe(1);
    expect(slept).toEqual([1000]);
    expect(steps).toEqual(["checking", "writing", "verifying", "retrying", "writing"]);
  });

  it("stops on a racing save to the same file", async () => {
    const { g, save } = await setup();
    g.beforeRefUpdate = () => void g.otherSave({ "boxes/a.yaml": () => "id: a\ntitle: Theirs\n" });
    const e = await save().catch((x) => x);
    expect(e).toBeInstanceOf(SaveConflict);
    expect(e.paths).toEqual(["boxes/a.yaml"]);
  });

  it("gives up after three STALE_DATAs, saying so", async () => {
    const { g, slept, save } = await setup();
    const race = () => {
      g.otherSave({ "boxes/c.yaml": (t) => `${t ?? ""}#\n` });
      g.beforeRefUpdate = race;
    };
    g.beforeRefUpdate = race;
    const e = await save().catch((x) => x);
    expect(e).toBeInstanceOf(GitHubFailure);
    expect(e).toMatchObject({ kind: "stale", ambiguous: false });
    expect(g.calls("graphql")).toBe(3);
    expect(slept).toEqual([1000, 2000]);
  });

  it("recognises its own commit when the answer is lost: one commit, alreadySaved", async () => {
    const { g, save } = await setup();
    g.inject("graphql", "lost-response");
    const result = await save();
    expect(result).toMatchObject({ status: "alreadySaved", commit: g.head });
    expect(g.headCommit().parent).toBe(g.root);
    expect(g.calls("graphql")).toBe(1);
  });

  it("finds its own commit under someone else's saved after it (lost answer)", async () => {
    let ours = "";
    const { g, save } = await setup({
      wrap: (g) => async (input, init) => {
        if (!String(input).endsWith("/graphql")) return g.fetch(input, init);
        try {
          return await g.fetch(input, init);
        } finally {
          ours = g.head;
          g.otherSave({ "boxes/c.yaml": () => "id: c\n" }); // lands before we look again
        }
      },
    });
    g.inject("graphql", "lost-response");
    const result = await save();
    expect(result).toMatchObject({ status: "alreadySaved", commit: ours });
    if (result.status === "noop") throw new Error("unreachable");
    expect(result.snapshot.files["boxes/c.yaml"]).toBe("id: c\n"); // their save is on screen, as a normal update
    expect(g.calls("graphql")).toBe(1);
  });

  it("treats a body that stalls after the commit was made as unclear, then finds the commit", async () => {
    TIMEOUTS.write = 50;
    const { g, save } = await setup({
      wrap: (g) => async (input, init) => {
        const res = await g.fetch(input, init);
        if (!String(input).endsWith("/graphql")) return res;
        const stalled = new ReadableStream({ start: (c) => init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError"))) });
        return new Response(stalled, { status: 200 });
      },
    });
    expect(await save()).toMatchObject({ status: "alreadySaved", commit: g.head });
    expect(g.calls("graphql")).toBe(1);
  });

  it("retries an unclear failure that didn't land, on the same head", async () => {
    const { g, mutations, save } = await setup();
    g.inject("graphql", "server");
    expect(await save()).toMatchObject({ status: "saved", parent: g.root });
    expect(mutations.map((m) => (m.input as { expectedHeadOid: string }).expectedHeadOid)).toEqual([g.root, g.root]);
  });

  it("says a save that never landed wasn't made, once it has checked", async () => {
    TIMEOUTS.write = 50;
    const { g, save } = await setup();
    g.inject("graphql", "hang", 3);
    const e = await save().catch((x) => x);
    expect(e).toMatchObject({ kind: "timeout", ambiguous: false });
    expect(g.head).toBe(g.root);
  });

  it("finds an earlier save whose answer was lost, even under later saves, instead of asking for review", async () => {
    const { g, gh, base, save } = await setup();
    await saveRoadmap({ gh, base, changes: CHANGES, message: MESSAGE }); // its answer "never arrived"
    g.otherSave({ "boxes/c.yaml": () => "id: c\n" });
    const result = await save({ review: true });
    expect(result).toMatchObject({ status: "alreadySaved", commit: g.head });
    expect(g.calls("graphql")).toBe(1);
  });

  it("writes nothing that would leave the roadmap invalid, or is too big for one commit", async () => {
    const { g, save } = await setup();
    await expect(save({ validate: () => ["boxes/a.yaml: lane: x doesn't exist"] })).rejects.toThrow(/would leave the roadmap invalid/);
    const many = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`boxes/x${i}.yaml`, `id: x${i}\n`]));
    await expect(save({ changes: many })).rejects.toThrow(/too big for one commit/);
    expect(g.calls("graphql")).toBe(0);
  });

  it("refuses to write anything but roadmap files", async () => {
    const { g, save } = await setup();
    await expect(save({ changes: { "../.github/workflows/x.yml": "on: push\n" } })).rejects.toThrow(/writes only roadmap files/);
    expect(g.calls()).toBe(0);
  });

  it("classifies GitHub's refusals, retrying none of them", async () => {
    const cases: [string, (g: FakeGitHub) => void, string | undefined, object][] = [
      ["read-only token", () => {}, READ_TOKEN, { kind: "read-only", detail: { push: true, visible: true } }],
      ["bad token", () => {}, "github_pat_EXPIRED", { kind: "unauthorized" }],
      ["sso", (g) => g.inject("graphql", "sso"), undefined, { kind: "sso", detail: { ssoUrl: "https://github.com/orgs/acme/sso?authorization_request=FAKE" } }],
      ["hourly limit", (g) => g.inject("graphql", "rate-limit"), undefined, { kind: "rate-limited", detail: { secondary: false } }],
      ["secondary limit", (g) => g.inject("graphql", "secondary-limit"), undefined, { kind: "rate-limited", detail: { secondary: true, retryAfter: 30 } }],
      ["rules", (g) => g.inject("graphql", "rules"), undefined, { kind: "rules" }],
      ["token policy", (g) => g.inject("graphql", "token-policy"), undefined, { kind: "token-policy" }],
      ["IP allow list", (g) => g.inject("graphql", "ip-blocked"), undefined, { kind: "ip-blocked" }],
    ];
    for (const [what, arrange, token, want] of cases) {
      const { g, save } = await setup({ token });
      arrange(g);
      const e = await save().catch((x) => x);
      expect(e, what).toBeInstanceOf(GitHubFailure);
      expect(e, what).toMatchObject({ ambiguous: false, ...want });
      expect(g.calls("graphql"), what).toBeLessThanOrEqual(1);
      expect(g.head, what).toBe(g.root);
    }
    // A token made for the wrong resource owner can't even read a private repository.
    const { save } = await setup({ visibility: "private", token: OTHER_OWNER_TOKEN });
    await expect(save()).rejects.toMatchObject({ kind: "no-access" });
  });
});

describe("commitParts", () => {
  it("splits headline and body, on one line, and neutralises CI skip markers", () => {
    expect(commitParts("Box “Stop [skip ci] abuse”:  renamed\n\n- Box “Stop [Skip CI] abuse”: renamed\n- [ci skip] [no ci] [skip actions] [actions skip]\n\nSaved from the BoxOps web app.")).toEqual({
      headline: "Box “Stop (skip ci) abuse”: renamed",
      body: "- Box “Stop (Skip CI) abuse”: renamed\n- (ci skip) (no ci) (skip actions) (actions skip)\n\nSaved from the BoxOps web app.",
    });
    expect(commitParts("Just a headline")).toEqual({ headline: "Just a headline", body: "" });
  });
});

describe("failureMessage", () => {
  const where = { repo: "acme/roadmap", branch: "main" };
  const now = new Date(2026, 9, 4, 13, 0).getTime();
  it("words each kind for the user", () => {
    const at = (h: number, d = 4) => new Date(2026, 9, d, h, 5).getTime();
    expect(failureMessage(new GitHubFailure("rate-limited", "x", { secondary: false, resetAt: at(14) }), where, now)).toBe(
      "This token has used up GitHub’s hourly allowance. Try again after 14:05.",
    );
    expect(failureMessage(new GitHubFailure("rate-limited", "x", { secondary: false, resetAt: at(0, 5) }), where, now)).toContain("after 2026-10-05 00:05");
    expect(failureMessage(new GitHubFailure("rate-limited", "x", { secondary: true, retryAfter: 30 }), where, now)).toBe("GitHub asked BoxOps to slow down. Try again in 30 seconds.");
    expect(failureMessage(new GitHubFailure("read-only", "x", { push: false }), where)).toBe("Your GitHub account can’t write to acme/roadmap. Ask an admin for Write access.");
    expect(failureMessage(new GitHubFailure("read-only", "x", { push: true }), where)).toContain("Contents to Read and write");
    expect(failureMessage(new GitHubFailure("no-access", "x"), where)).toContain("set Resource owner to acme");
    expect(failureMessage(new GitHubFailure("rules", "Commits must have verified signatures."), where)).toContain("main only accepts signed commits");
    expect(failureMessage(new GitHubFailure("timeout", "x", {}, true), where)).toContain("can’t tell whether this save went through");
    expect(failureMessage(new GitHubFailure("timeout", "x", {}, false), where)).toBe("GitHub didn’t answer in time. Your changes are kept in this browser.");
    expect(failureMessage(new GitHubFailure("unknown", "Weird", { requestId: "R:1" }), where)).toBe("GitHub said: “Weird” (GitHub request id R:1)");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { FakeGitHub, TOKEN } from "../../e2e/fake-github";
import { readBundle } from "../model/bundle";
import { GitHubClient } from "./api";
import { gitBlobSha, textBlobSha } from "./git-objects";
import { FolderProblems, MAX_BLOB_FETCHES, NeedsToken, type Snapshot, TooManyChanges, forgetBlobs, fromBundle, readSnapshot } from "./read";

const FILES = {
  "settings.yaml": "format: 1\n",
  "people.yaml": "people: []\n",
  "departments/d.yaml": "id: d\n",
  "boxes/a.yaml": "id: a\n",
  "boxes/b.yaml": "id: b\n",
};

let clock = Date.now();
const slept: number[] = [];
const client = (g: FakeGitHub, token: string | null = TOKEN, fetchImpl: typeof fetch = g.fetch) =>
  new GitHubClient({
    token,
    fetch: fetchImpl,
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
  });
const snapshot = async (g: FakeGitHub, commit = g.head): Promise<Snapshot> => fromBundle(await g.bundle(commit));

beforeEach(() => {
  forgetBlobs();
  slept.length = 0;
  clock = Date.now();
});

describe("readSnapshot", () => {
  it("returns base itself when the branch hasn't moved: one request", async () => {
    const g = await FakeGitHub.create(FILES);
    const base = await snapshot(g);
    expect(await readSnapshot(client(g), base)).toBe(base);
    expect(g.requests.map((r) => r.endpoint)).toEqual(["ref"]);
  });

  it("moves to a commit outside the roadmap folder with 3 requests and no blobs", async () => {
    const g = await FakeGitHub.create(FILES);
    const base = await snapshot(g);
    const readme = g.outsideSave("README.md", "# Notes\n", "Sam Lee", "Notes");
    const head = await readSnapshot(client(g), base);
    expect(g.requests.map((r) => r.endpoint)).toEqual(["ref", "commit", "tree"]);
    expect(head.files).toBe(base.files);
    expect(head.source).toMatchObject({ commit: readme, parent: g.root, author: "Sam Lee", subject: "Notes", tree: base.source.tree, history: [readme, g.root] });
  });

  it("fetches only the blobs that changed: an edit, a new file; a deleted one is dropped", async () => {
    const g = await FakeGitHub.create(FILES);
    const base = await snapshot(g);
    const at = g.otherSave({ "boxes/a.yaml": (t) => `${t}title: A2\n`, "boxes/b.yaml": () => undefined, "boxes/c.yaml": () => "id: c\n" });
    const head = await readSnapshot(client(g), base);
    expect(g.calls("blob")).toBe(2);
    const { "boxes/b.yaml": _deleted, ...kept } = FILES;
    expect(head.files).toEqual({ ...kept, "boxes/a.yaml": "id: a\ntitle: A2\n", "boxes/c.yaml": "id: c\n" });
    expect(Object.keys(head.files)).toEqual(Object.keys(head.files).sort());
    expect(head.blobs).toEqual((await g.bundle(at)).blobs);
    expect(head.source.tree).toBe((await g.bundle(at)).source.tree);
  });

  it("decides nothing from the tree SHA alone: a non-roadmap file in the folder changes no blob", async () => {
    const g = await FakeGitHub.create(FILES);
    const base = await snapshot(g);
    g.otherSave({ "NOTES.md": () => "notes\n" });
    const head = await readSnapshot(client(g), base);
    expect(head.source.tree).not.toBe(base.source.tree);
    expect(head.blobs).toEqual(base.blobs);
    expect(head.ignored).toEqual(["NOTES.md"]);
    expect(g.calls("blob")).toBe(0);
  });

  it("walks a truncated listing a folder at a time, with the same result", async () => {
    const g = await FakeGitHub.create(FILES);
    const base = await snapshot(g);
    g.otherSave({ "boxes/a.yaml": () => "id: a\ntitle: A2\n" });
    const whole = await readSnapshot(client(g), base);
    forgetBlobs();
    g.truncate = "recursive";
    const walked = await readSnapshot(client(g), base);
    expect(walked.files).toEqual(whole.files);
    expect(walked.blobs).toEqual(whole.blobs);
    g.truncate = "all";
    await expect(readSnapshot(client(g), base)).rejects.toThrow(/too many files for GitHub to list/);
  });

  it("refuses a symlink or a submodule, as the build does, fetching no blob", async () => {
    const g = await FakeGitHub.create(FILES);
    const base = await snapshot(g);
    g.otherSave({ "boxes/link.yaml": () => "../../.git/config", "boxes/sub.yaml": () => "x" });
    g.modes = { "roadmap/boxes/link.yaml": "120000", "roadmap/boxes/sub.yaml": "160000" };
    const e = await readSnapshot(client(g), base).catch((x) => x);
    expect(e).toBeInstanceOf(FolderProblems);
    expect(e.message).toBe(
      "roadmap/boxes/link.yaml: is a symlink; a roadmap folder holds plain files only\nroadmap/boxes/sub.yaml: is a submodule; a roadmap folder holds plain files only",
    );
    expect(g.calls("blob")).toBe(0);
  });

  it("keeps a BOM, so the text hashes back to its blob SHA", async () => {
    const g = await FakeGitHub.create(FILES);
    const base = await snapshot(g);
    g.otherSave({ "boxes/a.yaml": () => "\uFEFFid: a\r\ntitle: Zoë\r\n" });
    const head = await readSnapshot(client(g), base);
    expect(head.files["boxes/a.yaml"]).toBe("\uFEFFid: a\r\ntitle: Zoë\r\n");
    expect(await textBlobSha(head.files["boxes/a.yaml"])).toBe(head.blobs["boxes/a.yaml"]);
  });

  it("refuses a file that isn't UTF-8", async () => {
    const g = await FakeGitHub.create(FILES);
    const base = await snapshot(g);
    g.otherSave({ "boxes/a.yaml": () => "id: a2\n" });
    // The fake keeps text; swap the blob's bytes on the way out (its SHA check would fail too, so use bytes with the right SHA).
    const latin1 = Uint8Array.from([0x69, 0x64, 0x3a, 0x20, 0xe9, 0x0a]);
    const sha = await gitBlobSha(latin1);
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const res = await g.fetch(input, init);
      if (url.includes("/git/trees/") && url.includes("recursive")) {
        const body = await res.json();
        for (const e of body.tree) if (e.path === "boxes/a.yaml") Object.assign(e, { sha, size: latin1.length });
        return new Response(JSON.stringify(body), { status: 200 });
      }
      if (url.endsWith(sha)) return new Response(latin1, { status: 200 });
      return res;
    }) as typeof fetch;
    await expect(readSnapshot(client(g, TOKEN, fetchImpl), base)).rejects.toThrow("roadmap/boxes/a.yaml: isn’t UTF-8 text");
  });

  it("never fetches a blob twice in a session", async () => {
    const g = await FakeGitHub.create(FILES);
    const base = await snapshot(g);
    g.otherSave({ "boxes/a.yaml": () => "id: a\ntitle: A2\n" });
    const edited = await readSnapshot(client(g), base);
    g.otherSave({ "boxes/a.yaml": () => "id: a\n" }); // undone: base's blob again
    g.otherSave({ "boxes/a.yaml": () => "id: a\ntitle: A2\n" }); // redone: the cached one
    await readSnapshot(client(g), edited);
    expect(g.calls("blob")).toBe(1);
  });

  it("fetches at most 4 blobs at once, and stops at the first failure", async () => {
    const files: Record<string, string> = { ...FILES };
    for (let i = 0; i < 12; i++) files[`boxes/x${i}.yaml`] = `id: x${i}\n`;
    const g = await FakeGitHub.create(files);
    const base = await snapshot(g);
    g.otherSave(Object.fromEntries(Object.keys(files).filter((p) => p.startsWith("boxes/x")).map((p) => [p, (t: string) => `${t}title: T\n`])));
    let open = 0;
    let most = 0;
    const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("/git/blobs/")) return g.fetch(input, init);
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return g.fetch(input, init);
    }) as typeof fetch;
    await readSnapshot(client(g, TOKEN, slow), base);
    expect(most).toBe(4);

    forgetBlobs();
    const before = g.calls("blob");
    g.inject("blob", "no-access", 99);
    await expect(readSnapshot(client(g, TOKEN, slow), base)).rejects.toMatchObject({ kind: "no-access" });
    expect(g.calls("blob") - before).toBeLessThanOrEqual(4);
  });

  it("waits out a secondary rate limit, but not an hourly one", async () => {
    const g = await FakeGitHub.create(FILES);
    const base = await snapshot(g);
    g.otherSave({ "boxes/a.yaml": () => "id: a\ntitle: A2\n" });
    g.inject("blob", "secondary-limit");
    const head = await readSnapshot(client(g), base);
    expect(head.files["boxes/a.yaml"]).toBe("id: a\ntitle: A2\n");
    expect(slept).toEqual([30_000]);

    forgetBlobs();
    g.inject("blob", "rate-limit"); // resets in 10 minutes: more than a read waits
    await expect(readSnapshot(client(g), base)).rejects.toMatchObject({ kind: "rate-limited", detail: { secondary: false } });
    expect(slept).toEqual([30_000]);
  });

  it("retries a 5xx once", async () => {
    const g = await FakeGitHub.create(FILES);
    const base = await snapshot(g);
    g.otherSave({ "boxes/a.yaml": () => "id: a\ntitle: A2\n" });
    g.inject("commit", "server");
    await readSnapshot(client(g), base);
    g.otherSave({ "boxes/a.yaml": () => "id: a\ntitle: A3\n" });
    g.inject("commit", "server", 2);
    await expect(readSnapshot(client(g), base)).rejects.toMatchObject({ kind: "server" });
  });

  it("says when too many files changed, before fetching any", async () => {
    const files: Record<string, string> = { ...FILES };
    for (let i = 0; i <= MAX_BLOB_FETCHES; i++) files[`boxes/x${i}.yaml`] = `id: x${i}\n`;
    const g = await FakeGitHub.create(files);
    const base = await snapshot(g);
    g.otherSave(Object.fromEntries(Object.keys(files).filter((p) => p.startsWith("boxes/x")).map((p) => [p, (t: string) => `${t}title: T\n`])));
    const e = await readSnapshot(client(g), base).catch((x) => x);
    expect(e).toBeInstanceOf(TooManyChanges);
    expect(e.count).toBe(MAX_BLOB_FETCHES + 1);
    expect(g.calls("blob")).toBe(0);
  });

  it("makes no call at all for a private repository without a token", async () => {
    const g = await FakeGitHub.create(FILES, { visibility: "private" });
    const base = await snapshot(g);
    g.otherSave({ "boxes/a.yaml": () => "id: a2\n" });
    await expect(readSnapshot(client(g, null), base)).rejects.toBeInstanceOf(NeedsToken);
    expect(g.calls()).toBe(0);
    // With a token, everything goes through the API.
    const head = await readSnapshot(client(g), base);
    expect(head.files["boxes/a.yaml"]).toBe("id: a2\n");
    expect(g.calls("raw")).toBe(0);
    expect(g.forbidden).toEqual([]);
  });

  it("reads a public repository without a token, file contents from raw.githubusercontent.com", async () => {
    const g = await FakeGitHub.create(FILES);
    const base = await snapshot(g);
    g.otherSave({ "boxes/a.yaml": () => "id: a2\n" });
    const head = await readSnapshot(client(g, null), base);
    expect(head.files["boxes/a.yaml"]).toBe("id: a2\n");
    expect(g.calls("raw")).toBe(1);
    expect(g.calls("blob")).toBe(0);
    expect(g.requests.every((r) => !r.authed)).toBe(true);
    expect(g.forbidden).toEqual([]);
  });

  it("refuses a branch name that could steer the request, before any call", async () => {
    const g = await FakeGitHub.create(FILES);
    const base = await snapshot(g);
    await expect(readSnapshot(client(g), base, { branch: "../../../../user" })).rejects.toThrow(/isn’t a branch name/);
    expect(g.calls()).toBe(0);
  });

  it("asks again once when the head is older than what the tab has", async () => {
    const g = await FakeGitHub.create(FILES);
    const first = g.root;
    g.otherSave({ "boxes/a.yaml": () => "id: a2\n" });
    const base = await readSnapshot(client(g), await snapshot(g, first));
    // A lagging answer: the first read says the old commit.
    let lag = true;
    const lagging = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (lag && String(input).includes("/git/ref/")) {
        lag = false;
        return new Response(JSON.stringify({ object: { sha: first } }), { status: 200 });
      }
      return g.fetch(input, init);
    }) as typeof fetch;
    const before = g.calls("ref");
    expect(await readSnapshot(client(g, TOKEN, lagging), base)).toBe(base);
    expect(g.calls("ref") - before).toBe(1); // the second ask reached the fake
  });

  it("previews another branch, fetching only the blobs that differ from base", async () => {
    const g = await FakeGitHub.create(FILES);
    const base = await snapshot(g);
    const main = g.head;
    g.branches.feature = g.otherSave({ "boxes/a.yaml": () => "id: a\ntitle: Feature\n" });
    g.head = main;
    const preview = await readSnapshot(client(g), base, { branch: "feature" });
    expect(preview.source.branch).toBe("feature");
    expect(preview.files["boxes/a.yaml"]).toBe("id: a\ntitle: Feature\n");
    expect(g.calls("blob")).toBe(1);
  });
});

describe("fromBundle", () => {
  it("computes the blob SHAs a bundle from before schema 1 lacks", async () => {
    const g = await FakeGitHub.create(FILES);
    const current = await g.bundle(g.head);
    const old = readBundle({ files: current.files, source: { repo: "acme/roadmap", branch: "main", commit: g.head } });
    const s = await fromBundle(old);
    expect(s.blobs).toEqual(current.blobs);
    expect(s.source).toMatchObject({ tree: null, private: true });
  });
});

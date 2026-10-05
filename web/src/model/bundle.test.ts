import { describe, expect, it } from "vitest";
import { type Bundle, readBundle } from "./bundle";

const commit = "a".repeat(40);
const files = { "settings.yaml": "format: 1\n", "boxes/b1.yaml": "id: b1\n" };

describe("readBundle", () => {
  it("reads a schema-1 bundle as written", () => {
    const bundle: Bundle = {
      schema: 1,
      format: 1,
      app: { version: "0.1.0", build: "0.1.0+0123456789ab", time: "2026-10-01T00:00:00Z" },
      source: {
        repo: "acme/roadmap",
        branch: "main",
        commit,
        dir: "roadmap",
        tree: "b".repeat(40),
        visibility: "internal",
        private: true,
        readonly: false,
        author: "Sam Lee",
        subject: "Roadmap: 2 changes",
        date: "2026-10-02T10:00:00Z",
        history: [commit, "c".repeat(40)],
        run: "https://github.com/acme/roadmap/actions/runs/1",
      },
      files,
      blobs: { "settings.yaml": "d".repeat(40), "boxes/b1.yaml": "e".repeat(40) },
      ignored: ["README.md"],
      notices: [{ level: "info", text: "BoxOps v0.1.1 is out." }],
    };
    expect(readBundle(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
  });

  it("reads a bundle from before schema 1, with everything it lacks unknown", () => {
    const old = { files, source: { repo: "acme/roadmap", branch: "main", commit, author: "Sam Lee", subject: "Hi" } };
    expect(readBundle(old)).toEqual({
      schema: 0,
      format: 0,
      app: { version: "", build: "", time: "" },
      source: {
        repo: "acme/roadmap",
        branch: "main",
        commit,
        dir: "roadmap",
        tree: null,
        visibility: null,
        private: true,
        readonly: false,
        author: "Sam Lee",
        subject: "Hi",
        date: "",
        history: [commit],
      },
      files,
      blobs: {},
      ignored: [],
      notices: [],
    });
    // A local build with uncommitted edits said `dirty` then.
    expect(readBundle({ files, source: { ...old.source, dirty: true } }).source.local).toBe(true);
  });

  it("treats wrong values as unknown, and refuses a bundle without files", () => {
    const b = readBundle({
      files,
      source: { tree: "not a sha", visibility: "secret", private: "no", history: ["x"], commit: 5 },
      app: "0.1.0",
      notices: [{ level: "security", text: "Upgrade" }, { level: "shout", text: "?" }, "x"],
    });
    expect(b.source).toMatchObject({ tree: null, visibility: null, private: true, history: [], commit: "" });
    expect(b.app.build).toBe("");
    expect(b.notices).toEqual([{ level: "security", text: "Upgrade" }]);
    expect(() => readBundle(null)).toThrow("no roadmap files");
    expect(() => readBundle({ files: { "settings.yaml": 1 } })).toThrow("no roadmap files");
  });
});

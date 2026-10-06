import { describe, expect, it } from "vitest";
import { GitHubFailure } from "./api";
import { NewerFormat, type SaveResult } from "./save";
import { failedSave, othersIn } from "./saveOutcome";
import { FolderProblems, type Snapshot, TooManyChanges } from "./snapshot";

const snapshot = (blobs: Record<string, string>, source: Partial<Snapshot["source"]> = {}): Snapshot => ({
  source: { repo: "acme/roadmap", branch: "main", commit: "c2", dir: "roadmap", tree: null, history: ["c2"], ...source } as Snapshot["source"],
  files: {},
  blobs,
  ignored: [],
});

describe("a save that failed, for the save dialog", () => {
  const resume = { keep: "mine" as const };
  it("says why, and how to go on", () => {
    expect(failedSave(new NewerFormat(2), resume)).toEqual({ kind: "upgrading", format: 2 });
    expect(failedSave(new GitHubFailure("unauthorized", "Bad credentials"), resume)).toEqual({ kind: "token", rejected: true, resume });
    const offline = new GitHubFailure("offline", "You’re offline.");
    expect(failedSave(offline, resume)).toEqual({ kind: "github", failure: offline, resume });
    expect(failedSave(new FolderProblems("roadmap", [{ path: "a.yaml", message: "is a symlink" }]), resume)).toEqual({
      kind: "folder",
      problems: ["roadmap/a.yaml: is a symlink"],
    });
    expect(failedSave(new TooManyChanges(400), resume)).toMatchObject({ kind: "error", reload: "instead" });
    expect(failedSave(new Error("Boom"), resume)).toEqual({ kind: "error", message: "Boom", resume });
  });
});

describe("others' saves a save brought in", () => {
  const before = { "a.yaml": "1", "b.yaml": "1" };
  it("are none when only the files it wrote changed", () => {
    const result: SaveResult = { status: "noop", snapshot: snapshot({ "a.yaml": "2", "b.yaml": "1" }) };
    expect(othersIn(result, before, { "a.yaml": "x" })).toBeNull();
  });
  it("are named by the newest of them when that's known", () => {
    const after = snapshot({ "a.yaml": "2", "b.yaml": "2" }, { author: "Priya Shah", subject: "Revenue mart: at risk" });
    const saved: SaveResult = { status: "saved", commit: "c3", parent: "c2", parentAuthor: "Sam Lee", parentSubject: "CDC: renamed", url: "", signed: null, snapshot: after };
    expect(othersIn(saved, before, { "a.yaml": "x" })).toEqual({ author: "Sam Lee", subject: "CDC: renamed" });
    expect(othersIn({ status: "alreadySaved", commit: "c2", url: "", snapshot: after }, before, { "a.yaml": "x" })).toEqual({});
    expect(othersIn({ status: "alreadySaved", commit: "c1", url: "", snapshot: after }, before, { "a.yaml": "x" })).toEqual({
      author: "Priya Shah",
      subject: "Revenue mart: at risk",
    });
  });
});

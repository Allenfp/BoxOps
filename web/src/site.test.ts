import { describe, expect, it } from "vitest";
import type { BundleSource } from "./model/bundle";
import { movesForward } from "./site";

const sha = (c: string) => c.repeat(40);
const source = (commit: string, date: string, history: string[]): BundleSource => ({
  repo: "acme/roadmap",
  branch: "main",
  commit,
  dir: "roadmap",
  tree: null,
  visibility: "private",
  private: true,
  readonly: false,
  author: "",
  subject: "",
  date,
  history,
});

describe("movesForward", () => {
  const [c1, c2, c3] = [sha("1"), sha("2"), sha("3")];
  const onC2 = { commit: c2, date: "2026-10-02T16:02:00Z" };

  it("takes a deploy whose history holds the commit on screen", () => {
    expect(movesForward(source(c3, "2026-10-02T16:03:00Z", [c3, c2, c1]), onC2, new Set())).toBe(true);
    // Even if its date says otherwise (clocks differ): history decides.
    expect(movesForward(source(c3, "2026-10-02T16:00:00Z", [c3, c2]), onC2, new Set())).toBe(true);
  });

  it("ignores the commit on screen, one the tab has seen, and an older one", () => {
    expect(movesForward(source(c2, "2026-10-02T16:02:00Z", [c2, c1]), onC2, new Set())).toBe(false);
    expect(movesForward(source(c1, "2026-10-02T16:05:00Z", [c1]), onC2, new Set([c1]))).toBe(false);
    // C1's deploy finishing after the tab read C2 from GitHub: a rollback, ignored.
    expect(movesForward(source(c1, "2026-10-02T16:01:00Z", [c1]), onC2, new Set([c2]))).toBe(false);
  });

  it("takes a newer commit outside the history it knows (more than 50 behind, or a rewritten branch)", () => {
    expect(movesForward(source(c3, "2026-10-02T16:09:00Z", [c3]), onC2, new Set())).toBe(true);
  });

  it("takes an unseen bundle it can't date (from before schema 1)", () => {
    expect(movesForward(source(c3, "", [c3]), onC2, new Set())).toBe(true);
    expect(movesForward(source(c3, "2026-10-02T16:01:00Z", [c3]), { commit: c2, date: "" }, new Set())).toBe(true);
  });
});

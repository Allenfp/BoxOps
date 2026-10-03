import { describe, expect, it } from "vitest";
import { boxId, diffBoxes, diffDraft, slugify } from "./draft";
import type { Box } from "./types";

const box = (id: string, extra: Partial<Box> = {}): Box => ({
  id,
  title: id,
  lane: "l1",
  start: 100,
  end: 110,
  type: "project",
  status: "planned",
  ...extra,
});

describe("draft", () => {
  it("diffs added, modified and removed boxes", () => {
    const base = [box("a"), box("b"), box("c")];
    const current = [box("a"), box("b", { end: 120 }), box("d")];
    const d = diffBoxes(base, current);
    expect(d.added.map((b) => b.id)).toEqual(["d"]);
    expect(d.modified.map((b) => b.id)).toEqual(["b"]);
    expect(d.removed.map((b) => b.id)).toEqual(["c"]);
    expect(d.count).toBe(3);
  });

  it("treats cleared optional fields as unchanged", () => {
    const d = diffBoxes([box("a")], [box("a", { description: "", tags: [], epic: undefined })]);
    expect(d.count).toBe(0);
  });

  it("builds file-safe ids from titles", () => {
    expect(slugify("Dagster 2.x upgrade — phase 1!")).toBe("dagster-2-x-upgrade-phase-1");
    expect(slugify("   ")).toBe("box");
    expect(boxId("a1f0", "Q2 planning")).toBe("bx-a1f0-q2-planning");
  });
});

describe("department changes", () => {
  it("counts a renamed lane as one department change", () => {
    const dept = { id: "eng", name: "Eng", color: "#000", order: 1, collapsed: false, lanes: [{ id: "e1", fte: 1 }] };
    const base = { boxes: [box("a")], departments: [dept] };
    const renamed = { ...base, departments: [{ ...dept, lanes: [{ id: "e1", fte: 1, name: "Platform" }] }] };
    expect(diffDraft(base, renamed).departments.map((d) => d.id)).toEqual(["eng"]);
    expect(diffDraft(base, renamed).count).toBe(1);
    // Clearing the name again is no change at all.
    const cleared = { ...base, departments: [{ ...dept, lanes: [{ id: "e1", fte: 1, name: undefined }] }] };
    expect(diffDraft(base, cleared).count).toBe(0);
  });
});

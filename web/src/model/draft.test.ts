import { describe, expect, it, vi } from "vitest";
import { boxId, diffBoxes, diffDraft, slugify } from "./draft";
import type { Box } from "./types";
import { DEFAULT_SETTINGS } from "./load";
import { describeChanges } from "./summary";

const box = (id: string, extra: Partial<Box> = {}): Box => ({
  id,
  code: id.toUpperCase().padEnd(3, "X").slice(0, 3),
  title: id,
  lane: "l1",
  start: 100,
  end: 110,
  type: "project",
  status: "planned",
  fte: 1,
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
    const dept = { id: "eng", code: "EN", name: "Eng", color: "#000", order: 1, collapsed: false, lanes: [{ id: "e1", fte: 1 }] };
    const base = { boxes: [box("a")], departments: [dept], people: [], settings: DEFAULT_SETTINGS };
    const renamed = { ...base, departments: [{ ...dept, lanes: [{ id: "e1", fte: 1, name: "Platform" }] }] };
    expect(diffDraft(base, renamed).departments.map((d) => d.id)).toEqual(["eng"]);
    expect(diffDraft(base, renamed).count).toBe(1);
    // Clearing the name again is no change at all.
    const cleared = { ...base, departments: [{ ...dept, lanes: [{ id: "e1", fte: 1, name: undefined }] }] };
    expect(diffDraft(base, cleared).count).toBe(0);
  });

  it("counts a reorder as one change however many departments move", () => {
    const dept = (id: string, order: number) => ({ id, code: "XX", name: id, color: "#000", order, collapsed: false, lanes: [] });
    const base = { boxes: [], departments: [dept("a", 1), dept("b", 2), dept("c", 3)], people: [], settings: DEFAULT_SETTINGS };
    const moved = { ...base, departments: [dept("c", 1), dept("a", 2), dept("b", 3)] };
    expect(diffDraft(base, moved).departments).toHaveLength(3);
    expect(diffDraft(base, moved).count).toBe(1);
    // Renaming one as well: the reorder and the rename.
    const both = { ...moved, departments: [{ ...dept("c", 1), name: "C" }, dept("a", 2), dept("b", 3)] };
    expect(diffDraft(base, both).count).toBe(2);
  });
});

describe("rebaseDraft", () => {
  it("takes their changes, keeps ours, and flags items both changed", async () => {
    const { rebaseDraft, revertItems } = await import("./draft");
    const oldBase = { boxes: [box("a"), box("b"), box("c"), box("d")], departments: [], people: [], settings: DEFAULT_SETTINGS };
    const draft = {
      boxes: [box("a", { title: "A mine" }), box("b"), box("c", { end: 200 }), box("d"), box("new")],
      departments: [],
      people: [],
      settings: DEFAULT_SETTINGS,
    };
    const newBase = {
      boxes: [box("a", { title: "A theirs" }), box("b", { status: "done" }), box("c"), box("theirs-new")],
      departments: [],
      people: [],
      settings: DEFAULT_SETTINGS,
    };
    const r = rebaseDraft(oldBase, draft, newBase);
    const byId = Object.fromEntries(r.draft.boxes.map((b) => [b.id, b]));
    expect(byId.a.title).toBe("A mine"); // both changed: ours kept…
    expect(r.conflicts).toEqual(["box:a"]); // …and flagged
    expect(byId.b.status).toBe("done"); // only theirs changed
    expect(byId.c.end).toBe(200); // only ours changed
    expect(byId.d).toBeUndefined(); // they deleted it, we didn't touch it
    expect(Object.keys(byId).sort()).toEqual(["a", "b", "c", "new", "theirs-new"]);

    const theirs = revertItems(r.draft, newBase, r.conflicts);
    expect(theirs.boxes.find((b) => b.id === "a")!.title).toBe("A theirs");
  });

  it("keep theirs puts an item back where it stands in its list", async () => {
    const { revertItems } = await import("./draft");
    const person = (id: string, name = id) => ({ id, name });
    const base = { boxes: [], departments: [], people: [person("ann"), person("bob"), person("cy")], settings: DEFAULT_SETTINGS };
    const draft = { ...base, people: [person("ann", "Ann K"), person("bob", "Bob K"), person("cy")] };
    expect(revertItems(draft, base, ["person:ann"]).people).toEqual([person("ann"), person("bob", "Bob K"), person("cy")]);
    // One we deleted and they kept goes back between its neighbours, not to the end.
    const deleted = { ...base, people: [person("ann"), person("cy"), person("dee")] };
    expect(revertItems(deleted, base, ["person:bob"]).people.map((p) => p.id)).toEqual(["ann", "bob", "cy", "dee"]);
    const first = { ...base, people: [person("bob"), person("cy")] };
    expect(revertItems(first, base, ["person:ann"]).people.map((p) => p.id)).toEqual(["ann", "bob", "cy"]);
  });

  it("is a no-op after our own save", async () => {
    const { rebaseDraft } = await import("./draft");
    const oldBase = { boxes: [box("a")], departments: [], people: [], settings: DEFAULT_SETTINGS };
    const draft = { boxes: [box("a", { end: 300 })], departments: [], people: [], settings: DEFAULT_SETTINGS };
    const saved = { boxes: [box("a", { end: 300 })], departments: [], people: [], settings: DEFAULT_SETTINGS };
    const r = rebaseDraft(oldBase, draft, saved);
    expect(r.conflicts).toEqual([]);
    expect(diffBoxes(saved.boxes, r.draft.boxes).count).toBe(0);
  });
});

describe("comparison", () => {
  it("ignores field order", () => {
    const fromFile = box("n");
    const builtInApp = { status: "planned", fte: 1, type: "project", lane: "l1", end: 110, start: 100, title: "n", code: "NXX", id: "n" } as Box;
    expect(diffBoxes([fromFile], [builtInApp]).count).toBe(0);
  });
});

describe("unchanged items", () => {
  it("are skipped by identity: only changed ones are compared in full", () => {
    const boxes = Array.from({ length: 2000 }, (_, i) => box(`b${i}`));
    const base = { boxes, departments: [], people: [], settings: DEFAULT_SETTINGS };
    const edited = { ...base, boxes: boxes.map((b, i) => (i === 7 ? { ...b, end: 120 } : b)) };
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      expect(diffDraft(base, edited).count).toBe(1);
      expect(stringify).toHaveBeenCalledTimes(2); // the one edited box, against its loaded version
    } finally {
      stringify.mockRestore();
    }
  });

  it("describeChanges gives the same lines from changes worked out already", () => {
    const base = { boxes: [box("a"), box("b")], departments: [], people: [], settings: DEFAULT_SETTINGS };
    const draft = { ...base, boxes: [box("a", { title: "A2" }), box("c")] };
    expect(describeChanges(base, draft, diffDraft(base, draft))).toEqual(describeChanges(base, draft));
  });
});

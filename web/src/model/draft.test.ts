import { describe, expect, it, vi } from "vitest";
import { type History, boxId, diffBoxes, diffDraft, reduceHistory, slugify, startHistory } from "./draft";
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

describe("clashes", () => {
  const state = (boxes: Box[]) => ({ boxes, departments: [], people: [], settings: DEFAULT_SETTINGS });
  const edit = (h: History, id: string, patch: Partial<Box>) =>
    reduceHistory(h, { type: "edit", update: (d) => ({ ...d, boxes: d.boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)) }) });
  /** Loaded, edited (box a and b), then Sam's save of a and b came in. */
  const clashing = () => {
    const h = edit(edit(startHistory(state([box("a"), box("b"), box("c")])), "a", { title: "A mine" }), "b", { title: "B mine" });
    return reduceHistory(h, { type: "rebase", base: state([box("a", { title: "A Sam" }), box("b", { title: "B Sam" }), box("c")]) });
  };

  it("a clash is over once our own save has the item: editing it again later isn't one", () => {
    let h = clashing();
    expect(h.conflicts).toEqual(["box:a", "box:b"]);
    h = reduceHistory(h, { type: "resolve", keys: h.conflicts, keep: "mine" });
    h = reduceHistory(h, { type: "rebase", base: state(h.present.boxes.map((b) => ({ ...b }))) }); // our save, loaded back
    expect(h.conflicts).toEqual([]);
    h = edit(h, "a", { end: 150 });
    expect(h.conflicts).toEqual([]);
  });

  it("keep theirs, a manual fix or discarding ends a clash; a poll bringing the same version does too", () => {
    expect(reduceHistory(clashing(), { type: "resolve", keys: ["box:a", "box:b"], keep: "theirs" }).conflicts).toEqual([]);
    expect(edit(clashing(), "a", { title: "A Sam" }).conflicts).toEqual(["box:b"]);
    const h = clashing();
    expect(reduceHistory(h, { type: "edit", update: () => h.base }).conflicts).toEqual([]);
    // Sam's next save happens to match ours.
    expect(reduceHistory(h, { type: "rebase", base: state([box("a", { title: "A mine" }), box("b", { title: "B Sam" }), box("c")]) }).conflicts).toEqual(["box:b"]);
  });

  it("a choice settles only the clashes it was given, and never reverts an item that doesn't clash", () => {
    let h = edit(clashing(), "c", { title: "C mine" });
    h = reduceHistory(h, { type: "resolve", keys: ["box:a", "box:c"], keep: "theirs" });
    expect(h.present.boxes.map((b) => b.title)).toEqual(["A Sam", "B mine", "C mine"]);
    expect(h.conflicts).toEqual(["box:b"]);
    h = reduceHistory(h, { type: "resolve", keys: ["box:b"], keep: "mine" });
    expect(h.present.boxes.map((b) => b.title)).toEqual(["A Sam", "B mine", "C mine"]);
    expect(h.conflicts).toEqual([]);
  });

  it("undoing keep theirs brings back our version and the clash; keep mine stays settled", () => {
    let h = reduceHistory(clashing(), { type: "resolve", keys: ["box:a"], keep: "theirs" });
    h = reduceHistory(h, { type: "undo" });
    expect(h.present.boxes[0].title).toBe("A mine");
    expect(h.conflicts).toEqual(["box:a", "box:b"]);
    h = reduceHistory(h, { type: "redo" });
    expect(h.conflicts).toEqual(["box:b"]);

    h = edit(reduceHistory(clashing(), { type: "resolve", keys: ["box:a"], keep: "mine" }), "c", { end: 150 });
    h = reduceHistory(h, { type: "undo" });
    expect(h.conflicts).toEqual(["box:b"]);
  });

  it("an edit made while our save ran is ours, not a clash with our own commit", () => {
    // Saving box a's new title; meanwhile the title is typed on, and box b moved.
    let h = edit(startHistory(state([box("a"), box("b")])), "a", { title: "A1" });
    const target = h.present;
    h = edit(edit(h, "a", { title: "A12" }), "b", { end: 150 });
    h = reduceHistory(h, { type: "saved", draft: target });
    h = reduceHistory(h, { type: "rebase", base: state([box("a", { title: "A1" }), box("b")]) });
    expect(h.conflicts).toEqual([]);
    expect(h.present.boxes.map((b) => [b.title, b.end])).toEqual([["A12", 110], ["b", 150]]);
    expect(diffDraft(h.base, h.present).count).toBe(2);
    expect(h.saved).toBeUndefined();
  });

  it("an undo made while our save ran stays, and others' changes merged into the save come in", () => {
    let h = edit(startHistory(state([box("a"), box("b")])), "a", { title: "A1" });
    const target = h.present;
    h = reduceHistory(h, { type: "undo" });
    h = reduceHistory(h, { type: "saved", draft: target });
    // The save went on top of Sam's change to b.
    h = reduceHistory(h, { type: "rebase", base: state([box("a", { title: "A1" }), box("b", { status: "done" })]) });
    expect(h.conflicts).toEqual([]);
    expect(h.present.boxes.map((b) => [b.title, b.status])).toEqual([["a", "planned"], ["b", "done"]]);
  });

  it("restored clashes count only while the item still differs", () => {
    const base = state([box("a"), box("b")]);
    const draft = state([box("a", { title: "A mine" }), box("b")]);
    expect(startHistory(base, { draft, conflicts: ["box:a", "box:b", "box:a"] }).conflicts).toEqual(["box:a"]);
  });
});

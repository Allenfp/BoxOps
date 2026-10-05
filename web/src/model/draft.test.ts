import { describe, expect, it, vi } from "vitest";
import {
  type DraftState,
  type History,
  boxId,
  changedItems,
  diffBoxes,
  diffDraft,
  fromSharedDraft,
  openDraft,
  SETTINGS_KEY,
  rebaseDraft,
  recountOffers,
  reduceHistory,
  restoreDelta,
  restoreRecord,
  revertItems,
  slugify,
  startHistory,
} from "./draft";
import type { DeltaItem } from "./draftStore";
import { addDepartment, moveDepartment, removeDepartment, updateDepartment } from "./structure";
import type { Box, Department, Person } from "./types";
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
  it("takes their changes, keeps ours, and flags items both changed", () => {
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

  it("keep theirs puts an item back where it stands in its list", () => {
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

  it("is a no-op after our own save", () => {
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

  it("changes restored from storage stay marked for review until it's done: edits, undo, saves and rebases keep the mark", () => {
    const base = state([box("a"), box("b")]);
    const planted = state([box("a", { title: "Planted" }), box("b")]);
    expect(startHistory(base).fromStorage).toBeFalsy();
    expect(startHistory(base, { draft: base, conflicts: [] }).fromStorage).toBeFalsy(); // nothing left in it to save
    let h = startHistory(base, { draft: planted, conflicts: [] });
    expect(h.fromStorage).toBe(true);
    // A fresh edit, or undoing it, leaves what was restored in the draft.
    h = reduceHistory(edit(h, "b", { title: "B mine" }), { type: "undo" });
    expect(h.fromStorage).toBe(true);
    // Nor does someone else's save coming in, or one of ours under way before a restore going through.
    h = reduceHistory(h, { type: "rebase", base: state([box("a"), box("b", { status: "done" })]) });
    expect([h.fromStorage, h.present.boxes[0].title]).toEqual([true, "Planted"]);
    expect(reduceHistory(h, { type: "saved", draft: h.present }).fromStorage).toBe(true);
    h = reduceHistory(h, { type: "reviewed" });
    expect(h.fromStorage).toBeFalsy();
    expect(edit(h, "b", { title: "B mine" }).fromStorage).toBeFalsy();
    // Restoring a draft a gone tab left marks it again.
    h = reduceHistory(h, { type: "adopt", values: new Map([["box:b", box("b", { title: "Left behind" })]]), conflicts: [] });
    expect([h.fromStorage, h.present.boxes[1].title]).toEqual([true, "Left behind"]);
  });
});

describe("stored drafts", () => {
  const dept = (id: string, extra: Partial<Department> = {}): Department => ({
    id,
    code: id.toUpperCase(),
    name: id,
    color: "#000000",
    order: 1,
    collapsed: false,
    lanes: [{ id: `${id}-1`, fte: 1 }],
    ...extra,
  });
  const loaded = (): DraftState => ({
    boxes: [box("a"), box("b"), box("c")],
    departments: [dept("de"), dept("an", { order: 2 })],
    people: [
      { id: "ann", name: "Ann" },
      { id: "bob", name: "Bob", pto: [{ start: 200, end: 204 }] },
      { id: "cy", name: "Cy" },
    ],
    settings: DEFAULT_SETTINGS,
  });
  /** One of each kind of change. */
  const edited = (base: DraftState): DraftState => ({
    boxes: [box("a", { title: "A mine" }), box("c"), box("new")],
    departments: [dept("de", { name: "Data" }), dept("an", { order: 2 })],
    people: [{ id: "ann", name: "Ann K" }, { id: "cy", name: "Cy" }, { id: "dee", name: "Dee" }],
    settings: { ...base.settings, title: "Our roadmap" },
  });
  /** Stored, and read back. */
  const stored = (base: DraftState, draft: DraftState) =>
    JSON.parse(JSON.stringify(changedItems(base, draft, diffDraft(base, draft)))) as Record<string, DeltaItem>;

  it("keeps only the changed items, and comes back as it was, untouched items the loaded roadmap's own", () => {
    const base = loaded();
    const draft = edited(base);
    const items = stored(base, draft);
    expect(Object.keys(items).sort()).toEqual(["box:a", "box:b", "box:new", "dept:de", "person:ann", "person:bob", "person:dee", "settings:settings"]);
    expect(items["box:b"]).toEqual({ old: box("b") });
    expect(items["box:new"]).toEqual({ now: box("new") });

    const r = restoreDelta(items, base);
    expect(r.conflicts).toEqual([]);
    expect(diffDraft(draft, r.draft).count).toBe(0);
    expect(r.draft.people.map((p) => p.id)).toEqual(["ann", "cy", "dee"]);
    expect(r.draft.boxes.find((b) => b.id === "c")).toBe(base.boxes[2]);
    expect(r.draft.departments[1]).toBe(base.departments[1]);
  });

  it("restored onto a newer roadmap: their changes come in, ours stay, and items both changed clash", () => {
    const old = loaded();
    const items = stored(old, edited(old));
    const newer = loaded();
    newer.boxes = [box("a", { title: "A Sam" }), box("b"), box("c", { status: "done" })];
    newer.people[2] = { id: "cy", name: "Cy Sam" };
    const r = restoreDelta(items, newer);
    expect(r.conflicts).toEqual(["box:a"]);
    expect(r.draft.boxes.map((b) => [b.id, b.title, b.status])).toEqual([
      ["a", "A mine", "planned"],
      ["c", "c", "done"],
      ["new", "new", "planned"],
    ]);
    expect(r.draft.people.map((p) => p.name)).toEqual(["Ann K", "Cy Sam", "Dee"]);
  });

  it("restoring the delta onto a newer roadmap is the same as rebasing the whole draft", () => {
    const old = loaded();
    const draft: DraftState = {
      ...edited(old),
      departments: [dept("de", { lanes: [{ id: "de-1", fte: 1 }, { id: "de-2", fte: 0.5, end: 300 }] }), dept("an", { order: 2 })],
      people: [{ id: "ann", name: "Ann" }, { id: "bob", name: "Bob", pto: [{ start: 210, end: 214 }] }, { id: "cy", name: "Cy" }],
    };
    const newer: DraftState = {
      boxes: [box("a", { title: "A Sam" }), box("b", { end: 130 }), box("c"), box("sam")],
      departments: [dept("de"), dept("an", { order: 2, name: "Analytics" })],
      people: [{ id: "ann", name: "Ann" }, { id: "bob", name: "Bob", pto: [{ start: 200, end: 206 }] }, { id: "cy", name: "Cy" }, { id: "eve", name: "Eve" }],
      settings: { ...old.settings, fiscal_year_start_month: 2 },
    };
    const whole = rebaseDraft(old, draft, newer);
    const delta = restoreDelta(stored(old, draft), newer);
    expect(delta.conflicts.sort()).toEqual(whole.conflicts.sort());
    expect(diffDraft(whole.draft, delta.draft).count).toBe(0);
    expect(delta.draft.people.map((p) => p.id)).toEqual(whole.draft.people.map((p) => p.id));
    expect(delta.conflicts.sort()).toEqual(["box:a", "box:b", "person:bob", "settings:settings"]);
  });

  it("restored by another build of the same data format: untouched items are read as this build reads them", () => {
    // The stored draft edited a box only; Bob's PTO, which an older build might not have read, comes from what's loaded.
    const base = loaded();
    const asOldBuildRead = { ...base, people: base.people.map(({ pto: _, ...p }) => p) };
    const items = stored(asOldBuildRead, { ...asOldBuildRead, boxes: [box("a", { end: 300 }), ...base.boxes.slice(1)] });
    expect(Object.keys(items)).toEqual(["box:a"]);
    const r = restoreRecord({ v: 2, format: 1, build: "0.0.9+old", baseCommit: "c0", savedAt: "", alive: 0, items, conflicts: [] }, base);
    expect(r.draft.people[1]).toBe(base.people[1]);
    expect(r.draft.people[1].pto).toHaveLength(1);
    expect(r.draft.boxes[0].end).toBe(300);
  });

  it("one edit at 2,000 boxes stores well under 4 KB", () => {
    const boxes = Array.from({ length: 2000 }, (_, i) => box(`bx-${String(i).padStart(4, "0")}-some-longer-title-here`, { description: "x".repeat(200) }));
    const base = { boxes, departments: [dept("de")], people: [], settings: DEFAULT_SETTINGS };
    const draft = { ...base, boxes: boxes.map((b, i) => (i === 1234 ? { ...b, title: "Renamed" } : b)) };
    expect(JSON.stringify(changedItems(base, draft, diffDraft(base, draft))).length).toBeLessThan(4096);
  });

  it("a delta this BoxOps didn't store isn't restored", () => {
    const base = loaded();
    expect(() => restoreDelta({ "box:a": { now: { id: "b" } } }, base)).toThrow();
    expect(() => restoreDelta({ "box:a": { now: "a" } }, base)).toThrow();
    expect(() => restoreDelta({ "lane:x": { now: { id: "x" } } }, base)).toThrow();
    expect(() => restoreDelta({ "box:a": null as unknown as DeltaItem }, base)).toThrow();
  });

  it("the old shared draft (the whole roadmap twice) becomes a record of its changes", () => {
    const base = loaded();
    const shared = { baseHash: "abc", base, ...edited(base) };
    const record = fromSharedDraft(JSON.parse(JSON.stringify(shared)), base)!;
    expect(record.format).toBe(1);
    expect(record.savedAt).toBe(""); // it never said when: the offer gives no time
    expect(Object.keys(record.items)).toHaveLength(8);
    expect(diffDraft(edited(base), restoreRecord(record, base).draft).count).toBe(0);
    // Without what it was made against, it can't be carried onto anything.
    expect(fromSharedDraft({ baseHash: "abc", boxes: [] }, base)).toBeNull();
    // Nor with something that isn't a box in it: kept as it was, to download, rather than crashing every load.
    expect(fromSharedDraft({ base: { boxes: [null] }, boxes: [] }, base)).toBeNull();
  });

  describe("opening a tab", () => {
    const memory = () => {
      const data = new Map<string, string>();
      return {
        data,
        get length() {
          return data.size;
        },
        key: (i: number) => [...data.keys()][i] ?? null,
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
      };
    };
    const SCOPE = "acme/roadmap@main";
    const at = (tab: string) => `boxops-draft:${SCOPE}:${tab}`;
    const recordOf = (base: DraftState, draft: DraftState, extra: object = {}) => ({
      v: 2,
      format: 1,
      build: "0.1.0+0123456789ab",
      baseCommit: "c1",
      savedAt: "2026-10-03T08:00:00.000Z",
      alive: 0,
      items: stored(base, draft),
      conflicts: [],
      ...extra,
    });

    it("restores its own draft, and offers ones from tabs that are gone without taking them", () => {
      const base = loaded();
      const stores = { local: memory(), session: memory() };
      stores.session.setItem("boxops-tab", "aaaa0001");
      stores.local.setItem(at("aaaa0001"), JSON.stringify(recordOf(base, { ...base, boxes: [box("a", { end: 300 }), box("b"), box("c")] })));
      stores.local.setItem(at("bbbb0002"), JSON.stringify(recordOf(base, edited(base))));
      // All of it saved since: nothing to restore, so it's tidied away.
      stores.local.setItem(at("cccc0003"), JSON.stringify(recordOf(loaded(), base)));
      const o = openDraft(base, SCOPE, stores);
      expect(o.key).toBe(at("aaaa0001"));
      expect(o.restored?.draft.boxes[0].end).toBe(300);
      expect(o.offers.map((x) => [x.key, x.restorable, x.count])).toEqual([[at("bbbb0002"), true, 8]]);
      expect(stores.local.data.has(at("cccc0003"))).toBe(false);
      expect(stores.local.data.has(at("bbbb0002"))).toBe(true);
    });

    it("a draft in another data format is offered to download, never written over: the tab takes a fresh key", () => {
      const base = loaded();
      const stores = { local: memory(), session: memory() };
      stores.session.setItem("boxops-tab", "aaaa0001");
      const newer = recordOf(base, edited(base), { format: 2 });
      stores.local.setItem(at("aaaa0001"), JSON.stringify(newer));
      const o = openDraft(base, SCOPE, stores);
      expect(o.restored).toBeUndefined();
      expect(o.key).not.toBe(at("aaaa0001"));
      expect(o.offers).toEqual([{ key: at("aaaa0001"), value: newer, restorable: false, unreadable: false, count: 0, savedAt: "2026-10-03T08:00:00.000Z" }]);
      expect(JSON.parse(stores.local.getItem(at("aaaa0001"))!)).toEqual(newer);
    });

    it("tells a draft it can't read (not JSON, or broken) from one another version wrote", () => {
      const base = loaded();
      const stores = { local: memory(), session: memory() };
      stores.local.setItem(at("aaaa0001"), "{ not JSON");
      stores.local.setItem(at("bbbb0002"), JSON.stringify(recordOf(base, edited(base), { items: { "box:a": { now: "not a box" } } })));
      stores.local.setItem(at("cccc0003"), JSON.stringify(recordOf(base, edited(base), { v: 3 })));
      const o = openDraft(base, SCOPE, stores);
      // Newest first; one that isn't JSON says no time, so last.
      expect(o.offers.map((x) => [x.key, x.restorable, x.unreadable])).toEqual([
        [at("bbbb0002"), false, true],
        [at("cccc0003"), false, false],
        [at("aaaa0001"), false, true],
      ]);
    });

    it("counts an offer again against a newer roadmap: what's been saved since isn't a change, and all of it isn't offered", () => {
      const base = loaded();
      const stores = { local: memory(), session: memory() };
      const two = { ...base, boxes: [box("a", { end: 300 }), box("b", { end: 400 }), box("c")] };
      stores.local.setItem(at("bbbb0002"), JSON.stringify(recordOf(base, two)));
      const { offers } = openDraft(base, SCOPE, stores);
      expect(offers.map((x) => x.count)).toEqual([2]);
      // Someone saved one of the two changes, then the other.
      const one = { ...base, boxes: [box("a", { end: 300 }), box("b"), box("c")] };
      expect(recountOffers(offers, one).map((x) => [x.key, x.count])).toEqual([[at("bbbb0002"), 1]]);
      expect(recountOffers(offers, two)).toEqual([]);
      // Download-only offers are left as they are.
      const other = { key: at("cccc0003"), value: {}, restorable: false, unreadable: false, count: 0, savedAt: "" };
      expect(recountOffers([other], two)).toEqual([other]);
    });

    it("counts an offer's changes as a save would list them, a line each: a department renamed and recoloured is two", () => {
      const base = loaded();
      const stores = { local: memory(), session: memory() };
      const draft = { ...base, departments: [dept("de", { name: "Data", color: "#ffffff" }), dept("an", { order: 2 })] };
      stores.local.setItem(at("bbbb0002"), JSON.stringify(recordOf(base, draft)));
      expect(diffDraft(base, draft).count).toBe(1);
      const { offers } = openDraft(base, SCOPE, stores);
      expect(offers.map((x) => x.count)).toEqual([2]);
      expect(recountOffers(offers, base).map((x) => x.count)).toEqual([2]);
    });
  });
});

describe("departments added, removed and reordered", () => {
  const dept = (id: string, order: number): Department => ({
    id,
    code: id.toUpperCase().padEnd(2, "X"),
    name: id,
    color: "#000000",
    order,
    collapsed: false,
    lanes: [{ id: `${id}-1`, fte: 1 }],
  });
  const state = (departments: Department[]): DraftState => ({ boxes: [], departments, people: [], settings: DEFAULT_SETTINGS });

  it("adding or deleting one leaves the others' files alone, and isn't a reorder", () => {
    // Orders with gaps, as a team may write them by hand.
    const base = state([dept("a", 10), dept("b", 20), dept("c", 30)]);
    const added = addDepartment(base, "D").state;
    expect(added.departments.map((d) => [d.id, d.order])).toEqual([["a", 10], ["b", 20], ["c", 30], ["d", 31]]);
    expect(diffDraft(base, added).departments.map((d) => d.id)).toEqual(["d"]);
    expect(describeChanges(base, added).map((l) => l.text)).toEqual(["Added department **D** (1 lane, 1 FTE)"]);
    const removed = removeDepartment(base, "a");
    expect(removed.departments.map((d) => [d.id, d.order])).toEqual([["b", 20], ["c", 30]]);
    expect(diffDraft(base, removed).count).toBe(1);
    expect(describeChanges(base, removed).map((l) => l.text)).toEqual(["Deleted department **a**"]);
  });

  it("a reorder is said once; new numbers with nobody moving are no change", () => {
    const base = state([dept("a", 10), dept("b", 20), dept("c", 30)]);
    const moved = moveDepartment(base, "c", -1);
    expect(describeChanges(base, moved).map((l) => l.text)).toEqual(["Reordered departments"]);
    expect(diffDraft(base, moved).count).toBe(1);
    // Back where it was, numbered 1, 2, 3 now: nothing to save.
    const back = moveDepartment(moved, "c", 1);
    expect(back.departments.map((d) => d.order)).toEqual([1, 2, 3]);
    expect(diffDraft(base, back).count).toBe(0);
    expect(describeChanges(base, back)).toEqual([]);
  });

  it("a rename among departments with the same `order` isn't a reorder, though it sorts them anew", () => {
    // Hand-made departments without `order` (0): shown by name.
    const base = state([{ ...dept("aa", 0), name: "Alpha" }, { ...dept("bb", 0), name: "Beta" }, { ...dept("cc", 0), name: "Gamma" }]);
    const renamed = updateDepartment(base, "aa", { name: "Zeta" });
    expect(diffDraft(base, renamed).count).toBe(1);
    expect(describeChanges(base, renamed).map((l) => l.text)).toEqual(["Renamed department **Alpha** to **Zeta**"]);
    // A move then renumbers them all, in the order they're shown.
    const moved = moveDepartment(renamed, "bb", 1);
    expect(moved.departments.map((d) => [d.id, d.order])).toEqual([["aa", 1], ["cc", 2], ["bb", 3]]);
    expect(describeChanges(base, moved).map((l) => l.text)).toEqual(["Renamed department **Alpha** to **Zeta**", "Reordered departments"]);
    expect(diffDraft(base, moved).count).toBe(2);
  });

  it("a change with no words of its own still gets a line", () => {
    const base = state([dept("a", 1)]);
    // Lane 1 named what it showed anyway.
    const named = state([{ ...dept("a", 1), lanes: [{ id: "a-1", fte: 1, name: "FTE 1" }] }]);
    expect(describeChanges(base, named).map((l) => l.text)).toEqual(["Updated department **a**"]);
  });
});

describe("merging people, team settings and deletions", () => {
  const st = (boxes: Box[], people: Person[] = [], settings = DEFAULT_SETTINGS): DraftState => ({ boxes, departments: [], people, settings });
  const ann = { id: "ann", name: "Ann" };
  const bob = { id: "bob", name: "Bob" };

  it("people merge one by one: each side's edits come in, and both editing one person clashes", () => {
    const oldBase = st([], [ann, bob]);
    const draft = st([], [{ ...ann, role: "Lead" }, bob]);
    const r = rebaseDraft(oldBase, draft, st([], [ann, { ...bob, role: "Analyst" }]));
    expect(r.conflicts).toEqual([]);
    expect(r.draft.people).toEqual([{ ...ann, role: "Lead" }, { ...bob, role: "Analyst" }]);
    const both = rebaseDraft(oldBase, draft, st([], [{ ...ann, role: "Manager" }, bob]));
    expect(both.conflicts).toEqual(["person:ann"]);
    expect(revertItems(both.draft, st([], [{ ...ann, role: "Manager" }, bob]), both.conflicts).people[0].role).toBe("Manager");
  });

  it("team settings are one item: a clash only when both changed them differently", () => {
    const oldBase = st([]);
    const ours = st([], [], { ...DEFAULT_SETTINGS, title: "Ours" });
    expect(rebaseDraft(oldBase, ours, st([], [], { ...DEFAULT_SETTINGS, fiscal_year_start_month: 4 })).conflicts).toEqual([SETTINGS_KEY]);
    expect(rebaseDraft(oldBase, ours, st([], [], { ...DEFAULT_SETTINGS, title: "Ours" })).conflicts).toEqual([]);
    expect(rebaseDraft(oldBase, oldBase, st([], [], { ...DEFAULT_SETTINGS, title: "Theirs" })).draft.settings.title).toBe("Theirs");
  });

  it("we edit what they deleted: ours stays, as a clash; keep theirs deletes it", () => {
    const newBase = st([box("b")]);
    const r = rebaseDraft(st([box("a"), box("b")]), st([box("a", { title: "A mine" }), box("b")]), newBase);
    expect(r.conflicts).toEqual(["box:a"]);
    expect(r.draft.boxes.map((b) => b.id)).toEqual(["b", "a"]);
    expect(revertItems(r.draft, newBase, r.conflicts).boxes.map((b) => b.id)).toEqual(["b"]);
  });

  it("we delete what they edited: it stays deleted, as a clash; keep theirs brings theirs back in its place", () => {
    const newBase = st([box("a", { title: "A theirs" }), box("b")]);
    const r = rebaseDraft(st([box("a"), box("b")]), st([box("b")]), newBase);
    expect(r.conflicts).toEqual(["box:a"]);
    expect(r.draft.boxes.map((b) => b.id)).toEqual(["b"]);
    expect(revertItems(r.draft, newBase, r.conflicts).boxes.map((b) => [b.id, b.title])).toEqual([["a", "A theirs"], ["b", "b"]]);
  });
});

describe("what a merge leaves pointing at nothing", () => {
  const dept: Department = {
    id: "eng",
    code: "EN",
    name: "Eng",
    color: "#000000",
    order: 1,
    collapsed: false,
    lanes: [
      { id: "l1", fte: 1 },
      { id: "l2", fte: 1 },
    ],
  };
  const people: Person[] = [
    { id: "sam", name: "Sam" },
    { id: "ana", name: "Ana" },
  ];
  const st = (boxes: Box[], departments = [dept], who = people): DraftState => ({ boxes, departments, people: who, settings: DEFAULT_SETTINGS });

  it("puts right what one side deleted and the other still used", () => {
    const oldBase = st([box("a"), box("b", { lane: "l2" })]);
    // We removed lane l2 (its box going to l1) and Ana, and deleted box a.
    const draft = st([box("b", { lane: "l1" })], [{ ...dept, lanes: [dept.lanes[0]] }], [people[0]]);
    // They added a box in l2, a box with Ana on it, and a rule about box a; one box already named people and boxes that never were.
    const odd = box("f", { engineers: ["ghost"], relations: [{ type: "after", box: "ZZZ" }] });
    const newBase = st([
      box("a"),
      box("b", { lane: "l2" }),
      box("c", { lane: "l2" }),
      box("d", { engineers: ["ana", "sam"] }),
      box("e", { relations: [{ type: "before", box: "AXX" }] }),
      odd,
    ]);
    const r = rebaseDraft(oldBase, draft, newBase);
    const byId = Object.fromEntries(r.draft.boxes.map((b) => [b.id, b]));
    expect(byId.c.lane).toBe("l1"); // where the lane's other box went…
    expect(r.conflicts).toEqual(["box:c"]); // …and the user is asked about it
    expect(byId.d.engineers).toEqual(["sam"]);
    expect(byId.e.relations).toEqual([]);
    expect(byId.f).toBe(odd); // the files' own problems, left as they are
    expect(byId.a).toBeUndefined();
  });

  it("a box both sides changed, in a lane they removed, clashes once", () => {
    const oldBase = st([box("a"), box("b", { lane: "l2" })]);
    const draft = st([box("a"), box("b", { lane: "l2", title: "B mine" })]);
    // They removed lane l2, moving its box to l1.
    const newBase = st([box("a"), box("b", { lane: "l1" })], [{ ...dept, lanes: [dept.lanes[0]] }]);
    const r = rebaseDraft(oldBase, draft, newBase);
    expect(r.conflicts).toEqual(["box:b"]);
    expect(r.draft.boxes.find((b) => b.id === "b")?.lane).toBe("l1");
  });

  it("keep theirs never puts a box back in a lane that's gone", () => {
    const oldBase = st([box("a"), box("b", { lane: "l2" })]);
    const oneLane = { ...dept, lanes: [dept.lanes[0]] };
    let h = startHistory(oldBase);
    h = reduceHistory(h, { type: "edit", update: () => st([box("a"), box("b", { lane: "l1" })], [oneLane]) });
    // They added a box in the lane we removed.
    h = reduceHistory(h, { type: "rebase", base: st([box("a"), box("b", { lane: "l2" }), box("c", { lane: "l2" })]) });
    expect(h.conflicts).toEqual(["box:c"]);
    h = reduceHistory(h, { type: "resolve", keys: h.conflicts, keep: "theirs" });
    const lanes = h.present.departments.flatMap((d) => d.lanes.map((l) => l.id));
    expect(lanes).toEqual(["l1"]);
    expect(h.present.boxes.map((b) => [b.id, b.lane])).toEqual([["a", "l1"], ["b", "l1"], ["c", "l1"]]);
    expect(h.conflicts).toEqual([]);
  });

  it("keep theirs puts right what our side still used: a lane, a box, a person", () => {
    const oldBase = st([box("a"), box("b")]);
    // We added lane l3 with a box in it, edited box a and Ana, and put a rule about box a and Ana on box b.
    const draft = st(
      [box("a", { title: "A mine" }), box("b", { engineers: ["ana"], relations: [{ type: "after", box: "AXX" }] }), box("x", { lane: "l3" })],
      [{ ...dept, lanes: [...dept.lanes, { id: "l3", fte: 1 }] }],
      [people[0], { ...people[1], role: "Lead" }],
    );
    // They renamed the department, and deleted box a and Ana.
    const newBase = st([box("b")], [{ ...dept, name: "Engineering" }], [people[0]]);
    const r = rebaseDraft(oldBase, draft, newBase);
    expect(r.conflicts).toEqual(["box:a", "dept:eng", "person:ana"]);
    const theirs = revertItems(r.draft, newBase, r.conflicts);
    const byId = Object.fromEntries(theirs.boxes.map((b) => [b.id, b]));
    expect(theirs.departments[0].lanes.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(byId.x.lane).toBe("l1");
    expect(byId.b.engineers).toEqual([]);
    expect(byId.b.relations).toEqual([]);
    expect(byId.a).toBeUndefined();
  });

  it("a box we added that has the code of one they added takes a fresh one, and our rules follow it", () => {
    const oldBase = st([box("a")]);
    const draft = st([box("a", { relations: [{ type: "before", box: "K7P" }] }), box("ours", { code: "K7P" })]);
    const newBase = st([box("a"), box("theirs", { code: "K7P" }), box("other", { relations: [{ type: "during", box: "K7P" }] })]);
    const r = rebaseDraft(oldBase, draft, newBase);
    const byId = Object.fromEntries(r.draft.boxes.map((b) => [b.id, b]));
    expect(byId.ours.code).not.toBe("K7P");
    expect(byId.theirs.code).toBe("K7P");
    expect(byId.a.relations).toEqual([{ type: "before", box: byId.ours.code }]);
    expect(byId.other.relations).toEqual([{ type: "during", box: "K7P" }]); // theirs means their box
    expect(new Set(r.draft.boxes.map((b) => b.code)).size).toBe(4);
    expect(r.conflicts).toEqual([]);
  });
});

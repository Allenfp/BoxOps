import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DraftWriter,
  RECORD,
  STALE_MS,
  type Store,
  type StoredDraft,
  type Stores,
  asRecord,
  draftKey,
  isLeft,
  openTab,
  otherTabs,
} from "./draftStore";
import { FORMAT } from "./format";

/** Storage in memory, like localStorage; `fail` makes writes throw (blocked), and so does a value longer than `limit` (full). */
function memory(): Store & { data: Map<string, string>; fail: boolean; limit: number } {
  const data = new Map<string, string>();
  return {
    data,
    fail: false,
    limit: Infinity,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem(k, v) {
      if (this.fail || String(v).length > this.limit) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      data.set(k, String(v));
    },
    removeItem: (k) => void data.delete(k),
  };
}

const SCOPE = "acme/roadmap@main";
const NOW = Date.parse("2026-10-03T09:00:00Z");
const record = (extra: Partial<StoredDraft> = {}): StoredDraft => ({
  v: RECORD,
  format: FORMAT,
  build: "0.1.0+0123456789ab",
  baseCommit: "c1",
  savedAt: "2026-10-03T08:00:00.000Z",
  alive: NOW,
  items: { "box:a": { old: { id: "a" }, now: { id: "a", title: "A" } } },
  conflicts: [],
  ...extra,
});
const stores = () => ({ local: memory(), session: memory() });
const noShared = () => null;

describe("which drafts a tab finds", () => {
  it("a reload finds the tab's own; other open tabs' are left alone; ones from tabs that are gone are offered, newest first", () => {
    const s = stores();
    s.session.setItem("boxops-tab", "aaaa0001");
    s.local.setItem(draftKey(SCOPE, "aaaa0001"), JSON.stringify(record({ alive: 0 }))); // closed by the reload
    s.local.setItem(draftKey(SCOPE, "bbbb0002"), JSON.stringify(record({ alive: NOW - 1000 }))); // open
    s.local.setItem(draftKey(SCOPE, "cccc0003"), JSON.stringify(record({ alive: NOW - STALE_MS - 1, savedAt: "2026-10-01T08:00:00.000Z" })));
    s.local.setItem(draftKey(SCOPE, "dddd0004"), JSON.stringify(record({ alive: 0, savedAt: "2026-10-02T08:00:00.000Z" })));
    s.local.setItem(draftKey("acme/other@main", "eeee0005"), JSON.stringify(record({ alive: 0 }))); // another roadmap

    const t = openTab(SCOPE, NOW, s, noShared);
    expect(t.key).toBe(draftKey(SCOPE, "aaaa0001"));
    expect(t.own?.record?.items).toEqual(record().items);
    expect(t.orphans.map((o) => o.key)).toEqual([draftKey(SCOPE, "dddd0004"), draftKey(SCOPE, "cccc0003")]);
    expect(otherTabs(SCOPE, t.key, NOW, s.local)).toBe(1);
  });

  it("a duplicated tab (the same id, whose draft is alive in the original) takes an id of its own", () => {
    const s = stores();
    s.session.setItem("boxops-tab", "aaaa0001");
    s.local.setItem(draftKey(SCOPE, "aaaa0001"), JSON.stringify(record({ alive: NOW - 1000 })));
    const t = openTab(SCOPE, NOW, s, noShared);
    expect(t.key).not.toBe(draftKey(SCOPE, "aaaa0001"));
    expect(t.key).toBe(draftKey(SCOPE, s.session.getItem("boxops-tab")!));
    expect(t.own).toBeNull();
    expect(t.orphans).toEqual([]);
    expect(otherTabs(SCOPE, t.key, NOW, s.local)).toBe(1);
  });

  it("a new tab gets an id that a reload keeps", () => {
    const s = stores();
    const first = openTab(SCOPE, NOW, s, noShared);
    expect(first.key).toMatch(/^boxops-draft:acme\/roadmap@main:[0-9a-f]{8}$/);
    expect(openTab(SCOPE, NOW, s, noShared).key).toBe(first.key);
  });

  it("a reload after a crash (its draft never marked closed) finds the tab's own draft", () => {
    const s = stores();
    s.session.setItem("boxops-tab", "aaaa0001");
    s.local.setItem(draftKey(SCOPE, "aaaa0001"), JSON.stringify(record({ alive: NOW - 1000 })));
    const t = openTab(SCOPE, NOW, s, noShared, true);
    expect(t.key).toBe(draftKey(SCOPE, "aaaa0001"));
    expect(t.own?.record?.items).toEqual(record().items);
    expect(otherTabs(SCOPE, t.key, NOW, s.local)).toBe(0);
  });

  it("the old shared draft moves over once: this tab's if it has none, else one left behind; one it can't read stays to download", () => {
    const shared = "boxops-draft:acme/roadmap@main";
    const s = stores();
    s.local.setItem(shared, JSON.stringify({ baseHash: "1", base: {}, boxes: [] }));
    const t = openTab(SCOPE, NOW, s, () => record());
    expect(s.local.getItem(shared)).toBeNull();
    expect(t.own?.record).toEqual(record({ alive: 0 }));
    expect(t.orphans).toEqual([]);

    s.local.setItem(shared, JSON.stringify({ baseHash: "1", base: {}, boxes: [] }));
    const again = openTab(SCOPE, NOW, s, () => record({ savedAt: "2026-10-03T08:30:00.000Z" }));
    expect(again.key).toBe(t.key);
    expect(s.local.getItem(shared)).toBeNull();
    expect(again.orphans.map((o) => o.record?.savedAt)).toEqual(["2026-10-03T08:30:00.000Z"]);

    const old = stores();
    old.local.setItem(shared, JSON.stringify({ baseHash: "1", boxes: [] }));
    const unread = openTab(SCOPE, NOW, old, noShared);
    expect(unread.own).toBeNull();
    expect(unread.orphans.map((o) => [o.value, o.record])).toEqual([[{ baseHash: "1", boxes: [] }, null]]);
  });

  it("only a record of this layout and data format is one to restore", () => {
    expect(asRecord(record())).not.toBeNull();
    expect(asRecord(record({ format: FORMAT + 1 }))).toBeNull();
    expect(asRecord({ ...record(), v: 3 })).toBeNull();
    expect(asRecord({ baseHash: "1", boxes: [] })).toBeNull();
    expect(asRecord("not JSON")).toBeNull();
    // Missing stamps read as unknown, not as a reason to drop the edits.
    const { build: _b, savedAt: _s, conflicts: _c, ...bare } = record();
    expect(asRecord(bare)).toEqual(record({ build: "", savedAt: "", conflicts: [] }));
  });

  it("storage that can't be read or written finds nothing and fails quietly", () => {
    const blocked: Store = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
      removeItem: () => {},
    };
    const t = openTab(SCOPE, NOW, { local: blocked, session: blocked }, noShared);
    expect(t.own).toBeNull();
    expect(t.orphans).toEqual([]);
  });
});

describe("DraftWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const local = memory();
    const results: boolean[] = [];
    const w = new DraftWriter(draftKey(SCOPE, "aaaa0001"), SCOPE, { local, session: memory() }, { result: (ok) => results.push(ok) });
    let n = 0;
    w.track(() => record({ savedAt: String(++n) }));
    const writes = () => n;
    return { local, results, w, writes };
  };

  it("writes once editing pauses, not on every keystroke", () => {
    const { w, writes } = setup();
    for (let i = 0; i < 10; i++) {
      w.changed();
      vi.advanceTimersByTime(100);
    }
    expect(writes()).toBe(0);
    vi.advanceTimersByTime(300);
    expect(writes()).toBe(1);
  });

  it("writes at least every 2 s while editing goes on", () => {
    const { w, writes } = setup();
    for (let i = 0; i < 30; i++) {
      w.changed();
      vi.advanceTimersByTime(100);
    }
    expect(writes()).toBe(1);
    vi.advanceTimersByTime(400);
    expect(writes()).toBe(2);
  });

  it("flush writes what's waiting, and only that", () => {
    const { local, w, writes } = setup();
    w.flush();
    expect(writes()).toBe(0);
    w.changed();
    w.flush();
    expect(writes()).toBe(1);
    expect(local.data.has(draftKey(SCOPE, "aaaa0001"))).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(writes()).toBe(1);
  });

  it("nothing to keep removes the draft", () => {
    const { local, w } = setup();
    w.write();
    w.track(() => null);
    w.write();
    expect(local.data.size).toBe(0);
  });

  it("reports storage that refuses a write", () => {
    const { local, results, w } = setup();
    w.write();
    local.fail = true;
    w.write();
    local.fail = false;
    w.write();
    expect(results).toEqual([true, false, true]);
  });

  it("a write refused for size isn't covered up by the heartbeat: it's tried again, and only a write that goes through is kept", () => {
    const { local, results, w } = setup();
    let description = "short";
    w.track(() => record({ items: { "box:a": { old: { id: "a" }, now: { id: "a", description } } } }));
    w.write();
    local.limit = local.data.get(w.key)!.length + 100;
    description = "x".repeat(1000); // the user keeps typing: too big for what's left
    w.write();
    w.beat(NOW + 60_000); // a minute later: tried again, not just marked alive
    expect(results).toEqual([true, false, false]);
    expect(JSON.parse(local.getItem(w.key)!).items["box:a"].now.description).toBe("short");
    w.mark(NOW + 60_000);
    expect(results).toEqual([true, false, false]);

    local.limit = Infinity; // room again
    w.beat(NOW + 120_000);
    expect(results).toEqual([true, false, false, true]);
    expect(JSON.parse(local.getItem(w.key)!).items["box:a"].now.description).toBe(description);
  });

  it("flush tries a refused write again", () => {
    const { local, results, w } = setup();
    local.fail = true;
    w.write();
    local.fail = false;
    w.flush();
    expect(results).toEqual([false, true]);
  });

  it("marking alive or closed changes only that (and whose it is), keeping what's stored; it reports only a refusal", () => {
    const { local, results, w } = setup();
    w.write();
    local.setItem(w.key, JSON.stringify({ ...record(), page: w.page, extra: 1 }));
    w.mark(0);
    expect(JSON.parse(local.getItem(w.key)!)).toEqual({ ...record(), page: w.page, extra: 1, alive: 0 });
    local.fail = true;
    w.mark(NOW);
    local.fail = false;
    w.mark(NOW);
    expect(results).toEqual([true, false]);
  });

  it("marking alive writes the draft again if it's gone (another tab restored it while this one slept)", () => {
    const { local, w, writes } = setup();
    w.mark(0);
    expect(local.data.size).toBe(0);
    w.mark(NOW);
    expect(writes()).toBe(1);
    expect(local.data.has(w.key)).toBe(true);
    w.track(() => null); // nothing to keep: nothing written
    local.data.clear();
    w.mark(NOW);
    expect(local.data.size).toBe(0);
  });
});

describe("tabs that start with one id (a duplicated tab copies sessionStorage)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  /** Tab A, opened with no draft, and B, its duplicate: the same sessionStorage, so the same id. */
  const twins = () => {
    const local = memory();
    const a: Stores = { local, session: memory() };
    const atA = openTab(SCOPE, NOW, a, noShared);
    const b: Stores = { local, session: memory() };
    b.session.setItem("boxops-tab", a.session.getItem("boxops-tab")!);
    const atB = openTab(SCOPE, NOW, b, noShared);
    expect(atB.key).toBe(atA.key); // nothing to tell them apart yet
    const moved: string[] = [];
    const writer = (s: Stores, key: string, onMove?: (k: string) => void) =>
      new DraftWriter(key, SCOPE, s, { result: () => {}, move: onMove });
    const wa = writer(a, atA.key);
    const wb = writer(b, atB.key, (k) => moved.push(k));
    wa.track(() => record());
    wb.track(() => null);
    return { local, a, b, wa, wb, moved, key: atA.key };
  };

  it("the one with no changes never removes or marks the other's draft: it takes an id of its own", () => {
    const { local, b, wa, wb, moved, key } = twins();
    wa.write();
    wa.mark(0); // A closes
    wb.mark(NOW + 30_000); // B's heartbeat
    expect(JSON.parse(local.getItem(key)!).alive).toBe(0);
    wb.write(); // a poll, save or discard in B: nothing to keep
    expect(local.data.has(key)).toBe(true);
    expect(wb.key).not.toBe(key);
    expect(moved).toEqual([wb.key]);
    expect(b.session.getItem("boxops-tab")).toBe(wb.key.split(":").at(-1));
    // So B now offers A's draft, as one left by a tab that's gone.
    expect(isLeft(key, NOW + 60_000, local)).toBe(true);
    expect(openTab(SCOPE, NOW + 60_000, b, noShared).orphans.map((o) => o.key)).toEqual([key]);
  });

  it("when both have changes, whichever writes second moves to a key of its own", () => {
    const { local, wa, wb, key } = twins();
    wa.write();
    wb.track(() => record({ savedAt: "B's" }));
    wb.write();
    expect(wb.key).not.toBe(key);
    expect(JSON.parse(local.getItem(key)!).savedAt).toBe(record().savedAt);
    expect(JSON.parse(local.getItem(wb.key)!).savedAt).toBe("B's");
    // A keeps its key from then on.
    wa.write();
    wa.mark(NOW);
    expect(wa.key).toBe(key);
    expect(otherTabs(SCOPE, wb.key, NOW, local)).toBe(1);
  });

  it("a tab that took over its own draft on a reload keeps writing it", () => {
    const s = stores();
    s.session.setItem("boxops-tab", "aaaa0001");
    const key = draftKey(SCOPE, "aaaa0001");
    s.local.setItem(key, JSON.stringify({ ...record({ alive: 0 }), page: "0ld9a9e1" }));
    const t = openTab(SCOPE, NOW, s, noShared);
    const w = new DraftWriter(t.key, SCOPE, s, { result: () => {} }, "0ld9a9e1");
    w.track(() => record());
    w.mark(NOW);
    w.write();
    expect(w.key).toBe(key);
    expect(JSON.parse(s.local.getItem(key)!).page).toBe(w.page);
  });
});

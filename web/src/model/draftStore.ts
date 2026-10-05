// Unsaved drafts in localStorage, one per tab. A tab keeps its draft under its
// own key, `boxops-draft:<owner>/<repo>@<branch>:<tab id>`, and writes or
// removes only that one: never another tab's, except a draft left by a tab
// that's gone, once the user restores or discards it (and the old shared key,
// moved over once). The tab id is kept in sessionStorage, so a reload of the
// tab finds its own draft. A draft also says when its tab was last known to
// be open (a heartbeat; 0 once the tab has closed), which tells drafts in
// other open tabs (a notice) from drafts left by tabs that are gone (offered
// to restore, never taken silently).
//
// What's stored is a delta: only the changed items, each with the version it
// was changed from, stamped with the data format and the build that wrote it.
// Turning that into a draft and back (and rebasing it) is draft.ts's job.

import { FORMAT } from "./format";

/** Every key holding a draft starts with this (the crash screen looks for it too). */
export const DRAFT_PREFIX = "boxops-draft:";
/** This tab's id, in sessionStorage. */
const TAB_KEY = "boxops-tab";
/** A tab with a draft marks it alive this often while open. */
export const HEARTBEAT_MS = 60_000;
/**
 * A draft not marked alive for this long was left by a tab that's gone.
 * Browsers slow down timers in hidden tabs (to once a minute, in Chrome), so
 * this leaves room; a tab that's merely asleep looks gone, which at worst
 * offers its changes to a second tab too.
 */
export const STALE_MS = 5 * 60_000;
/** A pause in editing this long writes the draft… */
export const WRITE_AFTER_MS = 400;
/** …and so does editing this long without one. */
export const WRITE_AT_MOST_MS = 2000;
/** The layout of StoredDraft. The old shared-key drafts (the whole roadmap twice) had none. */
export const RECORD = 2;

/** A changed item: its version in the roadmap the draft was made against (none: we added it), and ours (none: we removed it). */
export interface DeltaItem {
  old?: unknown;
  now?: unknown;
}

/** What a tab stores. */
export interface StoredDraft {
  v: typeof RECORD;
  /** The data format (model/format.ts) of the BoxOps that wrote it: only that one can restore it. */
  format: number;
  /** The build that wrote it (__BOXOPS_BUILD__); "" when unknown. */
  build: string;
  /** The commit the draft was made against; "" when unknown. */
  baseCommit: string;
  /** When the draft was last written (ISO 8601). */
  savedAt: string;
  /** When its tab was last known to be open (ms since 1970); 0 once it closed. */
  alive: number;
  /** The changed items, by key: `box:<id>`, `dept:<id>`, `person:<id>`, `settings:settings`. */
  items: Record<string, DeltaItem>;
  /** Those of them that clash with someone else's save. */
  conflicts: string[];
}

/** Storage as used here: localStorage and sessionStorage in the app, stand-ins in tests. */
export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export interface Stores {
  local: Store;
  session: Store;
}

/** Storage that holds nothing and refuses every write: what a browser blocking site data gives us. */
const BLOCKED: Store = {
  length: 0,
  key: () => null,
  getItem: () => null,
  setItem: () => {
    throw new Error("Storage is blocked");
  },
  removeItem: () => {},
};

/** The browser's storage; reading `localStorage` itself throws when site data is blocked (Safari's "Block all cookies"). */
export function browserStores(): Stores {
  const get = (name: "localStorage" | "sessionStorage") => {
    try {
      return window[name] ?? BLOCKED;
    } catch {
      return BLOCKED;
    }
  };
  return { local: get("localStorage"), session: get("sessionStorage") };
}

/** Where a tab keeps its draft of the roadmap `scope` (`owner/repo@branch`). */
export const draftKey = (scope: string, tab: string) => `${DRAFT_PREFIX}${scope}:${tab}`;
/** Where every tab kept its draft before drafts were per tab. */
const sharedKey = (scope: string) => `${DRAFT_PREFIX}${scope}`;

const newTabId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");

/** A stored draft, as found. */
export interface FoundDraft {
  key: string;
  /** Its JSON, parsed; its text if it isn't JSON. */
  value: unknown;
  /** The record, if this BoxOps can restore it (this layout and data format); null for anything else. */
  record: StoredDraft | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `value` as a record this BoxOps can restore, or null. */
export function asRecord(value: unknown): StoredDraft | null {
  if (!isObject(value) || value.v !== RECORD || value.format !== FORMAT || !isObject(value.items)) return null;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    v: RECORD,
    format: FORMAT,
    build: text(value.build),
    baseCommit: text(value.baseCommit),
    savedAt: text(value.savedAt),
    alive: typeof value.alive === "number" ? value.alive : 0,
    items: value.items as Record<string, DeltaItem>,
    conflicts: Array.isArray(value.conflicts) ? value.conflicts.filter((k): k is string => typeof k === "string") : [],
  };
}

/** When a stored draft's tab was last known to be open; 0 if closed or unknown. */
const aliveAt = (value: unknown) => (isObject(value) && typeof value.alive === "number" ? value.alive : 0);
/** When a stored draft was last written; "" if unknown. */
export const savedAtOf = (value: unknown) => (isObject(value) && typeof value.savedAt === "string" ? value.savedAt : "");

/** A stored draft's JSON, parsed (its text if it isn't JSON); undefined if there's none. */
export function readValue(local: Store, key: string): unknown {
  return read(local, key)?.value;
}

function read(local: Store, key: string): FoundDraft | null {
  let text: string | null;
  try {
    text = local.getItem(key);
  } catch {
    return null;
  }
  if (text === null) return null;
  let value: unknown = text;
  try {
    value = JSON.parse(text);
  } catch {
    // Kept as text: still offered to download.
  }
  return { key, value, record: asRecord(value) };
}

/** Write `text` under `key` (null removes it); false if storage refused (full, or blocked). */
function put(local: Store, key: string, text: string | null): boolean {
  try {
    if (text === null) local.removeItem(key);
    else local.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

/** Remove a stored draft: this tab's own, or one left by a tab that's gone that the user restored or discarded. */
export function removeDraft(key: string, local = browserStores().local): void {
  put(local, key, null);
}

/** The keys of every stored draft of the roadmap `scope`, this tab's own included. */
function scopeKeys(local: Store, scope: string): string[] {
  const prefix = `${DRAFT_PREFIX}${scope}:`;
  const keys: string[] = [];
  try {
    for (let i = 0; i < local.length; i++) {
      const k = local.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
  } catch {
    // Storage blocked: there are none.
  }
  return keys;
}

/** What a tab finds when it opens a roadmap. */
export interface OpenedTab {
  /** This tab's key. */
  key: string;
  /** This tab's own draft, left by its previous page (a reload), if any. */
  own: FoundDraft | null;
  /** Drafts left by tabs that are gone, newest first. */
  orphans: FoundDraft[];
}

/**
 * Find this tab's key and drafts for the roadmap `scope`. A tab id whose draft
 * is alive belongs to another open tab (a duplicated tab copies
 * sessionStorage), so this tab takes a new one. The old shared draft, if any,
 * becomes this tab's own when it has none (it was every tab's before), or else
 * one left by a tab that's gone; `fromShared` turns it into a record (null if
 * it can't: then it's kept as it was, to download).
 */
export function openTab(scope: string, now: number, stores: Stores, fromShared: (value: unknown) => StoredDraft | null): OpenedTab {
  const { local, session } = stores;
  let tab: string | null = null;
  try {
    tab = session.getItem(TAB_KEY);
  } catch {
    // No sessionStorage: a new id every time.
  }
  if (tab && aliveAt(read(local, draftKey(scope, tab))?.value) > now - STALE_MS) tab = null;
  tab ??= takeNewTab(session);
  const key = draftKey(scope, tab);

  const shared = read(local, sharedKey(scope));
  if (shared) {
    const record = fromShared(shared.value);
    const into = record && !read(local, key) ? key : draftKey(scope, newTabId());
    // Closed (alive 0): to whoever opens it next, this tab included, it's one left behind.
    if (put(local, into, record ? JSON.stringify({ ...record, alive: 0 }) : JSON.stringify(shared.value))) put(local, sharedKey(scope), null);
  }

  const orphans = scopeKeys(local, scope)
    .filter((k) => k !== key)
    .flatMap((k) => read(local, k) ?? [])
    .filter((f) => aliveAt(f.value) <= now - STALE_MS)
    .sort((a, b) => savedAtOf(b.value).localeCompare(savedAtOf(a.value)));
  return { key, own: read(local, key), orphans };
}

/** A new id for this tab, kept for its session; returns it. */
function takeNewTab(session: Store): string {
  const tab = newTabId();
  try {
    session.setItem(TAB_KEY, tab);
  } catch {
    // Not kept: a reload won't find this tab's draft, and offers it as one left behind instead.
  }
  return tab;
}

/** A fresh key for this tab, when its own stored draft must stay as it is (one it can't restore, offered to download). */
export function newTabKey(scope: string, stores: Stores): string {
  return draftKey(scope, takeNewTab(stores.session));
}

/** How many other open tabs have unsaved changes to the roadmap `scope`. */
export function otherTabs(scope: string, key: string, now: number, local: Store): number {
  return scopeKeys(local, scope).filter((k) => k !== key && aliveAt(read(local, k)?.value) > now - STALE_MS).length;
}

/** Whether a stored draft is (still) one left by a tab that's gone: it's there, and not alive. */
export function isLeft(key: string, now: number, local: Store): boolean {
  const found = read(local, key);
  return found !== null && aliveAt(found.value) <= now - STALE_MS;
}

/**
 * Keeps one tab's draft in storage. A change is written a moment after
 * editing pauses (WRITE_AFTER_MS), or WRITE_AT_MOST_MS into a long burst,
 * never on every keystroke; `track()` says what to write then (null:
 * nothing to keep, so the key is removed). `onResult` hears whether each
 * write worked, since a full or blocked storage refuses them.
 */
export class DraftWriter {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private first = 0;
  private record: () => StoredDraft | null = () => null;

  constructor(
    readonly key: string,
    private readonly local: Store,
    private readonly onResult: (ok: boolean) => void,
  ) {}

  /** What to store from now on: the draft as it is now. */
  track(record: () => StoredDraft | null): void {
    this.record = record;
  }

  get pending(): boolean {
    return this.timer !== undefined;
  }

  /** The draft changed: write it soon. */
  changed(): void {
    const now = Date.now();
    if (this.timer === undefined) this.first = now;
    else clearTimeout(this.timer);
    this.timer = setTimeout(() => this.write(), Math.max(0, Math.min(WRITE_AFTER_MS, this.first + WRITE_AT_MOST_MS - now)));
  }

  /** Write now. */
  write(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const r = this.record();
    this.onResult(put(this.local, this.key, r === null ? null : JSON.stringify(r)));
  }

  /** Write now if a change is waiting. */
  flush(): void {
    if (this.timer !== undefined) this.write();
  }

  /** Mark the stored draft, if there is one, as alive now (`at`) or closed (0), leaving the rest as stored. */
  mark(at: number): void {
    const found = read(this.local, this.key);
    if (!found || !isObject(found.value)) return;
    this.onResult(put(this.local, this.key, JSON.stringify({ ...found.value, alive: at })));
  }
}

/** Offer `value` as a JSON file to save: `boxops-unsaved-changes-<YYYY-MM-DD>.json`. */
export function downloadJson(value: unknown): void {
  const json = JSON.stringify(value, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  const a = document.createElement("a");
  a.href = url;
  a.download = `boxops-unsaved-changes-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

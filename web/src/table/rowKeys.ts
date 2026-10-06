// React keys for the rows of the table and People: the same row keeps its
// key, so its DOM (and focus, and what's half typed in it) stays put while
// it's edited, re-sorted or moved, and two rows never share one. Box rows
// go by the box's code, which never changes (an unsaved box's id follows
// its title); PTO entries by the entry, as it's edited, given to someone
// else or moves up its owner's list; engineers by a key their row is given
// once, which follows them through renames.

import type { Box, Person, TimeOff } from "../model/types";
import { ptoKey, type PtoRef } from "../model/pto";

/**
 * Each box's row key, `b:<code>`. Codes are unique, but a roadmap can have
 * two boxes with one (the loader reports it and keeps both): the second is
 * `b:<code>~2`, in the order of `boxes`.
 */
export function boxKeys(boxes: readonly Box[]): Map<Box, string> {
  const seen = new Map<string, number>();
  const keys = new Map<Box, string>();
  for (const b of boxes) {
    const n = (seen.get(b.code) ?? 0) + 1;
    seen.set(b.code, n);
    keys.set(b, n === 1 ? `b:${b.code}` : `b:${b.code}~${n}`);
  }
  return keys;
}

/**
 * Keys that follow ids through renames (an unsaved engineer's id follows their
 * name): `rename` passes an id's key on to its new id. The old id keeps it too,
 * so undoing the rename finds the same key; but a key is never given to two
 * rows on the page at once, so a new engineer whose id is one a renamed
 * engineer had before ("new-engineer") gets a new key, not theirs.
 */
export class RowKeys {
  private byId = new Map<string, string>();
  /** Which id each key went to last. */
  private holder = new Map<string, string>();
  private count = 0;
  constructor(private prefix: string) {}

  rename(from: string, to: string): void {
    const key = this.byId.get(from);
    if (key === undefined || from === to) return;
    this.byId.set(to, key);
    this.holder.set(key, to);
  }

  /** The keys of these ids, the rows on the page now, in their order. */
  keys(ids: readonly string[]): string[] {
    const live = new Set(ids);
    const used = new Set<string>();
    return ids.map((id) => {
      let key = this.byId.get(id);
      const holder = key === undefined ? undefined : this.holder.get(key);
      if (key === undefined || used.has(key) || (holder !== id && holder !== undefined && live.has(holder))) {
        key = `${this.prefix}${++this.count}`;
        this.byId.set(id, key);
      }
      this.holder.set(key, id);
      used.add(key);
      return key;
    });
  }
}

/** One PTO entry (model/pto.ts's ptoEntries). */
interface Entry {
  person: Person;
  index: number;
  pto: TimeOff;
}

const samePto = (a: TimeOff, b: TimeOff) => a.start === b.start && a.end === b.end && (a.note ?? "") === (b.note ?? "");

/**
 * Keys for PTO entries, `p<n>`. An entry is a PTO object on a person: as long
 * as it's the same object (moved up its owner's list, given to someone else,
 * or back with an undo), it has the same key. An edit makes a new object:
 * `edited` says which entry is about to be replaced, and the new one takes
 * its key. One that comes back from a newer save as the same dates and note
 * in the same place keeps its key too.
 */
export class PtoKeys {
  private byObject = new WeakMap<TimeOff, string>();
  /** The entries last given keys, by place ("<person id>#<index>"). */
  private at = new Map<string, { key: string; pto: TimeOff }>();
  private expected = new Map<string, string>();
  private count = 0;

  /** The entry at `ref` is being changed: whatever's there next keeps `key`. */
  edited(ref: PtoRef, key: string): void {
    this.expected.set(ptoKey(ref), key);
  }

  /** The keys of these entries (every one there is), in their order. */
  keys(entries: readonly Entry[]): string[] {
    const used = new Set<string>();
    const at = new Map<string, { key: string; pto: TimeOff }>();
    const keys = entries.map((e) => {
      const place = ptoKey({ personId: e.person.id, index: e.index });
      let key = this.byObject.get(e.pto);
      if (key === undefined || used.has(key)) {
        const was = this.at.get(place);
        key = this.expected.get(place) ?? (was && samePto(was.pto, e.pto) ? was.key : undefined);
        if (key === undefined || used.has(key)) key = `p${++this.count}`;
        this.byObject.set(e.pto, key);
      }
      used.add(key);
      at.set(place, { key, pto: e.pto });
      return key;
    });
    this.at = at;
    this.expected.clear();
    return keys;
  }
}

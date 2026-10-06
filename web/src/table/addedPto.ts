// PTO added in this session, which the table shows though finished PTO is
// hidden (a week off this week, added on a weekend, has already ended). Kept
// by the app, not the table, so it lasts while another view is shown.

import type { Person, TimeOff } from "../model/types";
import { samePto } from "../model/pto";

/**
 * The PTO entries added in this session. An entry is a PTO object on a
 * person: as long as it's the same object (moved up its owner's list, given
 * to someone else, or back with an undo), it's still the one added. An edit
 * makes a new object, which `replace` marks too; and so does `follow` for one
 * that comes back from a save (ours or someone else's) as the same dates and
 * note in the same place.
 */
export class AddedPto {
  private marked = new WeakSet<TimeOff>();
  /** Whether anything's been added (until then, `follow` has nothing to look for). */
  private any = false;
  private last: readonly Person[] = [];

  add(pto: TimeOff): void {
    this.marked.add(pto);
    this.any = true;
  }

  /** `now` is put in place of `was` (an edit). */
  replace(was: TimeOff, now: TimeOff): void {
    if (this.marked.has(was)) this.marked.add(now);
  }

  has(pto: TimeOff): boolean {
    return this.marked.has(pto);
  }

  /** The roster now: an entry where one added was, last time, with its dates and note, is that one. */
  follow(people: readonly Person[]): void {
    if (people === this.last) return;
    if (this.any) {
      const before = new Map(this.last.map((p) => [p.id, p.pto ?? []]));
      for (const p of people) {
        p.pto?.forEach((t, i) => {
          const was = before.get(p.id)?.[i];
          if (was && was !== t && this.marked.has(was) && samePto(was, t)) this.marked.add(t);
        });
      }
    }
    this.last = people;
  }
}

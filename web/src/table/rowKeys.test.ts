import { describe, expect, it } from "vitest";
import type { Box, Person, TimeOff } from "../model/types";
import { boxKeys, PtoKeys, RowKeys } from "./rowKeys";

const box = (id: string, code: string): Box => ({ id, code, title: id, lane: "l", start: 0, end: 0, type: "t", fte: 1 });

describe("boxKeys", () => {
  it("keys a box by its code, a second box with the same code by the code and its place", () => {
    const [a, b, c] = [box("a", "A1F"), box("b", "K7P"), box("c", "A1F")];
    expect([...boxKeys([a, b, c]).values()]).toEqual(["b:A1F", "b:K7P", "b:A1F~2"]);
  });

  it("keeps a box's key when its id and title change", () => {
    const a = box("bx-1-new-box", "Q2R");
    const renamed = { ...a, id: "bx-1-hiring-plan", title: "Hiring plan" };
    expect(boxKeys([a]).get(a)).toBe(boxKeys([renamed]).get(renamed));
  });
});

describe("RowKeys", () => {
  it("never gives two engineers on the page one key, however ids are reused (#79)", () => {
    const keys = new RowKeys("r");
    // Add engineer ("new-engineer"), then name them Sam Lee.
    const [first] = keys.keys(["new-engineer"]);
    keys.rename("new-engineer", "sam-lee");
    expect(keys.keys(["sam-lee"])).toEqual([first]);
    // Add another: "new-engineer" again, beside Sam.
    const both = keys.keys(["new-engineer", "sam-lee"]);
    expect(both[1]).toBe(first);
    expect(both[0]).not.toBe(first);
    // Named Zoe Park, sorted after Sam: each keeps their own.
    keys.rename("new-engineer", "zoe-park");
    expect(keys.keys(["sam-lee", "zoe-park"])).toEqual([first, both[0]]);
    // And a third.
    const three = keys.keys(["new-engineer", "sam-lee", "zoe-park"]);
    expect(new Set(three).size).toBe(3);
    expect(three.slice(1)).toEqual([first, both[0]]);
  });

  it("gives a renamed id's key back when the rename is undone", () => {
    const keys = new RowKeys("r");
    const [k] = keys.keys(["new-engineer"]);
    keys.rename("new-engineer", "sam-lee");
    keys.keys(["sam-lee"]);
    expect(keys.keys(["new-engineer"])).toEqual([k]);
  });

  it("gives the same keys for the same ids, whatever their order", () => {
    const keys = new RowKeys("r");
    const k = keys.keys(["a", "b", "c"]);
    expect(keys.keys(["c", "a", "b"])).toEqual([k[2], k[0], k[1]]);
    expect(keys.keys(["a", "a"])[1]).not.toBe(k[0]);
  });
});

describe("PtoKeys", () => {
  const person = (id: string, pto: TimeOff[]): Person => ({ id, name: id, pto });
  const entries = (...people: Person[]) => people.flatMap((p) => (p.pto ?? []).map((pto, index) => ({ person: p, index, pto })));
  const [x, y, z]: TimeOff[] = [
    { start: 10, end: 12 },
    { start: 20, end: 22, note: "Holiday" },
    { start: 30, end: 31 },
  ];

  it("keeps an entry's key as it moves up its owner's list, or goes to someone else", () => {
    const keys = new PtoKeys();
    const [kx, ky, kz] = keys.keys(entries(person("sam", [x, y, z])));
    expect(new Set([kx, ky, kz]).size).toBe(3);
    // x removed: y and z move up a place.
    expect(keys.keys(entries(person("sam", [y, z])))).toEqual([ky, kz]);
    // y given to Alex, at the end of their list.
    expect(keys.keys(entries(person("sam", [z]), person("alex", [x, y])))).toEqual([kz, kx, ky]);
  });

  it("an edited entry keeps its key; a new one gets a new key", () => {
    const keys = new PtoKeys();
    const [kx, ky] = keys.keys(entries(person("sam", [x, y])));
    keys.edited({ personId: "sam", index: 1 }, ky);
    const moved = { ...y, start: 21 };
    const added = { start: 40, end: 40 };
    const next = keys.keys(entries(person("sam", [x, moved, added])));
    expect(next.slice(0, 2)).toEqual([kx, ky]);
    expect([kx, ky]).not.toContain(next[2]);
  });

  it("an entry that comes back from a newer save unchanged, in the same place, keeps its key", () => {
    const keys = new PtoKeys();
    const [kx, ky] = keys.keys(entries(person("sam", [x, y])));
    expect(keys.keys(entries(person("sam", [{ ...x }, { ...y, note: "Trip" }])))[0]).toBe(kx);
    expect(keys.keys(entries(person("sam", [x, y])))[1]).toBe(ky); // y itself is back (an undo)
  });

  it("never gives two entries one key", () => {
    const keys = new PtoKeys();
    const k = keys.keys(entries(person("sam", [x, x])));
    expect(k[0]).not.toBe(k[1]);
  });
});

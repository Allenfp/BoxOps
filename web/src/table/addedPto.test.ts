import { describe, expect, it } from "vitest";
import type { Person, TimeOff } from "../model/types";
import { AddedPto } from "./addedPto";

const person = (id: string, pto: TimeOff[]): Person => ({ id, name: id, pto });

describe("AddedPto", () => {
  it("knows an entry added through edits, a move to someone else and undo", () => {
    const added = new AddedPto();
    const other: TimeOff = { start: 10, end: 14 };
    const pto: TimeOff = { start: 20, end: 24 };
    added.add(pto);
    expect(added.has(pto)).toBe(true);
    expect(added.has(other)).toBe(false);
    // Edited: a new object in its place, and the old one still there to undo to.
    const noted = { ...pto, note: "Dentist" };
    added.replace(pto, noted);
    expect(added.has(noted)).toBe(true);
    expect(added.has(pto)).toBe(true);
    // Given to someone else, it's the same object.
    added.follow([person("a", [other]), person("b", [noted])]);
    expect(added.has(noted)).toBe(true);
    // An edit of another entry marks nothing.
    const moved = { ...other, start: 11 };
    added.replace(other, moved);
    expect(added.has(moved)).toBe(false);
  });

  it("follows an entry that comes back from a save as the same dates and note in the same place, and only that", () => {
    const added = new AddedPto();
    const other: TimeOff = { start: 10, end: 14 };
    const pto: TimeOff = { start: 20, end: 24, note: "Dentist" };
    added.add(pto);
    added.follow([person("a", [other, pto])]);
    // The save read back: new objects.
    const read = [person("a", [{ ...other }, { ...pto }])];
    added.follow(read);
    expect(added.has(read[0].pto![1])).toBe(true);
    expect(added.has(read[0].pto![0])).toBe(false);
    // Someone else's save changed it meanwhile, or put another in its place: not the one added.
    const theirs = [person("a", [{ ...other }, { ...pto, end: 25 }])];
    added.follow(theirs);
    expect(added.has(theirs[0].pto![1])).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { letter, shifted, shortcut } from "./keys";

describe("shortcut", () => {
  it("writes ⌘ on Apple's platforms and Ctrl elsewhere", () => {
    expect(shortcut("S", false, true)).toBe("⌘S");
    expect(shortcut("Z", true, true)).toBe("⇧⌘Z");
    expect(shortcut("S", false, false)).toBe("Ctrl+S");
    expect(shortcut("Z", true, false)).toBe("Ctrl+Shift+Z");
    expect(shifted("Tab", true)).toBe("⇧Tab");
    expect(shifted("Tab", false)).toBe("Shift+Tab");
  });
});

describe("letter", () => {
  it("is the key's own letter in a Latin layout, whatever its place", () => {
    expect(letter({ key: "s", code: "KeyS" })).toBe("s");
    expect(letter({ key: "Z", code: "KeyZ" })).toBe("z");
    // Dvorak: the key at QWERTY's S types O.
    expect(letter({ key: "o", code: "KeyS" })).toBe("o");
  });
  it("is the letter at the key's place on a US keyboard in another script", () => {
    expect(letter({ key: "ы", code: "KeyS" })).toBe("s");
    expect(letter({ key: "я", code: "KeyZ" })).toBe("z");
  });
  it("is null for a character typed with Alt or AltGr (Ctrl+Alt on Windows), as in Polish", () => {
    expect(letter({ key: "ś", code: "KeyS", altKey: true })).toBeNull();
    expect(letter({ key: "ż", code: "KeyZ", altKey: true })).toBeNull();
    expect(letter({ key: "ß", code: "KeyS", altKey: true })).toBeNull(); // Option+S on a Mac
    expect(letter({ key: "s", code: "KeyS", altKey: true })).toBe("s");
  });
  it("is null for keys that aren't letters", () => {
    expect(letter({ key: "Enter", code: "Enter" })).toBeNull();
    expect(letter({ key: "1", code: "Digit1" })).toBeNull();
    expect(letter({ key: ";", code: "KeyS" })).toBeNull();
  });
});

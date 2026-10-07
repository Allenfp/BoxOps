import { describe, expect, it } from "vitest";
import { visible } from "./terminal";
import { obeyed } from "./test-release";

describe("visible", () => {
  it("shows control characters as JSON's escapes, keeping tabs, and line feeds when asked", () => {
    const text = "a\u001b]0;title\u0007b\u001b[2K\rc\u0000d\u007fe\u009b31mf\u202eg\u2066h\ti\nj";
    const shown = "a\\u001b]0;title\\u0007b\\u001b[2K\\rc\\u0000d\\u007fe\\u009b31mf\\u202eg\\u2066h\ti";
    expect(visible(text)).toBe(`${shown}\\nj`);
    expect(visible(text, true)).toBe(`${shown}\nj`);
    expect(obeyed(text)).toHaveLength(9);
    expect(obeyed(visible(text))).toEqual([]);
    // Everything else stays as it is: accents, right-to-left text, emoji, the characters that only join or space others.
    const plain = "Zoë, שלום, 👩\u200d💻, a\u200bb\u00a0c, “quoted” — x\\u001b";
    expect(visible(plain)).toBe(plain);
  });

  it("keeps JSON JSON, meaning the same", () => {
    const value = { name: "x\u001b[31m\r\n\u0085\u202e\u007f\ty" };
    const json = JSON.stringify(value, null, 2);
    expect(obeyed(visible(json, true))).toEqual([]);
    expect(JSON.parse(visible(json, true))).toEqual(value);
  });
});

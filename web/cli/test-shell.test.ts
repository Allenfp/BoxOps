// The shells the tests paste printed commands into (cli/test-shell.ts): zsh
// as well as bash where it's installed, and where it must be (CI's unit
// tests: BOXOPS_TEST_ZSH=1), never left out without a word.

import { describe, expect, it } from "vitest";
import { SHELLS, shells, which } from "./test-shell";

const BASH = ["bash", "--noprofile", "--norc"];
const ZSH = ["zsh", "-f"];
const found = (name: string) => `/bin/${name}`;
const missing = () => undefined;

describe("the shells printed commands are pasted into", () => {
  it("are bash, and zsh where it's installed, each with no startup files", () => {
    expect(shells(found, {})).toEqual([BASH, ZSH]);
    expect(shells(missing, {})).toEqual([BASH]);
    expect(SHELLS).toEqual(which("zsh") ? [BASH, ZSH] : [BASH]);
  });

  it("must take zsh in where BOXOPS_TEST_ZSH=1 says it's there (CI's unit tests): without it, they fail", () => {
    expect(shells(found, { BOXOPS_TEST_ZSH: "1" })).toEqual([BASH, ZSH]);
    expect(() => shells(missing, { BOXOPS_TEST_ZSH: "1" })).toThrow(
      "BOXOPS_TEST_ZSH=1, but zsh isn’t installed: the commands printed for pasting would go untried in it",
    );
    expect(shells(missing, { BOXOPS_TEST_ZSH: "" })).toEqual([BASH]);
  });
});

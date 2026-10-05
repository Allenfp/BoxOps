import { describe, expect, it } from "vitest";
import { isTokenText, pastedToken } from "./token";

describe("a pasted token", () => {
  it("loses the spaces, invisible characters and quotes a document or a chat adds", () => {
    for (const pasted of [
      "github_pat_TEST",
      "  github_pat_TEST\n",
      "“github_pat_TEST”",
      "‘github_pat_TEST’",
      '"github_pat_TEST"',
      "`github_pat_TEST`",
      "github_pat_TEST\u200B",
      "\uFEFFgithub_pat_\u200DTEST\u00A0",
      " “github_pat_TEST\u2060” ",
    ]) {
      expect(pastedToken(pasted), JSON.stringify(pasted)).toBe("github_pat_TEST");
    }
  });

  it("is a token only if it's letters, digits and underscores", () => {
    for (const token of ["github_pat_11ABCDEFG0abcdefghijkl_MNOPQRSTUVWXYZ0123456789", "ghp_abcDEF123", "0123456789abcdef0123456789abcdef01234567"]) {
      expect(isTokenText(token), token).toBe(true);
    }
    for (const text of ["", "github_pat_TEST.", "github_pat_TEST, thanks", "github_pat_TÉST", "token: github_pat_TEST", "«github_pat_TEST»"]) {
      expect(isTokenText(pastedToken(text)), text).toBe(false);
    }
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withContentSecurityPolicy } from "./csp";

const page = (eol: string) =>
  ["<!doctype html>", "<html>", "  <head>", '    <meta charset="UTF-8" />', "    <script>", "      var a = 1;", "    </script>", "  </head>", "</html>", ""].join(eol);
const policy = (html: string) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)" \/>/.exec(withContentSecurityPolicy(html))?.[1];

describe("withContentSecurityPolicy", () => {
  it("allows each inline script by the hash of its text as a browser hashes it: CR LF and lone CR read as LF", () => {
    const sha = createHash("sha256").update("\n      var a = 1;\n    ").digest("base64");
    expect(policy(page("\n"))).toContain(`script-src 'self' 'sha256-${sha}';`);
    // A Windows checkout (CRLF), or a file saved with old Mac line ends, gets the same policy.
    expect(policy(page("\r\n"))).toBe(policy(page("\n")));
    expect(policy(page("\r"))).toBe(policy(page("\n")));
  });

  it("goes straight after <meta charset>, and needs one", () => {
    expect(withContentSecurityPolicy(page("\n")).split("\n").slice(3, 5)).toEqual([
      '    <meta charset="UTF-8" />',
      expect.stringMatching(/^ {4}<meta http-equiv="Content-Security-Policy" content="default-src 'none'; /),
    ]);
    expect(() => withContentSecurityPolicy("<head><script></script></head>")).toThrow("index.html has no <meta charset>");
  });
});

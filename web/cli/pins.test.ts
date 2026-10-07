import { describe, expect, it } from "vitest";
import { contractNumber, findPins, rewritePins } from "./pins";
import { retiredRunners } from "./runners";

const A = "a".repeat(40);
const B = "b".repeat(40);

const WORKFLOW = `jobs:
  build:
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - id: boxops
        uses: Allenfp/BoxOps@${A} # v0.1.0
        with:
          releases-file: x
  check:
    steps:
      - uses: "acme/boxops-mirror@${A}"   # v0.1.0 (our mirror)
      - name: Path B
        env:
          BOXOPS_ACTION: Allenfp/BoxOps@${A}
      - uses: ./build/release
      - uses: Allenfp/BoxOps@v0.1.0
`;

describe("findPins", () => {
  it("finds every BoxOps line by the repository's name, mirrors and Path B included", () => {
    expect(findPins(WORKFLOW)).toEqual([
      { line: 6, repo: "Allenfp/BoxOps", ref: A, tag: "v0.1.0", pathB: false },
      { line: 11, repo: "acme/boxops-mirror", ref: A, tag: "v0.1.0", pathB: false },
      { line: 14, repo: "Allenfp/BoxOps", ref: A, pathB: true },
      { line: 16, repo: "Allenfp/BoxOps", ref: "v0.1.0", pathB: false },
    ]);
  });

  it("reads CRLF files the same", () => {
    expect(findPins(WORKFLOW.replace(/\n/g, "\r\n"))).toEqual(findPins(WORKFLOW));
  });
});

describe("rewritePins", () => {
  it("moves every pin and its comment, and nothing else", () => {
    const out = rewritePins(WORKFLOW, B, "v0.2.0");
    expect(out.split("\n").filter((l, i) => l !== WORKFLOW.split("\n")[i])).toEqual([
      `        uses: Allenfp/BoxOps@${B} # v0.2.0`,
      `      - uses: "acme/boxops-mirror@${B}"   # v0.2.0 (our mirror)`,
      `          BOXOPS_ACTION: Allenfp/BoxOps@${B} # v0.2.0`,
      `      - uses: Allenfp/BoxOps@${B} # v0.2.0`,
    ]);
    expect(findPins(out).every((p) => p.ref === B && p.tag === "v0.2.0")).toBe(true);
  });

  it("keeps CRLF line ends, and can move to a mirror", () => {
    const crlf = WORKFLOW.replace(/\n/g, "\r\n");
    const out = rewritePins(crlf, B, "v0.2.0", "acme/boxops");
    expect(out.split("\r\n")).toHaveLength(crlf.split("\r\n").length);
    expect(out.includes("\n") && !/[^\r]\n/.test(out)).toBe(true);
    expect(findPins(out).map((p) => p.repo)).toEqual(["acme/boxops", "acme/boxops", "acme/boxops", "acme/boxops"]);
    expect(out).toContain(`uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\r\n`);
  });
});

describe("contractNumber", () => {
  it("reads the launcher's, the guard's and the AGENTS.md block's numbers", () => {
    expect(contractNumber("// BoxOps launcher (launcher: 3). Managed by BoxOps", "launcher")).toBe(3);
    expect(contractNumber("      - name: Check the GitHub Pages settings   # boxops-guard: 2\n", "guard")).toBe(2);
    expect(contractNumber("x\n<!-- boxops:begin block=4 — written by … -->\n", "block")).toBe(4);
    expect(contractNumber("nothing here", "block")).toBeNull();
  });
});

describe("retiredRunners", () => {
  const wf = `jobs:
  a:
    runs-on: ubuntu-20.04
  b:
    runs-on: [self-hosted, macos-13]
  c:
    runs-on:
      group: big
      labels: windows-2019
  d:
    strategy:
      matrix:
        os: [ubuntu-24.04, macos-12]
    runs-on: \${{ matrix.os }}
  e:
    runs-on: ubuntu-24.04
`;
  it("finds retired labels in runs-on and in matrix lists", () => {
    expect(retiredRunners(wf, "2026-10-06").map((w) => [w.line, w.label])).toEqual([
      [3, "ubuntu-20.04"],
      [5, "macos-13"],
      [9, "windows-2019"],
      [13, "macos-12"],
    ]);
  });

  it("says retiring, not retired, before the day", () => {
    expect(retiredRunners("jobs:\n  a:\n    runs-on: macos-13\n", "2025-11-01")[0].message).toBe(
      "runs on macos-13; GitHub retires it on 2025-12-04. Use macos-15.",
    );
  });

  it("ignores what isn't a workflow", () => {
    expect(retiredRunners("{{{", "2026-10-06")).toEqual([]);
    expect(retiredRunners("- a\n", "2026-10-06")).toEqual([]);
  });
});

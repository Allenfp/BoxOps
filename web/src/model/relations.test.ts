import { describe, expect, it } from "vitest";
import { parseDay } from "./dates";
import { deriveDeptCode, findViolations, fullCode, incoming, newBoxCode, parseCodeRef, RELATION_TYPES } from "./relations";
import type { Box, Department, RelationType } from "./types";

const d = (s: string) => parseDay(s)!;
const dept: Department = { id: "eng", code: "DE", name: "Data Engineering", color: "#000", order: 1, collapsed: false, lanes: [{ id: "e1", fte: 1 }] };
const box = (code: string, title: string, start: string, end: string, relations: Box["relations"] = []): Box => ({
  id: `bx-${code.toLowerCase()}`,
  code,
  title,
  lane: "e1",
  start: d(start),
  end: d(end),
  fte: 1,
  type: "project",
  status: "planned",
  relations,
});

describe("rules", () => {
  // a: Oct 5–16. b..h placed around it.
  const a = (type: RelationType, other: Box) => box("AAA", "Alpha", "2026-10-05", "2026-10-16", [{ type, box: other.code }]);
  const later = box("BBB", "Later", "2026-10-19", "2026-10-30");
  const touching = box("CCC", "Touching", "2026-10-16", "2026-10-30");
  const around = box("DDD", "Around", "2026-10-01", "2026-10-31");
  const inside = box("EEE", "Inside", "2026-10-07", "2026-10-09");
  const sameStart = box("FFF", "Same start", "2026-10-05", "2026-10-09");

  const holds = (type: RelationType, other: Box) => RELATION_TYPES[type].holds(a(type, other), other);

  it("each kind holds or breaks as its name says", () => {
    expect(holds("before", later)).toBe(true);
    expect(holds("before", touching)).toBe(false); // ends the day the other starts
    expect(holds("after", later)).toBe(false);
    expect(holds("during", around)).toBe(true);
    expect(holds("during", inside)).toBe(false);
    expect(holds("starts_with", sameStart)).toBe(true);
    expect(holds("ends_with", sameStart)).toBe(false);
    expect(holds("overlaps", inside)).toBe(true);
    expect(holds("overlaps", later)).toBe(false);
    expect(holds("apart", later)).toBe(true);
    expect(holds("apart", touching)).toBe(false);
  });

  it("explains broken rules in plain words with dates", () => {
    const v = findViolations([a("before", touching), touching], [dept]);
    expect(v.map((x) => x.message)).toEqual([
      "DE-AAA Alpha should finish before DE-CCC Touching starts, but it ends 2026-10-16 and the other starts 2026-10-16.",
    ]);
    const during = findViolations([box("AAA", "Alpha", "2026-09-28", "2026-10-21", [{ type: "during", box: "EEE" }]), inside], [dept]);
    expect(during[0].message).toBe(
      "DE-AAA Alpha should happen during DE-EEE Inside, but it starts 7 working days early and ends 8 working days late (the other runs 2026-10-07 – 2026-10-09).",
    );
    expect(findViolations([a("before", later), later], [dept])).toEqual([]);
  });

  it("finds rules pointing at a box, and ignores ones to missing boxes", () => {
    const boxes = [a("before", later), later];
    expect(incoming(boxes, "BBB").map((x) => [x.box.code, x.relation.type])).toEqual([["AAA", "before"]]);
    expect(findViolations([box("AAA", "Alpha", "2026-10-05", "2026-10-09", [{ type: "before", box: "ZZZ" }])], [dept])).toEqual([]);
  });
});

describe("codes", () => {
  it("prefixes a box's code with its department's", () => {
    expect(fullCode(box("A1F", "x", "2026-10-05", "2026-10-05"), [dept])).toBe("DE-A1F");
  });

  it("reads codes with or without the prefix", () => {
    expect(parseCodeRef("de-a1f")).toBe("A1F");
    expect(parseCodeRef(" A1F ")).toBe("A1F");
  });

  it("makes new box codes that aren't taken and are easy to read", () => {
    let i = 0;
    const seq = [0, 0, 0, 0, 0, 1]; // first candidate "AAA" is taken, then "AAB"
    expect(newBoxCode(new Set(["AAA"]), () => seq[i++] / 32)).toBe("AAB");
    for (let n = 0; n < 500; n++) expect(newBoxCode(new Set())).toMatch(/^[A-HJ-NP-Z2-9]{3}$/); // never 0, O, 1, I
    // Never a code YAML reads as a number: "234" and "2E4" are skipped, "2EA" is fine.
    const digits = [24, 25, 26, 24, 4, 26, 24, 4, 0];
    let k = 0;
    expect(newBoxCode(new Set(), () => digits[k++] / 32)).toBe("2EA");
  });

  it("derives department codes from names", () => {
    expect(deriveDeptCode("Data Engineering", new Set())).toBe("DE");
    expect(deriveDeptCode("Analytics", new Set())).toBe("AN");
    expect(deriveDeptCode("ML Platform", new Set())).toBe("MP");
    expect(deriveDeptCode("Data Eng", new Set(["DE"]))).toBe("DE2");
  });
});

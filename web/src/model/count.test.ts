import { describe, expect, it } from "vitest";
import { counted, thousands } from "./count";

describe("counts", () => {
  it("have a thousands separator", () => {
    expect(thousands(0)).toBe("0");
    expect(thousands(999)).toBe("999");
    expect(thousands(2000)).toBe("2,000");
    expect(thousands(1234567)).toBe("1,234,567");
  });

  it("go with the noun, one or many", () => {
    expect(counted(1, "box", "boxes")).toBe("1 box");
    expect(counted(0, "box", "boxes")).toBe("0 boxes");
    expect(counted(2000, "box", "boxes")).toBe("2,000 boxes");
    expect(counted(1500, "change")).toBe("1,500 changes");
  });
});

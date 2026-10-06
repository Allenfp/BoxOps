import { describe, expect, it } from "vitest";
import { drawn, layout, rowAt, runs, usual, windowRows } from "./windowMath";

/** Rows of these heights. */
const tops = (...heights: number[]) => layout(heights.length, (i) => heights[i]);
/** n rows, each 50 px. */
const even = (n: number) => layout(n, () => 50);

describe("layout", () => {
  it("adds up the heights: each row's top, then the total", () => {
    expect([...tops(37, 50, 50, 34)]).toEqual([0, 37, 87, 137, 171]);
    expect([...tops()]).toEqual([0]);
  });
});

describe("rowAt", () => {
  it("finds the row a pixel is in, edges included", () => {
    const t = tops(37, 50, 50, 34);
    expect(rowAt(t, 0)).toBe(0);
    expect(rowAt(t, 36.9)).toBe(0);
    expect(rowAt(t, 37)).toBe(1);
    expect(rowAt(t, 136)).toBe(2);
    expect(rowAt(t, 137)).toBe(3);
    expect(rowAt(t, 170)).toBe(3);
  });

  it("before the first row it's the first, past the last the last; none when there are no rows", () => {
    expect(rowAt(even(3), -100)).toBe(0);
    expect(rowAt(even(3), 1e6)).toBe(2);
    expect(rowAt(even(1), 25)).toBe(0);
    expect(rowAt(tops(), 0)).toBe(-1);
  });
});

describe("windowRows", () => {
  it("draws the rows reaching into the pixels, a row that only touches the bottom edge not", () => {
    expect(windowRows(even(100), 0, 100)).toEqual([[0, 2]]);
    expect(windowRows(even(100), 25, 101)).toEqual([[0, 3]]);
    expect(windowRows(even(100), 4950, 6000)).toEqual([[99, 100]]);
  });

  it("draws nothing for pixels outside the rows, or none", () => {
    expect(windowRows(even(10), 600, 900)).toEqual([]);
    expect(windowRows(even(10), -300, -10)).toEqual([]);
    expect(windowRows(even(10), 100, 100)).toEqual([]);
    expect(windowRows(tops(), 0, 900)).toEqual([]);
  });

  it("adds each pinned row with its neighbours, merging what meets or overlaps", () => {
    expect(windowRows(even(100), 0, 100, [50])).toEqual([[0, 2], [49, 52]]);
    expect(windowRows(even(100), 0, 100, [2])).toEqual([[0, 4]]);
    expect(windowRows(even(100), 0, 100, [3])).toEqual([[0, 5]]);
    expect(windowRows(even(100), 0, 100, [99, 70, 70])).toEqual([[0, 2], [69, 72], [98, 100]]);
    // At the ends, and out of range (gone since).
    expect(windowRows(even(5), 1000, 2000, [0, 4, 7, -1])).toEqual([[0, 2], [3, 5]]);
  });
});

describe("runs", () => {
  it("covers a group with its drawn rows and spacers as tall as the rest", () => {
    const t = even(20);
    // A group of rows 5-14, with rows 0-6 and 10-11 drawn.
    expect(runs(t, 5, 15, [[0, 7], [10, 12]])).toEqual([{ rows: [5, 7] }, { gap: 150 }, { rows: [10, 12] }, { gap: 150 }]);
    // Nothing drawn: one spacer. Everything: one run.
    expect(runs(t, 5, 15, [[16, 18]])).toEqual([{ gap: 500 }]);
    expect(runs(t, 5, 15, [[0, 20]])).toEqual([{ rows: [5, 15] }]);
  });

  it("adds up to the group's height, whatever's drawn", () => {
    const t = tops(37, 50, 50, 34, 34, 30, 37, 50, 32);
    const height = (r: ReturnType<typeof runs>) => r.reduce((sum, run) => sum + ("gap" in run ? run.gap : t[run.rows[1]] - t[run.rows[0]]), 0);
    for (const ranges of [[], [[0, 9]], [[2, 3]], [[0, 1], [4, 6], [8, 9]]] as [number, number][][]) {
      expect(height(runs(t, 0, 6, ranges))).toBe(t[6]);
      expect(height(runs(t, 6, 9, ranges))).toBe(t[9] - t[6]);
    }
  });

  it("an empty group has no runs", () => {
    expect(runs(even(5), 3, 3, [[0, 5]])).toEqual([]);
  });
});

describe("drawn", () => {
  it("says whether a row is in the ranges", () => {
    expect(drawn([[0, 2], [5, 7]], 1)).toBe(true);
    expect(drawn([[0, 2], [5, 7]], 2)).toBe(false);
    expect(drawn([[0, 2], [5, 7]], 6)).toBe(true);
    expect(drawn([], 0)).toBe(false);
  });
});

describe("usual", () => {
  it("is the most common height, the smaller of two as common, none of none", () => {
    expect(usual([52, 52, 70, 52, 34])).toBe(52);
    expect(usual([70, 52])).toBe(52);
    expect(usual([])).toBeUndefined();
  });
});

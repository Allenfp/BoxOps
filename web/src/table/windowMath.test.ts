import { describe, expect, it } from "vitest";
import { anchorRow, drawn, heightLearner, layout, rowAt, runs, usual, windowRows } from "./windowMath";

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
    expect(runs(t, 5, 15, [[0, 7], [10, 12]])).toEqual([
      { rows: [5, 7] },
      { gap: 150, stands: [7, 10] },
      { rows: [10, 12] },
      { gap: 150, stands: [12, 15] },
    ]);
    // Nothing drawn: one spacer. Everything: one run.
    expect(runs(t, 5, 15, [[16, 18]])).toEqual([{ gap: 500, stands: [5, 15] }]);
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

describe("heightLearner", () => {
  // A department as the table has it: its heading, three boxes, two PTO entries and Add PTO.
  const keys = ["g", "b1", "b2", "b3", "p1", "p2", "add"];
  const kinds = ["group", "box", "box", "box", "pto", "pto", "add-pto"];
  const index = new Map(keys.map((k, i) => [k, i]));
  // Comfortable-density heights; the rows measure less (compact).
  const defaults = { group: 36, box: 53, pto: 33, "add-pto": 32 };
  const heights = (tops: Float64Array) => [...tops.subarray(1)].map((t, i) => t - tops[i]);
  /** A table's layouts in turn, with these rows drawn (key, height) each time. */
  const table = () => {
    const learner = heightLearner();
    return (measured: [string, number][], density = "compact") => heights(learner({ keys, kinds, index, measured: new Map(measured), defaults, density }));
  };

  it("a row drawn is as tall as it measured; one that isn't, as rows of its kind drawn usually are; a kind never drawn, its default", () => {
    expect(table()([["b1", 49], ["b2", 49], ["b3", 70], ["p1", 29]])).toEqual([36, 49, 49, 70, 29, 29, 32]);
  });

  it("a kind none of whose rows is drawn now keeps the height it was learned to have, not its default", () => {
    const layout = table();
    layout([["g", 32], ["b1", 49], ["p1", 29], ["add", 28]]);
    // Scrolled on: only boxes drawn (one of them being edited, taller).
    expect(layout([["b2", 49], ["b3", 70]])).toEqual([32, 49, 49, 70, 29, 29, 28]);
    expect(layout([])).toEqual([32, 49, 49, 49, 29, 29, 28]);
    // Rows of a kind drawn again, at another height: that's learned instead.
    expect(layout([["p2", 30]])).toEqual([32, 49, 49, 49, 30, 30, 28]);
  });

  it("forgets what it learned in another density", () => {
    const layout = table();
    layout([["g", 32], ["b1", 49], ["p1", 29], ["add", 28]]);
    expect(layout([["b1", 53]], "comfortable")).toEqual([36, 53, 53, 53, 33, 33, 32]);
  });

  it("leaves out rows no longer in the table; no rows, no height", () => {
    expect(table()([["gone", 99], ["b1", 49]])).toEqual([36, 49, 49, 49, 33, 33, 32]);
    expect([...heightLearner()({ keys: [], kinds: [], index: new Map(), measured: new Map(), defaults })]).toEqual([0]);
  });
});

describe("anchorRow", () => {
  /** Where each of these keys is. */
  const at = (...keys: string[]) => new Map(keys.map((k, i) => [k, i]));
  const keys = ["a", "b", "c", "d", "e", "f"];
  const t = even(6); // each row 50 px

  it("is the row at the pixel, wherever it is now, as rows are added, removed or reordered around it", () => {
    expect(anchorRow(keys, t, 120, at(...keys))).toEqual({ was: 2, is: 2 });
    expect(anchorRow(keys, t, 120, at("x", "a", "b", "c", "d", "e", "f"))).toEqual({ was: 2, is: 3 });
    expect(anchorRow(keys, t, 120, at("b", "c", "d", "e", "f"))).toEqual({ was: 2, is: 1 });
    expect(anchorRow(keys, t, 120, at("b", "a", "c", "e", "d", "f"))).toEqual({ was: 2, is: 2 });
    // Rows added just after it, or just before it, leave it where it is among the rest.
    expect(anchorRow(keys, t, 120, at("a", "b", "c", "x", "y", "d", "e", "f"))).toEqual({ was: 2, is: 2 });
    expect(anchorRow(keys, t, 120, at("a", "b", "x", "c", "d", "e", "f"))).toEqual({ was: 2, is: 3 });
  });

  it("gone, it's the first row after it that's still there", () => {
    expect(anchorRow(keys, t, 120, at("a", "b", "e", "f"))).toEqual({ was: 4, is: 2 });
  });

  it("sorted elsewhere by the change (earlier, or later), it's the next row that's in its place", () => {
    expect(anchorRow(keys, t, 120, at("c", "a", "b", "d", "e", "f"))).toEqual({ was: 3, is: 3 });
    // Later: the row after it is out of place against it too, so the one after that (which moved as far).
    expect(anchorRow(keys, t, 120, at("a", "b", "d", "e", "f", "c"))).toEqual({ was: 4, is: 3 });
    expect(anchorRow(keys, t, 120, at("a", "b", "d", "c", "e", "f"))).toEqual({ was: 4, is: 4 });
  });

  it("none, with no rows, or none of those from the pixel on still there", () => {
    expect(anchorRow([], tops(), 0, at())).toBeNull();
    expect(anchorRow(keys, t, 120, at("a", "b"))).toBeNull();
  });
});

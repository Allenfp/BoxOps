// Which rows of a long table to put on the page: those near the screen, and
// a few others wherever they are (the one being edited, one about to be
// focused), each with its neighbours. The rest are spacers as tall as the
// rows they stand for. Plain arithmetic on row heights, so it's unit-tested
// without a browser; useWindowedRows.ts does the browser's part.

/** Rows `from` up to (not including) `to`. */
export type Range = readonly [from: number, to: number];

/** Inside one group of rows (a department's <tbody>): rows to draw, or a spacer as tall as the rows it stands for. */
export type Run = { rows: Range } | { gap: number; stands: Range };

/** Each row's top, counted from the first row's (`tops[0]` is 0), then the height of them all (`tops[n]`). */
export function layout(n: number, height: (i: number) => number): Float64Array {
  const tops = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) tops[i + 1] = tops[i] + height(i);
  return tops;
}

/** The row at `y` (pixels from the first row's top): the first or last if `y` is before or after them all; -1 if there are none. */
export function rowAt(tops: Float64Array, y: number): number {
  const n = tops.length - 1;
  if (n <= 0) return -1;
  let lo = 0;
  let hi = n - 1;
  // The last row whose top is at or above y.
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The rows to draw, in order and without overlaps: those that reach into
 * pixels `top` to `bottom`, and each of `pinned` (indexes; any out of range
 * are left out) with the rows either side of it, so Tab and Shift+Tab from
 * it always have a row to go to.
 */
export function windowRows(tops: Float64Array, top: number, bottom: number, pinned: readonly number[] = []): Range[] {
  const n = tops.length - 1;
  const ranges: [number, number][] = [];
  if (n <= 0) return ranges;
  if (bottom > top && bottom > 0 && top < tops[n]) {
    const first = rowAt(tops, top);
    // The row whose top is at or past `bottom` isn't in view: up to the one before it.
    let last = rowAt(tops, bottom);
    if (tops[last] >= bottom && last > first) last--;
    ranges.push([first, last + 1]);
  }
  for (const i of pinned) if (i >= 0 && i < n) ranges.push([Math.max(0, i - 1), Math.min(n, i + 2)]);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Rows `start` to `end` (one group's) as runs: the parts of `ranges` inside it, and spacers between them. */
export function runs(tops: Float64Array, start: number, end: number, ranges: readonly Range[]): Run[] {
  const out: Run[] = [];
  let at = start;
  for (const [from, to] of ranges) {
    const a = Math.max(from, start);
    const b = Math.min(to, end);
    if (a >= b) continue;
    if (a > at) out.push({ gap: tops[a] - tops[at], stands: [at, a] });
    out.push({ rows: [a, b] });
    at = b;
  }
  if (at < end) out.push({ gap: tops[end] - tops[at], stands: [at, end] });
  return out;
}

/** Whether row `i` is drawn by these ranges. */
export const drawn = (ranges: readonly Range[], i: number): boolean => ranges.some(([from, to]) => i >= from && i < to);

/** The most common of these heights (the smallest, of those as common): what a row of a kind usually measures. */
export function usual(heights: Iterable<number>): number | undefined {
  const counts = new Map<number, number>();
  for (const h of heights) counts.set(h, (counts.get(h) ?? 0) + 1);
  let best: number | undefined;
  let most = 0;
  for (const [h, n] of counts) {
    if (n > most || (n === most && h < best!)) {
      best = h;
      most = n;
    }
  }
  return best;
}

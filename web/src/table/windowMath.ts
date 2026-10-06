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

/**
 * The row to keep in place, the view not moving, across a change to the rows:
 * of the rows at `y` and after it before the change (`keys`, laid out as
 * `tops`), the first that's still there (`now`: where each key is now) and
 * still where it was among the rows around it, after the row before it and
 * before the one after (those still there). Not one an edit, an undo or
 * someone else's save has sorted elsewhere: the view would follow it there.
 * Its index before the change and now; null if there's none.
 */
export function anchorRow(keys: readonly string[], tops: Float64Array, y: number, now: ReadonlyMap<string, number>): { was: number; is: number } | null {
  /** Where the nearest row to `i` that's still there, going `step`, is now; past either end if none is. */
  const near = (i: number, step: 1 | -1) => {
    for (let k = i + step; k >= 0 && k < keys.length; k += step) {
      const j = now.get(keys[k]);
      if (j !== undefined) return j;
    }
    return step * Infinity;
  };
  for (let i = rowAt(tops, y); i >= 0 && i < keys.length; i++) {
    const j = now.get(keys[i]);
    if (j !== undefined && near(i, -1) < j && j < near(i, 1)) return { was: i, is: j };
  }
  return null;
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

/**
 * Lays rows out (each row's top, as layout() gives them) at the heights
 * they're taken to be, learning as it goes what each kind of row usually
 * measures: one per table, given each layout's rows in turn. A row that's
 * drawn is as tall as it measured (`measured`, by key). One that isn't is as
 * tall as rows of its kind usually are, by those drawn now, or else by those
 * drawn last (a kind none of whose rows is drawn keeps its height rather
 * than going back to its default), or else as `defaults` says (40 px if it
 * doesn't). What's learned is forgotten when `density` changes: every kind
 * of row is another height in each. `index` is where each key is in `keys`.
 */
export function heightLearner(): (o: {
  keys: readonly string[];
  kinds: readonly string[];
  index: ReadonlyMap<string, number>;
  measured: ReadonlyMap<string, number>;
  defaults: Readonly<Record<string, number>>;
  density?: string;
}) => Float64Array {
  let learned = new Map<string, number>();
  let learnedIn: string | undefined;
  return ({ keys, kinds, index, measured, defaults, density }) => {
    if (density !== learnedIn) [learned, learnedIn] = [new Map(), density];
    const byKind = new Map<string, number[]>();
    for (const [key, h] of measured) {
      const i = index.get(key);
      if (i === undefined) continue;
      const list = byKind.get(kinds[i]) ?? [];
      list.push(h);
      byKind.set(kinds[i], list);
    }
    for (const [kind, hs] of byKind) learned.set(kind, usual(hs)!);
    return layout(keys.length, (i) => measured.get(keys[i]) ?? learned.get(kinds[i]) ?? defaults[kinds[i]] ?? 40);
  };
}

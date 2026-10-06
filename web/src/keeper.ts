/**
 * Returns what it's given, or what it returned last time while that's the
 * `same`: a value made again on every change (a map of names, say) that keeps
 * its identity while it says the same, so what's memoized on it isn't made
 * again. One per component (`useState(() => keeper(…))`).
 */
export function keeper<T>(same: (a: T, b: T) => boolean): (next: T) => T {
  let last: { value: T } | null = null;
  return (next) => {
    if (!last || !same(last.value, next)) last = { value: next };
    return last.value;
  };
}

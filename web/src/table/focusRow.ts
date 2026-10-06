// Keyboard focus in the table and People, whose rows are drawn only near
// the screen on a big roadmap: which row focus is in, and keeping what has
// focus clear of the sticky header and title column (WCAG 2.4.11).

/** The key of the row `el` is in (`tr[data-row-key]`), if it's in one. */
export const rowKeyOf = (el: EventTarget | null): string | null =>
  (el instanceof Element && el.closest<HTMLElement>("tr[data-row-key]")?.dataset.rowKey) || null;

/**
 * Scroll `scroller` so `el` isn't under its sticky header, or its sticky
 * title column (`td.col-title`, which stays put while the rest scrolls
 * sideways), or past its edges. WebKit ignores `scroll-padding` when Tab
 * moves focus, and `focus()` centres what it scrolls to, so this is done for
 * every focus in it, by hand. Not for what's in a calendar or the Engineers
 * list (fixed on the screen, over the table).
 */
export function keepInView(scroller: HTMLElement | null, el: EventTarget | null): void {
  if (!scroller || !(el instanceof HTMLElement) || el.closest(".calendar, .picker-menu")) return;
  const view = scroller.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const headH = scroller.querySelector("thead")?.getBoundingClientRect().height ?? 0;
  const top = view.top + headH;
  const bottom = view.top + scroller.clientHeight;
  if (r.top < top) scroller.scrollTop -= top - r.top;
  else if (r.bottom > bottom) scroller.scrollTop += Math.min(r.bottom - bottom, r.top - top);
  const sticky = el.closest("tr")?.querySelector("td.col-title");
  if (!sticky || sticky.contains(el)) return;
  const left = sticky.getBoundingClientRect().right;
  const right = view.left + scroller.clientWidth;
  if (r.left < left) scroller.scrollLeft -= left - r.left;
  else if (r.right > right) scroller.scrollLeft += Math.min(r.right - right, r.left - left);
}

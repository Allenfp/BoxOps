import { type ReactNode, type Ref, type SelectHTMLAttributes, useState } from "react";

/** A select with more options than this lists only the chosen one until it's used. */
export const LAZY_OPTIONS_ABOVE = 30;

/**
 * A <select> whose long list of options (the table's Lane, with every lane
 * of every department, in each of its rows) is only put on the page once
 * it's about to be used: until then it holds just the chosen option, which
 * shows the same. A browser lays out every option of a closed select, so
 * rows of them cost more than everything else in a big table. It fills on
 * a press (before the list opens: React updates the page before the
 * browser's own action), on focus (before a key can choose) and on a key,
 * and stays filled: one select's options cost little once laid out (it's
 * a whole table's at once that's slow), and a row scrolled away or
 * filtered out leaves the page with them. With `count` options or fewer,
 * they're all there from the start. Browser tests choose with
 * e2e/helpers.ts's choose(), which focuses it first: Playwright's
 * selectOption doesn't.
 */
export function LazySelect({
  options,
  chosen,
  count,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  ref?: Ref<HTMLSelectElement>;
  /** Every option (and optgroup). */
  options: ReactNode;
  /** The chosen option alone, as it is in `options`. */
  chosen: ReactNode;
  /** How many options `options` has. */
  count: number;
}) {
  const [filled, setFilled] = useState(count <= LAZY_OPTIONS_ABOVE);
  const fill = () => setFilled(true);
  return (
    <select
      {...rest}
      onPointerDown={(e) => {
        fill();
        rest.onPointerDown?.(e);
      }}
      onMouseDown={(e) => {
        fill();
        rest.onMouseDown?.(e);
      }}
      onFocus={(e) => {
        fill();
        rest.onFocus?.(e);
      }}
      onKeyDown={(e) => {
        fill();
        rest.onKeyDown?.(e);
      }}
    >
      {filled || count <= LAZY_OPTIONS_ABOVE ? options : chosen}
    </select>
  );
}

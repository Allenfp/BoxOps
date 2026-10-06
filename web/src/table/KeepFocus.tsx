import { Component, type ReactNode, type RefObject } from "react";
import { focusLost, tabbable } from "../a11y/focus";
import { keepInView } from "./focusRow";

/** Where focus was: its row's key and place, the cell it was in (by class), and the control (by name or class). */
interface Spot {
  row: string;
  /** The row's place in the rows as they were, and those rows' keys. */
  at: number;
  keys: readonly string[];
  cell: string;
  label: string | null;
  className: string;
}

interface Props {
  /** The table (rows are `tr[data-row-key]`). */
  table: RefObject<HTMLElement | null>;
  /** Every row's key, in order, drawn or not. Department headings' start with "g:". */
  keys: readonly string[];
  children: ReactNode;
}

/**
 * Keeps focus in a table whose rows move: one sorted elsewhere, moved to
 * another department (and drawn anew there), taken off the page and back, or
 * deleted. Browsers drop focus on <body> when a focused element is moved or
 * removed (WebKit and Firefox without a blur), so each change drawn is
 * checked: if focus was in a row before it and is lost after it, it goes
 * back to the same control in the same row, wherever that is now; if the
 * row is gone, to the same column in the next row of its department, else
 * the row before, else the department's heading. Put somewhere else in its
 * row (or its heading) for want of the control itself (a save disabled it, or
 * took the row's Delete away, for a while), focus goes back to that control
 * once a later change brings it back, if it's still where it was put. A class
 * component, as only one sees the page just before a change reaches it
 * (getSnapshotBeforeUpdate).
 */
export class KeepFocus extends Component<Props> {
  /** Where focus was put for want of the control that had it, by its row and name: it goes back once that's there again. */
  private standIn: { el: HTMLElement; row: string; label: string } | null = null;

  getSnapshotBeforeUpdate(before: Props): Spot | null {
    const el = document.activeElement;
    const row = el instanceof HTMLElement && this.props.table.current?.contains(el) ? el.closest<HTMLElement>("tr[data-row-key]") : null;
    if (!el || !row) return null;
    const key = row.dataset.rowKey!;
    return {
      row: key,
      at: before.keys.indexOf(key),
      keys: before.keys,
      cell: el.closest("td")?.className ?? "",
      label: el.getAttribute("aria-label"),
      className: el.classList[0] ?? "",
    };
  }

  componentDidUpdate(_before: Props, _state: unknown, spot: Spot | null): void {
    const table = this.props.table.current;
    if (!table) return;
    const row = (key: string) => table.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(key)}"]`);
    const standIn = this.standIn;
    if (standIn && document.activeElement !== standIn.el) this.standIn = null;
    else if (standIn) {
      const there = row(standIn.row);
      const back = there && tabbable(there).find((el) => el.getAttribute("aria-label") === standIn.label);
      if (back) {
        this.standIn = null;
        back.focus({ preventScroll: true });
        keepInView(table.closest(".table-scroll"), back);
        return;
      }
    }
    if (!spot || !focusLost()) return;
    const here = row(spot.row);
    let to = here && (control(here, spot, true) ?? tabbable(here)[0]);
    // Gone: the same column in the department's next row, else the one before, else its heading.
    const around = (step: 1 | -1) => {
      for (let i = spot.at + step; i >= 0 && i < spot.keys.length && !spot.keys[i].startsWith("g:"); i += step) {
        const tr = row(spot.keys[i]);
        const found = tr && control(tr, spot, false);
        if (found) return found;
      }
      return null;
    };
    if (!to && spot.at >= 0) {
      let heading = spot.at;
      while (heading > 0 && !spot.keys[heading].startsWith("g:")) heading--;
      const group = row(spot.keys[heading]);
      to = around(1) ?? around(-1) ?? (group && tabbable(group)[0]);
    }
    if (!to) return;
    to.focus({ preventScroll: true });
    // Its row still there, but not the control (disabled, or gone for now): it may come back.
    if (here && spot.label !== null && to.getAttribute("aria-label") !== spot.label) this.standIn = { el: to, row: spot.row, label: spot.label };
    keepInView(table.closest(".table-scroll"), to);
  }

  render(): ReactNode {
    return this.props.children;
  }
}

/** The control in `row` that's where focus was: in a cell like its cell, by its name, else (`same`, the row it was in) its class, else that cell's first. */
function control(row: HTMLElement, spot: Spot, same: boolean): HTMLElement | null {
  const cells = [...row.children].filter((td) => td.className === spot.cell);
  for (const cell of cells) {
    const all = tabbable(cell);
    const found =
      (spot.label !== null && all.find((el) => el.getAttribute("aria-label") === spot.label)) ||
      (same && spot.className && all.find((el) => el.classList.contains(spot.className))) ||
      all[0];
    if (found) return found;
  }
  return null;
}

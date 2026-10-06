import { flushSync } from "react-dom";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flagName, PROGRESS_NAME, progress } from "../model/status";
import { boxScale, scaleSentence } from "../model/scale";
import { jiraKey } from "../model/jira";
import { ScaleBadge } from "./ScaleBadge";
import { capacityOn, hasDates, laneDates } from "../model/lanes";
import { packRows, ptoEntries, ptoKey, ptoRange, type PtoRef } from "../model/pto";
import { CollapseAll } from "./CollapseAll";
import { useToday } from "./useToday";
import { type CapacityStretch, overCapacity, overloadText, worstStretch } from "../model/report";
import {
  type Day,
  addMonths,
  addWorkdays,
  dayParts,
  nextWorkday,
  prettyDay,
  prevWorkday,
  startOfMonth,
  startOfWeek,
  workdays,
} from "../model/dates";
import type { Box, Department, Lane, Roadmap, TimeOff, ZoomLevel } from "../model/types";
import { type Placed, laneAtSlot, layoutDepartment, slotsOf } from "../timeline/layout";
import { type Scale, type Segment, headerBands, makeScale, timelineRange } from "../timeline/scale";
import { type DragMode, dragDays, dropLane, movedDates, previewSlot } from "../timeline/drag";
import { Icon } from "./Icon";
import { DEFAULT_PREFS, type Prefs } from "../prefs";
import { UseChart } from "./UseChart";
import { reorderByKey, useReorder } from "./useReorder";
import { focusLater } from "../a11y/focus";
import { followPointer, swallowNextClick } from "./followPointer";
import { cellOf, useGridFocus } from "./useGridFocus";
import { announce } from "../a11y/announce";
import { APPLE, letter, undoHint } from "../a11y/keys";
import { boxName, fitsInLane, laneName, laneSequence, ptoName, spokenRange, workingDays } from "../timeline/keyboard";
import { type Facts, boxFacts, consequences, ptoFacts } from "../timeline/consequences";

const LABEL_W = 240;
/** The gap (px) between a box and the edges of the slots it's drawn in. */
const BOX_PAD = 3;
/** Pointer travel (px) before a press on a box becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4;
/** How near the timeline's edges (px, inside the labels and header) a drag scrolls it, and how far each frame. */
const EDGE = 40;
const EDGE_STEP = 12;

export type BoxPlacement = Pick<Box, "lane" | "start" | "end">;

/** A keyboard move under way: what's moving, from where, to where now, and what's been said about it. */
type Move = (
  | { kind: "box"; id: string; from: BoxPlacement; at: BoxPlacement }
  | { kind: "pto"; ref: PtoRef; key: string; from: { start: Day; end: Day }; at: { start: Day; end: Day } }
) & {
  /** What held as last read out, and the message on its way (with what held then). */
  said: Facts;
  pending?: { facts: Facts; takeBack(): boolean };
  /** The end that moved last, kept on screen. */
  edge: "start" | "end";
};

/** The keys of a keyboard move are said the first time one starts, not every time. */
let toldMoveKeys = false;
const ALT_KEY = APPLE ? "Option" : "Alt";

/** The keys of a keyboard move, beside its dates while it lasts (said when it starts). */
const moveKeysHint = (lanes: boolean) =>
  ` · ← → dates · ${APPLE ? "⌥" : "Alt+"}← → end${lanes ? " · ↑ ↓ lane" : ""} · Enter drop · Esc cancel`;

/** The row of a department's extra area, below its lanes. */
const OVERFLOW = "overflow";

/** The id of what's said about the focused box beyond its name (useGridFocus.ts writes it). */
const DESCRIBED_BY = "tl-focus-desc";
const GRID_HELP =
  "Arrow keys move between lanes, boxes and PTO. Enter opens a box, Space picks it up to move it, Delete deletes it. " +
  "The + beside a lane or PTO adds one there, as N does. Question mark lists the keys.";

/** A cell's key, `kind:id` (data-cell), in its two parts. */
const splitKey = (key: string): [string, string] => {
  const i = key.indexOf(":");
  return [key.slice(0, i), key.slice(i + 1)];
};
/** A PTO block's ref from its key, `person#index`. */
const ptoRefOf = (key: string): PtoRef => ({ personId: key.slice(0, key.lastIndexOf("#")), index: Number(key.slice(key.lastIndexOf("#") + 1)) });

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** "FTE 2", or the lane's name. */
const laneLabel = (dept: Department, lane: Lane) => lane.name ?? `FTE ${dept.lanes.indexOf(lane) + 1}`;

interface Props {
  /** Personal display preferences: density and what a box shows. */
  display?: Pick<Prefs, "density" | "showCodes" | "showScale" | "showInitials" | "showFlags" | "showPto" | "collapsedView">;
  /** Every box, finished ones too, for capacity used (`roadmap` may leave some out). */
  allBoxes?: Box[];
  roadmap: Roadmap;
  zoom: ZoomLevel;
  collapsed: Set<string>;
  onToggleDepartment(id: string): void;
  allCollapsed: boolean;
  onToggleAll(): void;
  /** Incremented to request a scroll to today. */
  jumpToToday: number;
  selectedId: string | null;
  onSelect(id: string | null): void;
  onPlaceBox(id: string, placement: BoxPlacement): void;
  onCreateBox(placement: BoxPlacement): void;
  /** `undefined` clears the name, falling back to "FTE n". */
  onRenameLane(laneId: string, name: string | undefined): void;
  /** Previewing another branch, or saving: look, don't touch. */
  readOnly?: boolean;
  /** What the corner says while read-only ("Read-only preview" for a branch); nothing while only saving. */
  readOnlyLabel?: string;
  /** Boxes someone else changed while we were editing them too. */
  conflictIds?: Set<string>;
  /** Boxes someone else changed since this tab loaded (for review). */
  updatedIds?: Set<string>;
  /** Broken rules, by box id: the messages to show on that box. */
  ruleWarnings?: Map<string, string[]>;
  /** Drag a department heading to a new place in the order (0 = first). */
  onMoveDepartment?(id: string, index: number): void;
  /** Open the department editor (✎ on a department heading). */
  onEditDepartment?(id: string): void;
  onAddDepartment?(): void;
  /** The PTO block being edited (`ptoKey`), if any. */
  selectedPto?: string | null;
  onSelectPto?(ref: PtoRef): void;
  onPlacePto?(ref: PtoRef, dates: Pick<TimeOff, "start" | "end">): void;
  /** Double-click a department's PTO row. */
  onCreatePto?(departmentId: string, dates: Pick<TimeOff, "start" | "end">): void;
  /** Why nothing can be changed while `readOnly`, said when a key or button would have changed something. */
  readOnlyReason?: string;
  /** The Delete key on a focused box or PTO block. */
  onDeleteBox?(id: string): void;
  onDeletePto?(ref: PtoRef): void;
  /** ? in the timeline: the list of keys. */
  onShowShortcuts?(): void;
  /** A keyboard move started (true) or ended: others' saves wait meanwhile. */
  onMoveSession?(moving: boolean): void;
}

/** Working days a box added from the keyboard (or its lane's +) runs, by zoom: a week, two, or about a month. */
const NEW_DAYS: Record<ZoomLevel, number> = { weeks: 5, months: 10, quarters: 20 };

/** A new box's dates around `day`, sized to the zoom: a working week, two from that Monday, or the rest of the month. */
function defaultSpan(day: Day, zoom: ZoomLevel): { start: Day; end: Day } {
  if (zoom === "months") {
    const start = startOfWeek(day);
    return { start, end: addWorkdays(start, 9) };
  }
  if (zoom === "quarters") {
    const start = nextWorkday(startOfMonth(day));
    return { start, end: prevWorkday(addMonths(start, 1) - 1) };
  }
  const start = nextWorkday(day);
  return { start, end: addWorkdays(start, 4) };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join("");

export function Timeline(props: Props) {
  const display = props.display ?? DEFAULT_PREFS;
  // Rows are shorter in the compact density. SLOT_H is the height of half an FTE: a 1-FTE lane is two slots.
  const SLOT_H = display.density === "compact" ? 18 : 22;
  const DEPT_H = display.density === "compact" ? 30 : 34;
  // A collapsed row with a capacity chart is a little taller, so the chart can be read.
  const CHART_H = display.density === "compact" ? 40 : 48;
  const { roadmap, zoom, collapsed, onToggleDepartment, jumpToToday, selectedId, onSelect, onCreateBox, readOnly } =
    props;
  const { settings, departments, boxes, people } = roadmap;
  const fy = settings.fiscal_year_start_month;
  const now = useToday();

  const [rangeStart, rangeEnd] = useMemo(() => timelineRange(boxes, now, fy), [boxes, now, fy]);
  const scale = useMemo(() => makeScale(rangeStart, rangeEnd, zoom), [rangeStart, rangeEnd, zoom]);
  const bands = useMemo(() => headerBands(scale, fy), [scale, fy]);
  const typeColor = useMemo(() => new Map(settings.types.map((t) => [t.id, t.color])), [settings.types]);
  const personName = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const deptCode = useMemo(
    () => new Map(departments.flatMap((d) => d.lanes.map((l) => [l.id, d.code] as const))),
    [departments],
  );

  // Where a box being dragged would go. The layout stays as it was until it's dropped, so
  // nothing moves under the pointer (nor does its department change height); the box is
  // drawn where it's going.
  const [preview, setPreview] = useState<(BoxPlacement & { id: string }) | null>(null);

  const laneDept = useMemo(
    () => new Map(departments.flatMap((d) => d.lanes.map((l) => [l.id, d.id] as const))),
    [departments],
  );
  const layouts = useMemo(() => {
    const byDept = new Map<string, Box[]>(departments.map((d) => [d.id, []]));
    for (const b of boxes) {
      byDept.get(laneDept.get(b.lane) ?? "")?.push(b);
    }
    return new Map(departments.map((d) => [d.id, layoutDepartment(d, byDept.get(d.id) ?? [])]));
  }, [boxes, departments, laneDept]);
  // Over capacity, in the same terms as the app's warnings: finished boxes count too.
  const overloads = useMemo(
    () => new Map(departments.map((d) => [d.id, overCapacity(d, props.allBoxes ?? boxes)])),
    [departments, props.allBoxes, boxes],
  );

  const latest = useRef({ props, scale, layouts });
  latest.current = { props, scale, layouts };

  // Keep the same date centred when zooming; start with today a third of the way in.
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const reorder = useReorder(bodyRef, (id, index) => props.onMoveDepartment?.(id, index), {
    disabled: readOnly || !props.onMoveDepartment,
    scroller: scrollRef,
  });
  const centerDay = useRef<Day | null>(null);
  const trackWidth = () => (scrollRef.current?.clientWidth ?? 0) - LABEL_W;

  /** The working days on screen. */
  const visible = () => {
    const el = scrollRef.current;
    const s = latest.current.scale;
    if (!el) return { from: s.start, to: s.start };
    return { from: s.dayAt(el.scrollLeft), to: s.dayAt(el.scrollLeft + Math.max(0, el.clientWidth - LABEL_W)) };
  };
  /** Today if it's on screen, else the middle of what is: where a new box goes. */
  const nearToday = () => {
    const { from, to } = visible();
    return now >= from && now <= to ? now : Math.round((from + to) / 2);
  };

  // ---- Keyboard ---------------------------------------------------------------
  // The timeline is a grid: one Tab stop, the arrow keys between cells
  // (useGridFocus.ts). On a box or PTO block, Enter opens it, Space picks it
  // up to move it (below), Delete deletes it; N adds one in the row.

  const gridRef = useRef<HTMLDivElement>(null);
  /** What's said about a focused cell beyond its name: a box's lane, scale, progress and warnings; a chart's overloads. */
  const describeCell = (cell: HTMLElement): string => {
    const [kind, id] = splitKey(cell.dataset.cell!);
    const p = latest.current.props;
    if (kind === "chart") {
      const dept = p.roadmap.departments.find((d) => d.id === id);
      const over = dept ? overCapacity(dept, p.allBoxes ?? p.roadmap.boxes) : [];
      return over.length ? `Over capacity: ${overloadText(over)}.` : "Never over capacity.";
    }
    const found = kind === "box" && p.roadmap.boxes.find((x) => x.id === id);
    if (!found) return "";
    // Being moved from the keyboard: where it's got to (its lane, its scale).
    const m = move.current;
    const b = m?.kind === "box" && m.id === id ? { ...found, ...m.at } : found;
    const clash = p.conflictIds?.has(b.id);
    return [
      `${laneName(p.roadmap.departments, b.lane)}.`,
      scaleSentence(b, p.roadmap.departments),
      `${PROGRESS_NAME[progress(b, now)]}.`,
      ...(p.ruleWarnings?.get(b.id) ?? []),
      clash && "Someone else also changed this box: you’ll choose whose version to keep when you save.",
      p.updatedIds?.has(b.id) && !clash && "Changed by someone else since you opened the roadmap.",
    ]
      .filter(Boolean)
      .join(" ");
  };
  const grid = useGridFocus(gridRef, { scroller: scrollRef, labelWidth: LABEL_W, visible, describe: describeCell, describedBy: DESCRIBED_BY });

  const readOnlyWhy = props.readOnlyReason ?? "Read-only: changes can’t be made here.";
  const say = (text: string) => void announce(text);

  /** A new box in `lane` (Add a box, or N): after `after`, else near today, as long as the zoom suggests. */
  const createBoxIn = (lane: string, after?: Day) => {
    if (readOnly) return say(readOnlyWhy);
    const start = after === undefined ? nextWorkday(nearToday()) : addWorkdays(after, 1);
    const end = addWorkdays(start, NEW_DAYS[zoom] - 1);
    onCreateBox({ lane, start, end });
    say(`Added a box to ${laneName(departments, lane)}, ${spokenRange(start, end)}.`);
  };
  /** A week of PTO in `deptId` (Add PTO, or N): after `after`, else from the next working day. */
  const createPto = (deptId: string, after?: Day) => {
    if (readOnly) return say(readOnlyWhy);
    const start = after === undefined ? nextWorkday(now) : addWorkdays(after, 1);
    const end = addWorkdays(start, 4);
    props.onCreatePto?.(deptId, { start, end });
    say(`Added PTO in ${departments.find((d) => d.id === deptId)?.name ?? "the department"}, ${spokenRange(start, end)}.`);
  };

  const onGridKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || isTyping(e.target) || move.current) return;
    const cell = cellOf(e.target);
    if (!cell || grid.onKey(e.nativeEvent)) return;
    const [kind, id] = splitKey(cell.dataset.cell!);
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    if (e.key === "Enter" && plain && (kind === "box" || kind === "pto")) {
      e.preventDefault();
      if (readOnly) return say(readOnlyWhy);
      if (kind === "box") onSelect(id);
      else props.onSelectPto?.(ptoRefOf(id));
    } else if (e.key === " " && plain && (kind === "box" || kind === "pto")) {
      e.preventDefault();
      if (!e.repeat) pickUp(kind, id);
    } else if (e.key === " " && plain && kind === "chart") {
      e.preventDefault(); // not a scroll
    } else if ((e.key === "Delete" || e.key === "Backspace") && plain && (kind === "box" || kind === "pto")) {
      // Only the focused box or block, once a press: a key held down would go on to delete its neighbours.
      e.preventDefault();
      if (e.repeat || e.nativeEvent.isComposing) return;
      if (readOnly) return say(readOnlyWhy);
      remove(cell, kind, id);
    } else if (letter(e.nativeEvent) === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (e.repeat) return;
      const [rowKind, rowId] = splitKey(cell.closest<HTMLElement>("[data-row]")?.dataset.row ?? ":");
      const after = cell.dataset.end === undefined ? undefined : Number(cell.dataset.end);
      if (rowKind === "lane") createBoxIn(rowId, after);
      else if (rowKind === "pto") createPto(rowId, after);
      // The extra area: in the focused box's own lane.
      else if (kind === "box") createBoxIn(boxes.find((b) => b.id === id)!.lane, after);
      else say("N adds a box in a lane, or PTO in a PTO row.");
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.altKey && !e.metaKey && !e.ctrlKey) {
      // Never the browser's Back or Forward (Alt+← on Windows), on any cell. On a box or PTO
      // block, it's a move's key with nothing picked up.
      e.preventDefault();
      if (e.repeat || (kind !== "box" && kind !== "pto")) return;
      say(readOnly ? readOnlyWhy : `Press Space to pick it up first; then ${ALT_KEY} with Left or Right changes the end date.`);
    } else if (kind === "dept" && e.altKey) {
      // Alt+↑ or Alt+↓ on a heading moves the department; focus stays on it.
      const order = latest.current.props.roadmap.departments;
      const place = readOnly ? undefined : props.onMoveDepartment;
      if (reorderByKey(e, order, id, place, readOnlyWhy) !== null) grid.keep(`dept:${id}`);
    } else if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      props.onShowShortcuts?.();
    }
  };

  /** Delete the focused box or PTO block; focus goes to the cell beside it. */
  const remove = (cell: HTMLElement, kind: string, id: string) => {
    let next = grid.neighbour(cell);
    if (kind === "box") {
      if (next) grid.setActive(next);
      return props.onDeleteBox?.(id);
    }
    // The owner's later entries move up one place in their list, and so their keys.
    const ref = ptoRefOf(id);
    const [nextKind, nextId] = next ? splitKey(next) : ["", ""];
    if (nextKind === "pto") {
      const n = ptoRefOf(nextId);
      if (n.personId === ref.personId && n.index > ref.index) next = `pto:${ptoKey({ ...n, index: n.index - 1 })}`;
    }
    if (next) grid.setActive(next);
    props.onDeletePto?.(ref);
  };

  const scrollToDay = (day: Day, fraction: number, smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: scale.x(day) - trackWidth() * fraction, behavior: smooth ? "smooth" : "auto" });
  };

  useLayoutEffect(() => {
    if (centerDay.current === null) scrollToDay(now, 1 / 3);
    else scrollToDay(centerDay.current, 1 / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-centre on zoom only, not when today changes
  }, [scale]);

  useEffect(() => {
    if (jumpToToday > 0) scrollToDay(now, 1 / 3, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll only when Today is pressed
  }, [jumpToToday]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) centerDay.current = scale.dayAt(el.scrollLeft + trackWidth() / 2);
  };

  /** The department under a point, and how many slots down its lanes the point is. */
  const slotAt = (clientX: number, clientY: number) => {
    const track = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-dept-track]");
    const layout = track && latest.current.layouts.get(track.dataset.deptTrack!);
    return layout ? { layout, slot: Math.floor((clientY - track.getBoundingClientRect().top) / SLOT_H) } : undefined;
  };

  // ---- Dragging -------------------------------------------------------------
  // Only the pointer that pressed moves a box, and the drag ends however that
  // pointer goes (followPointer.ts). Everything moves in working days; a box
  // keeps its number of working days when moved.

  /**
   * Focus on what was pressed (it wouldn't take it otherwise, the press being kept from selecting
   * text), without the keyboard's ring: browsers draw one when a script moves focus, unless told.
   * One the keyboard had focused is focused again, so its ring (and its scale card) goes.
   */
  const focusPressed = (el: HTMLElement) => {
    if (document.activeElement === el) el.blur();
    el.focus({ preventScroll: true, focusVisible: false });
  };

  /** Cancels the drag under way, if any: one at a time, and none left behind when the timeline goes. */
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  /**
   * While a drag is on, scrolling (a wheel, a trackpad, or the pointer
   * resting near an edge, which scrolls by itself) carries what's dragged
   * along, as if it were held under the pointer: `follow` runs again with
   * how far the content has scrolled since the press. Call `moved` after
   * each pointer move; `stop` when the drag ends.
   *
   * An edge scrolls only once the pointer has been clear of it during the
   * drag, or has gone on towards it from where it pressed (`press`): a box
   * pressed near an edge and dragged along it, or away, stays put.
   */
  const scrollWithDrag = (press: { x: number; y: number }, pointer: { x: number; y: number }, follow: () => void) => {
    const el = scrollRef.current!;
    const from = { x: el.scrollLeft, y: el.scrollTop };
    let frame = 0;
    /** How far into each edge's zone the pointer is (more than 0: in it), and how far it's gone towards that edge since the press. */
    const edges = () => {
      const r = el.getBoundingClientRect();
      const head = el.querySelector(".tl-head")?.getBoundingClientRect().height ?? 0;
      return {
        left: { into: r.left + LABEL_W + EDGE - pointer.x, towards: press.x - pointer.x },
        right: { into: pointer.x - (r.left + el.clientWidth - EDGE), towards: pointer.x - press.x },
        top: { into: r.top + head + EDGE - pointer.y, towards: press.y - pointer.y },
        bottom: { into: pointer.y - (r.top + el.clientHeight - EDGE), towards: pointer.y - press.y },
      };
    };
    const armed = { left: false, right: false, top: false, bottom: false };
    const edge = () => {
      frame = 0;
      const at = edges();
      const on = (side: keyof typeof armed) => armed[side] && at[side].into > 0;
      const dx = on("left") ? -EDGE_STEP : on("right") ? EDGE_STEP : 0;
      const dy = on("top") ? -EDGE_STEP : on("bottom") ? EDGE_STEP : 0;
      const before = [el.scrollLeft, el.scrollTop];
      el.scrollBy(dx, dy);
      // On until the pointer leaves the edge, or there's no further to go.
      if (el.scrollLeft !== before[0] || el.scrollTop !== before[1]) frame = requestAnimationFrame(edge);
    };
    el.addEventListener("scroll", follow);
    return {
      scrolled: () => ({ x: el.scrollLeft - from.x, y: el.scrollTop - from.y }),
      moved: () => {
        const at = edges();
        for (const side of ["left", "right", "top", "bottom"] as const) {
          armed[side] ||= at[side].into <= 0 || at[side].towards >= EDGE / 2;
        }
        if (!frame) frame = requestAnimationFrame(edge);
      },
      stop: () => {
        el.removeEventListener("scroll", follow);
        cancelAnimationFrame(frame);
      },
    };
  };

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, box: Box) => {
    if (e.button !== 0 || endDrag.current) return;
    focusPressed(e.currentTarget);
    e.preventDefault();
    const mode = ((e.target as HTMLElement).dataset.handle as DragMode | undefined) ?? "move";
    const x0 = e.clientX;
    const y0 = e.clientY;
    const pointer = { x: x0, y: y0 };
    let scrolling: ReturnType<typeof scrollWithDrag> | null = null;
    let placement: BoxPlacement = { lane: box.lane, start: box.start, end: box.end };
    let shown = false;
    // Which of its half-FTE slots it was held by: it's the box's top that lands in a lane.
    const need = slotsOf(box.fte);
    const held = Math.floor((y0 - e.currentTarget.getBoundingClientRect().top + BOX_PAD) / SLOT_H);
    const grab = { need, own: box.lane, slot: Math.min(need - 1, Math.max(0, held)) };

    /** Where it goes, held under the pointer, the content scrolled or not. */
    const follow = () => {
      const { props: p, scale: s } = latest.current;
      const scrolled = scrolling!.scrolled();
      const dates = movedDates(box, mode, dragDays(pointer.x - x0 + scrolled.x, s.pxPerDay, p.zoom));
      const under = mode === "move" ? slotAt(pointer.x, pointer.y) : undefined;
      const lane = under && dropLane(under.layout, { slot: under.slot, dy: pointer.y - y0 + scrolled.y }, grab, SLOT_H);
      const next = { lane: mode === "move" ? (lane ?? placement.lane) : box.lane, ...dates };
      // Drawn again only when where it would go changes, not at every pixel the pointer moves.
      if (shown && next.lane === placement.lane && next.start === placement.start && next.end === placement.end) return;
      placement = next;
      shown = true;
      setPreview({ id: box.id, ...placement });
    };

    endDrag.current = followPointer(e, scrollRef.current, {
      move: (ev) => {
        pointer.x = ev.clientX;
        pointer.y = ev.clientY;
        if (!scrolling) {
          if (Math.hypot(pointer.x - x0, pointer.y - y0) < DRAG_THRESHOLD) return false;
          scrolling = scrollWithDrag({ x: x0, y: y0 }, pointer, follow);
          document.body.classList.add(mode === "move" ? "dragging-move" : "dragging-resize");
        }
        follow();
        scrolling.moved();
        return true;
      },
      end: (released) => {
        endDrag.current = null;
        scrolling?.stop();
        document.body.classList.remove("dragging-move", "dragging-resize");
        setPreview(null);
        // A press that didn't drag is a click: the box's onClick opens it. Not after a drag, nor once cancelled.
        if (!released || scrolling) swallowNextClick();
        if (!released || !scrolling) return;
        const changed = placement.lane !== box.lane || placement.start !== box.start || placement.end !== box.end;
        if (changed) latest.current.props.onPlaceBox(box.id, placement);
      },
    });
  };

  /** Double-click empty space in a lane: a new box there, sized to the zoom level. */
  const createAt = (e: ReactMouseEvent<HTMLDivElement>, lane: string) => {
    if ((e.target as HTMLElement).closest("[data-box-id]")) return;
    const day = scale.dayAt(e.clientX - e.currentTarget.getBoundingClientRect().left);
    onCreateBox({ lane, ...defaultSpan(day, zoom) });
  };

  // ---- PTO ----------------------------------------------------------------
  // PTO blocks sit in a row under their owner's department. They drag and
  // resize like boxes, but only in time.

  const [ptoPreview, setPtoPreview] = useState<{ key: string; start: Day; end: Day } | null>(null);

  const startPtoDrag = (e: ReactPointerEvent<HTMLDivElement>, ref: PtoRef, pto: TimeOff) => {
    if (e.button !== 0 || endDrag.current) return;
    focusPressed(e.currentTarget);
    e.preventDefault();
    const mode = ((e.target as HTMLElement).dataset.handle as DragMode | undefined) ?? "move";
    const x0 = e.clientX;
    const y0 = e.clientY;
    const pointer = { x: x0, y: y0 };
    let scrolling: ReturnType<typeof scrollWithDrag> | null = null;
    let dates = { start: pto.start, end: pto.end };
    let shown = false;
    const follow = () => {
      const { props: p, scale: s } = latest.current;
      const next = movedDates(pto, mode, dragDays(pointer.x - x0 + scrolling!.scrolled().x, s.pxPerDay, p.zoom));
      if (shown && next.start === dates.start && next.end === dates.end) return;
      dates = next;
      shown = true;
      setPtoPreview({ key: ptoKey(ref), ...dates });
    };

    endDrag.current = followPointer(e, scrollRef.current, {
      move: (ev) => {
        pointer.x = ev.clientX;
        pointer.y = ev.clientY;
        if (!scrolling) {
          if (Math.abs(pointer.x - x0) < DRAG_THRESHOLD) return false;
          scrolling = scrollWithDrag({ x: x0, y: y0 }, pointer, follow);
          document.body.classList.add(mode === "move" ? "dragging-move" : "dragging-resize");
        }
        follow();
        scrolling.moved();
        return true;
      },
      end: (released) => {
        endDrag.current = null;
        scrolling?.stop();
        document.body.classList.remove("dragging-move", "dragging-resize");
        setPtoPreview(null);
        if (!released || scrolling) swallowNextClick();
        if (!released || !scrolling) return;
        if (dates.start !== pto.start || dates.end !== pto.end) latest.current.props.onPlacePto?.(ref, dates);
      },
    });
  };

  /** Double-click empty space in a PTO row: a week off, starting that day. */
  const createPtoAt = (e: ReactMouseEvent<HTMLDivElement>, deptId: string) => {
    if ((e.target as HTMLElement).closest("[data-pto-key]")) return;
    const start = nextWorkday(scale.dayAt(e.clientX - e.currentTarget.getBoundingClientRect().left));
    props.onCreatePto?.(deptId, { start, end: addWorkdays(start, 4) });
  };

  const ptoByDept = useMemo(() => {
    const out = new Map<string, ReturnType<typeof ptoEntries>>();
    for (const e of ptoEntries(people)) {
      if (e.person.department) out.set(e.person.department, [...(out.get(e.person.department) ?? []), e]);
    }
    return out;
  }, [people]);

  // ---- Moving from the keyboard -----------------------------------------------
  // Space picks a box or PTO block up; the arrow keys move what's drawn (a
  // preview, as a pointer drag does: nothing is laid out again, nothing else
  // moves); Enter or Space drops it, one change; Escape or ⌘Z puts it back.
  // Tab, a click anywhere, ⌘S, another view or going read-only drop it too.
  // Each step says the dates, and what they'd do (consequences.ts). While it
  // lasts, others' saves wait (App's polling).

  const move = useRef<Move | null>(null);
  const [keyMoving, setKeyMoving] = useState(false);

  /** The roadmap as it would be with the move dropped where it is now, and what holds for what's moved then. */
  const factsNow = (m: Move): Facts => {
    const p = latest.current.props;
    const all = p.allBoxes ?? p.roadmap.boxes;
    if (m.kind === "pto") {
      const person = p.roadmap.people.find((x) => x.id === m.ref.personId)!;
      return ptoFacts(all, person, { ...person.pto![m.ref.index], ...m.at });
    }
    const box = { ...all.find((b) => b.id === m.id)!, ...m.at };
    const deptOf = (lane: string) => p.roadmap.departments.find((d) => d.lanes.some((l) => l.id === lane))?.id ?? "";
    const state = { boxes: all.map((b) => (b.id === m.id ? box : b)), departments: p.roadmap.departments, people: p.roadmap.people };
    return boxFacts(state, box, [deptOf(m.from.lane), deptOf(m.at.lane)]);
  };

  /**
   * Say where it's got to (`lead`) and what changed since what was last said. A message not
   * yet read is taken back (a key held down says only where it ends up), so what changed is
   * counted from what was read.
   */
  const step = (m: Move, lead: string) => {
    if (m.pending && !m.pending.takeBack()) m.said = m.pending.facts;
    const facts = factsNow(m);
    m.pending = { facts, takeBack: announce([lead, ...consequences(m.said, facts)].join(" ")) };
  };

  const show = (m: Move) => {
    if (m.kind === "box") setPreview({ id: m.id, ...m.at });
    else setPtoPreview({ key: m.key, ...m.at });
  };

  const end = () => {
    const m = move.current;
    move.current = null;
    setPreview(null);
    setPtoPreview(null);
    setKeyMoving(false);
    latest.current.props.onMoveSession?.(false);
    m?.pending?.takeBack();
    return m;
  };

  /** What's moving, in words: its title, or whose PTO. */
  const movingName = (m: Move) => {
    const p = latest.current.props;
    if (m.kind === "box") return p.roadmap.boxes.find((b) => b.id === m.id)?.title || "Untitled";
    return `PTO for ${p.roadmap.people.find((x) => x.id === m.ref.personId)?.name ?? "an engineer"}`;
  };

  const pickUp = (kind: string, id: string) => {
    if (readOnly) return say(readOnlyWhy);
    if (endDrag.current || move.current) return;
    let m: Move;
    if (kind === "box") {
      const b = boxes.find((x) => x.id === id);
      const dept = b && departments.find((d) => d.lanes.some((l) => l.id === b.lane));
      if (!b || !dept) return;
      if (collapsed.has(dept.id)) return say(`Expand ${dept.name} to move its boxes.`);
      const from = { lane: b.lane, start: b.start, end: b.end };
      m = { kind: "box", id, from, at: from, said: new Map(), edge: "start" };
    } else {
      const ref = ptoRefOf(id);
      const pto = people.find((x) => x.id === ref.personId)?.pto?.[ref.index];
      if (!pto) return;
      const from = { start: pto.start, end: pto.end };
      m = { kind: "pto", ref, key: id, from, at: from, said: new Map(), edge: "start" };
    }
    m.said = factsNow(m);
    move.current = m;
    show(m);
    setKeyMoving(true);
    props.onMoveSession?.(true);
    const lanes = m.kind === "box" ? " Up and Down change the lane." : "";
    say(
      toldMoveKeys
        ? `Moving ${movingName(m)}.`
        : `Moving ${movingName(m)}, ${spokenRange(m.from.start, m.from.end)}. Left and Right move it a working day, Shift for a week. ${ALT_KEY} with Left or Right changes the end date.${lanes} Enter to drop, Escape to cancel.`,
    );
    toldMoveKeys = true;
  };

  const drop = () => {
    const m = end();
    if (!m) return;
    const p = latest.current.props;
    const changed = m.at.start !== m.from.start || m.at.end !== m.from.end || (m.kind === "box" && m.at.lane !== m.from.lane);
    if (!changed) return say(`Dropped where it was: ${movingName(m)}.`);
    if (m.kind === "box") {
      p.onPlaceBox(m.id, m.at);
      say(`Dropped: ${movingName(m)}, ${spokenRange(m.at.start, m.at.end)}, ${laneName(p.roadmap.departments, m.at.lane)}. ${undoHint()}`);
    } else {
      p.onPlacePto?.(m.ref, m.at);
      say(`Dropped: ${movingName(m)}, ${spokenRange(m.at.start, m.at.end)}. ${undoHint()}`);
    }
  };

  const cancel = () => {
    const m = end();
    if (m) say(`Move cancelled: ${movingName(m)} is back at ${spokenRange(m.from.start, m.from.end)}.`);
  };

  /** ← → (a day; Shift, a week), and with Alt the end date only. */
  const stepDates = (m: Move, mode: "move" | "end", delta: number) => {
    const at = { ...m.at, ...movedDates(m.at, mode, delta) };
    if (at.start === m.at.start && at.end === m.at.end) return say("It can’t end before it starts.");
    m.at = at as typeof m.at;
    m.edge = mode === "end" ? "end" : "start";
    show(m);
    step(m, mode === "end" ? `Ends ${prettyDay(at.end)}, ${workingDays(at.start, at.end)}.` : `${spokenRange(at.start, at.end)}.`);
  };

  /** ↑ ↓: the lane above or below, into the next open department; it says when the lane is busy then. */
  const stepLane = (m: Move, dir: -1 | 1) => {
    if (m.kind === "pto") return say("PTO moves only in time; change whose it is in its editor.");
    const { props: p, layouts: l } = latest.current;
    const lanes = laneSequence(p.roadmap.departments, p.collapsed);
    const i = lanes.findIndex((x) => x.lane === m.at.lane) + dir;
    if (i < 0 || i >= lanes.length) return say(dir < 0 ? "It’s in the top lane." : "It’s in the bottom lane.");
    const was = lanes[i - dir]?.dept;
    const { lane, dept: deptId } = lanes[i];
    m.at = { ...m.at, lane };
    show(m);
    const dept = p.roadmap.departments.find((d) => d.id === deptId)!;
    const box = { ...p.roadmap.boxes.find((b) => b.id === m.id)!, ...m.at };
    const fits = fitsInLane(dept, l.get(deptId)!, p.allBoxes ?? p.roadmap.boxes, box, lane);
    step(
      m,
      [
        `${laneName(p.roadmap.departments, lane)}.`,
        deptId !== was && `Code now ${dept.code}-${box.code}.`,
        !fits && "Busy then: it will be drawn in the nearest free space.",
      ]
        .filter(Boolean)
        .join(" "),
    );
  };

  const onMoveKey = (e: KeyboardEvent) => {
    const m = move.current;
    if (!m) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = letter(e);
    // ⌘S saves it dropped: the drop reaches the draft before the app's own ⌘S reads it.
    if (mod && key === "s") return flushSync(drop);
    // Tab drops it, and goes on.
    if (e.key === "Tab") return drop();
    const arrow = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[e.key] as -1 | 1 | undefined;
    const ours =
      (mod && (key === "z" || key === "y")) ||
      (!mod && (arrow !== undefined || ["Escape", "Enter", " ", "Delete", "Backspace", "Home", "End", "PageUp", "PageDown"].includes(e.key) || key === "n"));
    if (!ours) return;
    // Nothing behind the move acts on these: not the app's undo, nor the browser's Back (Alt+← on Windows).
    e.preventDefault();
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === "Escape" || (mod && key === "z" && !e.shiftKey)) cancel();
    else if ((e.key === "Enter" || e.key === " ") && !e.repeat) drop();
    else if (arrow && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !mod) stepDates(m, e.altKey ? "end" : "move", arrow * (e.shiftKey ? 5 : 1));
    else if (arrow && !mod && !e.altKey && !e.shiftKey) stepLane(m, arrow);
  };
  const moveKey = useRef(onMoveKey);
  const dropNow = useRef(drop);
  useLayoutEffect(() => {
    moveKey.current = onMoveKey;
    dropNow.current = drop;
  });

  // From the render that starts it, so not a key is missed.
  useLayoutEffect(() => {
    if (!keyMoving) return;
    const onKey = (e: KeyboardEvent) => moveKey.current(e);
    // A press anywhere drops it first, then does what it does; so does focus going elsewhere.
    const onDown = () => dropNow.current();
    const onFocus = (e: FocusEvent) => {
      if (!gridRef.current?.contains(e.target as Node)) dropNow.current();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    document.addEventListener("focusin", onFocus, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("focusin", onFocus, true);
    };
  }, [keyMoving]);
  // Going read-only (a newer BoxOps, say) drops it; so does the timeline going (another view).
  useEffect(() => {
    if (readOnly) dropNow.current();
  }, [readOnly]);
  useEffect(() => () => dropNow.current(), []);
  // Each step keeps what moves on screen: its start, or its end while that's what moves. What's
  // said about it beyond its name follows it (its lane, its scale), and goes back if it's put back.
  const wasMoving = useRef(false);
  useLayoutEffect(() => {
    const m = move.current;
    const el = m && gridRef.current?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(m.kind === "box" ? `box:${m.id}` : `pto:${m.key}`)}"]`);
    if (el) grid.reveal(el, m.edge);
    const focused = (m || wasMoving.current) && cellOf(document.activeElement);
    if (focused && gridRef.current?.contains(focused)) grid.describe(focused);
    wasMoving.current = !!m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- after each step, not each render: grid's functions don't change what they do
  }, [preview, ptoPreview]);

  // ---- Rendering ------------------------------------------------------------

  const showToday = now >= scale.start && now < scale.end;
  // On a weekend the line sits on Monday's edge; on a weekday, mid-day.
  const todayX = scale.x(now) + (workdays(now, now) ? scale.pxPerDay / 2 : 0);

  const span = (start: Day, end: Day) => ({
    left: scale.x(start),
    width: Math.max(scale.pxPerDay, scale.span(start, end)),
  });

  const boxEl = (b: Box, style: CSSProperties, variant: "full" | "compact" | "dragging" = "full", slots = 2, overflowing = false) => {
    const width = typeof style.width === "number" ? style.width : 0;
    const interactive = variant !== "compact" && !readOnly;
    const clash = props.conflictIds?.has(b.id);
    const warnings = props.ruleWarnings?.get(b.id) ?? [];
    const code = `${deptCode.get(b.lane) ?? "?"}-${b.code}`;
    // A Jira epic link labels the box with its key; the BoxOps code moves to the tooltip and editor.
    const jira = jiraKey(b.epic);
    const engineers = (b.engineers ?? []).map((id) => personName.get(id) ?? id);
    // Initials only where they won't crowd the title.
    // Scale (FTE × working days) sits at the far right, after the initials.
    const scaleValue = boxScale(b);
    const scaleW = 6 + String(scaleValue).length * 7;
    const showScale = display.showScale && variant !== "compact" && width >= 120;
    const showPeople =
      display.showInitials &&
      variant !== "compact" &&
      engineers.length > 0 &&
      width >= 160 + 20 * engineers.length + (showScale ? scaleW : 0);
    // Keep their space clear: the sliding (sticky) title stops before them.
    const peopleW =
      showPeople || showScale
        ? 8 + (showPeople ? engineers.length * (slots === 1 ? 16 : 20) : 0) + (showScale ? scaleW : 0) + 6
        : 0;
    const stage = progress(b, now);
    const flag = b.status && flagName(settings, b.status);
    const classes = [
      "box",
      `progress-${stage}`,
      variant !== "full" && variant,
      slots === 1 && "half",
      b.id === selectedId && "selected",
      clash && "conflict",
      props.updatedIds?.has(b.id) && "updated",
      warnings.length > 0 && "rule-broken",
      overflowing && "overflowing",
    ];
    const tooltip = [
      clash && "⚠ Someone else also changed this box. You’ll choose whose version to keep when you save.\n",
      props.updatedIds?.has(b.id) && !clash && "● Changed by someone else since you opened the roadmap.\n",
      ...warnings.map((w) => `⚠ ${w}\n`),
      jira ? `${jira}  ${b.title}  (BoxOps ${code})` : `${code}  ${b.title}`,
      `${prettyDay(b.start)} – ${prettyDay(b.end)}`,
      `${workdays(b.start, b.end)} working day${workdays(b.start, b.end) === 1 ? "" : "s"} · ${b.fte} FTE · Scale ${scaleValue} · ${PROGRESS_NAME[stage]}${flag ? ` · ${flag}` : ""}`,
      engineers.length ? `Engineers: ${engineers.join(", ")}` : "No engineer assigned",
      b.description && `\n${b.description}`,
    ];
    return (
      <div
        key={b.id}
        data-box-id={b.id}
        role="gridcell"
        data-cell={`box:${b.id}`}
        data-start={b.start}
        data-end={b.end}
        aria-label={boxName({
          title: b.title,
          code,
          jira,
          start: b.start,
          end: b.end,
          fte: b.fte,
          engineers,
          flag: b.status ? flag : undefined,
          rules: warnings.length,
          clash: !!clash,
          updated: !!props.updatedIds?.has(b.id),
        })}
        aria-haspopup={readOnly ? undefined : "dialog"}
        // Only while its editor is open: false on every other box would be said, "collapsed", on each.
        aria-expanded={!readOnly && b.id === selectedId ? true : undefined}
        // The grid's Tab stop when it's the active cell (useGridFocus.ts); else reached with the arrow keys.
        tabIndex={-1}
        className={classes.filter(Boolean).join(" ")}
        style={{ ...style, ...((showPeople || showScale) && { paddingRight: peopleW }), "--c": typeColor.get(b.type) ?? "#8a94a6" } as CSSProperties}
        title={variant === "full" && b.id !== selectedId ? tooltip.filter(Boolean).join("\n") : undefined}
        onPointerDown={interactive ? (e) => startDrag(e, b) : undefined}
        // A click opens it (a screen reader's "press" is a click too); one ending a drag goes elsewhere.
        onClick={readOnly ? undefined : () => onSelect(b.id)}
      >
        {variant !== "compact" && (
          <span className="box-title">
            {/* An image, named for what it shows: a name on a plain <span> is ignored. */}
            <span className="status-mark" role="img" aria-label={PROGRESS_NAME[stage]} />
            {(warnings.length > 0 || clash) && (
              <span className="box-warn" role="img" aria-label={warnings.length ? "Breaks a rule" : "Clash"}>
                <Icon name="alert" size={12} />
              </span>
            )}
            {display.showCodes && <span className={`box-code${jira ? " jira" : ""}`}>{jira ?? code}</span>}
            {flag && display.showFlags && <span className="box-flag">{flag}</span>}
            <span className="box-name">{b.title || "Untitled"}</span>
          </span>
        )}
        {(showPeople || showScale) && (
          <span className="box-people">
            {showPeople &&
              engineers.map((n, i) => (
                // By engineer: two with the same name are two avatars.
                <span key={b.engineers![i]} className="avatar" title={n}>
                  {initials(n)}
                </span>
              ))}
            {showScale && (
              <ScaleBadge box={b} departments={departments} className="box-scale" />
            )}
          </span>
        )}
        {interactive && width >= 24 && (
          <>
            <div className="handle start" data-handle="start" />
            <div className="handle end" data-handle="end" />
          </>
        )}
      </div>
    );
  };

  const dragged = preview ? boxes.find((b) => b.id === preview.id) : undefined;
  const moving = preview && dragged ? { ...dragged, ...preview } : null;
  const boxTop = (slot: number) => slot * SLOT_H + BOX_PAD;
  const boxHeight = (slots: number) => slots * SLOT_H - BOX_PAD * 2;

  return (
    <div
      className="timeline"
      ref={scrollRef}
      onScroll={onScroll}
      style={{ "--label-w": `${LABEL_W}px` } as CSSProperties}
    >
      <div className="tl-canvas" style={{ width: LABEL_W + scale.width }}>
        <div className="tl-head">
          <div className="tl-corner" style={{ width: LABEL_W }}>
            {departments.length > 0 && <CollapseAll all={props.allCollapsed} onToggle={props.onToggleAll} />}
            {readOnly && props.readOnlyLabel && <span>{props.readOnlyLabel}</span>}
          </div>
          {/* The dates along the top: what the boxes' names say in words. */}
          <div className="tl-bands" aria-hidden style={{ width: scale.width }}>
            {bands.map((band, i) => (
              <div key={i} className={`tl-band band-${i}`}>
                {band.map((s) => (
                  <BandCell key={s.start} seg={s} scale={scale} />
                ))}
              </div>
            ))}
            {showToday && (
              <div className="today-flag" style={{ left: todayX }} title={prettyDay(now)}>
                Today
              </div>
            )}
          </div>
        </div>

        <div className="tl-body" ref={bodyRef}>
          <Grid scale={scale} fine={bands[1]} coarse={bands[0]} zoom={zoom} />
          {reorder.line && <div className="reorder-line" aria-hidden style={reorder.line} />}

          {/* The timeline as a grid for the keyboard and screen readers (useGridFocus.ts): one Tab stop, arrow keys between cells. */}
          <div
            ref={gridRef}
            className="tl-rows"
            role={departments.length ? "grid" : undefined}
            aria-label={departments.length ? "Timeline" : undefined}
            aria-describedby={departments.length ? "tl-help" : undefined}
            aria-readonly={(departments.length && readOnly) || undefined}
            onKeyDown={onGridKey}
          >
            {departments.map((dept) => {
              const layout = layouts.get(dept.id)!;
              const isCollapsed = collapsed.has(dept.id);
              // Over capacity is FTE arithmetic; the extra area is where boxes that couldn't be drawn in the lanes go.
              // Only an overload from today on is a warning, as in the app's warnings; past ones are history.
              // The layout counts in half slots: where the warnings' arithmetic finds no overload, it's none.
              const stretches = overloads.get(dept.id) ?? [];
              const over = layout.overCapacity && stretches.length > 0;
              const ahead = stretches.filter((x) => x.to >= now);
              const extra = layout.height > layout.capacity;
              const extraName = over && !ahead.length ? "Over capacity in the past" : over ? "Over capacity" : "Doesn’t fit side by side";
              const deptBoxes = boxes.filter((b) => laneDept.get(b.lane) === dept.id);
              // Each box goes in the row of the lane it's drawn in (its own, or wherever the layout found room), in time order.
              // One being dragged stays there while it's only moved in time; dragged to another lane, it's in that lane's row.
              const byRow = new Map<string, { box: Box; at: Placed }[]>();
              const add = (row: string, box: Box, at: Placed) => byRow.set(row, [...(byRow.get(row) ?? []), { box, at }]);
              for (const b of deptBoxes) {
                const at = layout.boxes.get(b.id);
                if (!at || (moving?.id === b.id && moving.lane !== b.lane)) continue;
                add(at.overflow ? OVERFLOW : (laneAtSlot(layout, at.slot) ?? OVERFLOW), b, at);
              }
              if (moving && moving.lane !== dragged!.lane && laneDept.get(moving.lane) === dept.id) {
                const need = slotsOf(moving.fte);
                add(moving.lane, dragged!, { slot: previewSlot(layout, moving.lane, need), slots: need, overflow: false });
              }
              for (const list of byRow.values()) list.sort((a, b) => a.box.start - b.box.start || a.at.slot - b.at.slot);
              return (
                <section
                  key={dept.id}
                  role="rowgroup"
                  className={`dept${reorder.draggingId === dept.id ? " reordering-this" : ""}`}
                  data-dept-id={dept.id}
                  data-reorder-id={dept.id}
                  style={{ "--dept": dept.color } as CSSProperties}>
                  <div
                    className="row dept-row"
                    role="row"
                    // Each row has a short name of its own: one made from its cells would be every box's name in it.
                    aria-label={dept.name}
                    style={{ height: isCollapsed && display.collapsedView !== "boxes" ? CHART_H : DEPT_H }}
                  >
                    <DeptLabel
                      dept={dept}
                      now={now}
                      over={ahead}
                      collapsed={isCollapsed}
                      onToggle={() => onToggleDepartment(dept.id)}
                      onGrab={readOnly || !props.onMoveDepartment ? undefined : (e) => reorder.start(e, dept.id)}
                      onEdit={props.onEditDepartment && (() => (readOnly ? say(readOnlyWhy) : props.onEditDepartment!(dept.id)))}
                      readOnly={readOnly}
                    />
                    <div className="track" style={{ width: scale.width }}>
                      {isCollapsed &&
                        (display.collapsedView === "boxes" ? (
                          deptBoxes.toSorted((a, b) => a.start - b.start).map((b) => boxEl(b, span(b.start, b.end), "compact"))
                        ) : (
                          // The chart as a cell: its name says the peak, its description the weeks over capacity.
                          <div role="gridcell" tabIndex={-1} data-cell={`chart:${dept.id}`} className="use-cell">
                            <UseChart
                              dept={dept}
                              boxes={(props.allBoxes ?? boxes).filter((b) => laneDept.get(b.lane) === dept.id)}
                              scale={scale}
                              height={CHART_H}
                              kind={display.collapsedView}
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                  {!isCollapsed && (
                    // One row per lane, then the extra area: each exactly as tall as its slots, so
                    // a slot is SLOT_H pixels down from the top here wherever it is (laneAt).
                    <div className="dept-lanes" data-dept-track={dept.id} style={{ height: layout.height * SLOT_H }}>
                      {[...dept.lanes.map((lane) => lane.id), ...(extra ? [OVERFLOW] : [])].map((rowId) => {
                        const lane = dept.lanes.find((l) => l.id === rowId);
                        const l = lane ? layout.lanes.get(lane.id)! : { slot: layout.capacity, slots: layout.height - layout.capacity };
                        const rowBoxes = byRow.get(rowId) ?? [];
                        return (
                          <div
                            key={rowId}
                            role="row"
                            aria-label={`${dept.name} / ${lane ? laneLabel(dept, lane) : extraName}`}
                            data-row={lane ? `lane:${lane.id}` : undefined}
                            className={`lane-row${lane ? "" : " overflow-row"}${moving?.lane === rowId ? " drop-target" : ""}`}
                            style={{ height: l.slots * SLOT_H }}
                          >
                            {lane ? (
                              <div className="label lane-label" style={{ width: LABEL_W }}>
                                {/* The row's header: the lane's name, and when it's open and its size, if not always and 1 FTE. */}
                                <div role="rowheader" className="lane-head">
                                  <LaneName
                                    readOnly={readOnly}
                                    label={laneLabel(dept, lane)}
                                    named={lane.name !== undefined}
                                    cell={`lane:${lane.id}`}
                                    details={[hasDates(lane) && `lane-dates-${lane.id}`, lane.fte !== 1 && `lane-fte-${lane.id}`].filter(Boolean).join(" ") || undefined}
                                    onRename={(name) => props.onRenameLane(lane.id, name)}
                                  />
                                  {hasDates(lane) && (
                                    <span id={`lane-dates-${lane.id}`} className="pill lane-dates" title={`This lane holds capacity ${laneDates(lane)}`}>
                                      {laneDates(lane)}
                                    </span>
                                  )}
                                  {lane.fte !== 1 && (
                                    <span id={`lane-fte-${lane.id}`} className="pill">
                                      {lane.fte} FTE
                                    </span>
                                  )}
                                </div>
                                <div role="gridcell" className="add-cell">
                                  <button
                                    className="icon-button lane-add"
                                    tabIndex={-1}
                                    data-cell={`lane-add:${lane.id}`}
                                    title="Add a box (or double-click the lane)"
                                    aria-label={`Add a box to ${dept.name} / ${laneLabel(dept, lane)}`}
                                    aria-disabled={readOnly || undefined}
                                    onClick={() => createBoxIn(lane.id)}
                                  >
                                    <Icon name="plus" size={14} />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="label lane-label overflow-label" role="rowheader" style={{ width: LABEL_W }}>
                                {over && !ahead.length ? (
                                  <span className="overflow-note" title={`Over capacity before today: ${overloadText(stretches)}`}>
                                    {extraName}
                                  </span>
                                ) : over ? (
                                  <span className="overflow-note warn-text" title={`Over capacity: ${overloadText(ahead)}`}>
                                    {extraName}
                                  </span>
                                ) : (
                                  <span className="overflow-note" title="The FTE fits, but the free space is split up, so these boxes can't be drawn in one piece inside the lanes.">
                                    {extraName}
                                  </span>
                                )}
                              </div>
                            )}
                            <div
                              className={lane ? "track lane-track" : "track overflow-band"}
                              data-lane={lane?.id}
                              style={{ width: scale.width }}
                              onDoubleClick={readOnly || !lane ? undefined : (e) => createAt(e, lane.id)}
                            >
                              {lane && (() => {
                                // Before a lane opens and after it closes, it's hatched out: no capacity there.
                                const title = `Closed: this lane holds capacity ${laneDates(lane)}`;
                                return (
                                  <>
                                    {lane.start !== undefined && lane.start > scale.start && (
                                      <div className="lane-closed" aria-hidden title={title} style={{ left: 0, width: scale.x(lane.start) }} />
                                    )}
                                    {lane.end !== undefined && lane.end < scale.end && (
                                      <div
                                        className="lane-closed"
                                        aria-hidden
                                        title={title}
                                        style={{ left: scale.x(lane.end + 1), width: scale.width - scale.x(lane.end + 1) }}
                                      />
                                    )}
                                  </>
                                );
                              })()}
                              {rowBoxes.map(({ box: b, at }) => {
                                const style = { top: boxTop(at.slot - l.slot), height: boxHeight(at.slots) };
                                // The same element dragged or not: moved in time, it keeps focus.
                                return b.id === moving?.id
                                  ? boxEl(moving, { ...span(moving.start, moving.end), ...style }, "dragging", at.slots)
                                  : boxEl(b, { ...span(b.start, b.end), ...style }, "full", at.slots, over && at.slot >= layout.capacity && ahead.length > 0 && b.end >= now);
                              })}
                              {rowBoxes.map(({ box: b, at }) =>
                                b.id === moving?.id ? (
                                  <div key="drag-dates" className="drag-dates" aria-hidden style={{ left: scale.x(moving.start), top: boxTop(at.slot - l.slot) - 21 }}>
                                    {prettyDay(moving.start)} – {prettyDay(moving.end)} · {workdays(moving.start, moving.end)} working day
                                    {workdays(moving.start, moving.end) === 1 ? "" : "s"}
                                    {keyMoving && <span className="drag-keys">{moveKeysHint(true)}</span>}
                                  </div>
                                ) : null,
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {!isCollapsed && display.showPto && people.some((p) => p.department === dept.id) && (() => {
                    const entries = ptoByDept.get(dept.id) ?? [];
                    const { rows, count } = packRows(entries);
                    const height = Math.max(1, count) * SLOT_H;
                    return (
                      <div className="row pto-row" role="row" aria-label={`${dept.name} / PTO`} data-row={`pto:${dept.id}`} style={{ height }}>
                        <div className="label lane-label pto-label" style={{ width: LABEL_W, height }}>
                          <span className="lane-name static" role="rowheader">
                            PTO
                          </span>
                          {props.onCreatePto && (
                            <span role="gridcell" className="add-cell">
                              <button
                                className="icon-button pto-add"
                                tabIndex={-1}
                                data-cell={`pto-add:${dept.id}`}
                                title="Add PTO (or double-click the row)"
                                aria-label={`Add PTO in ${dept.name}`}
                                aria-disabled={readOnly || undefined}
                                onClick={() => createPto(dept.id)}
                              >
                                <Icon name="plus" size={14} />
                              </button>
                            </span>
                          )}
                        </div>
                        <div
                          className="track pto-track"
                          data-pto-track={dept.id}
                          style={{ width: scale.width, height }}
                          onDoubleClick={readOnly || !props.onCreatePto ? undefined : (e) => createPtoAt(e, dept.id)}
                        >
                          {entries.toSorted((a, b) => a.pto.start - b.pto.start || a.pto.end - b.pto.end).map((entry) => {
                            const ref = { personId: entry.person.id, index: entry.index };
                            const key = ptoKey(ref);
                            const live = ptoPreview?.key === key ? { ...entry.pto, ...ptoPreview } : entry.pto;
                            const style = { ...span(live.start, live.end), top: rows.get(entry)! * SLOT_H + BOX_PAD, height: SLOT_H - BOX_PAD * 2 };
                            const days = workdays(live.start, live.end);
                            return (
                              <div
                                key={key}
                                data-pto-key={key}
                                role="gridcell"
                                data-cell={`pto:${key}`}
                                data-start={entry.pto.start}
                                data-end={entry.pto.end}
                                aria-label={ptoName(entry.person.name, live)}
                                aria-haspopup={readOnly ? undefined : "dialog"}
                                aria-expanded={!readOnly && props.selectedPto === key ? true : undefined}
                                tabIndex={-1}
                                className={`pto-block${props.selectedPto === key ? " selected" : ""}${ptoPreview?.key === key ? " dragging" : ""}`}
                                style={style}
                                title={[
                                  `PTO · ${entry.person.name}`,
                                  `${ptoRange(live)} · ${days} working day${days === 1 ? "" : "s"}`,
                                  live.note,
                                ]
                                  .filter(Boolean)
                                  .join("\n")}
                                onPointerDown={readOnly ? undefined : (e) => startPtoDrag(e, ref, entry.pto)}
                                onClick={readOnly ? undefined : () => props.onSelectPto?.(ref)}
                              >
                                <span className="pto-text">
                                  {/* Short blocks show initials; the tooltip has the rest. */}
                                  <strong>{style.width < 90 ? initials(entry.person.name) : entry.person.name}</strong>
                                  {live.note && style.width >= 90 && <span className="pto-note"> · {live.note}</span>}
                                </span>
                                {!readOnly && style.width >= 24 && (
                                  <>
                                    <div className="handle start" data-handle="start" />
                                    <div className="handle end" data-handle="end" />
                                  </>
                                )}
                              </div>
                            );
                          })}
                          {ptoPreview && entries.some((en) => ptoKey({ personId: en.person.id, index: en.index }) === ptoPreview.key) && (
                            <div className="drag-dates" aria-hidden style={{ left: scale.x(ptoPreview.start), top: -18 }}>
                              {prettyDay(ptoPreview.start)} – {prettyDay(ptoPreview.end)} · {workdays(ptoPreview.start, ptoPreview.end)} working day
                              {workdays(ptoPreview.start, ptoPreview.end) === 1 ? "" : "s"}
                              {keyMoving && <span className="drag-keys">{moveKeysHint(false)}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </section>
              );
            })}
          </div>
          <p id="tl-help" hidden>
            {GRID_HELP}
          </p>
          {/* What's said about the focused box beyond its name (useGridFocus.ts writes it). */}
          <p id={DESCRIBED_BY} hidden />

          {departments.length === 0 && (
            <div className="empty-roadmap">
              <p>
                <strong>This roadmap has no departments yet.</strong>
              </p>
              <p>
                Start with a department: its lanes are your capacity. Then double-click a lane to add a box, and add
                engineers under People.
              </p>
              {!readOnly && props.onAddDepartment && (
                <button className="primary" onClick={props.onAddDepartment}>
                  <Icon name="plus" size={14} />
                  Add department
                </button>
              )}
            </div>
          )}

          {!readOnly && props.onAddDepartment && departments.length > 0 && (
            <div className="row add-dept-row">
              <div className="label" style={{ width: LABEL_W }}>
                <button className="add-button" onClick={props.onAddDepartment}>
                  <Icon name="plus" size={14} />
                  Add department
                </button>
              </div>
            </div>
          )}

          {showToday && <div className="today-line" aria-hidden style={{ left: LABEL_W + todayX }} />}
        </div>
      </div>
    </div>
  );
}

function BandCell({ seg, scale }: { seg: Segment; scale: Scale }) {
  const width = scale.x(seg.end) - scale.x(seg.start);
  if (width <= 0) return null;
  return (
    <div className="band-cell" style={{ left: scale.x(seg.start), width }}>
      <span>{seg.label}</span>
    </div>
  );
}

/** Vertical grid lines behind the rows; at week zoom, Mondays are stronger. */
function Grid({ scale, fine, coarse, zoom }: { scale: Scale; fine: Segment[]; coarse: Segment[]; zoom: ZoomLevel }) {
  const major = new Set(coarse.map((s) => scale.x(s.start)));
  return (
    <div className="tl-grid" aria-hidden style={{ left: LABEL_W, width: scale.width }}>
      {fine.map((s) => {
        const x = scale.x(s.start);
        const week = zoom === "weeks" && dayParts(s.start).weekday === 0;
        return <div key={s.start} className={`grid-line${major.has(x) ? " major" : week ? " week" : ""}`} style={{ left: x }} />;
      })}
    </div>
  );
}

/**
 * Click the lane name to rename it in place. Enter or click away saves; Esc
 * cancels; empty resets to "FTE n". After Enter or Esc, focus is back on the
 * name (the field it was in has gone). The name, the field and the read-only
 * text are all the lane's first cell (`cell`), so focus in the grid keeps to
 * it whichever is there; `details` (its dates and size) is read with it.
 */
function LaneName({
  label,
  named,
  cell,
  details,
  onRename,
  readOnly,
}: {
  label: string;
  named: boolean;
  cell: string;
  details?: string;
  onRename(name: string | undefined): void;
  readOnly?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  /** Enter or Esc ended the rename: focus goes back to the name. */
  const back = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (text !== null || !back.current) return;
    back.current = false;
    // After the key's own events: Enter's keypress would press the button were it focused now.
    focusLater([() => button.current]);
  }, [text]);

  if (readOnly) {
    return (
      <span className="lane-name static" tabIndex={-1} data-cell={cell} aria-describedby={details}>
        {label}
      </span>
    );
  }

  if (text === null) {
    return (
      <button
        ref={button}
        className="lane-name"
        tabIndex={-1}
        data-cell={cell}
        aria-describedby={details}
        title="Click to rename this lane"
        onClick={() => setText(named ? label : "")}
      >
        {label}
        <span className="edit-icon" aria-hidden>
          <Icon name="pencil" size={12} />
        </span>
      </button>
    );
  }

  const save = () => {
    const name = text.trim() || undefined;
    if (name !== (named ? label : undefined)) onRename(name);
    setText(null);
  };
  return (
    <input
      className="lane-name-input"
      data-cell={cell}
      value={text}
      placeholder={label}
      aria-label="Lane name"
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") back.current = true;
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setText(null);
      }}
    />
  );
}

function DeptLabel({
  dept,
  now,
  over,
  collapsed,
  readOnly,
  onToggle,
  onGrab,
  onEdit,
}: {
  dept: Department;
  now: Day;
  /** Its stretches over capacity from today on. */
  over: CapacityStretch[];
  collapsed: boolean;
  readOnly?: boolean;
  onToggle(): void;
  onGrab?(e: ReactPointerEvent): void;
  onEdit?(): void;
}) {
  // Capacity today; dated lanes make it change over time.
  const fte = capacityOn(dept, now);
  const dated = dept.lanes.some(hasDates);
  return (
    <div
      className={`label dept-label${onGrab ? " grabbable" : ""}`}
      style={{ width: LABEL_W }}
      onPointerDown={onGrab}
    >
      {onGrab && (
        <span className="dept-grip" title="Drag to reorder" aria-hidden>
          <Icon name="grip" size={14} />
        </span>
      )}
      {/* A heading for each department, as in the table and People views: screen readers can jump between them. */}
      <div role="gridcell" className="dept-cell">
        <h3 className="dept-heading">
          <button
            className="dept-toggle"
            tabIndex={-1}
            data-cell={`dept:${dept.id}`}
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-keyshortcuts={readOnly ? undefined : "Alt+ArrowUp Alt+ArrowDown"}
            title={over.length ? `Over capacity: ${overloadText(over)}` : undefined}
          >
            <Icon name="chevron-right" size={14} className={`chevron${collapsed ? "" : " open"}`} />
            <span className="dept-text">
              <span className="dept-name">{dept.name}</span>
              <span className="dept-sub">
                <span className="dept-meta" title={dated ? `${fte} FTE today; some lanes open or close on set dates` : undefined}>
                  {fte} FTE
                </span>
                {over.length > 0 && (
                  <span className="dept-over">
                    <Icon name="alert" size={11} /> {worstStretch(over).fte} planned
                  </span>
                )}
              </span>
            </span>
          </button>
        </h3>
      </div>
      {onEdit && (
        // Still there while read-only (a save under way, say), so focus on it isn't lost: it says why it does nothing.
        <div role="gridcell" className="edit-cell">
          <button
            className="icon-button dept-edit"
            tabIndex={-1}
            data-cell={`dept-edit:${dept.id}`}
            onClick={onEdit}
            aria-label={`Edit ${dept.name}`}
            aria-disabled={readOnly || undefined}
            title="Edit department and lanes"
          >
            <Icon name="pencil" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flagName, PROGRESS_NAME, progress } from "../model/status";
import { boxScale } from "../model/scale";
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
import { type DepartmentLayout, type Placed, laneAtSlot, layoutDepartment } from "../timeline/layout";
import { type Scale, type Segment, headerBands, makeScale, timelineRange } from "../timeline/scale";
import { type DragMode, dragDays, movedDates } from "../timeline/drag";
import { Icon } from "./Icon";
import { DEFAULT_PREFS, type Prefs } from "../prefs";
import { UseChart } from "./UseChart";
import { useReorder } from "./useReorder";
import { focusLater } from "../a11y/focus";

const LABEL_W = 240;
/** Height of half an FTE; a 1-FTE lane is two of these. */
const BOX_PAD = 3;
/** Pointer travel (px) before a press on a box becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4;

export type BoxPlacement = Pick<Box, "lane" | "start" | "end">;

/** The row of a department's extra area, below its lanes. */
const OVERFLOW = "overflow";

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
}

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
  // Rows are shorter in the compact density; a lane is two half-FTE slots.
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

  // While a box is dragged it is left out of the layout, so nothing jumps around under the pointer.
  const [preview, setPreview] = useState<(BoxPlacement & { id: string }) | null>(null);
  const draggingId = preview?.id ?? null;

  const laneDept = useMemo(
    () => new Map(departments.flatMap((d) => d.lanes.map((l) => [l.id, d.id] as const))),
    [departments],
  );
  const layouts = useMemo(() => {
    const byDept = new Map<string, Box[]>(departments.map((d) => [d.id, []]));
    for (const b of boxes) {
      if (b.id !== draggingId) byDept.get(laneDept.get(b.lane) ?? "")?.push(b);
    }
    return new Map(departments.map((d) => [d.id, layoutDepartment(d, byDept.get(d.id) ?? [])]));
  }, [boxes, departments, draggingId, laneDept]);
  // Over capacity, in the same terms as the app's warnings: finished boxes count too.
  const overloads = useMemo(
    () => new Map(departments.map((d) => [d.id, overCapacity(d, props.allBoxes ?? boxes)])),
    [departments, props.allBoxes, boxes],
  );

  // Keep the same date centred when zooming; start with today a third of the way in.
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const reorder = useReorder(bodyRef, (id, index) => props.onMoveDepartment?.(id, index), {
    disabled: readOnly || !props.onMoveDepartment,
    scroller: scrollRef,
  });
  const centerDay = useRef<Day | null>(null);
  const trackWidth = () => (scrollRef.current?.clientWidth ?? 0) - LABEL_W;

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

  /** The lane under a point, from a department track's layout. */
  const laneAt = (clientX: number, clientY: number, layoutsNow: Map<string, DepartmentLayout>) => {
    const track = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-dept-track]");
    if (!track) return undefined;
    const layout = layoutsNow.get(track.dataset.deptTrack!);
    if (!layout) return undefined;
    return laneAtSlot(layout, Math.floor((clientY - track.getBoundingClientRect().top) / SLOT_H));
  };

  // ---- Dragging -------------------------------------------------------------
  // Listeners go on window, not pointer capture: a box dragged to another lane
  // re-mounts elsewhere, which would drop the capture. Everything moves in
  // working days; a box keeps its number of working days when moved.

  const latest = useRef({ props, scale, layouts });
  latest.current = { props, scale, layouts };

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, box: Box) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const mode = ((e.target as HTMLElement).dataset.handle as DragMode | undefined) ?? "move";
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let placement: BoxPlacement = { lane: box.lane, start: box.start, end: box.end };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.hypot(dx, ev.clientY - y0) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        document.body.classList.add(mode === "move" ? "dragging-move" : "dragging-resize");
      }
      const { props: p, scale: s, layouts: l } = latest.current;
      const dates = movedDates(box, mode, dragDays(dx, s.pxPerDay, p.zoom));
      placement = { lane: mode === "move" ? (laneAt(ev.clientX, ev.clientY, l) ?? placement.lane) : box.lane, ...dates };
      setPreview({ id: box.id, ...placement });
    };

    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("dragging-move", "dragging-resize");
      setPreview(null);
      if (!commit) return;
      if (!moved) {
        latest.current.props.onSelect(box.id);
        return;
      }
      const changed = placement.lane !== box.lane || placement.start !== box.start || placement.end !== box.end;
      if (changed) latest.current.props.onPlaceBox(box.id, placement);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") finish(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
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
    if (e.button !== 0) return;
    e.preventDefault();
    const mode = ((e.target as HTMLElement).dataset.handle as DragMode | undefined) ?? "move";
    const x0 = e.clientX;
    let moved = false;
    let dates = { start: pto.start, end: pto.end };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        document.body.classList.add(mode === "move" ? "dragging-move" : "dragging-resize");
      }
      const { props: p, scale: s } = latest.current;
      dates = movedDates(pto, mode, dragDays(dx, s.pxPerDay, p.zoom));
      setPtoPreview({ key: ptoKey(ref), ...dates });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("dragging-move", "dragging-resize");
      setPtoPreview(null);
      if (!commit) return;
      const p = latest.current.props;
      if (!moved) p.onSelectPto?.(ref);
      else if (dates.start !== pto.start || dates.end !== pto.end) p.onPlacePto?.(ref, dates);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") finish(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
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
    const scale = boxScale(b);
    const scaleW = 6 + String(scale).length * 7;
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
      flag && `flagged flag-${b.status}`,
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
      `${workdays(b.start, b.end)} working day${workdays(b.start, b.end) === 1 ? "" : "s"} · ${b.fte} FTE · Scale ${scale} · ${PROGRESS_NAME[stage]}${flag ? ` · ${flag}` : ""}`,
      engineers.length ? `Engineers: ${engineers.join(", ")}` : "No engineer assigned",
      b.description && `\n${b.description}`,
    ];
    return (
      <div
        key={b.id}
        data-box-id={b.id}
        // Focus can be put here (when its editor closes), not tabbed to.
        tabIndex={-1}
        className={classes.filter(Boolean).join(" ")}
        style={{ ...style, ...((showPeople || showScale) && { paddingRight: peopleW }), "--c": typeColor.get(b.type) ?? "#8a94a6" } as CSSProperties}
        title={variant === "full" && b.id !== selectedId ? tooltip.filter(Boolean).join("\n") : undefined}
        onPointerDown={interactive ? (e) => startDrag(e, b) : undefined}
        onClick={interactive || readOnly ? undefined : () => onSelect(b.id)}
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
              engineers.map((n) => (
                <span key={n} className="avatar" title={n}>
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
          <div className="tl-bands" style={{ width: scale.width }}>
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
          {reorder.line && <div className="reorder-line" style={reorder.line} />}

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
            const deptBoxes = boxes.filter((b) => b.id !== draggingId && laneDept.get(b.lane) === dept.id);
            const previewHere = preview && dragged && laneDept.get(preview.lane) === dept.id ? preview : null;
            // Each box goes in the row of the lane it's drawn in (its own, or wherever the layout found room), in time order.
            const byRow = new Map<string, { box: Box; at: Placed }[]>();
            for (const b of deptBoxes) {
              const at = layout.boxes.get(b.id);
              if (!at) continue;
              const row = at.overflow ? OVERFLOW : (laneAtSlot(layout, at.slot) ?? OVERFLOW);
              byRow.set(row, [...(byRow.get(row) ?? []), { box: b, at }]);
            }
            for (const list of byRow.values()) list.sort((a, b) => a.box.start - b.box.start || a.at.slot - b.at.slot);
            return (
              <section
                key={dept.id}
                className={`dept${reorder.draggingId === dept.id ? " reordering-this" : ""}`}
                data-dept-id={dept.id}
                data-reorder-id={dept.id}
                style={{ "--dept": dept.color } as CSSProperties}>
                <div
                  className="row dept-row"
                  style={{ height: isCollapsed && display.collapsedView !== "boxes" ? CHART_H : DEPT_H }}
                >
                  <DeptLabel
                    dept={dept}
                    now={now}
                    over={ahead}
                    collapsed={isCollapsed}
                    onToggle={() => onToggleDepartment(dept.id)}
                    onGrab={readOnly || !props.onMoveDepartment ? undefined : (e) => reorder.start(e, dept.id)}
                    onEdit={readOnly || !props.onEditDepartment ? undefined : () => props.onEditDepartment!(dept.id)}
                  />
                  <div className="track" style={{ width: scale.width }}>
                    {isCollapsed &&
                      (display.collapsedView === "boxes" ? (
                        deptBoxes.map((b) => boxEl(b, span(b.start, b.end), "compact"))
                      ) : (
                        <UseChart
                          dept={dept}
                          boxes={(props.allBoxes ?? boxes).filter((b) => laneDept.get(b.lane) === dept.id)}
                          scale={scale}
                          height={CHART_H}
                          kind={display.collapsedView}
                        />
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
                          className={`lane-row${lane ? "" : " overflow-row"}${previewHere?.lane === rowId ? " drop-target" : ""}`}
                          style={{ height: l.slots * SLOT_H }}
                        >
                          {lane ? (
                            <div className="label lane-label" style={{ width: LABEL_W }}>
                              <LaneName
                                readOnly={readOnly}
                                label={laneLabel(dept, lane)}
                                named={lane.name !== undefined}
                                onRename={(name) => props.onRenameLane(lane.id, name)}
                              />
                              {hasDates(lane) && (
                                <span className="pill lane-dates" title={`This lane holds capacity ${laneDates(lane)}`}>
                                  {laneDates(lane)}
                                </span>
                              )}
                              {lane.fte !== 1 && <span className="pill">{lane.fte} FTE</span>}
                            </div>
                          ) : (
                            <div className={`label lane-label overflow-label${over ? "" : " squeezed"}`} style={{ width: LABEL_W }}>
                              {over && !ahead.length ? (
                                <span className="overflow-note" title={`Over capacity before today: ${overloadText(stretches)}`}>
                                  Over capacity in the past
                                </span>
                              ) : over ? (
                                <span className="overflow-note warn-text" title={`Over capacity: ${overloadText(ahead)}`}>
                                  Over capacity
                                </span>
                              ) : (
                                <span className="overflow-note" title="The FTE fits, but the free space is split up, so these boxes can't be drawn in one piece inside the lanes.">
                                  Doesn’t fit side by side
                                </span>
                              )}
                            </div>
                          )}
                          <div
                            className={lane ? "track lane-track" : `track overflow-band${over ? "" : " squeezed"}`}
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
                                    <div className="lane-closed" title={title} style={{ left: 0, width: scale.x(lane.start) }} />
                                  )}
                                  {lane.end !== undefined && lane.end < scale.end && (
                                    <div
                                      className="lane-closed"
                                      title={title}
                                      style={{ left: scale.x(lane.end + 1), width: scale.width - scale.x(lane.end + 1) }}
                                    />
                                  )}
                                </>
                              );
                            })()}
                            {rowBoxes.map(({ box: b, at }) =>
                              boxEl(
                                b,
                                { ...span(b.start, b.end), top: boxTop(at.slot - l.slot), height: boxHeight(at.slots) },
                                "full",
                                at.slots,
                                over && at.slot >= layout.capacity && ahead.length > 0 && b.end >= now,
                              ),
                            )}
                            {previewHere?.lane === rowId && dragged && (
                              <>
                                {boxEl(
                                  { ...dragged, ...previewHere },
                                  {
                                    ...span(previewHere.start, previewHere.end),
                                    top: BOX_PAD,
                                    height: boxHeight(Math.max(1, Math.round(dragged.fte * 2))),
                                  },
                                  "dragging",
                                  Math.max(1, Math.round(dragged.fte * 2)),
                                )}
                                <div className="drag-dates" style={{ left: scale.x(previewHere.start), top: BOX_PAD - 21 }}>
                                  {prettyDay(previewHere.start)} – {prettyDay(previewHere.end)} ·{" "}
                                  {workdays(previewHere.start, previewHere.end)} working day{workdays(previewHere.start, previewHere.end) === 1 ? "" : "s"}
                                </div>
                              </>
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
                    <div className="row pto-row" style={{ height }}>
                      <div className="label lane-label pto-label" style={{ width: LABEL_W, height }}>
                        <span className="lane-name static">PTO</span>
                        {!readOnly && props.onCreatePto && (
                          <button
                            className="icon-button pto-add"
                            title="Add PTO (or double-click the row)"
                            aria-label={`Add PTO in ${dept.name}`}
                            onClick={() => {
                              const start = nextWorkday(now);
                              props.onCreatePto!(dept.id, { start, end: addWorkdays(start, 4) });
                            }}
                          >
                            <Icon name="plus" size={14} />
                          </button>
                        )}
                      </div>
                      <div
                        className="track pto-track"
                        data-pto-track={dept.id}
                        style={{ width: scale.width, height }}
                        onDoubleClick={readOnly || !props.onCreatePto ? undefined : (e) => createPtoAt(e, dept.id)}
                      >
                        {entries.map((entry) => {
                          const ref = { personId: entry.person.id, index: entry.index };
                          const key = ptoKey(ref);
                          const live = ptoPreview?.key === key ? { ...entry.pto, ...ptoPreview } : entry.pto;
                          const style = { ...span(live.start, live.end), top: rows.get(entry)! * SLOT_H + BOX_PAD, height: SLOT_H - BOX_PAD * 2 };
                          const days = workdays(live.start, live.end);
                          return (
                            <div
                              key={key}
                              data-pto-key={key}
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
                          <div className="drag-dates" style={{ left: scale.x(ptoPreview.start), top: -18 }}>
                            {prettyDay(ptoPreview.start)} – {prettyDay(ptoPreview.end)} · {workdays(ptoPreview.start, ptoPreview.end)} working day
                            {workdays(ptoPreview.start, ptoPreview.end) === 1 ? "" : "s"}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </section>
            );
          })}

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

          {showToday && <div className="today-line" style={{ left: LABEL_W + todayX }} />}
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
    <div className="tl-grid" style={{ left: LABEL_W, width: scale.width }}>
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
 * name (the field it was in has gone).
 */
function LaneName({
  label,
  named,
  onRename,
  readOnly,
}: {
  label: string;
  named: boolean;
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

  if (readOnly) return <span className="lane-name static">{label}</span>;

  if (text === null) {
    return (
      <button ref={button} className="lane-name" title="Click to rename this lane" onClick={() => setText(named ? label : "")}>
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
  onToggle,
  onGrab,
  onEdit,
}: {
  dept: Department;
  now: Day;
  /** Its stretches over capacity from today on. */
  over: CapacityStretch[];
  collapsed: boolean;
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
      <h3 className="dept-heading">
        <button
          className="dept-toggle"
          onClick={onToggle}
          aria-expanded={!collapsed}
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
      {onEdit && (
        <button className="icon-button dept-edit" onClick={onEdit} aria-label={`Edit ${dept.name}`} title="Edit department and lanes">
          <Icon name="pencil" size={14} />
        </button>
      )}
    </div>
  );
}

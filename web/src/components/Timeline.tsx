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
import { CollapseAll } from "./CollapseAll";
import {
  type Day,
  addMonths,
  addWorkdays,
  dayOfWorkIndex,
  dayParts,
  nextWorkday,
  prettyDay,
  prevWorkday,
  startOfMonth,
  startOfWeek,
  today as todayDay,
  workIndex,
  workdays,
} from "../model/dates";
import type { Box, Department, Roadmap, ZoomLevel } from "../model/types";
import { type DepartmentLayout, laneAtSlot, layoutDepartment } from "../timeline/layout";
import { type Scale, type Segment, headerBands, makeScale, timelineRange } from "../timeline/scale";

const LABEL_W = 240;
/** Height of half an FTE; a 1-FTE lane is two of these. */
const SLOT_H = 22;
const BOX_PAD = 3;
const DEPT_H = 34;
/** Pointer travel (px) before a press on a box becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4;
/** Drags move in whole multiples of this many working days. */
const SNAP_DAYS: Record<ZoomLevel, number> = { weeks: 1, months: 1, quarters: 5 };

export type BoxPlacement = Pick<Box, "lane" | "start" | "end">;

interface Props {
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
  /** Previewing another branch: look, don't touch. */
  readOnly?: boolean;
  /** Boxes someone else changed while we were editing them too. */
  conflictIds?: Set<string>;
  /** Boxes someone else changed since this tab loaded (for review). */
  updatedIds?: Set<string>;
  /** Broken rules, by box id: the messages to show on that box. */
  ruleWarnings?: Map<string, string[]>;
  /** Open the department editor (✎ on a department heading). */
  onEditDepartment?(id: string): void;
  onAddDepartment?(): void;
}

type DragMode = "move" | "start" | "end";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join("");

export function Timeline(props: Props) {
  const { roadmap, zoom, collapsed, onToggleDepartment, jumpToToday, selectedId, onSelect, onCreateBox, readOnly } =
    props;
  const { settings, departments, boxes, people } = roadmap;
  const fy = settings.fiscal_year_start_month;
  const now = useMemo(() => todayDay(), []);

  const [rangeStart, rangeEnd] = useMemo(() => timelineRange(boxes, now, fy), [boxes, now, fy]);
  const scale = useMemo(() => makeScale(rangeStart, rangeEnd, zoom), [rangeStart, rangeEnd, zoom]);
  const bands = useMemo(() => headerBands(scale, fy), [scale, fy]);
  const typeColor = useMemo(() => new Map(settings.types.map((t) => [t.id, t.color])), [settings.types]);
  const statusName = useMemo(() => new Map(settings.statuses.map((s) => [s.id, s.name])), [settings.statuses]);
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

  // Keep the same date centred when zooming; start with today a third of the way in.
  const scrollRef = useRef<HTMLDivElement>(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  useEffect(() => {
    if (jumpToToday > 0) scrollToDay(now, 1 / 3, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const startIdx = workIndex(nextWorkday(box.start));
    const endIdx = workIndex(box.end + 1) - 1; // last working day
    const length = Math.max(1, endIdx - startIdx + 1);
    let placement: BoxPlacement = { lane: box.lane, start: box.start, end: box.end };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.hypot(dx, ev.clientY - y0) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        document.body.classList.add(mode === "move" ? "dragging-move" : "dragging-resize");
      }
      const { props: p, scale: s, layouts: l } = latest.current;
      const snap = SNAP_DAYS[p.zoom];
      const delta = Math.round(dx / s.pxPerDay / snap) * snap;
      if (mode === "move") {
        const start = dayOfWorkIndex(startIdx + delta);
        placement = {
          lane: laneAt(ev.clientX, ev.clientY, l) ?? placement.lane,
          start,
          end: dayOfWorkIndex(startIdx + delta + length - 1),
        };
      } else if (mode === "start") {
        placement = { ...placement, start: dayOfWorkIndex(Math.min(startIdx + delta, endIdx)) };
      } else {
        placement = { ...placement, end: dayOfWorkIndex(Math.max(endIdx + delta, startIdx)) };
      }
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

  /** Double-click empty lane space: a new box sized to the zoom level. */
  const createAt = (e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-box-id]")) return;
    const lane = laneAt(e.clientX, e.clientY, layouts);
    if (!lane) return;
    const track = e.currentTarget.getBoundingClientRect();
    const day = scale.dayAt(e.clientX - track.left);
    let start = nextWorkday(day);
    let end = addWorkdays(start, 4); // a working week
    if (zoom === "months") {
      start = startOfWeek(day);
      end = addWorkdays(start, 9); // two working weeks
    } else if (zoom === "quarters") {
      start = nextWorkday(startOfMonth(day));
      end = prevWorkday(addMonths(start, 1) - 1); // the rest of the month
    }
    onCreateBox({ lane, start, end });
  };

  // ---- Rendering ------------------------------------------------------------

  const showToday = now >= scale.start && now < scale.end;
  // On a weekend the line sits on Monday's edge; on a weekday, mid-day.
  const todayX = scale.x(now) + (workdays(now, now) ? scale.pxPerDay / 2 : 0);

  const span = (start: Day, end: Day) => ({
    left: scale.x(start),
    width: Math.max(scale.pxPerDay, scale.span(start, end)),
  });

  const boxEl = (b: Box, style: CSSProperties, variant: "full" | "compact" | "dragging" = "full", slots = 2) => {
    const width = typeof style.width === "number" ? style.width : 0;
    const interactive = variant !== "compact" && !readOnly;
    const clash = props.conflictIds?.has(b.id);
    const warnings = props.ruleWarnings?.get(b.id) ?? [];
    const code = `${deptCode.get(b.lane) ?? "?"}-${b.code}`;
    const engineers = (b.engineers ?? []).map((id) => personName.get(id) ?? id);
    // Initials only where they won't crowd the title.
    const showPeople = variant !== "compact" && engineers.length > 0 && width >= 160 + 20 * engineers.length;
    // Keep their space clear: the sliding (sticky) title stops before them.
    const peopleW = showPeople ? 8 + engineers.length * (slots === 1 ? 16 : 20) + 6 : 0;
    const classes = [
      "box",
      `status-${b.status}`,
      variant !== "full" && variant,
      slots === 1 && "half",
      b.id === selectedId && "selected",
      clash && "conflict",
      props.updatedIds?.has(b.id) && "updated",
      warnings.length > 0 && "rule-broken",
    ];
    const tooltip = [
      clash && "⚠ Someone else also changed this box. You’ll choose whose version to keep when you save.\n",
      props.updatedIds?.has(b.id) && !clash && "● Changed by someone else since you opened the roadmap.\n",
      ...warnings.map((w) => `⚠ ${w}\n`),
      `${code}  ${b.title}`,
      `${prettyDay(b.start)} – ${prettyDay(b.end)}`,
      `${workdays(b.start, b.end)} working days · ${b.fte} FTE · ${statusName.get(b.status) ?? b.status}`,
      engineers.length ? `Engineers: ${engineers.join(", ")}` : "No engineer assigned",
      b.description && `\n${b.description}`,
    ];
    return (
      <div
        key={b.id}
        data-box-id={b.id}
        className={classes.filter(Boolean).join(" ")}
        style={{ ...style, ...(showPeople && { paddingRight: peopleW }), "--c": typeColor.get(b.type) ?? "#8a94a6" } as CSSProperties}
        title={variant === "full" && b.id !== selectedId ? tooltip.filter(Boolean).join("\n") : undefined}
        onPointerDown={interactive ? (e) => startDrag(e, b) : undefined}
        onClick={interactive || readOnly ? undefined : () => onSelect(b.id)}
      >
        {variant !== "compact" && (
          <span className="box-title">
            <span className="status-mark" aria-label={statusName.get(b.status) ?? b.status} />
            {(warnings.length > 0 || clash) && (
              <span className="box-warn" aria-label={warnings.length ? "Breaks a rule" : "Clash"}>
                ⚠
              </span>
            )}
            <span className="box-code">{code}</span>
            <span className="box-name">{b.title || "Untitled"}</span>
          </span>
        )}
        {showPeople && (
          <span className="box-people">
            {engineers.map((n) => (
              <span key={n} className="avatar" title={n}>
                {initials(n)}
              </span>
            ))}
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
            <CollapseAll all={props.allCollapsed} onToggle={props.onToggleAll} />
            <span>{readOnly ? "Read-only preview" : "Double-click a lane to add a box"}</span>
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
              <div className="today-flag" style={{ left: todayX }}>
                Today
              </div>
            )}
          </div>
        </div>

        <div className="tl-body">
          <Grid scale={scale} fine={bands[1]} coarse={bands[0]} zoom={zoom} />

          {departments.map((dept) => {
            const layout = layouts.get(dept.id)!;
            const isCollapsed = collapsed.has(dept.id);
            // Over capacity is FTE arithmetic; the extra area is where boxes that couldn't be drawn in the lanes go.
            const over = layout.overCapacity;
            const extra = layout.height > layout.capacity;
            const deptBoxes = boxes.filter((b) => b.id !== draggingId && laneDept.get(b.lane) === dept.id);
            const previewHere = preview && dragged && laneDept.get(preview.lane) === dept.id ? preview : null;
            const previewLane = previewHere ? layout.lanes.get(previewHere.lane) : undefined;
            return (
              <section key={dept.id} className="dept" data-dept-id={dept.id} style={{ "--dept": dept.color } as CSSProperties}>
                <div className="row dept-row" style={{ height: DEPT_H }}>
                  <DeptLabel
                    dept={dept}
                    over={over}
                    peakFte={layout.peakFte}
                    collapsed={isCollapsed}
                    onToggle={() => onToggleDepartment(dept.id)}
                    onEdit={readOnly || !props.onEditDepartment ? undefined : () => props.onEditDepartment!(dept.id)}
                  />
                  <div className="track" style={{ width: scale.width }}>
                    {isCollapsed && deptBoxes.map((b) => boxEl(b, span(b.start, b.end), "compact"))}
                  </div>
                </div>
                {!isCollapsed && (
                  <div className="row dept-body" style={{ height: layout.height * SLOT_H }}>
                    <div className="label lane-labels" style={{ width: LABEL_W }}>
                      {dept.lanes.map((lane, i) => {
                        const l = layout.lanes.get(lane.id)!;
                        return (
                          <div
                            key={lane.id}
                            className={`lane-label${previewHere?.lane === lane.id ? " drop-target" : ""}`}
                            style={{ height: l.slots * SLOT_H }}
                          >
                            <LaneName
                              readOnly={readOnly}
                              label={lane.name ?? `FTE ${i + 1}`}
                              named={lane.name !== undefined}
                              onRename={(name) => props.onRenameLane(lane.id, name)}
                            />
                            {lane.fte !== 1 && <span className="pill">{lane.fte} FTE</span>}
                          </div>
                        );
                      })}
                      {extra && (
                        <div
                          className={`lane-label overflow-label${over ? "" : " squeezed"}`}
                          style={{ height: (layout.height - layout.capacity) * SLOT_H }}
                        >
                          {over ? (
                            <span
                              className="pill warn"
                              title={`Up to ${layout.peakFte} FTE is planned at once; the lanes hold ${layout.capacity / 2} FTE.`}
                            >
                              Over capacity
                            </span>
                          ) : (
                            <span className="pill" title="The FTE fits, but the free space is split up, so these boxes can't be drawn in one piece inside the lanes.">
                              Doesn’t fit side by side
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div
                      className="track dept-track"
                      data-dept-track={dept.id}
                      style={{ width: scale.width, height: layout.height * SLOT_H }}
                      onDoubleClick={readOnly ? undefined : createAt}
                    >
                      {dept.lanes.map((lane) => {
                        const l = layout.lanes.get(lane.id)!;
                        return (
                          <div
                            key={lane.id}
                            className={`lane-band${previewHere?.lane === lane.id ? " drop-target" : ""}`}
                            data-lane={lane.id}
                            style={{ top: l.slot * SLOT_H, height: l.slots * SLOT_H }}
                          />
                        );
                      })}
                      {extra && (
                        <div
                          className={`overflow-band${over ? "" : " squeezed"}`}
                          style={{ top: layout.capacity * SLOT_H, height: (layout.height - layout.capacity) * SLOT_H }}
                        />
                      )}
                      {deptBoxes.map((b) => {
                        const p = layout.boxes.get(b.id);
                        if (!p) return null;
                        return boxEl(
                          b,
                          { ...span(b.start, b.end), top: boxTop(p.slot), height: boxHeight(p.slots) },
                          "full",
                          p.slots,
                        );
                      })}
                      {previewHere && dragged && previewLane && (
                        <>
                          {boxEl(
                            { ...dragged, ...previewHere },
                            {
                              ...span(previewHere.start, previewHere.end),
                              top: boxTop(previewLane.slot),
                              height: boxHeight(Math.max(1, Math.round(dragged.fte * 2))),
                            },
                            "dragging",
                            Math.max(1, Math.round(dragged.fte * 2)),
                          )}
                          <div
                            className="drag-dates"
                            style={{ left: scale.x(previewHere.start), top: boxTop(previewLane.slot) - 21 }}
                          >
                            {prettyDay(previewHere.start)} – {prettyDay(previewHere.end)} ·{" "}
                            {workdays(previewHere.start, previewHere.end)} working days
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </section>
            );
          })}

          {!readOnly && props.onAddDepartment && (
            <div className="row add-dept-row">
              <div className="label" style={{ width: LABEL_W }}>
                <button className="link-button add-dept" onClick={props.onAddDepartment}>
                  + Add department
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

/** Click the lane name to rename it in place. Enter or click away saves; Esc cancels; empty resets to "FTE n". */
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

  if (readOnly) return <span className="lane-name static">{label}</span>;

  if (text === null) {
    return (
      <button className="lane-name" title="Click to rename this lane" onClick={() => setText(named ? label : "")}>
        {label}
        <span className="edit-icon" aria-hidden>
          ✎
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
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setText(null);
      }}
    />
  );
}

function DeptLabel({
  dept,
  over,
  peakFte,
  collapsed,
  onToggle,
  onEdit,
}: {
  dept: Department;
  over: boolean;
  peakFte: number;
  collapsed: boolean;
  onToggle(): void;
  onEdit?(): void;
}) {
  const fte = dept.lanes.reduce((sum, l) => sum + l.fte, 0);
  return (
    <div className="label dept-label" style={{ width: LABEL_W }}>
      <button
        className="dept-toggle"
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={over ? `Over capacity: up to ${peakFte} FTE planned at once, ${fte} FTE available.` : undefined}
      >
        <span className={`chevron${collapsed ? "" : " open"}`}>▸</span>
        <span className="dept-name">{dept.name}</span>
        <span className="dept-meta">
          {fte} FTE{over && <span className="warn-text"> · {peakFte} planned</span>}
        </span>
      </button>
      {onEdit && (
        <button className="icon-button dept-edit" onClick={onEdit} aria-label={`Edit ${dept.name}`} title="Edit department and lanes">
          ✎
        </button>
      )}
    </div>
  );
}

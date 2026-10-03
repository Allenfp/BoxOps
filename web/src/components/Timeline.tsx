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
import { type Day, addMonths, dayParts, prettyDay, startOfMonth, startOfWeek, today as todayDay } from "../model/dates";
import type { Box, Department, Lane, Roadmap, ZoomLevel } from "../model/types";
import { type Scale, type Segment, headerBands, makeScale, packRows, timelineRange } from "../timeline/scale";

const LABEL_W = 240;
const ROW_H = 34;
const DEPT_H = 34;
/** Pointer travel (px) before a press on a box becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4;
/** Drags move in whole multiples of this many days. */
const SNAP_DAYS: Record<ZoomLevel, number> = { weeks: 1, months: 1, quarters: 7 };

export type BoxPlacement = Pick<Box, "lane" | "start" | "end">;

interface Props {
  roadmap: Roadmap;
  zoom: ZoomLevel;
  collapsed: Set<string>;
  onToggleDepartment(id: string): void;
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
}

interface LaneLayout {
  lane: Lane;
  label: string;
  boxes: Box[];
  row: Map<string, number>;
  rows: number;
}

type DragMode = "move" | "start" | "end";

export function Timeline(props: Props) {
  const { roadmap, zoom, collapsed, onToggleDepartment, jumpToToday, selectedId, onSelect, onCreateBox, readOnly } =
    props;
  const { settings, departments, boxes } = roadmap;
  const fy = settings.fiscal_year_start_month;
  const now = useMemo(() => todayDay(), []);

  const [rangeStart, rangeEnd] = useMemo(() => timelineRange(boxes, now, fy), [boxes, now, fy]);
  const scale = useMemo(() => makeScale(rangeStart, rangeEnd, zoom), [rangeStart, rangeEnd, zoom]);
  const bands = useMemo(() => headerBands(scale, fy), [scale, fy]);
  const typeColor = useMemo(() => new Map(settings.types.map((t) => [t.id, t.color])), [settings.types]);
  const statusName = useMemo(() => new Map(settings.statuses.map((s) => [s.id, s.name])), [settings.statuses]);

  // While a box is dragged it is left out of lane packing, so rows don't jump around under the pointer.
  const [preview, setPreview] = useState<(BoxPlacement & { id: string }) | null>(null);
  const draggingId = preview?.id ?? null;

  const lanesByDept = useMemo(() => {
    const byLane = new Map<string, Box[]>();
    for (const b of boxes) {
      if (b.id === draggingId) continue;
      byLane.set(b.lane, [...(byLane.get(b.lane) ?? []), b]);
    }
    return new Map(
      departments.map((d) => [
        d.id,
        d.lanes.map((lane, i): LaneLayout => {
          const laneBoxes = byLane.get(lane.id) ?? [];
          return { lane, label: lane.name ?? `FTE ${i + 1}`, boxes: laneBoxes, ...packRows(laneBoxes) };
        }),
      ]),
    );
  }, [boxes, departments, draggingId]);

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

  // ---- Dragging -------------------------------------------------------------
  // Listeners go on window, not pointer capture: a box dragged to another lane
  // re-mounts under a different row, which would drop the capture.

  const latest = useRef(props);
  latest.current = props;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

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
      const snap = SNAP_DAYS[latest.current.zoom];
      const delta = Math.round(dx / scaleRef.current.pxPerDay / snap) * snap;
      if (mode === "move") {
        const laneEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-lane]");
        placement = { lane: laneEl?.dataset.lane ?? placement.lane, start: box.start + delta, end: box.end + delta };
      } else if (mode === "start") {
        placement = { ...placement, start: Math.min(box.start + delta, box.end) };
      } else {
        placement = { ...placement, end: Math.max(box.end + delta, box.start) };
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
        latest.current.onSelect(box.id);
        return;
      }
      const changed = placement.lane !== box.lane || placement.start !== box.start || placement.end !== box.end;
      if (changed) latest.current.onPlaceBox(box.id, placement);
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
  const createAt = (e: ReactMouseEvent<HTMLDivElement>, laneId: string) => {
    if (e.target !== e.currentTarget) return;
    const day = scale.dayAt(e.clientX - e.currentTarget.getBoundingClientRect().left);
    let start = day;
    let end = day + 4;
    if (zoom === "months") {
      start = startOfWeek(day);
      end = start + 13;
    } else if (zoom === "quarters") {
      start = startOfMonth(day);
      end = addMonths(start, 1) - 1;
    }
    onCreateBox({ lane: laneId, start, end });
  };

  // ---- Rendering ------------------------------------------------------------

  const showToday = now >= scale.start && now < scale.end;
  const todayX = scale.x(now) + scale.pxPerDay / 2;

  const span = (start: Day, end: Day) => ({
    left: scale.x(start),
    width: Math.max(scale.pxPerDay, (end - start + 1) * scale.pxPerDay),
  });

  const boxEl = (b: Box, style: CSSProperties, variant: "full" | "compact" | "dragging" = "full") => {
    const width = typeof style.width === "number" ? style.width : 0;
    const interactive = variant !== "compact" && !readOnly;
    const clash = props.conflictIds?.has(b.id);
    const classes = [
      "box",
      `status-${b.status}`,
      variant !== "full" && variant,
      b.id === selectedId && "selected",
      clash && "conflict",
      props.updatedIds?.has(b.id) && "updated",
    ];
    return (
      <div
        key={b.id}
        data-box-id={b.id}
        className={classes.filter(Boolean).join(" ")}
        style={{ ...style, "--c": typeColor.get(b.type) ?? "#8a94a6" } as CSSProperties}
        title={
          variant === "full" && b.id !== selectedId
            ? `${clash ? "⚠ Someone else also changed this box. You’ll choose whose version to keep when you save.\n\n" : ""}${
                props.updatedIds?.has(b.id) && !clash ? "● Changed by someone else since you opened the roadmap.\n\n" : ""
              }${b.title}\n${prettyDay(b.start)} – ${prettyDay(b.end)}\n${statusName.get(b.status) ?? b.status}${
                b.description ? `\n\n${b.description}` : ""
              }`
            : undefined
        }
        onPointerDown={interactive ? (e) => startDrag(e, b) : undefined}
        onClick={interactive || readOnly ? undefined : () => onSelect(b.id)}
      >
        {variant !== "compact" && <span className="box-title">{b.title || "Untitled"}</span>}
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
            <span>{readOnly ? "Read-only preview" : "Double-click a lane to add a box"}</span>
          </div>
          <div className="tl-bands" style={{ width: scale.width }}>
            {bands.map((band, i) => (
              <div key={i} className={`tl-band band-${i}`}>
                {band.map((s) => (
                  <BandCell
                    key={s.start}
                    seg={s}
                    scale={scale}
                    weekend={zoom === "weeks" && i === 1 && dayParts(s.start).weekday >= 5}
                  />
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
            const lanes = lanesByDept.get(dept.id) ?? [];
            const isCollapsed = collapsed.has(dept.id);
            return (
              <section key={dept.id} className="dept" style={{ "--dept": dept.color } as CSSProperties}>
                <div className="row dept-row" style={{ height: DEPT_H }}>
                  <DeptLabel
                    dept={dept}
                    lanes={lanes}
                    collapsed={isCollapsed}
                    onToggle={() => onToggleDepartment(dept.id)}
                  />
                  <div className="track" style={{ width: scale.width }}>
                    {isCollapsed &&
                      lanes.flatMap((l) => l.boxes).map((b) => boxEl(b, span(b.start, b.end), "compact"))}
                  </div>
                </div>
                {!isCollapsed &&
                  lanes.map((l) => {
                    const isTarget = preview?.lane === l.lane.id;
                    return (
                      <div
                        key={l.lane.id}
                        className={`row lane-row${l.rows > 1 ? " over" : ""}${isTarget ? " drop-target" : ""}`}
                        style={{ height: l.rows * ROW_H }}
                      >
                        <div className="label lane-label" style={{ width: LABEL_W }}>
                          <LaneName
                            readOnly={readOnly}
                            label={l.label}
                            named={l.lane.name !== undefined}
                            onRename={(name) => props.onRenameLane(l.lane.id, name)}
                          />
                          {l.lane.fte !== 1 && <span className="pill">{l.lane.fte} FTE</span>}
                          {l.rows > 1 && (
                            <span className="pill warn" title="Boxes overlap: this lane is over-allocated">
                              overlap
                            </span>
                          )}
                        </div>
                        <div
                          className="track"
                          data-lane={l.lane.id}
                          style={{ width: scale.width }}
                          onDoubleClick={readOnly ? undefined : (e) => createAt(e, l.lane.id)}
                        >
                          {l.boxes.map((b) =>
                            boxEl(b, { ...span(b.start, b.end), top: (l.row.get(b.id) ?? 0) * ROW_H + 4 }),
                          )}
                          {isTarget && dragged && preview && (
                            <>
                              {boxEl({ ...dragged, ...preview }, { ...span(preview.start, preview.end), top: 4 }, "dragging")}
                              <div className="drag-dates" style={{ left: scale.x(preview.start) }}>
                                {prettyDay(preview.start)} – {prettyDay(preview.end)}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </section>
            );
          })}

          {showToday && <div className="today-line" style={{ left: LABEL_W + todayX }} />}
        </div>
      </div>
    </div>
  );
}

function BandCell({ seg, scale, weekend }: { seg: Segment; scale: Scale; weekend: boolean }) {
  return (
    <div
      className={`band-cell${weekend ? " weekend" : ""}`}
      style={{ left: scale.x(seg.start), width: (seg.end - seg.start) * scale.pxPerDay }}
    >
      <span>{seg.label}</span>
    </div>
  );
}

/** Vertical grid lines behind the rows; weekends shaded at week zoom. */
function Grid({ scale, fine, coarse, zoom }: { scale: Scale; fine: Segment[]; coarse: Segment[]; zoom: ZoomLevel }) {
  const major = new Set(coarse.map((s) => s.start));
  return (
    <div className="tl-grid" style={{ left: LABEL_W, width: scale.width }}>
      {fine.map((s) =>
        zoom === "weeks" && dayParts(s.start).weekday >= 5 ? (
          <div key={`w${s.start}`} className="weekend-shade" style={{ left: scale.x(s.start), width: scale.pxPerDay }} />
        ) : null,
      )}
      {fine.map((s) => (
        <div key={s.start} className={`grid-line${major.has(s.start) ? " major" : ""}`} style={{ left: scale.x(s.start) }} />
      ))}
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
  lanes,
  collapsed,
  onToggle,
}: {
  dept: Department;
  lanes: LaneLayout[];
  collapsed: boolean;
  onToggle(): void;
}) {
  const fte = lanes.reduce((sum, l) => sum + l.lane.fte, 0);
  const over = lanes.filter((l) => l.rows > 1).length;
  return (
    <button className="label dept-label" style={{ width: LABEL_W }} onClick={onToggle} aria-expanded={!collapsed}>
      <span className={`chevron${collapsed ? "" : " open"}`}>▸</span>
      <span className="dept-name">{dept.name}</span>
      <span className="dept-meta">
        {fte} FTE{over > 0 && <span className="warn-text"> · {over} over</span>}
      </span>
    </button>
  );
}

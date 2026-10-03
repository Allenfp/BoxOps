import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatDay, parseDay, prettyDay } from "../model/dates";
import type { Box, Department, Settings } from "../model/types";

const WIDTH = 360;
const GAP = 8;

interface Props {
  box: Box;
  settings: Settings;
  departments: Department[];
  /** `field` groups keystrokes in one field into a single undo step. */
  onChange(patch: Partial<Box>, field: string): void;
  onDelete(): void;
  onClose(): void;
}

const splitList = (text: string, sep: RegExp) =>
  text
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);

export function BoxEditor({ box, settings, departments, onChange, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Free-text list fields keep their raw text while typing so commas and newlines aren't eaten.
  const [tagsText, setTagsText] = useState(() => (box.tags ?? []).join(", "));
  const [linksText, setLinksText] = useState(() => (box.links ?? []).join("\n"));

  // Sit below the box (or above if there's no room), and follow it while the timeline scrolls.
  useLayoutEffect(() => {
    const place = () => {
      const pop = ref.current;
      const anchor = document.querySelector(`[data-box-id="${CSS.escape(box.id)}"]`);
      if (!pop) return;
      const h = pop.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (!anchor) {
        setPos({ top: Math.max(GAP, (vh - h) / 2), left: Math.max(GAP, (vw - WIDTH) / 2) });
        return;
      }
      const r = anchor.getBoundingClientRect();
      const clampTop = (t: number) => Math.min(Math.max(GAP, t), Math.max(GAP, vh - h - GAP));
      const clampLeft = (l: number) => Math.min(Math.max(GAP, l), vw - WIDTH - GAP);
      let top: number;
      let left: number;
      if (r.bottom + GAP + h <= vh - GAP) {
        top = r.bottom + GAP;
        left = clampLeft(r.left);
      } else if (r.top - GAP - h >= GAP) {
        top = r.top - GAP - h;
        left = clampLeft(r.left);
      } else {
        // No room above or below: sit beside the box rather than on top of it.
        top = clampTop(r.top - 40);
        const right = Math.min(r.right, vw) + GAP;
        left = right + WIDTH <= vw - GAP ? right : clampLeft(Math.max(r.left, 0) - WIDTH - GAP);
      }
      setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [box]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      // Clicking another box re-targets the editor instead of closing it.
      if (!ref.current?.contains(t) && !t.closest("[data-box-id]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  const setStart = (text: string) => {
    const start = parseDay(text);
    if (start === null) return;
    onChange(start > box.end ? { start, end: start } : { start }, "start");
  };
  const setEnd = (text: string) => {
    const end = parseDay(text);
    if (end === null) return;
    onChange(end < box.start ? { end, start: end } : { end }, "end");
  };

  const epicValid = !box.epic || /^https?:\/\/\S+$/.test(box.epic);
  const days = box.end - box.start + 1;
  const typeColor = settings.types.find((t) => t.id === box.type)?.color;

  return (
    <div
      ref={ref}
      className="editor"
      role="dialog"
      aria-label={`Edit ${box.title || "box"}`}
      style={{ width: WIDTH, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      <div className="editor-head" style={{ borderTopColor: typeColor }}>
        <input
          className="editor-title"
          value={box.title}
          placeholder="Box title"
          autoFocus
          onFocus={(e) => box.title === "New box" && e.currentTarget.select()}
          onChange={(e) => onChange({ title: e.target.value }, "title")}
        />
        <button className="icon-button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {!box.title.trim() && <p className="field-error">A title is required.</p>}

      <div className="editor-grid">
        <label>
          Type
          <select value={box.type} onChange={(e) => onChange({ type: e.target.value }, "type")}>
            {settings.types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={box.status} onChange={(e) => onChange({ status: e.target.value }, "status")}>
            {settings.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Start
          <input type="date" value={formatDay(box.start)} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          End
          <input type="date" value={formatDay(box.end)} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="span-2">
          Lane
          <select value={box.lane} onChange={(e) => onChange({ lane: e.target.value }, "lane")}>
            {departments.map((d) => (
              <optgroup key={d.id} label={d.name}>
                {d.lanes.map((l, i) => (
                  <option key={l.id} value={l.id}>
                    {l.name ?? `FTE ${i + 1}`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="span-2">
          Epic link
          <span className="with-action">
            <input
              type="url"
              placeholder="https://…"
              value={box.epic ?? ""}
              onChange={(e) => onChange({ epic: e.target.value.trim() || undefined }, "epic")}
            />
            {box.epic && epicValid && (
              <a className="button-link" href={box.epic} target="_blank" rel="noopener noreferrer">
                Open ↗
              </a>
            )}
          </span>
          {!epicValid && <span className="field-error">Use a full http(s) link.</span>}
        </label>
        <label className="span-2">
          Description
          <textarea
            rows={2}
            value={box.description ?? ""}
            onChange={(e) => onChange({ description: e.target.value || undefined }, "description")}
          />
        </label>
        <label className="span-2">
          <span>
            Tags <span className="hint">comma separated</span>
          </span>
          <input
            value={tagsText}
            onChange={(e) => {
              setTagsText(e.target.value);
              onChange({ tags: splitList(e.target.value, /,/) }, "tags");
            }}
          />
        </label>
        <label className="span-2">
          <span>
            Other links <span className="hint">one per line</span>
          </span>
          <textarea
            rows={2}
            value={linksText}
            onChange={(e) => {
              setLinksText(e.target.value);
              onChange({ links: splitList(e.target.value, /\n/) }, "links");
            }}
          />
        </label>
      </div>

      <div className="editor-foot">
        <span className="hint">
          {prettyDay(box.start)} – {prettyDay(box.end)} · {days} day{days === 1 ? "" : "s"}
        </span>
        <button className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

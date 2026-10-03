import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { formatDay, parseDay } from "../model/dates";
import type { Box, Roadmap } from "../model/types";

interface Props {
  roadmap: Roadmap;
  readOnly?: boolean;
  conflictIds?: Set<string>;
  updatedIds?: Set<string>;
  /**
   * Patch a box. `key` groups repeated edits of one cell into one undo step.
   * Returns the box's id afterwards (an unsaved box's id follows its title).
   */
  onUpdate(id: string, patch: Partial<Box>, key?: string): string;
  /** Add a box; returns its id. */
  onAdd(): string;
  onDelete(id: string): void;
  /** A cell lost focus: end its undo step. */
  onCheckpoint(): void;
  /** The user looked at this row (clears its "changed by someone else" mark). */
  onReviewed(id: string): void;
}

type SortKey = "title" | "lane" | "start" | "end" | "days" | "type" | "status";

const COLUMNS: { key: SortKey | null; label: string; className?: string }[] = [
  { key: "title", label: "Title", className: "col-title" },
  { key: "lane", label: "Department / lane", className: "col-lane" },
  { key: "start", label: "Start", className: "col-date" },
  { key: "end", label: "End", className: "col-date" },
  { key: "days", label: "Days", className: "col-days" },
  { key: "type", label: "Type", className: "col-type" },
  { key: "status", label: "Status", className: "col-status" },
  { key: null, label: "Epic link", className: "col-epic" },
  { key: null, label: "Tags", className: "col-tags" },
  { key: null, label: "Description", className: "col-desc" },
  { key: null, label: "", className: "col-actions" },
];

const tagsText = (b: Box) => (b.tags ?? []).join(", ");
const splitTags = (t: string) =>
  t
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function TableView(props: Props) {
  const { roadmap, readOnly, conflictIds, updatedIds, onUpdate, onAdd, onDelete, onCheckpoint, onReviewed } = props;
  const { settings, departments, boxes } = roadmap;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "lane", dir: 1 });
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);

  // Lane order and labels, for the lane column and for sorting by it.
  const lanes = useMemo(() => {
    const out = new Map<string, { label: string; dept: string; order: number; color: string }>();
    let order = 0;
    for (const d of departments) {
      d.lanes.forEach((l, i) => out.set(l.id, { label: l.name ?? `FTE ${i + 1}`, dept: d.name, order: order++, color: d.color }));
    }
    return out;
  }, [departments]);
  const typeIndex = useMemo(() => new Map(settings.types.map((t, i) => [t.id, i])), [settings.types]);
  const statusIndex = useMemo(() => new Map(settings.statuses.map((s, i) => [s.id, i])), [settings.statuses]);
  const typeColor = useMemo(() => new Map(settings.types.map((t) => [t.id, t.color])), [settings.types]);

  // Rows keep a stable React key even when an unsaved box's id follows its title,
  // so tabbing out of a renamed title doesn't drop focus from the next cell.
  const rowKeys = useRef(new Map<string, string>());
  const keyFor = (id: string) => {
    if (!rowKeys.current.has(id)) rowKeys.current.set(id, id);
    return rowKeys.current.get(id)!;
  };
  const update = (id: string, patch: Partial<Box>, key?: string) => {
    const next = onUpdate(id, patch, key);
    if (next !== id) rowKeys.current.set(next, keyFor(id));
    return next;
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? boxes.filter((b) =>
          [b.title, b.description ?? "", tagsText(b), lanes.get(b.lane)?.label ?? "", lanes.get(b.lane)?.dept ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : boxes;
    const value = (b: Box): number | string => {
      switch (sort.key) {
        case "title":
          return b.title.toLowerCase();
        case "lane":
          return (lanes.get(b.lane)?.order ?? 1e6) * 1e6 + b.start;
        case "start":
          return b.start;
        case "end":
          return b.end;
        case "days":
          return b.end - b.start;
        case "type":
          return typeIndex.get(b.type) ?? 99;
        case "status":
          return statusIndex.get(b.status) ?? 99;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return (va < vb ? -1 : va > vb ? 1 : a.start - b.start || a.id.localeCompare(b.id)) * sort.dir;
    });
  }, [boxes, query, sort, lanes, typeIndex, statusIndex]);

  const setStart = (b: Box, text: string) => {
    const start = parseDay(text);
    if (start !== null) update(b.id, start > b.end ? { start, end: start } : { start }, `table:${b.id}:start`);
  };
  const setEnd = (b: Box, text: string) => {
    const end = parseDay(text);
    if (end !== null) update(b.id, end < b.start ? { end, start: end } : { end }, `table:${b.id}:end`);
  };

  return (
    <div className="table-view">
      <div className="table-toolbar">
        <input
          className="table-search"
          type="search"
          placeholder="Search titles, tags, lanes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="hint">
          {rows.length === boxes.length ? `${boxes.length} boxes` : `${rows.length} of ${boxes.length} boxes`}
        </span>
        {!readOnly && (
          <button
            className="primary"
            onClick={() => {
              setQuery("");
              setFocusId(onAdd());
            }}
          >
            + Add box
          </button>
        )}
      </div>

      <div className="table-scroll">
        <table className="box-table">
          <thead>
            <tr>
              {COLUMNS.map((c, i) => (
                <th key={i} className={c.className} aria-sort={c.key === sort.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  {c.key ? (
                    <button
                      className="sort-button"
                      onClick={() => setSort((s) => ({ key: c.key!, dir: s.key === c.key ? ((-s.dir) as 1 | -1) : 1 }))}
                    >
                      {c.label}
                      <span className="sort-mark">{c.key === sort.key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const lane = lanes.get(b.lane);
              const classes = [conflictIds?.has(b.id) && "conflict", updatedIds?.has(b.id) && "updated"];
              return (
                <tr
                  key={keyFor(b.id)}
                  className={classes.filter(Boolean).join(" ")}
                  style={{ "--dept": lane?.color } as CSSProperties}
                  onFocusCapture={() => updatedIds?.has(b.id) && onReviewed(b.id)}
                  title={
                    conflictIds?.has(b.id)
                      ? "Someone else also changed this box. You’ll choose whose version to keep when you save."
                      : updatedIds?.has(b.id)
                        ? "Changed by someone else since you opened the roadmap."
                        : undefined
                  }
                >
                  <td className="col-title">
                    <TextCell
                      value={b.title}
                      readOnly={readOnly}
                      required
                      autoFocus={focusId === b.id}
                      onCommit={(title) => update(b.id, { title })}
                      onBlur={onCheckpoint}
                      ariaLabel="Title"
                    />
                  </td>
                  <td className="col-lane">
                    <select
                      value={b.lane}
                      disabled={readOnly}
                      aria-label="Lane"
                      onChange={(e) => update(b.id, { lane: e.target.value })}
                    >
                      {departments.map((d) => (
                        <optgroup key={d.id} label={d.name}>
                          {d.lanes.map((l, i) => (
                            <option key={l.id} value={l.id}>
                              {d.name} / {l.name ?? `FTE ${i + 1}`}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="col-date">
                    <input
                      type="date"
                      value={formatDay(b.start)}
                      disabled={readOnly}
                      aria-label="Start"
                      onChange={(e) => setStart(b, e.target.value)}
                      onBlur={onCheckpoint}
                    />
                  </td>
                  <td className="col-date">
                    <input
                      type="date"
                      value={formatDay(b.end)}
                      disabled={readOnly}
                      aria-label="End"
                      onChange={(e) => setEnd(b, e.target.value)}
                      onBlur={onCheckpoint}
                    />
                  </td>
                  <td className="col-days">{b.end - b.start + 1}</td>
                  <td className="col-type">
                    <span className="type-cell">
                      <span className="swatch" style={{ background: typeColor.get(b.type) }} />
                      <select
                        value={b.type}
                        disabled={readOnly}
                        aria-label="Type"
                        onChange={(e) => update(b.id, { type: e.target.value })}
                      >
                        {settings.types.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </span>
                  </td>
                  <td className="col-status">
                    <select
                      className={`status-select status-${b.status}`}
                      value={b.status}
                      disabled={readOnly}
                      aria-label="Status"
                      onChange={(e) => update(b.id, { status: e.target.value })}
                    >
                      {settings.statuses.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="col-epic">
                    <span className="epic-cell">
                      <TextCell
                        value={b.epic ?? ""}
                        readOnly={readOnly}
                        placeholder="https://…"
                        invalid={(v) => v !== "" && !/^https?:\/\/\S+$/.test(v)}
                        onCommit={(v) => update(b.id, { epic: v || undefined })}
                        onBlur={onCheckpoint}
                        ariaLabel="Epic link"
                      />
                      {b.epic && /^https?:\/\//.test(b.epic) && (
                        <a href={b.epic} target="_blank" rel="noopener noreferrer" title="Open epic" className="open-link">
                          ↗
                        </a>
                      )}
                    </span>
                  </td>
                  <td className="col-tags">
                    <TextCell
                      value={tagsText(b)}
                      readOnly={readOnly}
                      placeholder="tag, tag"
                      onCommit={(v) => update(b.id, { tags: splitTags(v) })}
                      onBlur={onCheckpoint}
                      ariaLabel="Tags"
                    />
                  </td>
                  <td className="col-desc">
                    <TextCell
                      value={b.description ?? ""}
                      readOnly={readOnly}
                      onCommit={(v) => update(b.id, { description: v || undefined })}
                      onBlur={onCheckpoint}
                      ariaLabel="Description"
                    />
                  </td>
                  <td className="col-actions">
                    {!readOnly && (
                      <button className="icon-button row-delete" title="Delete box" aria-label={`Delete ${b.title}`} onClick={() => onDelete(b.id)}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">No boxes match “{query}”.</p>}
      </div>
    </div>
  );
}

/**
 * A spreadsheet-style text cell: edits locally, saves on Enter or when focus
 * leaves, Esc puts the old value back. One saved edit = one undo step.
 */
function TextCell({
  value,
  onCommit,
  onBlur,
  readOnly,
  placeholder,
  required,
  invalid,
  autoFocus,
  ariaLabel,
}: {
  value: string;
  onCommit(value: string): void;
  onBlur(): void;
  readOnly?: boolean;
  placeholder?: string;
  required?: boolean;
  invalid?(value: string): boolean;
  autoFocus?: boolean;
  ariaLabel: string;
}) {
  const [text, setText] = useState(value);
  const editing = useRef(false);
  const ref = useRef<HTMLInputElement>(null);

  // Follow outside changes (undo, someone else's save) unless mid-edit.
  useEffect(() => {
    if (!editing.current) setText(value);
  }, [value]);

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      ref.current.select();
      ref.current.scrollIntoView({ block: "nearest" });
    }
  }, [autoFocus]);

  const bad = (required && !text.trim()) || invalid?.(text.trim());
  return (
    <input
      ref={ref}
      className={`cell-input${bad ? " invalid" : ""}`}
      value={text}
      placeholder={placeholder}
      disabled={readOnly}
      aria-label={ariaLabel}
      aria-invalid={bad || undefined}
      onFocus={() => (editing.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        editing.current = false;
        if (text !== value) onCommit(text.trim() === "" && !required ? "" : text);
        onBlur();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setText(value);
          editing.current = false;
          // Let the blur that follows see the restored value.
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
    />
  );
}

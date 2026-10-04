import { type CSSProperties, useMemo, useRef, useState } from "react";
import { NO_FLAG } from "../model/status";
import { boxScale } from "../model/scale";
import { jiraKey } from "../model/jira";
import { ScaleBadge } from "./ScaleBadge";
import { CollapseAll } from "./CollapseAll";
import { formatDay, nextWorkday, parseDay, prevWorkday, workdays } from "../model/dates";
import { BOX_FTE_OPTIONS, type Box, type Roadmap, type TimeOff } from "../model/types";
import { type PtoRef, ptoEntries, ptoKey } from "../model/pto";
import { capacityOn, hasDates, laneDates } from "../model/lanes";
import { today } from "../model/dates";
import { EngineerPicker } from "./EngineerPicker";
import { TextCell } from "./TextCell";
import { Icon } from "./Icon";
import { DateInput } from "./DateInput";

interface Props {
  roadmap: Roadmap;
  /** Show PTO rows under each department (a personal preference). */
  showPto?: boolean;
  /** Hide boxes that ended before today (a personal preference, shared with the timeline). */
  hideFinished?: boolean;
  onHideFinished?(hide: boolean): void;
  readOnly?: boolean;
  conflictIds?: Set<string>;
  updatedIds?: Set<string>;
  /**
   * Patch a box. `key` groups repeated edits of one cell into one undo step.
   * Returns the box's id afterwards (an unsaved box's id follows its title).
   */
  onUpdate(id: string, patch: Partial<Box>, key?: string): string;
  /** Add someone to the engineer roster; returns their id. */
  onAddPerson(name: string, department?: string): string;
  /** Add a box (to this department's first lane, if given); returns its id. */
  onAdd(departmentId?: string): string;
  /** Collapsed departments; shared with the timeline. */
  collapsed: Set<string>;
  onToggleDepartment(id: string): void;
  allCollapsed: boolean;
  onToggleAll(): void;
  onDelete(id: string): void;
  /** A cell lost focus: end its undo step. */
  onCheckpoint(): void;
  /** The user looked at this row (clears its "changed by someone else" mark). */
  onReviewed(id: string): void;
  /** Open the department editor. */
  onEditDepartment?(id: string): void;
  onAddDepartment?(): void;
  /** Broken rules, by box id. */
  ruleWarnings?: Map<string, string[]>;
  /** PTO rows: edit, reassign, add (to a department's first engineer) and remove. */
  onUpdatePto?(ref: PtoRef, patch: Partial<TimeOff>, key?: string): void;
  onReassignPto?(ref: PtoRef, personId: string): void;
  onAddPto?(departmentId: string): void;
  onRemovePto?(ref: PtoRef): void;
}

type SortKey = "title" | "lane" | "start" | "end" | "days" | "fte" | "scale" | "engineers" | "type" | "status";

const COLUMNS: { key: SortKey | null; label: string; className?: string }[] = [
  { key: "title", label: "Title", className: "col-title" },
  { key: "lane", label: "Department / lane", className: "col-lane" },
  { key: "start", label: "Start", className: "col-date" },
  { key: "end", label: "End", className: "col-date" },
  { key: "days", label: "Work days", className: "col-days" },
  { key: "fte", label: "FTE", className: "col-fte" },
  { key: "scale", label: "Scale", className: "col-scale" },
  { key: "engineers", label: "Engineers", className: "col-engineers" },
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
  const { collapsed, onToggleDepartment, onAddPerson, ruleWarnings } = props;
  const { settings, departments, boxes, people } = roadmap;
  const personName = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const engineerNames = (b: Box) => (b.engineers ?? []).map((id) => personName.get(id) ?? id).join(", ");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "lane", dir: 1 });
  const [query, setQuery] = useState("");
  // Date filter: boxes (and PTO) that overlap these dates; either end can be open.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const fromDay = parseDay(from);
  const toDay = parseDay(to);
  const inDates = (start: number, end: number) => (fromDay === null || end >= fromDay) && (toDay === null || start <= toDay);
  const now = today();
  const [focusId, setFocusId] = useState<string | null>(null);

  // Lane order and labels, for the lane column and for sorting by it.
  const lanes = useMemo(() => {
    const out = new Map<string, { label: string; dept: string; deptId: string; deptCode: string; order: number; color: string }>();
    let order = 0;
    for (const d of departments) {
      d.lanes.forEach((l, i) =>
        out.set(l.id, {
          label: l.name ?? `FTE ${i + 1}`,
          dept: d.name,
          deptId: d.id,
          deptCode: d.code,
          order: order++,
          color: d.color,
        }),
      );
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
    const dated = boxes.filter((b) => inDates(b.start, b.end) && !(props.hideFinished && b.end < now));
    const filtered = q
      ? dated.filter((b) =>
          [
            `${lanes.get(b.lane)?.deptCode ?? ""}-${b.code}`,
            jiraKey(b.epic) ?? "",
            b.title,
            b.description ?? "",
            tagsText(b),
            lanes.get(b.lane)?.label ?? "",
            lanes.get(b.lane)?.dept ?? "",
            engineerNames(b),
          ]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : dated;
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
          return workdays(b.start, b.end);
        case "fte":
          return b.fte;
        case "scale":
          return boxScale(b);
        case "engineers":
          return engineerNames(b).toLowerCase() || "\uffff"; // unassigned last
        case "type":
          return typeIndex.get(b.type) ?? 99;
        case "status":
          return b.status === undefined ? 99 : (statusIndex.get(b.status) ?? 98); // flagged first
      }
    };
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return (va < vb ? -1 : va > vb ? 1 : a.start - b.start || a.id.localeCompare(b.id)) * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes, query, sort, lanes, typeIndex, statusIndex, personName, fromDay, toDay, props.hideFinished, now]);

  // Sorted rows, bucketed by department (in department order).
  const groups = useMemo(() => {
    const byDept = new Map<string, Box[]>(departments.map((d) => [d.id, []]));
    for (const b of rows) byDept.get(lanes.get(b.lane)?.deptId ?? "")?.push(b);
    return departments.map((d) => ({ dept: d, rows: byDept.get(d.id) ?? [] }));
  }, [rows, departments, lanes]);
  // Searching or a date filter: show only matching rows, with their departments open.
  const searching = query.trim() !== "" || fromDay !== null || toDay !== null;

  // PTO rows, by department (their owner's), earliest first; a search matches names and notes.
  const ptoByDept = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = new Map<string, ReturnType<typeof ptoEntries>>();
    if (props.showPto === false) return out;
    for (const e of ptoEntries(people).sort((a, b) => a.pto.start - b.pto.start)) {
      if (!e.person.department) continue;
      if (!inDates(e.pto.start, e.pto.end)) continue;
      if (q && !`pto ${e.person.name} ${e.pto.note ?? ""}`.toLowerCase().includes(q)) continue;
      out.set(e.person.department, [...(out.get(e.person.department) ?? []), e]);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, query, props.showPto, fromDay, toDay]);
  const ptoDates = (ref: PtoRef, pto: TimeOff, field: "start" | "end", text: string) => {
    const picked = parseDay(text);
    if (picked === null) return;
    const key = `table:${ptoKey(ref)}:${field}`;
    if (field === "start") {
      const start = nextWorkday(picked);
      props.onUpdatePto?.(ref, start > pto.end ? { start, end: start } : { start }, key);
    } else {
      const end = prevWorkday(picked);
      props.onUpdatePto?.(ref, end < pto.start ? { end, start: end } : { end }, key);
    }
  };

  // Weekends don't exist on the roadmap: a weekend start moves to Monday, a weekend end to Friday.
  const setStart = (b: Box, text: string) => {
    const picked = parseDay(text);
    if (picked === null) return;
    const start = nextWorkday(picked);
    update(b.id, start > b.end ? { start, end: start } : { start }, `table:${b.id}:start`);
  };
  const setEnd = (b: Box, text: string) => {
    const picked = parseDay(text);
    if (picked === null) return;
    const end = prevWorkday(picked);
    update(b.id, end < b.start ? { end, start: end } : { end }, `table:${b.id}:end`);
  };

  return (
    <div className="table-view">
      <div className="table-toolbar">
        <input
          className="table-search"
          type="search"
          placeholder="Search codes, titles, tags, lanes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="date-filter" role="group" aria-label="Dates">
          <DateInput value={from} onChange={setFrom} aria-label="From date" placeholder="From" />
          <span className="date-sep">–</span>
          <DateInput value={to} onChange={setTo} aria-label="To date" placeholder="To" />
          {(from || to) && (
            <button
              className="icon-button"
              aria-label="Clear dates"
              title="Clear dates"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </span>
        {props.onHideFinished && (
          <label className="toggle table-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={!!props.hideFinished}
              onChange={(e) => props.onHideFinished!(e.target.checked)}
            />
            <span>Hide completed</span>
          </label>
        )}
        <span className="hint">
          {rows.length === boxes.length ? `${boxes.length} boxes` : `${rows.length} of ${boxes.length} boxes`}
        </span>
        <CollapseAll all={props.allCollapsed} onToggle={props.onToggleAll} />
        {!readOnly && (
          <button
            className="primary"
            onClick={() => {
              setQuery("");
              setFocusId(onAdd());
            }}
          >
            <Icon name="plus" size={14} />
            Add box
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
          {groups.map((group) => {
            const { dept } = group;
            // A search opens every department with matches, so results are never hidden.
            const isCollapsed = collapsed.has(dept.id) && !searching;
            const ptoRows = ptoByDept.get(dept.id) ?? [];
            const members = people.filter((p) => p.department === dept.id).sort((a, b) => a.name.localeCompare(b.name));
            if (searching && group.rows.length === 0 && ptoRows.length === 0) return null;
            // Capacity today; dated lanes (listed in the tooltip) make it change over time.
            const fte = capacityOn(dept, today());
            const dated = dept.lanes.filter(hasDates);
            const datedText = dept.lanes
              .map((l, i) => (hasDates(l) ? `${l.name ?? `FTE ${i + 1}`}: ${laneDates(l)}` : ""))
              .filter(Boolean)
              .join("\n");
            const total = boxes.filter((b) => lanes.get(b.lane)?.deptId === dept.id).length;
            return (
              <tbody key={dept.id} className="dept-group" style={{ "--dept": dept.color } as CSSProperties}>
                <tr className="group-row">
                  <td colSpan={COLUMNS.length}>
                    <div className="group-head">
                      <button
                        className="group-toggle"
                        onClick={() => onToggleDepartment(dept.id)}
                        aria-expanded={!isCollapsed}
                        disabled={searching}
                      >
                        <Icon name="chevron-right" size={14} className={`chevron${isCollapsed ? "" : " open"}`} />
                        <span className="dept-name">{dept.name}</span>
                        <span className="dept-meta" title={dated.length ? `FTE today. Dated lanes:\n${datedText}` : undefined}>
                          {searching ? `${group.rows.length} of ${total}` : total} box{total === 1 ? "" : "es"} · {fte} FTE
                          {dated.length > 0 && ` today · ${dated.length} dated lane${dated.length === 1 ? "" : "s"}`}
                        </span>
                      </button>
                      {!readOnly && props.onEditDepartment && (
                        <button
                          className="icon-button group-edit"
                          title="Edit department and lanes"
                          aria-label={`Edit ${dept.name}`}
                          onClick={() => props.onEditDepartment!(dept.id)}
                        >
                          <Icon name="pencil" size={14} />
                        </button>
                      )}
                      {!readOnly && dept.lanes.length > 0 && (
                        <button
                          className="icon-button group-add"
                          title={`Add a box to ${dept.name}`}
                          aria-label={`Add a box to ${dept.name}`}
                          onClick={() => {
                            setQuery("");
                            if (collapsed.has(dept.id)) onToggleDepartment(dept.id);
                            setFocusId(onAdd(dept.id));
                          }}
                        >
                          <Icon name="plus" size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {!isCollapsed && group.rows.length === 0 && (
                  <tr className="empty-row">
                    <td colSpan={COLUMNS.length}>No boxes in {dept.name} yet.</td>
                  </tr>
                )}
                {!isCollapsed &&
                  group.rows.map((b) => {
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
                    <span
                      className={`cell-code${jiraKey(b.epic) ? " jira" : ""}`}
                      title={[jiraKey(b.epic) && `BoxOps ${lane?.deptCode}-${b.code}`, ...(ruleWarnings?.get(b.id) ?? [])]
                        .filter(Boolean)
                        .join("\n") || undefined}
                    >
                      {jiraKey(b.epic) ?? `${lane?.deptCode}-${b.code}`}
                      {ruleWarnings?.has(b.id) && <Icon name="alert" size={12} className="box-warn" />}
                    </span>
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
                              {hasDates(l) ? ` (${laneDates(l)})` : ""}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="col-date">
                    <DateInput
                      value={formatDay(b.start)}
                      disabled={readOnly}
                      aria-label="Start"
                      onChange={(v) => setStart(b, v)}
                      onBlur={onCheckpoint}
                    />
                  </td>
                  <td className="col-date">
                    <DateInput
                      value={formatDay(b.end)}
                      disabled={readOnly}
                      aria-label="End"
                      onChange={(v) => setEnd(b, v)}
                      onBlur={onCheckpoint}
                    />
                  </td>
                  <td className="col-days">{workdays(b.start, b.end)}</td>
                  <td className="col-fte">
                    <select
                      value={b.fte}
                      disabled={readOnly}
                      aria-label="FTE"
                      onChange={(e) => update(b.id, { fte: Number(e.target.value) })}
                    >
                      {BOX_FTE_OPTIONS.map((f) => (
                        <option key={f} value={f}>
                          {f.toFixed(1)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="col-scale">
                    <ScaleBadge box={b} departments={departments} />
                  </td>
                  <td className="col-engineers">
                    <EngineerPicker
                      value={b.engineers ?? []}
                      people={people}
                      department={lane?.deptId}
                      readOnly={readOnly}
                      emptyLabel="—"
                      onChange={(engineers) => update(b.id, { engineers })}
                      onAddPerson={(name) => onAddPerson(name, lane?.deptId)}
                    />
                  </td>
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
                      className={`status-select${b.status ? " flagged" : ""}`}
                      value={b.status ?? ""}
                      disabled={readOnly}
                      aria-label="Status"
                      onChange={(e) => update(b.id, { status: e.target.value || undefined })}
                    >
                      <option value="">{NO_FLAG}</option>
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
                          <Icon name="external" size={14} />
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
                      multiline
                    />
                  </td>
                  <td className="col-actions">
                    {!readOnly && (
                      <button className="icon-button row-delete" title="Delete box" aria-label={`Delete ${b.title}`} onClick={() => onDelete(b.id)}>
                        <Icon name="x" size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
                {!isCollapsed &&
                  ptoRows.map(({ person, index, pto }) => {
                    const ref = { personId: person.id, index };
                    return (
                      <tr key={`pto:${ptoKey(ref)}`} className="pto-table-row">
                        <td className="col-title">
                          <span className="pto-cell">
                            <span className="cell-code pto-chip">PTO</span>
                            <select
                              value={person.id}
                              disabled={readOnly}
                              aria-label="Engineer"
                              onChange={(e) => props.onReassignPto?.(ref, e.target.value)}
                            >
                              {members.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </span>
                        </td>
                        <td className="col-lane">
                          <TextCell
                            value={pto.note ?? ""}
                            readOnly={readOnly}
                            placeholder="Note"
                            onCommit={(note) => props.onUpdatePto?.(ref, { note: note.trim() || undefined })}
                            onBlur={onCheckpoint}
                            ariaLabel="PTO note"
                          />
                        </td>
                        <td className="col-date">
                          <DateInput
                            value={formatDay(pto.start)}
                            disabled={readOnly}
                            aria-label="PTO start"
                            onChange={(v) => ptoDates(ref, pto, "start", v)}
                            onBlur={onCheckpoint}
                          />
                        </td>
                        <td className="col-date">
                          <DateInput
                            value={formatDay(pto.end)}
                            disabled={readOnly}
                            aria-label="PTO end"
                            onChange={(v) => ptoDates(ref, pto, "end", v)}
                            onBlur={onCheckpoint}
                          />
                        </td>
                        <td className="col-days">{workdays(pto.start, pto.end)}</td>
                        <td colSpan={COLUMNS.length - 6} />
                        <td className="col-actions">
                          {!readOnly && (
                            <button
                              className="icon-button row-delete"
                              title="Delete PTO"
                              aria-label={`Delete PTO for ${person.name}`}
                              onClick={() => props.onRemovePto?.(ref)}
                            >
                              <Icon name="x" size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                {!isCollapsed && !readOnly && !searching && members.length > 0 && props.onAddPto && props.showPto !== false && (
                  <tr className="add-pto-row">
                    <td colSpan={COLUMNS.length}>
                      <button className="add-button" onClick={() => props.onAddPto!(dept.id)}>
                        <Icon name="plus" size={14} />
                        Add PTO
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
          {!readOnly && props.onAddDepartment && !searching && (
            <tbody>
              <tr className="add-dept-row">
                <td colSpan={COLUMNS.length}>
                  <button className="add-button" onClick={props.onAddDepartment}>
                    <Icon name="plus" size={14} />
                    Add department
                  </button>
                </td>
              </tr>
            </tbody>
          )}
        </table>
        {rows.length === 0 && (
          <p className="empty">
            {query.trim() ? `No boxes match “${query}”${fromDay !== null || toDay !== null ? " in these dates" : ""}.` : "No boxes in these dates."}
          </p>
        )}
      </div>
    </div>
  );
}

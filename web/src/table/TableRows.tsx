// The table's rows (components/TableView.tsx), one component each, memoized:
// everything a row is given stays the same from one edit to the next unless
// it's about that row (the box, its lane, its warnings), and what rows do is
// one object of functions that never changes, so an edit draws again only
// the rows it changed. Each row is measured as it's drawn (`measure`) and
// says which it is (`index`, its aria-rowindex).

import { type CSSProperties, type KeyboardEvent, memo, type PointerEvent, type ReactNode, useEffect, useRef } from "react";
import { formatDay, workdays } from "../model/dates";
import { jiraKey } from "../model/jira";
import { LINK } from "../model/load";
import type { PtoRef } from "../model/pto";
import { BOX_FTE_OPTIONS, type Box, type Department, type Person, type TimeOff } from "../model/types";
import type { PtoEntry } from "../timeline/rows";
import { DateInput } from "../components/DateInput";
import { EngineerPicker } from "../components/EngineerPicker";
import { Icon } from "../components/Icon";
import { LazySelect } from "../components/LazySelect";
import { ScaleBadge } from "../components/ScaleBadge";
import { TextCell } from "../components/TextCell";

/** The table's columns, in order. */
export const COLUMN_COUNT = 14;

/** A lane as the table shows it. */
export interface LaneInfo {
  /** "FTE 2", or its name. */
  label: string;
  /** Its option in the Lane select: "Data Engineering / FTE 2", with its dates if it has any. */
  option: string;
  dept: string;
  deptId: string;
  deptCode: string;
  /** Its place among every lane, for sorting by lane. */
  order: number;
  color: string;
}

/** What the rows do: TableView's functions, the same object for as long as the table's open. */
export interface RowActions {
  /** Patch a box; `key` makes repeated edits of one cell one undo step. Returns its id afterwards. */
  update(id: string, patch: Partial<Box>, key?: string): string;
  setStart(box: Box, text: string): void;
  setEnd(box: Box, text: string): void;
  addPerson(name: string, department?: string): string;
  remove(box: Box, button: HTMLElement): void;
  checkpoint(): void;
  reviewed(id: string): void;
  updatePto(ref: PtoRef, patch: Partial<TimeOff>): void;
  ptoDates(ref: PtoRef, pto: TimeOff, field: "start" | "end", text: string): void;
  reassignPto(ref: PtoRef, toId: string): void;
  removePto(ref: PtoRef, name: string, button: HTMLElement): void;
  toggle(id: string): void;
  edit(id: string): void;
  addBox(id: string): void;
  addPto(id: string): void;
  addDepartment(): void;
  grab(e: PointerEvent, id: string): void;
  /** A key on a department's heading (Alt+↑ ↓ moves it). */
  headingKey(e: KeyboardEvent<HTMLButtonElement>, id: string): void;
}

const tagsText = (b: Box) => (b.tags ?? []).join(", ");
const splitTags = (t: string) =>
  t
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Shown in a row that's being edited though it no longer matches the search or filters: it goes once focus leaves it. */
function HeldNote() {
  return <span className="held-note">Doesn’t match the search or filters: hidden once you leave this row.</span>;
}

export const BoxRow = memo(function BoxRow({ box: b, rowKey, index, lane, laneOptions, laneCount, typeOptions, statusOptions, typeColor, warnings, flag, readOnly, autoFocus, held, departments, people, names, measure, actions }: {
  box: Box;
  rowKey: string;
  index: number;
  lane: LaneInfo | undefined;
  laneOptions: ReactNode;
  laneCount: number;
  typeOptions: ReactNode;
  statusOptions: ReactNode;
  typeColor: string | undefined;
  /** Broken rules, a line each. */
  warnings: string | undefined;
  flag: "conflict" | "updated" | undefined;
  readOnly: boolean;
  autoFocus: boolean;
  held: boolean;
  departments: Department[];
  people: Person[];
  names: Map<string, string>;
  measure(el: HTMLElement | null): void;
  actions: RowActions;
}) {
  const jira = jiraKey(b.epic);
  const code = `${lane?.deptCode}-${b.code}`;
  return (
    <tr
      ref={measure}
      data-row-key={rowKey}
      aria-rowindex={index}
      className={["box-row", flag, held && "held"].filter(Boolean).join(" ")}
      style={{ "--dept": lane?.color } as CSSProperties}
      onFocusCapture={() => flag === "updated" && actions.reviewed(b.id)}
      title={
        flag === "conflict"
          ? "Someone else also changed this box. You’ll choose whose version to keep when you save."
          : flag === "updated"
            ? "Changed by someone else since you opened the roadmap."
            : undefined
      }
    >
      <td className="col-title">
        <span className={`cell-code${jira ? " jira" : ""}`} title={[jira && `BoxOps ${code}`, warnings].filter(Boolean).join("\n") || undefined}>
          {jira ?? code}
          {/* The row's tint says these too; marks and words say them without colour (and to screen readers). */}
          {warnings && (
            <span className="box-warn">
              <Icon name="alert" size={12} />
              <span className="sr-only">Breaks a rule: {warnings.replaceAll("\n", " ")}</span>
            </span>
          )}
          {flag === "conflict" ? (
            <span className="box-warn">
              <Icon name="alert" size={12} />
              <span className="sr-only">Someone else also changed this box; you’ll choose whose version to keep when you save.</span>
            </span>
          ) : (
            flag === "updated" && (
              <span className="row-updated">
                <span className="sr-only">Changed by someone else since you opened the roadmap.</span>
              </span>
            )
          )}
        </span>
        <TextCell
          value={b.title}
          readOnly={readOnly}
          required
          problem="A title is required."
          autoFocus={autoFocus}
          onCommit={(title) => actions.update(b.id, { title })}
          onBlur={actions.checkpoint}
          ariaLabel="Title"
        />
        {held && <HeldNote />}
      </td>
      <td className="col-lane">
        <LazySelect
          value={b.lane}
          disabled={readOnly}
          aria-label="Lane"
          onChange={(e) => actions.update(b.id, { lane: e.target.value })}
          options={laneOptions}
          count={laneCount}
          chosen={<option value={b.lane}>{lane?.option ?? b.lane}</option>}
        />
      </td>
      <td className="col-date">
        <DateInput
          value={formatDay(b.start)}
          disabled={readOnly}
          pickerTabStop={false}
          aria-label="Start"
          onChange={(v) => actions.setStart(b, v)}
          onBlur={actions.checkpoint}
        />
      </td>
      <td className="col-date">
        <DateInput
          value={formatDay(b.end)}
          disabled={readOnly}
          pickerTabStop={false}
          aria-label="End"
          onChange={(v) => actions.setEnd(b, v)}
          onBlur={actions.checkpoint}
        />
      </td>
      <td className="col-days">{workdays(b.start, b.end)}</td>
      <td className="col-fte">
        <select value={b.fte} disabled={readOnly} aria-label="FTE" onChange={(e) => actions.update(b.id, { fte: Number(e.target.value) })}>
          {FTE_OPTIONS}
        </select>
      </td>
      <td className="col-scale">
        <ScaleBadge box={b} departments={departments} />
      </td>
      <td className="col-engineers">
        <EngineerPicker
          value={b.engineers ?? []}
          people={people}
          names={names}
          department={lane?.deptId}
          readOnly={readOnly}
          emptyLabel="—"
          onChange={(engineers) => actions.update(b.id, { engineers })}
          onAddPerson={(name) => actions.addPerson(name, lane?.deptId)}
        />
      </td>
      <td className="col-type">
        <span className="type-cell">
          <span className="swatch" style={{ background: typeColor }} />
          <select value={b.type} disabled={readOnly} aria-label="Type" onChange={(e) => actions.update(b.id, { type: e.target.value })}>
            {typeOptions}
          </select>
        </span>
      </td>
      <td className="col-status">
        <select
          className={`status-select${b.status ? " flagged" : ""}`}
          value={b.status ?? ""}
          disabled={readOnly}
          aria-label="Flag"
          onChange={(e) => actions.update(b.id, { status: e.target.value || undefined })}
        >
          {statusOptions}
        </select>
      </td>
      <td className="col-epic">
        <span className="epic-cell">
          <TextCell
            value={b.epic ?? ""}
            readOnly={readOnly}
            placeholder="https://…"
            invalid={invalidLink}
            problem="Use a full http(s) link."
            onCommit={(v) => actions.update(b.id, { epic: v || undefined })}
            onBlur={actions.checkpoint}
            ariaLabel="Epic link"
          />
          {b.epic && LINK.test(b.epic) && (
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
          onCommit={(v) => actions.update(b.id, { tags: splitTags(v) })}
          onBlur={actions.checkpoint}
          ariaLabel="Tags"
        />
      </td>
      <td className="col-desc">
        <TextCell
          value={b.description ?? ""}
          readOnly={readOnly}
          onCommit={(v) => actions.update(b.id, { description: v || undefined })}
          onBlur={actions.checkpoint}
          ariaLabel="Description"
          multiline
        />
      </td>
      <td className="col-actions">
        {!readOnly && (
          <button className="icon-button row-delete" title="Delete box" aria-label={`Delete ${b.title}`} onClick={(e) => actions.remove(b, e.currentTarget)}>
            <Icon name="x" size={14} />
          </button>
        )}
      </td>
    </tr>
  );
});

const invalidLink = (v: string) => v !== "" && !LINK.test(v);

const FTE_OPTIONS = BOX_FTE_OPTIONS.map((f) => (
  <option key={f} value={f}>
    {f.toFixed(1)}
  </option>
));

export const PtoRow = memo(function PtoRow({ entry, rowKey, index, members, memberCount, readOnly, autoFocus, held, measure, actions }: {
  entry: PtoEntry;
  rowKey: string;
  index: number;
  /** The department's engineers, as options; how many. */
  members: ReactNode;
  memberCount: number;
  readOnly: boolean;
  autoFocus: boolean;
  held: boolean;
  measure(el: HTMLElement | null): void;
  actions: RowActions;
}) {
  const { person, pto } = entry;
  const ref: PtoRef = { personId: person.id, index: entry.index };
  const engineer = useRef<HTMLSelectElement>(null);
  // A new entry: focus goes to whose it is (the table scrolls it clear of its header).
  useEffect(() => {
    if (autoFocus) engineer.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  return (
    <tr ref={measure} data-row-key={rowKey} aria-rowindex={index} className={`pto-table-row${held ? " held" : ""}`}>
      <td className="col-title">
        <span className="pto-cell">
          <span className="cell-code pto-chip">PTO</span>
          <LazySelect
            ref={engineer}
            value={person.id}
            disabled={readOnly}
            aria-label="Engineer"
            onChange={(e) => actions.reassignPto(ref, e.target.value)}
            options={members}
            count={memberCount}
            chosen={<option value={person.id}>{person.name}</option>}
          />
        </span>
        {held && <HeldNote />}
      </td>
      <td className="col-lane">
        <TextCell
          value={pto.note ?? ""}
          readOnly={readOnly}
          placeholder="Note"
          onCommit={(note) => actions.updatePto(ref, { note: note.trim() || undefined })}
          onBlur={actions.checkpoint}
          ariaLabel="PTO note"
        />
      </td>
      <td className="col-date">
        <DateInput
          value={formatDay(pto.start)}
          disabled={readOnly}
          pickerTabStop={false}
          aria-label="PTO start"
          onChange={(v) => actions.ptoDates(ref, pto, "start", v)}
          onBlur={actions.checkpoint}
        />
      </td>
      <td className="col-date">
        <DateInput
          value={formatDay(pto.end)}
          disabled={readOnly}
          pickerTabStop={false}
          aria-label="PTO end"
          onChange={(v) => actions.ptoDates(ref, pto, "end", v)}
          onBlur={actions.checkpoint}
        />
      </td>
      <td className="col-days">{workdays(pto.start, pto.end)}</td>
      <td colSpan={COLUMN_COUNT - 6} />
      <td className="col-actions">
        {!readOnly && (
          <button
            className="icon-button row-delete"
            title="Delete PTO"
            aria-label={`Delete PTO for ${person.name}`}
            onClick={(e) => actions.removePto(ref, person.name, e.currentTarget)}
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </td>
    </tr>
  );
});

export const GroupRow = memo(function GroupRow({ dept, rowKey, index, shown, total, searching, collapsed, canReorder, readOnly, editable, fte, dated, measure, actions }: {
  dept: Department;
  rowKey: string;
  index: number;
  /** Boxes shown (a search or date filter may leave some out), and how many it has. */
  shown: number;
  total: number;
  searching: boolean;
  collapsed: boolean;
  canReorder: boolean;
  readOnly: boolean;
  editable: boolean;
  /** FTE today, and its dated lanes ("FTE 2: from 2027-01-04"), a line each. */
  fte: number;
  dated: string[];
  measure(el: HTMLElement | null): void;
  actions: RowActions;
}) {
  return (
    <tr ref={measure} data-row-key={rowKey} aria-rowindex={index} className="group-row">
      <td colSpan={COLUMN_COUNT}>
        <div className={`group-head${canReorder ? " grabbable" : ""}`} onPointerDown={canReorder ? (e) => actions.grab(e, dept.id) : undefined}>
          {canReorder && (
            <span className="dept-grip" title="Drag to reorder" aria-hidden>
              <Icon name="grip" size={14} />
            </span>
          )}
          <h3 className="dept-heading">
            <button
              className="group-toggle"
              onClick={() => actions.toggle(dept.id)}
              // Alt+↑ or Alt+↓ moves the department, as dragging its heading does; focus stays on it.
              // (While searching, it's disabled: nothing to say about that.)
              onKeyDown={(e) => actions.headingKey(e, dept.id)}
              aria-expanded={!collapsed}
              aria-keyshortcuts={canReorder ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
              disabled={searching}
            >
              <Icon name="chevron-right" size={14} className={`chevron${collapsed ? "" : " open"}`} />
              <span className="dept-name">{dept.name}</span>
              <span className="dept-meta" title={dated.length ? `FTE today. Dated lanes:\n${dated.join("\n")}` : undefined}>
                {searching ? `${shown} of ${total}` : total} box{total === 1 ? "" : "es"} · {fte} FTE
                {dated.length > 0 && ` today · ${dated.length} dated lane${dated.length === 1 ? "" : "s"}`}
              </span>
            </button>
          </h3>
          {!readOnly && editable && (
            <button className="icon-button group-edit" title="Edit department and lanes" aria-label={`Edit ${dept.name}`} onClick={() => actions.edit(dept.id)}>
              <Icon name="pencil" size={14} />
            </button>
          )}
          {!readOnly && dept.lanes.length > 0 && (
            <button
              className="icon-button group-add"
              title={`Add a box to ${dept.name}`}
              aria-label={`Add a box to ${dept.name}`}
              onClick={() => actions.addBox(dept.id)}
            >
              <Icon name="plus" size={16} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});

/** A row of text across the table: a department with no boxes (or engineers) yet. */
export const EmptyRow = memo(function EmptyRow({
  rowKey,
  index,
  text,
  columns,
  measure,
}: {
  rowKey: string;
  index: number;
  text: string;
  columns: number;
  measure(el: HTMLElement | null): void;
}) {
  return (
    <tr ref={measure} data-row-key={rowKey} aria-rowindex={index} className="empty-row">
      <td colSpan={columns}>{text}</td>
    </tr>
  );
});

/** A row with one button across the table: Add PTO in a department, or Add department at the end. */
export const AddRow = memo(function AddRow({ rowKey, index, className, label, columns, onClick, measure }: {
  rowKey: string;
  index: number;
  className: string;
  label: string;
  columns: number;
  onClick(): void;
  measure(el: HTMLElement | null): void;
}) {
  return (
    <tr ref={measure} data-row-key={rowKey} aria-rowindex={index} className={className}>
      <td colSpan={columns}>
        <button className="add-button" onClick={onClick}>
          <Icon name="plus" size={14} />
          {label}
        </button>
      </td>
    </tr>
  );
});

/** Rows not drawn: as tall as they'd be, hidden from screen readers (the table's aria-rowcount counts them). */
export function SpacerRow({ height, columns }: { height: number; columns: number }) {
  return (
    <tr className="spacer" aria-hidden="true">
      <td colSpan={columns} style={{ height }} />
    </tr>
  );
}

// People's rows (components/PeopleView.tsx), memoized as the table's are
// (TableRows.tsx): each is given only what's its own and one object of
// functions that never changes, is measured as it's drawn, and says which
// row it is.

import { memo, type ReactNode } from "react";
import type { Day } from "../model/dates";
import { counted, thousands } from "../model/count";
import { EMAIL } from "../model/load";
import { type PtoRef, ptoRange } from "../model/pto";
import type { Person } from "../model/types";
import { Icon } from "../components/Icon";
import { LazySelect } from "../components/LazySelect";
import { TextCell } from "../components/TextCell";
import { twoLines } from "./tableModel";

/** People's columns. */
export const PEOPLE_COLUMNS = 8;

/** What People's rows do: PeopleView's functions, the same object for as long as it's open. */
export interface PersonActions {
  update(id: string, patch: Partial<Omit<Person, "id">>): void;
  remove(person: Person, button: HTMLElement): void;
  checkpoint(): void;
  showPto?(ref: PtoRef): void;
  toggle(id: string): void;
  edit(id: string): void;
  add(id: string): void;
  addDepartment(): void;
  /** Show all of the PTO in the row with this key, or two entries again. */
  morePto(rowKey: string): void;
}

/** Shown in a row that's being edited though it no longer matches the search: it goes once focus leaves it. */
export const PEOPLE_HELD_NOTE = "Doesn’t match the search: hidden once you leave this row.";

const invalidEmail = (v: string) => v !== "" && !EMAIL.test(v);

export const PersonRow = memo(function PersonRow({
  person: p,
  rowKey,
  index,
  department,
  departmentName,
  departmentOptions,
  departmentCount,
  readOnly,
  autoFocus,
  held,
  now,
  ptoOpen,
  measure,
  actions,
}: {
  person: Person;
  rowKey: string;
  index: number;
  /** Their department's id, or "" for none (or one that's gone), and its name. */
  department: string;
  departmentName: string;
  departmentOptions: ReactNode;
  departmentCount: number;
  readOnly: boolean;
  autoFocus: boolean;
  held: boolean;
  now: Day;
  /** "+N more" pressed: all of their PTO shown (kept by PeopleView, as the row isn't drawn while scrolled away). */
  ptoOpen: boolean;
  measure(el: HTMLElement | null): void;
  actions: PersonActions;
}) {
  return (
    <tr ref={measure} data-row-key={rowKey} aria-rowindex={index} className={`person-row${twoLines(p) ? " two-lines" : ""}${held ? " held" : ""}`}>
      <td className="col-name">
        <TextCell
          value={p.name}
          required
          problem="A name is required."
          readOnly={readOnly}
          autoFocus={autoFocus}
          onCommit={(name) => actions.update(p.id, { name: name.trim() })}
          onBlur={actions.checkpoint}
          ariaLabel="Name"
        />
        {held && <span className="held-note">{PEOPLE_HELD_NOTE}</span>}
      </td>
      <td className="col-dept">
        <LazySelect
          value={department}
          disabled={readOnly}
          aria-label="Department"
          onChange={(e) => actions.update(p.id, { department: e.target.value || undefined })}
          options={departmentOptions}
          count={departmentCount}
          chosen={<option value={department}>{departmentName}</option>}
        />
      </td>
      <td className="col-role">
        <TextCell
          value={p.role ?? ""}
          readOnly={readOnly}
          placeholder="e.g. Data Engineer"
          onCommit={(role) => actions.update(p.id, { role: role.trim() || undefined })}
          onBlur={actions.checkpoint}
          ariaLabel="Role"
        />
      </td>
      <td className="col-email">
        <TextCell
          value={p.email ?? ""}
          readOnly={readOnly}
          placeholder="name@company.com"
          invalid={invalidEmail}
          problem="That isn’t an email address."
          onCommit={(email) => actions.update(p.id, { email: email.trim() || undefined })}
          onBlur={actions.checkpoint}
          ariaLabel="Email"
        />
      </td>
      <td className="col-manager">
        <TextCell
          value={p.manager ?? ""}
          readOnly={readOnly}
          placeholder="Manager’s name"
          onCommit={(manager) => actions.update(p.id, { manager: manager.trim() || undefined })}
          onBlur={actions.checkpoint}
          ariaLabel="Manager"
        />
      </td>
      <td className="col-pto">
        <PtoList person={p} hasDepartment={department !== ""} now={now} all={ptoOpen} onMore={() => actions.morePto(rowKey)} onShow={actions.showPto} />
      </td>
      <td className="col-notes">
        <TextCell
          value={p.notes ?? ""}
          readOnly={readOnly}
          multiline
          onCommit={(notes) => actions.update(p.id, { notes: notes.trim() || undefined })}
          onBlur={actions.checkpoint}
          ariaLabel="Notes"
        />
      </td>
      <td className="col-actions">
        {!readOnly && (
          <button className="icon-button row-delete" title={`Remove ${p.name}`} aria-label={`Remove ${p.name}`} onClick={(e) => actions.remove(p, e.currentTarget)}>
            <Icon name="x" size={14} />
          </button>
        )}
      </td>
    </tr>
  );
});

/**
 * A person's PTO, read-only: each entry opens its block on the timeline, where
 * it's edited. Two lines at most until "+N more" is pressed (every row is as
 * tall as the next): both entries, or with more, the first that hasn't
 * finished (else the last), then the button.
 */
function PtoList(props: { person: Person; hasDepartment: boolean; now: Day; all: boolean; onMore(): void; onShow?(ref: PtoRef): void }) {
  const { person, hasDepartment, now, all, onMore, onShow } = props;
  const list = (person.pto ?? []).map((pto, index) => ({ pto, index })).sort((a, b) => a.pto.start - b.pto.start);
  if (!list.length) return null;
  const next = list.findIndex((e) => e.pto.end >= now);
  const shown = all || list.length <= 2 ? list : [list[next < 0 ? list.length - 1 : next]];
  return (
    <ul className="pto-list">
      {shown.map(({ pto, index }) => (
        <li key={index}>
          {onShow && hasDepartment ? (
            <button
              className="link-button"
              title={`${pto.note ? `${pto.note}\n` : ""}Edit on the timeline`}
              onClick={() => onShow({ personId: person.id, index })}
            >
              {ptoRange(pto)}
            </button>
          ) : (
            <span title={hasDepartment ? pto.note : `Give ${person.name} a department to see their PTO on the timeline`}>{ptoRange(pto)}</span>
          )}
          {pto.note && (
            <span className="hint" title={pto.note}>
              &nbsp;· {pto.note}
            </span>
          )}
        </li>
      ))}
      {list.length > 2 && (
        <li>
          <button className="link-button pto-more" aria-expanded={all} onClick={onMore}>
            {all ? "Fewer" : `+${thousands(list.length - 1)} more`}
            <span className="sr-only"> PTO for {person.name}</span>
          </button>
        </li>
      )}
    </ul>
  );
}

export const PeopleGroupRow = memo(function PeopleGroupRow({
  id,
  name,
  rowKey,
  index,
  shown,
  total,
  searching,
  collapsed,
  readOnly,
  editable,
  measure,
  actions,
}: {
  /** The department's id, or "" for No department. */
  id: string;
  name: string;
  rowKey: string;
  index: number;
  shown: number;
  total: number;
  searching: boolean;
  collapsed: boolean;
  readOnly: boolean;
  editable: boolean;
  measure(el: HTMLElement | null): void;
  actions: PersonActions;
}) {
  return (
    <tr ref={measure} data-row-key={rowKey} aria-rowindex={index} className="group-row">
      <td colSpan={PEOPLE_COLUMNS}>
        <div className="group-head">
          <h3 className="dept-heading">
            <button className="group-toggle" onClick={() => id && actions.toggle(id)} aria-expanded={!collapsed} disabled={searching || !id}>
              <Icon name="chevron-right" size={14} className={`chevron${collapsed ? "" : " open"}`} />
              <span className="dept-name">{name}</span>
              <span className="dept-meta">
                {searching ? `${thousands(shown)} of ${counted(total, "engineer")}` : counted(total, "engineer")}
              </span>
            </button>
          </h3>
          {!readOnly && id && editable && (
            <button className="icon-button group-edit" title="Edit department and lanes" aria-label={`Edit ${name}`} onClick={() => actions.edit(id)}>
              <Icon name="pencil" size={14} />
            </button>
          )}
          {!readOnly && id && (
            <button className="icon-button group-add" title={`Add an engineer to ${name}`} aria-label={`Add an engineer to ${name}`} onClick={() => actions.add(id)}>
              <Icon name="plus" size={16} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});

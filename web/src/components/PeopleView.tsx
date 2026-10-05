import { type CSSProperties, useMemo, useRef, useState } from "react";
import { CollapseAll } from "./CollapseAll";
import { EMAIL } from "../model/load";
import { type PtoRef, ptoRange } from "../model/pto";
import type { Person, Roadmap } from "../model/types";
import { TextCell } from "./TextCell";
import { Icon } from "./Icon";
import { useAnnounceResults } from "../a11y/announce";

interface Props {
  roadmap: Roadmap;
  readOnly?: boolean;
  /** Collapsed departments; shared with the other views. */
  collapsed: Set<string>;
  onToggleDepartment(id: string): void;
  allCollapsed: boolean;
  onToggleAll(): void;
  onEditDepartment?(id: string): void;
  onAddDepartment?(): void;
  /** Open a PTO block on the timeline (PTO is edited there, not here). */
  onShowPto?(ref: PtoRef): void;
  /** Add an engineer; returns their id. */
  onAdd(department?: string): string;
  /** Edit an engineer; returns their id afterwards (an unsaved person's id follows their name). */
  onUpdate(id: string, patch: Partial<Omit<Person, "id">>): string;
  /** Remove an engineer and unassign them from their boxes. */
  onRemove(id: string): void;
  onCheckpoint(): void;
}

/** People without a department (or with one that no longer exists). */
const NO_DEPT = "";

const COLUMNS = [
  { label: "Name", className: "col-name" },
  { label: "Department", className: "col-dept" },
  { label: "Role", className: "col-role" },
  { label: "Email", className: "col-email" },
  { label: "Manager", className: "col-manager" },
  { label: "PTO", className: "col-pto" },
  { label: "Notes", className: "col-notes" },
  { label: "", className: "col-actions" },
];

export function PeopleView(props: Props) {
  const { roadmap, readOnly, collapsed, onToggleDepartment, onAdd, onUpdate, onRemove, onCheckpoint } = props;
  const { departments, people, boxes } = roadmap;
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);

  // Stable row keys while an unsaved person's id follows their name.
  const rowKeys = useRef(new Map<string, string>());
  const keyFor = (id: string) => {
    if (!rowKeys.current.has(id)) rowKeys.current.set(id, id);
    return rowKeys.current.get(id)!;
  };
  const update = (id: string, patch: Partial<Omit<Person, "id">>) => {
    const next = onUpdate(id, patch);
    if (next !== id) rowKeys.current.set(next, keyFor(id));
  };

  /** How many boxes each person is on, to warn before removing them. */
  const boxCount = useMemo(() => {
    const n = new Map<string, number>();
    for (const b of boxes) for (const id of b.engineers ?? []) n.set(id, (n.get(id) ?? 0) + 1);
    return n;
  }, [boxes]);
  const deptIds = new Set(departments.map((d) => d.id));
  const q = query.trim().toLowerCase();
  const matches = (p: Person) =>
    !q ||
    [p.name, p.role ?? "", p.email ?? "", p.manager ?? "", p.notes ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(q);

  const groups = [
    ...departments.map((d) => ({ id: d.id, name: d.name, color: d.color })),
    { id: NO_DEPT, name: "No department", color: "#8a94a6" },
  ].map((g) => ({
    ...g,
    all: people.filter((p) => (p.department && deptIds.has(p.department) ? p.department : NO_DEPT) === g.id),
  }));
  const shown = people.filter(matches).length;
  // How many a search leaves, said once typing pauses.
  useAnnounceResults(
    q,
    q && !shown ? `No engineers match “${query.trim()}”.` : `${shown === people.length ? "" : `${shown} of `}${people.length} engineer${people.length === 1 ? "" : "s"}.`,
  );

  const remove = (p: Person) => {
    const n = boxCount.get(p.id) ?? 0;
    if (
      n === 0 ||
      confirm(`Remove ${p.name}? They're on ${n} box${n === 1 ? "" : "es"} and will be unassigned. You can undo this.`)
    ) {
      onRemove(p.id);
    }
  };

  return (
    <div className="table-view people-view">
      <div className="table-toolbar">
        <input
          className="table-search"
          type="search"
          aria-label="Search engineers"
          placeholder="Search names, roles, managers, notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="hint">
          {shown === people.length ? "" : `${shown} of `}
          {people.length} engineer{people.length === 1 ? "" : "s"}
        </span>
        {departments.length > 0 && <CollapseAll all={props.allCollapsed} onToggle={props.onToggleAll} />}
        {!readOnly && (
          <button
            className="primary"
            onClick={() => {
              setQuery("");
              setFocusId(onAdd());
            }}
          >
            <Icon name="plus" size={14} />
            Add engineer
          </button>
        )}
      </div>

      <div className="table-scroll">
        <table className="box-table people-table">
          <thead>
            <tr>
              {COLUMNS.map((c, i) => (
                <th key={i} className={c.className}>
                  <span className="th-label">{c.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          {/* keyFor reads rowKeys while rendering, on purpose; it only ever adds id → id, so a second render is harmless. */}
          {/* eslint-disable-next-line react-hooks/refs -- stable row keys, see above */}
          {groups.map((g) => {
            const rows = g.all.filter(matches).sort((a, b) => a.name.localeCompare(b.name));
            if (g.id === NO_DEPT && g.all.length === 0) return null;
            if (q && rows.length === 0) return null;
            const isCollapsed = g.id !== NO_DEPT && collapsed.has(g.id) && !q;
            return (
              <tbody key={g.id || "none"} className="dept-group" data-dept-id={g.id || undefined} style={{ "--dept": g.color } as CSSProperties}>
                <tr className="group-row">
                  <td colSpan={COLUMNS.length}>
                    <div className="group-head">
                      <h3 className="dept-heading">
                        <button
                          className="group-toggle"
                          onClick={() => g.id !== NO_DEPT && onToggleDepartment(g.id)}
                          aria-expanded={!isCollapsed}
                          disabled={!!q || g.id === NO_DEPT}
                        >
                          <Icon name="chevron-right" size={14} className={`chevron${isCollapsed ? "" : " open"}`} />
                          <span className="dept-name">{g.name}</span>
                          <span className="dept-meta">
                            {q ? `${rows.length} of ${g.all.length}` : g.all.length} engineer{g.all.length === 1 ? "" : "s"}
                          </span>
                        </button>
                      </h3>
                      {!readOnly && g.id !== NO_DEPT && props.onEditDepartment && (
                        <button
                          className="icon-button group-edit"
                          title="Edit department and lanes"
                          aria-label={`Edit ${g.name}`}
                          onClick={() => props.onEditDepartment!(g.id)}
                        >
                          <Icon name="pencil" size={14} />
                        </button>
                      )}
                      {!readOnly && g.id !== NO_DEPT && (
                        <button
                          className="icon-button group-add"
                          title={`Add an engineer to ${g.name}`}
                          aria-label={`Add an engineer to ${g.name}`}
                          onClick={() => {
                            setQuery("");
                            if (collapsed.has(g.id)) onToggleDepartment(g.id);
                            setFocusId(onAdd(g.id));
                          }}
                        >
                          <Icon name="plus" size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {!isCollapsed && rows.length === 0 && (
                  <tr className="empty-row">
                    <td colSpan={COLUMNS.length}>No engineers in {g.name} yet.</td>
                  </tr>
                )}
                {!isCollapsed &&
                  rows.map((p) => (
                      <tr key={keyFor(p.id)}>
                        <td className="col-name">
                          <TextCell
                            value={p.name}
                            required
                            readOnly={readOnly}
                            autoFocus={focusId === p.id}
                            onCommit={(name) => update(p.id, { name: name.trim() })}
                            onBlur={onCheckpoint}
                            ariaLabel="Name"
                          />
                        </td>
                        <td className="col-dept">
                          <select
                            value={p.department && deptIds.has(p.department) ? p.department : NO_DEPT}
                            disabled={readOnly}
                            aria-label="Department"
                            onChange={(e) => update(p.id, { department: e.target.value || undefined })}
                          >
                            {departments.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                            <option value={NO_DEPT}>No department</option>
                          </select>
                        </td>
                        <td className="col-role">
                          <TextCell
                            value={p.role ?? ""}
                            readOnly={readOnly}
                            placeholder="e.g. Data Engineer"
                            onCommit={(role) => update(p.id, { role: role.trim() || undefined })}
                            onBlur={onCheckpoint}
                            ariaLabel="Role"
                          />
                        </td>
                        <td className="col-email">
                          <TextCell
                            value={p.email ?? ""}
                            readOnly={readOnly}
                            placeholder="name@company.com"
                            invalid={(v) => v !== "" && !EMAIL.test(v)}
                            onCommit={(email) => update(p.id, { email: email.trim() || undefined })}
                            onBlur={onCheckpoint}
                            ariaLabel="Email"
                          />
                        </td>
                        <td className="col-manager">
                          <TextCell
                            value={p.manager ?? ""}
                            readOnly={readOnly}
                            placeholder="Manager's name"
                            onCommit={(manager) => update(p.id, { manager: manager.trim() || undefined })}
                            onBlur={onCheckpoint}
                            ariaLabel="Manager"
                          />
                        </td>
                        <td className="col-pto">
                          <PtoList person={p} hasDepartment={!!p.department && deptIds.has(p.department)} onShow={props.onShowPto} />
                        </td>
                        <td className="col-notes">
                          <TextCell
                            value={p.notes ?? ""}
                            readOnly={readOnly}
                            multiline
                            onCommit={(notes) => update(p.id, { notes: notes.trim() || undefined })}
                            onBlur={onCheckpoint}
                            ariaLabel="Notes"
                          />
                        </td>
                        <td className="col-actions">
                          {!readOnly && (
                            <button
                              className="icon-button row-delete"
                              title={`Remove ${p.name}`}
                              aria-label={`Remove ${p.name}`}
                              onClick={() => remove(p)}
                            >
                              <Icon name="x" size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                  ))}
              </tbody>
            );
          })}
          {!readOnly && props.onAddDepartment && !q && (
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
        {q && shown === 0 && <p className="empty">No engineers match “{query}”.</p>}
      </div>
    </div>
  );
}

/** A person's PTO, read-only: each entry opens its block on the timeline, where it's edited. */
function PtoList({ person, hasDepartment, onShow }: { person: Person; hasDepartment: boolean; onShow?(ref: PtoRef): void }) {
  const list = (person.pto ?? []).map((pto, index) => ({ pto, index })).sort((a, b) => a.pto.start - b.pto.start);
  if (!list.length) return null;
  return (
    <ul className="pto-list">
      {list.map(({ pto, index }) => (
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
            <span title={hasDepartment ? pto.note : `Give ${person.name} a department to see their PTO on the timeline`}>
              {ptoRange(pto)}
            </span>
          )}
          {pto.note && <span className="hint"> · {pto.note}</span>}
        </li>
      ))}
    </ul>
  );
}

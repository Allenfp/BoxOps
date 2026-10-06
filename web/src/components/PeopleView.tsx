import { type CSSProperties, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CollapseAll } from "./CollapseAll";
import { type PtoRef, ptoRange } from "../model/pto";
import { counted, thousands } from "../model/count";
import type { Person, Roadmap } from "../model/types";
import { Icon } from "./Icon";
import { useToday } from "./useToday";
import { useAnnounce, useAnnounceResults } from "../a11y/useAnnounce";
import { focusAfterRow } from "../a11y/focus";
import { RowKeys } from "../table/rowKeys";
import { keepPlace, type PeopleRow, peopleRows } from "../table/tableModel";
import { DRAW_ALL_UP_TO, useWindowedRows } from "../table/useWindowedRows";
import { KeepFocus } from "../table/KeepFocus";
import { rowKeyOf } from "../table/focusRow";
import { useActiveRow } from "../table/useActiveRow";
import { usePrinting } from "../table/usePrinting";
import { PrintPeople } from "../table/PrintTable";
import { AddRow, EmptyRow, SpacerRow } from "../table/TableRows";
import { PEOPLE_COLUMNS, PEOPLE_HELD_NOTE, PeopleGroupRow, type PersonActions, PersonRow } from "../table/PeopleRows";

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

/** How tall each kind of row is until one's been measured, at the comfortable density. */
/** Each kind of row's height until one's been measured: a person's row takes one line, or two ("person-2", tableModel.ts). */
const ROW_HEIGHTS: Record<PeopleRow["kind"] | "person-2", number> = { group: 36, person: 35, "person-2": 53, empty: 36, "add-dept": 44 };

export function PeopleView(props: Props) {
  const { roadmap, readOnly = false, collapsed, onToggleDepartment, onAdd, onUpdate, onRemove, onCheckpoint } = props;
  const { departments, people, boxes } = roadmap;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const now = useToday();

  // Kept from one render to the next: row keys (which follow an unsaved person's id as it follows their name), and
  // the order last shown (a row being edited keeps its place in it).
  const [kept] = useState(() => ({ keys: new RowKeys("r"), order: new Map<string, string[]>(), searched: "" }));

  /** How many boxes each person is on, to warn before removing them. */
  const boxCount = useMemo(() => {
    const n = new Map<string, number>();
    for (const b of boxes) for (const id of b.engineers ?? []) n.set(id, (n.get(id) ?? 0) + 1);
    return n;
  }, [boxes]);
  const deptIds = useMemo(() => new Set(departments.map((d) => d.id)), [departments]);
  const deptNames = useMemo(() => new Map([...departments.map((d) => [d.id, d.name] as const), [NO_DEPT, "No department"]]), [departments]);
  const departmentOptions = useMemo(
    () => [
      ...departments.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      )),
      <option key={NO_DEPT} value={NO_DEPT}>
        No department
      </option>,
    ],
    [departments],
  );
  // What a search looks in, worked out once a person (and again only for one who's changed): every column's text,
  // their PTO's dates and notes too (on a big roster, rows not drawn are found only by the search, not the browser's Find).
  const searchable = useMemo(() => {
    const made = new WeakMap<Person, string>();
    return (p: Person) => {
      let s = made.get(p);
      if (s === undefined) {
        const pto = (p.pto ?? []).map((t) => `${ptoRange(t)} ${t.note ?? ""}`);
        const fields = [p.name, deptNames.get(p.department ?? "") ?? "", p.role ?? "", p.email ?? "", p.manager ?? "", ...pto, p.notes ?? ""];
        made.set(p, (s = fields.join(" ").toLowerCase()));
      }
      return s;
    };
  }, [deptNames]);
  const deptOf = (p: Person) => (p.department && deptIds.has(p.department) ? p.department : NO_DEPT);
  const keyOf = useMemo(() => {
    const keys = kept.keys.keys(people.map((p) => p.id));
    return new Map(people.map((p, i) => [p, keys[i]]));
  }, [kept, people]);

  // The row focus is in, drawn wherever it is; and the row that keeps its place and stays shown while it has
  // focus, though an edit would sort it elsewhere or the search leave it out. Searching puts it where it goes.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { active, held: holding, handlers: rowFocus } = useActiveRow(scrollRef);
  const held = kept.searched === q ? holding : null;
  // An engineer just added: drawn, scrolled to and their name focused, until it's had focus.
  const [target, setTarget] = useState<string | null>(null);
  // Rows whose "+N more" PTO was pressed, by key: still open when drawn again, scrolled away and back.
  const [ptoOpen, setPtoOpen] = useState<ReadonlySet<string>>(() => new Set());
  const targetKey = target === null ? null : (keyOf.get(people.find((p) => p.id === target)!) ?? null);

  const groups = useMemo(() => {
    const all = new Map<string, Person[]>([...departments.map((d) => [d.id, [] as Person[]] as const), [NO_DEPT, []]]);
    for (const p of people) all.get(deptOf(p))!.push(p);
    return [...departments.map((d) => ({ id: d.id, name: d.name, color: d.color })), { id: NO_DEPT, name: "No department", color: "#8a94a6" }]
      .filter((g) => g.id !== NO_DEPT || all.get(NO_DEPT)!.length > 0)
      .map((g) => {
        const list = all.get(g.id)!;
        const shown = list
          .flatMap((person) => {
            const key = keyOf.get(person)!;
            const ok = !q || searchable(person).includes(q);
            return ok || key === held || key === targetKey ? [{ person, key, held: !ok && key !== targetKey }] : [];
          })
          .sort((a, b) => a.person.name.localeCompare(b.person.name));
        return { ...g, total: list.length, people: keepPlace(shown, (r) => r.key, kept.order.get(g.id) ?? [], held) };
      });
    // deptOf is a new function every render: deptIds stands in for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [departments, people, deptIds, keyOf, q, searchable, held, targetKey, kept]);
  const shown = groups.reduce((n, g) => n + g.people.filter((r) => !r.held).length, 0);

  const model = useMemo(
    () => peopleRows({ groups, collapsed, searching: q !== "", addDepartment: !readOnly && !!props.onAddDepartment }),
    [groups, collapsed, q, readOnly, props.onAddDepartment],
  );
  // The row being edited, once it no longer matches: its note is heard too, once, not only seen (WCAG 4.1.3).
  const heldOut = useMemo(() => model.rows.find((r) => r.kind === "person" && r.held)?.key ?? null, [model]);
  useAnnounce(heldOut && PEOPLE_HELD_NOTE, { news: heldOut });
  const windowed = window.__boxopsTest?.virtualize ?? model.rows.length > DRAW_ALL_UP_TO;
  const win = useWindowedRows({
    keys: model.keys,
    kinds: model.kinds,
    defaults: ROW_HEIGHTS,
    pinned: [active, holding, targetKey].filter((k) => k !== null),
    enabled: windowed,
    search: q,
    heading: "group",
  });
  const tableRef = useRef<HTMLTableElement>(null);
  const printing = usePrinting();

  // What was shown is what a row being edited keeps its place in; a new search, once shown, too.
  useLayoutEffect(() => {
    kept.order = new Map(groups.map((g) => [g.id, g.people.map((r) => r.key)]));
    kept.searched = q;
  });
  // An engineer just added: their department opened, scrolled to (drawn there at once); focus goes there as it's drawn.
  const reached = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!targetKey || reached.current === targetKey) return;
    if (win.scrollTo(targetKey, "center")) reached.current = targetKey;
  });

  // How many a search leaves, said once typing pauses.
  useAnnounceResults(
    q,
    q && !shown ? `No engineers match “${query.trim()}”.` : `${shown === people.length ? "" : `${thousands(shown)} of `}${counted(people.length, "engineer")}.`,
  );

  /** Add an engineer (to a department, opened), with the search cleared so they're shown. */
  const add = (department?: string) => {
    setQuery("");
    if (department && collapsed.has(department)) onToggleDepartment(department);
    setTarget(onAdd(department));
  };
  // What the rows do: these functions, always the latest (rows are memoized, given one object that never changes).
  const handlers: PersonActions = {
    update: (id, patch) => {
      const next = onUpdate(id, patch);
      if (next !== id) kept.keys.rename(id, next);
    },
    remove: (p, button) => {
      const n = boxCount.get(p.id) ?? 0;
      if (n === 0 || confirm(`Remove ${p.name}? They’re on ${counted(n, "box", "boxes")} and will be unassigned. You can undo this.`)) {
        focusAfterRow(button, ".row-delete");
        onRemove(p.id);
      }
    },
    checkpoint: () => onCheckpoint(),
    showPto: props.onShowPto && ((ref) => props.onShowPto?.(ref)),
    toggle: (id) => onToggleDepartment(id),
    edit: (id) => props.onEditDepartment?.(id),
    add: (id) => add(id),
    addDepartment: () => props.onAddDepartment?.(),
    morePto: (key) =>
      setPtoOpen((open) => {
        const next = new Set(open);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
  };
  const act = useRef(handlers);
  useLayoutEffect(() => {
    act.current = handlers;
  });
  const canShowPto = !!props.onShowPto;
  const actions = useMemo<PersonActions>(
    () => ({
      update: (id, patch) => act.current.update(id, patch),
      remove: (p, button) => act.current.remove(p, button),
      checkpoint: () => act.current.checkpoint(),
      showPto: canShowPto ? (ref) => act.current.showPto?.(ref) : undefined,
      toggle: (id) => act.current.toggle(id),
      edit: (id) => act.current.edit(id),
      add: (id) => act.current.add(id),
      addDepartment: () => act.current.addDepartment(),
      morePto: (key) => act.current.morePto(key),
    }),
    [canShowPto],
  );

  const row = (r: PeopleRow, i: number) => {
    const common = { rowKey: r.key, index: i + 2, measure: win.measure(r.key) };
    switch (r.kind) {
      case "group":
        return (
          <PeopleGroupRow
            key={r.key}
            {...common}
            id={r.id}
            name={r.name}
            shown={r.shown}
            total={r.total}
            searching={q !== ""}
            collapsed={r.id !== NO_DEPT && collapsed.has(r.id) && !q}
            readOnly={readOnly}
            editable={!!props.onEditDepartment}
            actions={actions}
          />
        );
      case "person": {
        const department = deptOf(r.person);
        return (
          <PersonRow
            key={r.key}
            {...common}
            person={r.person}
            department={department}
            departmentName={deptNames.get(department) ?? ""}
            departmentOptions={departmentOptions}
            departmentCount={departments.length + 1}
            readOnly={readOnly}
            autoFocus={r.key === targetKey}
            held={r.held}
            now={now}
            ptoOpen={ptoOpen.has(r.key)}
            actions={actions}
          />
        );
      }
      case "empty":
        return <EmptyRow key={r.key} {...common} text={`No engineers in ${r.name} yet.`} columns={PEOPLE_COLUMNS} />;
      case "add-dept":
        return <AddRow key={r.key} {...common} className="add-dept-row" label="Add department" columns={PEOPLE_COLUMNS} onClick={actions.addDepartment} />;
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
          {shown === people.length ? "" : `${thousands(shown)} of `}
          {counted(people.length, "engineer")}
        </span>
        {departments.length > 0 && <CollapseAll all={props.allCollapsed} onToggle={props.onToggleAll} />}
        {!readOnly && (
          <button className="primary" onClick={() => add()}>
            <Icon name="plus" size={14} />
            Add engineer
          </button>
        )}
      </div>

      <div
        className={`table-scroll${windowed ? " windowed" : ""}`}
        ref={(el) => {
          scrollRef.current = el;
          win.scroller.current = el;
        }}
        {...rowFocus}
        onFocus={(e) => {
          rowFocus.onFocus(e);
          if (targetKey !== null && rowKeyOf(e.target) === targetKey) setTarget(null);
        }}
      >
        <KeepFocus table={tableRef} keys={model.keys}>
          <table className="box-table people-table" ref={tableRef} aria-rowcount={model.rows.length + 1}>
            <thead ref={win.head}>
              <tr aria-rowindex={1}>
                {COLUMNS.map((c, i) => (
                  <th key={i} className={c.className}>
                    {c.label ? <span className="th-label">{c.label}</span> : <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            {model.groups.map((g) => {
              const head = model.rows[g.start];
              const dept = head.kind === "group" ? head : null;
              return (
                <tbody
                  key={g.id || "none"}
                  className={dept ? "dept-group" : undefined}
                  data-dept-id={dept?.id || undefined}
                  style={dept ? ({ "--dept": dept.color } as CSSProperties) : undefined}
                >
                  {/* One list of rows and spacers, each with its own key (a list in a list would be keyed by place). */}
                  {win
                    .runs(g.start, g.end)
                    .flatMap((run) =>
                      // A spacer's key is the first row it stands for, so one never takes a key an earlier spacer had
                      // elsewhere: React would move the rows between them (and with them focus, which browsers drop).
                      "gap" in run
                        ? [<SpacerRow key={`gap:${model.keys[run.stands[0]]}`} height={run.gap} columns={PEOPLE_COLUMNS} />]
                        : model.rows.slice(run.rows[0], run.rows[1]).map((r, k) => row(r, run.rows[0] + k)),
                    )}
                </tbody>
              );
            })}
          </table>
        </KeepFocus>
        {/* On paper, every row as shown (the table above only has those near the screen). */}
        {printing && <PrintPeople rows={model.rows} collapsed={(id) => collapsed.has(id) && !q} />}
        {q && shown === 0 && <p className="empty">No engineers match “{query}”.</p>}
      </div>
    </div>
  );
}

import { type CSSProperties, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NO_FLAG } from "../model/status";
import { boxScale } from "../model/scale";
import { jiraKey } from "../model/jira";
import { CollapseAll } from "./CollapseAll";
import { formatDay, nextWorkday, parseDay, prettyDay, prevWorkday, workdays } from "../model/dates";
import type { Box, Person, Roadmap, TimeOff } from "../model/types";
import { type PtoRef, ptoEntries, ptoKey } from "../model/pto";
import { capacityOn, hasDates, laneDates } from "../model/lanes";
import { useToday } from "./useToday";
import { Icon } from "./Icon";
import { DateInput } from "./DateInput";
import { reorderByKey, useReorder } from "./useReorder";
import { announce, useAnnounce, useAnnounceResults } from "../a11y/announce";
import { focusAfterRow, focusLater } from "../a11y/focus";
import { keeper } from "../keeper";
import { boxKeys, PtoKeys } from "../table/rowKeys";
import type { AddedPto } from "../table/addedPto";
import { keepPlace, type TableRow, tableRows } from "../table/tableModel";
import { DRAW_ALL_UP_TO, useWindowedRows } from "../table/useWindowedRows";
import { KeepFocus } from "../table/KeepFocus";
import { rowKeyOf } from "../table/focusRow";
import { useActiveRow } from "../table/useActiveRow";
import { usePrinting } from "../table/usePrinting";
import { PrintBoxes } from "../table/PrintTable";
import { AddRow, BoxRow, COLUMN_COUNT, EmptyRow, GroupRow, HELD_NOTE, type LaneInfo, PtoRow, type RowActions, SpacerRow } from "../table/TableRows";

interface Props {
  roadmap: Roadmap;
  /** Show PTO rows under each department (a personal preference). */
  showPto?: boolean;
  /** Hide boxes that ended before today, and here PTO too (a personal preference, shared with the timeline). */
  hideFinished?: boolean;
  onHideFinished?(hide: boolean): void;
  readOnly?: boolean;
  /** Why nothing can be changed while `readOnly`, said when a key would have changed something. */
  readOnlyReason?: string;
  conflictIds?: Set<string>;
  updatedIds?: Set<string>;
  /**
   * Patch a box. `key` groups repeated edits of one cell into one undo step.
   * Returns the box's id afterwards (an unsaved box's id follows its title).
   */
  onUpdate(id: string, patch: Partial<Box>, key?: string): string;
  /** Add someone to the engineer roster; returns their id. */
  onAddPerson(name: string, department?: string): string;
  /** Add a box (to this department's first lane, if given); returns its id, or null when there's no lane to put it in. */
  onAdd(departmentId?: string): string | null;
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
  /** Drag a department's heading to a new place in the order (0 = first). */
  onMoveDepartment?(id: string, index: number): void;
  onAddDepartment?(): void;
  /** Broken rules, by box id. */
  ruleWarnings?: Map<string, string[]>;
  /** PTO rows: edit, reassign, add (to a department's first engineer; returns where it went) and remove. */
  onUpdatePto?(ref: PtoRef, patch: Partial<TimeOff>, key?: string): void;
  onReassignPto?(ref: PtoRef, personId: string): void;
  onAddPto?(departmentId: string): PtoRef | null;
  onRemovePto?(ref: PtoRef): void;
  /** PTO added in this session, shown though finished PTO is hidden (a week off added on a weekend has ended). */
  addedPto?: AddedPto;
}

type SortKey = "title" | "lane" | "start" | "end" | "days" | "fte" | "scale" | "engineers" | "type" | "status";

const COLUMNS: { key: SortKey | null; label: string; className?: string }[] = [
  { key: "title", label: "Title", className: "col-title" },
  { key: "lane", label: "Department / lane", className: "col-lane" },
  { key: "start", label: "Start", className: "col-date" },
  { key: "end", label: "End", className: "col-date" },
  { key: "days", label: "Working days", className: "col-days" },
  { key: "fte", label: "FTE", className: "col-fte" },
  { key: "scale", label: "Scale", className: "col-scale" },
  { key: "engineers", label: "Engineers", className: "col-engineers" },
  { key: "type", label: "Type", className: "col-type" },
  { key: "status", label: "Flag", className: "col-status" },
  { key: null, label: "Epic link", className: "col-epic" },
  { key: null, label: "Tags", className: "col-tags" },
  { key: null, label: "Description", className: "col-desc" },
  { key: null, label: "", className: "col-actions" },
];

/** How tall each kind of row is until one's been measured, at the comfortable density (they're measured as they're drawn). */
const ROW_HEIGHTS: Record<TableRow["kind"], number> = { group: 36, box: 53, empty: 36, pto: 33, "add-pto": 32, "add-dept": 44 };

/** A box's text a search looks in, and its engineers' names. */
interface Searchable {
  text: string;
  engineers: string;
}

const sameNames = (a: Map<string, string>, b: Map<string, string>) => a.size === b.size && [...b].every(([id, name]) => a.get(id) === name);
/** The roster as the Engineers lists use it: the same while nobody's name, id or department changes (PTO edits leave it). */
const sameRoster = (a: Person[], b: Person[]) =>
  a.length === b.length && a.every((p, i) => p.id === b[i].id && p.name === b[i].name && p.department === b[i].department);

export function TableView(props: Props) {
  const { roadmap, readOnly = false, conflictIds, updatedIds, onUpdate, onAdd, onCheckpoint, onReviewed } = props;
  const { collapsed, onToggleDepartment, onAddPerson, ruleWarnings } = props;
  const { settings, departments, boxes, people } = roadmap;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "lane", dir: 1 });
  const [query, setQuery] = useState("");
  // Date filter: boxes (and PTO) that overlap these dates; either end can be open.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const fromDay = parseDay(from);
  const toDay = parseDay(to);
  const dated = fromDay !== null || toDay !== null;
  const q = query.trim().toLowerCase();
  // Searching or a date filter: show only matching rows, with their departments open.
  const searching = q !== "" || dated;
  const now = useToday();
  const hideFinished = !!props.hideFinished;
  const showPto = props.showPto !== false;
  /** A box needs a lane to go in. */
  const hasLanes = departments.some((d) => d.lanes.length > 0);

  // Kept from one render to the next: values that keep their identity while they say the same, keys for PTO,
  // and the order last shown (a row being edited keeps its place in it).
  const [kept] = useState(() => ({
    names: keeper(sameNames),
    roster: keeper(sameRoster),
    ptoKeys: new PtoKeys(),
    order: new Map<string, string[]>(),
    sorted: "",
  }));

  // Lane order and labels, for the lane column and for sorting by it.
  const lanes = useMemo(() => {
    const out = new Map<string, LaneInfo>();
    let order = 0;
    for (const d of departments) {
      d.lanes.forEach((l, i) => {
        const label = l.name ?? `FTE ${i + 1}`;
        const option = `${d.name} / ${label}${hasDates(l) ? ` (${laneDates(l)})` : ""}`;
        out.set(l.id, { label, option, dept: d.name, deptId: d.id, deptCode: d.code, order: order++, color: d.color });
      });
    }
    return out;
  }, [departments]);
  const laneOptions = useMemo(
    () =>
      departments.map((d) => (
        <optgroup key={d.id} label={d.name}>
          {d.lanes.map((l) => (
            <option key={l.id} value={l.id}>
              {lanes.get(l.id)!.option}
            </option>
          ))}
        </optgroup>
      )),
    [departments, lanes],
  );
  const typeOptions = useMemo(
    () =>
      settings.types.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      )),
    [settings.types],
  );
  const statusOptions = useMemo(
    () => [
      <option key="" value="">
        {NO_FLAG}
      </option>,
      ...settings.statuses.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      )),
    ],
    [settings.statuses],
  );
  const typeIndex = useMemo(() => new Map(settings.types.map((t, i) => [t.id, i])), [settings.types]);
  const statusIndex = useMemo(() => new Map(settings.statuses.map((s, i) => [s.id, i])), [settings.statuses]);
  const typeColor = useMemo(() => new Map(settings.types.map((t) => [t.id, t.color])), [settings.types]);
  // Type and flag names, as the search looks for them.
  const typeNames = useMemo(() => new Map(settings.types.map((t) => [t.id, t.name])), [settings.types]);
  const flagNames = useMemo(() => new Map(settings.statuses.map((s) => [s.id, s.name])), [settings.statuses]);
  const names = useMemo(() => kept.names(new Map(people.map((p) => [p.id, p.name]))), [kept, people]);
  const roster = useMemo(() => kept.roster(people), [kept, people]);
  // Each department's engineers by name, as the options of a PTO row's Engineer.
  const members = useMemo(() => {
    const out = new Map<string, { options: ReactNode; count: number }>();
    const byDept = new Map<string, Person[]>();
    for (const p of roster) if (p.department) byDept.set(p.department, [...(byDept.get(p.department) ?? []), p]);
    for (const [id, list] of byDept) {
      const sorted = list.toSorted((a, b) => a.name.localeCompare(b.name));
      out.set(id, {
        count: sorted.length,
        options: sorted.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        )),
      });
    }
    return out;
  }, [roster]);
  // Capacity today and dated lanes (listed in the heading's tooltip, as they make it change over time).
  const headings = useMemo(
    () =>
      new Map(
        departments.map((d) => [
          d.id,
          { fte: capacityOn(d, now), dated: d.lanes.flatMap((l, i) => (hasDates(l) ? [`${l.name ?? `FTE ${i + 1}`}: ${laneDates(l)}`] : [])) },
        ]),
      ),
    [departments, now],
  );
  const totals = useMemo(() => {
    const out = new Map<string, number>();
    for (const b of boxes) {
      const id = lanes.get(b.lane)?.deptId ?? "";
      out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
  }, [boxes, lanes]);

  // What a search looks in, worked out once a box (and again only for a box that's changed): the text of every
  // column but the numbers, and a flag's name only if it has one (on a big table, rows not drawn are found only by
  // the search, not the browser's Find).
  const searchable = useMemo(() => {
    const made = new WeakMap<Box, Searchable>();
    return (b: Box): Searchable => {
      let s = made.get(b);
      if (!s) {
        const lane = lanes.get(b.lane);
        const engineers = (b.engineers ?? []).map((id) => names.get(id) ?? id).join(", ");
        const fields = [`${lane?.deptCode ?? ""}-${b.code}`, jiraKey(b.epic) ?? "", b.title, b.description ?? "", (b.tags ?? []).join(", ")];
        const shown = [formatDay(b.start), formatDay(b.end), typeNames.get(b.type) ?? b.type, b.status ? (flagNames.get(b.status) ?? b.status) : "", b.epic ?? ""];
        const text = [...fields, lane?.label ?? "", lane?.dept ?? "", engineers, ...shown].join(" ").toLowerCase();
        made.set(b, (s = { text, engineers }));
      }
      return s;
    };
  }, [lanes, names, typeNames, flagNames]);
  const boxKey = useMemo(() => boxKeys(boxes), [boxes]);

  // The row focus is in, drawn wherever it is; and the row that keeps its place and stays shown while it has focus,
  // though an edit would sort it elsewhere or filter it out. A new sort, search or filter puts it where it goes.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { active, held: holding, handlers: rowFocus } = useActiveRow(scrollRef);
  const filters = JSON.stringify([sort, q, fromDay, toDay, hideFinished, showPto]);
  const held = kept.sorted === filters ? holding : null;
  // A row just added: drawn, scrolled to and focused (its title, or a PTO row's engineer), until it's had focus.
  const [target, setTarget] = useState<{ box: string } | { pto: PtoRef } | null>(null);

  const inDates = (start: number, end: number) => (fromDay === null || end >= fromDay) && (toDay === null || start <= toDay);

  // PTO: every entry's key, then the rows by department (their owner's), earliest first; a search matches names, notes and dates.
  const entries = useMemo(() => ptoEntries(people), [people]);
  const entryKeys = useMemo(() => kept.ptoKeys.keys(entries), [kept, entries]);
  const ptoKeyAt = useMemo(() => new Map(entries.map((e, i) => [ptoKey({ personId: e.person.id, index: e.index }), entryKeys[i]])), [entries, entryKeys]);
  const targetKey =
    target === null
      ? null
      : "box" in target
        ? (boxKey.get(boxes.find((b) => b.id === target.box)!) ?? null)
        : (ptoKeyAt.get(ptoKey(target.pto)) ?? null);

  const groups = useMemo(() => {
    let matched = 0;
    const shown = boxes.flatMap((b) => {
      const key = boxKey.get(b)!;
      const ok = inDates(b.start, b.end) && !(hideFinished && b.end < now) && (!q || searchable(b).text.includes(q));
      if (ok) matched++;
      return ok || key === held || key === targetKey ? [{ box: b, key, held: !ok && key !== targetKey }] : [];
    });
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
          return searchable(b).engineers.toLowerCase() || "\uffff"; // unassigned last
        case "type":
          return typeIndex.get(b.type) ?? 99;
        case "status":
          return b.status === undefined ? 99 : (statusIndex.get(b.status) ?? 98); // flagged first
      }
    };
    const sorted = shown
      .map((row) => ({ row, v: value(row.box) }))
      .sort((a, b) => (a.v < b.v ? -1 : a.v > b.v ? 1 : a.row.box.start - b.row.box.start || a.row.box.id.localeCompare(b.row.box.id)) * sort.dir)
      .map(({ row }) => row);
    // Bucketed by department (in department order).
    const byDept = new Map(departments.map((d) => [d.id, [] as typeof sorted]));
    for (const row of sorted) byDept.get(lanes.get(row.box.lane)?.deptId ?? "")?.push(row);
    for (const [id, list] of byDept) byDept.set(id, keepPlace(list, (r) => r.key, kept.order.get(id) ?? [], held));
    return { byDept, matched };
    // inDates is a new function every render: what it reads is listed instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fromDay and toDay stand in for it
  }, [boxes, boxKey, departments, lanes, sort, q, fromDay, toDay, hideFinished, now, searchable, typeIndex, statusIndex, held, targetKey, kept]);

  const ptoByDept = useMemo(() => {
    const out = new Map<string, { entry: (typeof entries)[number]; key: string; held: boolean }[]>();
    if (!showPto) return out;
    const order = entries.map((entry, i) => ({ entry, key: entryKeys[i] })).sort((a, b) => a.entry.pto.start - b.entry.pto.start);
    for (const { entry, key } of order) {
      const dept = entry.person.department;
      if (!dept) continue;
      const { pto, person } = entry;
      // Finished PTO goes with finished boxes, but not PTO added in this session (a week off this week, on a weekend).
      const ok =
        inDates(pto.start, pto.end) &&
        !(hideFinished && pto.end < now && !props.addedPto?.has(pto)) &&
        (!q || `pto ${person.name} ${pto.note ?? ""} ${formatDay(pto.start)} ${formatDay(pto.end)}`.toLowerCase().includes(q));
      if (!ok && key !== held && key !== targetKey) continue;
      const list = out.get(dept) ?? [];
      list.push({ entry, key, held: !ok && key !== targetKey });
      out.set(dept, list);
    }
    for (const [id, list] of out) out.set(id, keepPlace(list, (r) => r.key, kept.order.get(`pto:${id}`) ?? [], held));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fromDay and toDay stand in for inDates, as above
  }, [entries, entryKeys, showPto, q, fromDay, toDay, hideFinished, now, held, targetKey, kept, props.addedPto]);

  const model = useMemo(
    () =>
      tableRows({
        departments,
        boxes: groups.byDept,
        pto: ptoByDept,
        collapsed,
        searching,
        addPto: (d) => !readOnly && (members.get(d.id)?.count ?? 0) > 0 && !!props.onAddPto && showPto,
        addDepartment: !readOnly && !!props.onAddDepartment,
      }),
    [departments, groups, ptoByDept, collapsed, searching, readOnly, members, props.onAddPto, showPto, props.onAddDepartment],
  );
  // The row being edited, once it no longer matches: its note is heard too, once, not only seen (WCAG 4.1.3).
  const heldOut = useMemo(() => model.rows.find((r) => (r.kind === "box" || r.kind === "pto") && r.held)?.key ?? null, [model]);
  useAnnounce(heldOut && HELD_NOTE, { news: heldOut });
  const windowed = window.__boxopsTest?.virtualize ?? model.rows.length > DRAW_ALL_UP_TO;
  const win = useWindowedRows({
    keys: model.keys,
    kinds: model.kinds,
    defaults: ROW_HEIGHTS,
    pinned: [active, holding, targetKey].filter((k) => k !== null),
    enabled: windowed,
    sort: `${sort.key} ${sort.dir}`,
    search: `${q}\n${fromDay ?? ""}\n${toDay ?? ""}`,
  });
  const tableRef = useRef<HTMLTableElement>(null);
  const printing = usePrinting();
  // Departments are dragged into a new order by their headings; not while filtering, when some are hidden.
  const canReorder = !readOnly && !searching && !!props.onMoveDepartment;
  const reorder = useReorder(tableRef, (id, index) => props.onMoveDepartment?.(id, index), {
    disabled: !canReorder,
    scroller: scrollRef,
  });

  // What was shown is what a row being edited keeps its place in; a new sort or filter, once shown, too.
  useLayoutEffect(() => {
    kept.order = new Map([
      ...[...groups.byDept].map(([id, list]) => [id, list.map((r) => r.key)] as const),
      ...[...ptoByDept].map(([id, list]) => [`pto:${id}`, list.map((r) => r.key)] as const),
    ]);
    kept.sorted = filters;
  });

  // A row just added: its department opened, scrolled to (drawn there at once), kept shown; focus goes there as it's drawn.
  const reached = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!targetKey || reached.current === targetKey) return;
    if (target && "box" in target) {
      const dept = lanes.get(boxes.find((b) => b.id === target.box)?.lane ?? "")?.deptId;
      if (dept && collapsed.has(dept) && !searching) {
        onToggleDepartment(dept);
        return;
      }
    }
    if (win.scrollTo(targetKey, "center")) reached.current = targetKey;
  });

  /** A date that wasn't used as typed (a weekend), or that took the other end with it, is said: the cell just shows the result. */
  const sayMoved = (picked: number, day: number, what: string, other: "start" | "end" | false) => {
    const notes = [day !== picked && `Moved to ${prettyDay(day)}: ${what} on a weekday.`, other && `The ${other} moved to ${prettyDay(day)} too.`];
    if (notes.some(Boolean)) announce(notes.filter(Boolean).join(" "));
  };
  /** Change PTO, its row keeping its key. */
  const updatePto = (ref: PtoRef, patch: Partial<TimeOff>, key?: string) => {
    const row = ptoKeyAt.get(ptoKey(ref));
    if (row) kept.ptoKeys.edited(ref, row);
    props.onUpdatePto?.(ref, patch, key);
  };
  /** Start a new box or PTO: the search and dates cleared, so it's shown. */
  const adding = () => {
    setQuery("");
    setFrom("");
    setTo("");
  };

  // What the rows do: these functions, always the latest (rows are memoized, given one object that never changes).
  const handlers: RowActions = {
    update: (id, patch, key) => onUpdate(id, patch, key),
    // Weekends don't exist on the roadmap: a weekend start moves to Monday, a weekend end to Friday.
    setStart: (b, text) => {
      const picked = parseDay(text);
      if (picked === null) return;
      const start = nextWorkday(picked);
      sayMoved(picked, start, "boxes start", start > b.end && "end");
      onUpdate(b.id, start > b.end ? { start, end: start } : { start }, `table:${b.id}:start`);
    },
    setEnd: (b, text) => {
      const picked = parseDay(text);
      if (picked === null) return;
      const end = prevWorkday(picked);
      sayMoved(picked, end, "boxes end", end < b.start && "start");
      onUpdate(b.id, end < b.start ? { end, start: end } : { end }, `table:${b.id}:end`);
    },
    addPerson: (name, department) => onAddPerson(name, department),
    remove: (b, button) => {
      focusAfterRow(button, ".row-delete");
      props.onDelete(b.id);
    },
    checkpoint: () => onCheckpoint(),
    reviewed: (id) => onReviewed(id),
    updatePto: (ref, patch) => updatePto(ref, patch),
    ptoDates: (ref, pto, field, text) => {
      const picked = parseDay(text);
      if (picked === null) return;
      const key = `table:${ptoKey(ref)}:${field}`;
      if (field === "start") {
        const start = nextWorkday(picked);
        sayMoved(picked, start, "PTO starts", start > pto.end && "end");
        updatePto(ref, start > pto.end ? { start, end: start } : { start }, key);
      } else {
        const end = prevWorkday(picked);
        sayMoved(picked, end, "PTO ends", end < pto.start && "start");
        updatePto(ref, end < pto.start ? { end, start: end } : { end }, key);
      }
    },
    reassignPto: (ref, toId) => props.onReassignPto?.(ref, toId),
    removePto: (ref, button) => {
      focusAfterRow(button, ".row-delete");
      props.onRemovePto?.(ref);
    },
    toggle: (id) => onToggleDepartment(id),
    edit: (id) => props.onEditDepartment?.(id),
    addBox: (id) => {
      adding();
      if (collapsed.has(id)) onToggleDepartment(id);
      const added = onAdd(id);
      if (added) setTarget({ box: added });
    },
    addPto: (id) => {
      adding();
      const ref = props.onAddPto?.(id);
      if (ref) setTarget({ pto: ref });
    },
    addDepartment: () => props.onAddDepartment?.(),
    grab: (e, id) => reorder.start(e, id),
    headingKey: (e, id) => {
      const why = props.readOnlyReason ?? "Read-only: changes can’t be made here.";
      if (reorderByKey(e, departments, id, canReorder ? props.onMoveDepartment : undefined, why) === null) return;
      const button = e.currentTarget;
      focusLater([() => document.querySelector(`.box-table [data-dept-id="${CSS.escape(id)}"] .group-toggle`)], button);
    },
  };
  const act = useRef(handlers);
  useLayoutEffect(() => {
    act.current = handlers;
  });
  const actions = useMemo<RowActions>(
    () => ({
      update: (id, patch, key) => act.current.update(id, patch, key),
      setStart: (b, text) => act.current.setStart(b, text),
      setEnd: (b, text) => act.current.setEnd(b, text),
      addPerson: (name, department) => act.current.addPerson(name, department),
      remove: (b, button) => act.current.remove(b, button),
      checkpoint: () => act.current.checkpoint(),
      reviewed: (id) => act.current.reviewed(id),
      updatePto: (ref, patch) => act.current.updatePto(ref, patch),
      ptoDates: (ref, pto, field, text) => act.current.ptoDates(ref, pto, field, text),
      reassignPto: (ref, toId) => act.current.reassignPto(ref, toId),
      removePto: (ref, button) => act.current.removePto(ref, button),
      toggle: (id) => act.current.toggle(id),
      edit: (id) => act.current.edit(id),
      addBox: (id) => act.current.addBox(id),
      addPto: (id) => act.current.addPto(id),
      addDepartment: () => act.current.addDepartment(),
      grab: (e, id) => act.current.grab(e, id),
      headingKey: (e, id) => act.current.headingKey(e, id),
    }),
    [],
  );

  // How many boxes a search or date filter leaves, said once typing pauses (as the toolbar shows it).
  const shown = groups.matched;
  const shownText =
    shown === 0 && searching
      ? q
        ? `No boxes match “${query.trim()}”${dated ? " in these dates" : ""}.`
        : "No boxes in these dates."
      : `${shown === boxes.length ? "" : `${shown} of `}${boxes.length} box${boxes.length === 1 ? "" : "es"}.`;
  useAnnounceResults(`${query.trim()}\n${from}\n${to}\n${hideFinished}`, shownText);
  // Nothing to show: say why.
  const empty =
    boxes.length === 0
      ? "No boxes yet."
      : q
        ? `No boxes match “${query.trim()}”${dated ? " in these dates" : ""}.`
        : dated
          ? "No boxes in these dates."
          : "Every box has finished, and finished boxes are hidden.";

  const row = (r: TableRow, i: number) => {
    const common = { rowKey: r.key, index: i + 2, measure: win.measure(r.key) };
    switch (r.kind) {
      case "group": {
        const h = headings.get(r.dept.id)!;
        return (
          <GroupRow
            key={r.key}
            {...common}
            dept={r.dept}
            shown={groups.byDept.get(r.dept.id)?.length ?? 0}
            total={totals.get(r.dept.id) ?? 0}
            searching={searching}
            collapsed={collapsed.has(r.dept.id) && !searching}
            canReorder={canReorder}
            readOnly={readOnly}
            editable={!!props.onEditDepartment}
            fte={h.fte}
            dated={h.dated}
            actions={actions}
          />
        );
      }
      case "box": {
        const b = r.box;
        return (
          <BoxRow
            key={r.key}
            {...common}
            box={b}
            lane={lanes.get(b.lane)}
            laneOptions={laneOptions}
            laneCount={lanes.size}
            typeOptions={typeOptions}
            statusOptions={statusOptions}
            typeColor={typeColor.get(b.type)}
            warnings={ruleWarnings?.get(b.id)?.join("\n")}
            flag={conflictIds?.has(b.id) ? "conflict" : updatedIds?.has(b.id) ? "updated" : undefined}
            readOnly={readOnly}
            autoFocus={r.key === targetKey}
            held={r.held}
            departments={departments}
            people={roster}
            names={names}
            actions={actions}
          />
        );
      }
      case "pto": {
        const m = members.get(r.entry.person.department ?? "");
        return (
          <PtoRow
            key={r.key}
            {...common}
            entry={r.entry}
            members={m?.options}
            memberCount={m?.count ?? 0}
            readOnly={readOnly}
            autoFocus={r.key === targetKey}
            held={r.held}
            actions={actions}
          />
        );
      }
      case "empty":
        return <EmptyRow key={r.key} {...common} text={`No boxes in ${r.dept.name} yet.`} columns={COLUMN_COUNT} />;
      case "add-pto":
        return <AddRow key={r.key} {...common} className="add-pto-row" label="Add PTO" columns={COLUMN_COUNT} id={r.dept.id} onClick={actions.addPto} />;
      case "add-dept":
        return <AddRow key={r.key} {...common} className="add-dept-row" label="Add department" columns={COLUMN_COUNT} onClick={actions.addDepartment} />;
    }
  };

  return (
    <div className="table-view">
      <div className="table-toolbar">
        <input
          className="table-search"
          type="search"
          aria-label="Search boxes"
          placeholder="Search codes, titles, tags, lanes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="date-filter" role="group" aria-label="Dates">
          <DateInput value={from} onChange={setFrom} optional aria-label="From date" placeholder="From" />
          <span className="date-sep">–</span>
          <DateInput value={to} onChange={setTo} optional aria-label="To date" placeholder="To" />
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
            <input type="checkbox" role="switch" checked={hideFinished} onChange={(e) => props.onHideFinished!(e.target.checked)} />
            <span>Hide finished boxes and PTO</span>
          </label>
        )}
        <span className="hint">
          {shown === boxes.length ? "" : `${shown} of `}
          {boxes.length} box{boxes.length === 1 ? "" : "es"}
        </span>
        {departments.length > 0 && <CollapseAll all={props.allCollapsed} onToggle={props.onToggleAll} />}
        {!readOnly && !hasLanes && <span className="hint">Add a department first: boxes go in its lanes.</span>}
        {!readOnly && (
          <button
            className="primary"
            disabled={!hasLanes}
            onClick={() => {
              adding();
              const added = onAdd();
              if (added) setTarget({ box: added });
            }}
          >
            <Icon name="plus" size={14} />
            Add box
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
        {reorder.line && <div className="reorder-line" style={reorder.line} />}
        <KeepFocus table={tableRef} keys={model.keys}>
          <table className="box-table" ref={tableRef} aria-rowcount={model.rows.length + 1}>
            <thead ref={win.head}>
              <tr aria-rowindex={1}>
                {COLUMNS.map((c, i) => (
                  <th key={i} className={c.className} aria-sort={c.key === sort.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                    {c.key ? (
                      <button
                        className="sort-button"
                        onClick={() => setSort((s) => ({ key: c.key!, dir: s.key === c.key ? ((-s.dir) as 1 | -1) : 1 }))}
                      >
                        {c.label}
                        {/* aria-sort on the header says it to screen readers. */}
                        <span className="sort-mark" aria-hidden="true">
                          {c.key === sort.key ? (sort.dir === 1 ? "▲" : "▼") : ""}
                        </span>
                      </button>
                    ) : (
                      c.label || <span className="sr-only">Actions</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            {model.groups.map((g) => {
              const head = model.rows[g.start];
              const dept = head.kind === "group" ? head.dept : null;
              return (
                <tbody
                  key={g.id}
                  className={dept ? `dept-group${reorder.draggingId === dept.id ? " reordering-this" : ""}` : undefined}
                  data-dept-id={dept?.id}
                  data-reorder-id={dept?.id}
                  style={dept ? ({ "--dept": dept.color } as CSSProperties) : undefined}
                >
                  {/* One list of rows and spacers, each with its own key (a list in a list would be keyed by place). */}
                  {win
                    .runs(g.start, g.end)
                    .flatMap((run) =>
                      // A spacer's key is the first row it stands for, so one never takes a key an earlier spacer had
                      // elsewhere: React would move the rows between them (and with them focus, which browsers drop).
                      "gap" in run
                        ? [<SpacerRow key={`gap:${model.keys[run.stands[0]]}`} height={run.gap} columns={COLUMN_COUNT} />]
                        : model.rows.slice(run.rows[0], run.rows[1]).map((r, k) => row(r, run.rows[0] + k)),
                    )}
                </tbody>
              );
            })}
          </table>
        </KeepFocus>
        {/* On paper, every row as shown (the table above only has those near the screen). */}
        {printing && (
          <PrintBoxes rows={model.rows} lanes={lanes} names={names} settings={settings} totals={totals} collapsed={(id) => collapsed.has(id) && !searching} />
        )}
        {shown === 0 && <p className="empty">{empty}</p>}
      </div>
    </div>
  );
}

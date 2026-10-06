import { useCallback, useId, useRef, useState } from "react";
import { LiveRegion, announce } from "../a11y/announce";
import { FieldError, describedBy } from "./FieldError";
import { focusAfterRemoving, focusLater, main, onPage, useReturnFocus } from "../a11y/focus";
import { DEPT_CODE } from "../model/load";
import { deriveDeptCode } from "../model/relations";
import { COLOR_NAMES, DEPARTMENT_COLORS } from "../model/structure";
import { formatDay, nextWorkday, parseDay, prettyDay, prevWorkday } from "../model/dates";
import type { Box, Department, Lane, Person } from "../model/types";
import { Icon } from "./Icon";
import { DateInput } from "./DateInput";

export type DepartmentEditorTarget = { kind: "new" } | { kind: "edit"; id: string };

interface Props {
  target: DepartmentEditorTarget;
  departments: Department[];
  boxes: Box[];
  people: Person[];
  /** Codes in department files the app couldn't read: no department may take them. */
  reservedCodes: ReadonlySet<string>;
  onCreate(name: string, color: string, code: string): string;
  /** `key` groups typing in one field into one undo step. */
  onUpdate(id: string, patch: Partial<Pick<Department, "name" | "color" | "code">>, key?: string): void;
  onMove(id: string, dir: -1 | 1): void;
  onRemove(id: string, moveTo?: string): void;
  onAddLane(deptId: string): void;
  onUpdateLane(laneId: string, patch: Partial<Omit<Lane, "id">>, key?: string): void;
  onMoveLane(laneId: string, dir: -1 | 1): void;
  onRemoveLane(laneId: string, moveTo?: string): void;
  /** Close; ends any open undo step. */
  onClose(): void;
}

const laneLabel = (lanes: Lane[], i: number) => lanes[i].name ?? `FTE ${i + 1}`;

/** A dropdown of lanes to move boxes to, grouped by department. */
function LanePicker({
  departments,
  exclude,
  value,
  onChange,
  label,
  describedBy,
}: {
  departments: Department[];
  exclude: (laneId: string) => boolean;
  value: string;
  onChange(laneId: string): void;
  label: string;
  /** The question it answers (its callout's text). */
  describedBy?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} aria-describedby={describedBy}>
      <option value="">Choose a lane…</option>
      {departments.map((d) => {
        const lanes = d.lanes.map((l, i) => ({ l, i })).filter(({ l }) => !exclude(l.id));
        if (!lanes.length) return null;
        return (
          <optgroup key={d.id} label={d.name}>
            {lanes.map(({ l, i }) => (
              <option key={l.id} value={l.id}>
                {d.name} / {laneLabel(d.lanes, i)}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

export function DepartmentEditor(props: Props) {
  const { target, departments, boxes, people, onClose } = props;
  const [created, setCreated] = useState<string | null>(null);
  // New department form.
  const used = new Set(departments.map((d) => d.color));
  /** Lane date fields opened with "+ From" / "+ Until" but not filled in yet. */
  const [shownDates, setShownDates] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(() => DEPARTMENT_COLORS.find((c) => !used.has(c)) ?? DEPARTMENT_COLORS[0]);
  /** Typed by the user; until then, suggested from the name. */
  const [newCode, setNewCode] = useState<string | null>(null);
  // Which lane (or the whole department) is being removed, and where its boxes go.
  const [removing, setRemoving] = useState<{ what: string; moveTo: string } | null>(null);

  // Every <dialog> this renders opens as it mounts: one comes and goes as the
  // department it edits does (removed, or undone, while it was open).
  const dialog = useRef<HTMLDialogElement>(null);
  const open = useCallback((d: HTMLDialogElement | null) => {
    dialog.current = d;
    if (d && !d.open) {
      d.showModal();
      // showModal() focuses the first focusable element (the close button); start in the first field instead.
      d.querySelector<HTMLInputElement>("input:not([type=color])")?.focus();
    }
  }, []);
  const titleId = useId();
  const nameError = useId();
  const codeError = useId();
  /** The removal callout's question, and its note about engineers: what its first control is described by. */
  const question = useId();
  const peopleNote = useId();
  /** Delete department…: where its callout's Cancel puts focus back. */
  const deleteButton = useRef<HTMLButtonElement>(null);

  const id = target.kind === "edit" ? target.id : created;
  // Closed: focus goes to the department's ✎ (one just added: its heading), in whichever view is
  // showing; deleted, to what opened the editor if it's still there, else the first department.
  useReturnFocus(dialog, (opener) => {
    const inDept = (sel: string) => (id ? document.querySelector(`[data-dept-id="${CSS.escape(id)}"] :is(${sel})`) : null);
    return (
      (target.kind === "edit" ? inDept(".dept-edit, .group-edit") : inDept(".dept-toggle, .group-toggle")) ??
      onPage(opener) ??
      document.querySelector(".dept-toggle, .group-toggle") ??
      main()
    );
  });
  const codesTakenExcept = (deptId?: string) => new Set([...departments.filter((d) => d.id !== deptId).map((d) => d.code), ...props.reservedCodes]);
  const codeProblem = (code: string, deptId?: string) =>
    !DEPT_CODE.test(code)
      ? "2–4 capital letters or digits, starting with a letter."
      : props.reservedCodes.has(code)
        ? "A department file the app couldn’t read uses this code."
        : codesTakenExcept(deptId).has(code)
          ? "Another department already uses this code."
          : null;
  const sorted = [...departments].sort((a, b) => a.order - b.order);
  const dept = id ? departments.find((d) => d.id === id) : undefined;
  const index = dept ? sorted.findIndex((d) => d.id === dept.id) : -1;

  const shell = (title: string, body: React.ReactNode) => (
    <dialog
      ref={open}
      className="save-dialog dept-editor"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <Icon name="x" size={16} />
        </button>
      </header>
      {/* VoiceOver reads only live regions inside an open modal dialog. */}
      <LiveRegion />
      {body}
    </dialog>
  );

  if (!dept) {
    if (target.kind === "edit") return null; // removed (or undone) while open
    const newCodeProblem = newName.trim() ? codeProblem(newCode ?? deriveDeptCode(newName, codesTakenExcept())) : null;
    return shell(
      "Add a department",
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const code = newCode ?? deriveDeptCode(newName, codesTakenExcept());
          if (newName.trim() && !codeProblem(code)) setCreated(props.onCreate(newName.trim(), newColor, code));
        }}
      >
        <label>
          Name
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            placeholder="e.g. Platform"
            aria-label="Department name"
          />
        </label>
        <label>
          <span>
            Code <span className="hint">prefixes its boxes, e.g. DE-A1F</span>
          </span>
          <input
            value={newCode ?? deriveDeptCode(newName, codesTakenExcept())}
            onChange={(e) => setNewCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
            aria-label="Department code"
            aria-invalid={!!newCodeProblem || undefined}
            aria-describedby={describedBy(newCodeProblem && codeError)}
            className="code-input"
          />
          <FieldError id={codeError}>{newCodeProblem}</FieldError>
        </label>
        <div className="field">
          <span className="field-label">Colour</span>
          <ColorChoice value={newColor} onChange={setNewColor} />
        </div>
        <p className="hint">It starts with one 1-FTE lane. You can add more lanes next.</p>
        <footer className="dialog-foot">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!newName.trim() || !!codeProblem(newCode ?? deriveDeptCode(newName, codesTakenExcept()))}
          >
            Add department
          </button>
        </footer>
      </form>,
    );
  }

  const laneIds = dept.lanes.map((l) => l.id);
  const boxesInLane = (laneId: string) => boxes.filter((b) => b.lane === laneId).length;
  const deptBoxes = boxes.filter((b) => laneIds.includes(b.lane)).length;
  const deptPeople = people.filter((p) => p.department === dept.id).length;
  const fte = dept.lanes.reduce((n, l) => n + l.fte, 0);
  /** A lane removed from one of its buttons: focus goes to the next lane's ✕, else the one before's, else Add lane. */
  const removeLane = (button: HTMLElement, laneId: string, moveTo?: string) => {
    focusAfterRemoving(button, "li", ".row-remove", (list) => list.nextElementSibling?.querySelector("button"));
    props.onRemoveLane(laneId, moveTo);
  };
  // The Move buttons and a lane's arrows are never disabled (a disabled button loses focus, to
  // the page): at the end already, they say so. Each move says the new place.
  const moveDept = (dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= sorted.length) {
      announce(`${dept.name} is already ${dir < 0 ? "first" : "last"}.`);
      return;
    }
    props.onMove(dept.id, dir);
    announce(`${dept.name} moved ${dir < 0 ? "up" : "down"}, ${to + 1} of ${sorted.length}.`);
  };
  /** The lane in row `i` up or down a place. Its row is moved on the page, which loses focus: it goes back to the same arrow. */
  const moveLane = (lane: Lane, i: number, dir: -1 | 1) => {
    const to = i + dir;
    const which = `Lane ${i + 1}${lane.name ? ` (${lane.name})` : ""}`;
    if (to < 0 || to >= dept.lanes.length) {
      announce(`${which} is already ${dir < 0 ? "first" : "last"}.`);
      return;
    }
    const arrow = `.lane-list li[data-lane-id="${CSS.escape(lane.id)}"] [aria-label^="Move lane"][aria-label$="${dir < 0 ? "up" : "down"}"]`;
    focusLater([() => dialog.current?.querySelector(arrow)]);
    props.onMoveLane(lane.id, dir);
    announce(`${which} moved ${dir < 0 ? "up" : "down"}, now lane ${to + 1} of ${dept.lanes.length}.`);
  };
  /** Ask about removing the lane (or the department, its id): focus goes into the question, on its first control. */
  const askRemove = (what: string, from: HTMLElement) => {
    setRemoving((cur) => (cur?.what === what ? cur : { what, moveTo: "" }));
    focusLater([() => dialog.current?.querySelector(".remove-callout :is(select, .danger:not(:disabled))")], from);
  };
  /** The question's Cancel: focus goes back to what asked it. */
  const cancelRemove = (back: () => Element | null | undefined) => {
    focusLater([back]);
    setRemoving(null);
  };

  return shell(
    created ? `Added ${dept.name}` : `Edit ${dept.name}`,
    <div className="form">
      <label>
        Name
        <input
          value={dept.name}
          onChange={(e) => props.onUpdate(dept.id, { name: e.target.value }, `${dept.id}:name`)}
          onBlur={(e) => e.target.value.trim() !== e.target.value && props.onUpdate(dept.id, { name: e.target.value.trim() }, `${dept.id}:name`)}
          aria-label="Department name"
          aria-invalid={!dept.name.trim() || undefined}
          aria-describedby={describedBy(!dept.name.trim() && nameError)}
        />
        <FieldError id={nameError}>{!dept.name.trim() && "A name is required to save."}</FieldError>
      </label>
      <label>
        <span>
          Code <span className="hint">prefixes its boxes: {dept.code || "?"}-A1F. Changing it relabels them all.</span>
        </span>
        <input
          value={dept.code}
          onChange={(e) =>
            props.onUpdate(dept.id, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) }, `${dept.id}:code`)
          }
          aria-label="Department code"
          aria-invalid={!!codeProblem(dept.code, dept.id) || undefined}
          aria-describedby={describedBy(!!codeProblem(dept.code, dept.id) && codeError)}
          className="code-input"
        />
        <FieldError id={codeError}>{codeProblem(dept.code, dept.id) && `${codeProblem(dept.code, dept.id)} It must be fixed before saving.`}</FieldError>
      </label>
      <div className="field">
        <span className="field-label">Colour</span>
        <ColorChoice value={dept.color} onChange={(color) => props.onUpdate(dept.id, { color }, `${dept.id}:color`)} />
      </div>
      <div className="field">
        <span className="field-label">Position</span>
        <span className="button-row">
          <button onClick={() => moveDept(-1)} aria-disabled={index <= 0 || undefined}>
            <Icon name="arrow-up" size={14} /> Move up
          </button>
          <button onClick={() => moveDept(1)} aria-disabled={index >= sorted.length - 1 || undefined}>
            <Icon name="arrow-down" size={14} /> Move down
          </button>
          <span className="hint">
            {index + 1} of {sorted.length}
          </span>
        </span>
      </div>

      <div className="field">
        <span className="field-label">
          Lanes <span className="hint">{fte} FTE in total. Unnamed lanes show as FTE 1, FTE 2…
          Give a lane dates if it only exists for a while (a new hire, a contractor).</span>
        </span>
        <ul className="lane-list">
          {dept.lanes.map((lane, i) => {
            const count = boxesInLane(lane.id);
            const isRemoving = removing?.what === lane.id;
            return (
              <li key={lane.id} data-lane-id={lane.id}>
                <div className="lane-edit-row">
                  <input
                    value={lane.name ?? ""}
                    placeholder={`FTE ${i + 1}`}
                    aria-label={`Lane ${i + 1} name`}
                    onChange={(e) => props.onUpdateLane(lane.id, { name: e.target.value.trim() ? e.target.value : undefined }, `${lane.id}:name`)}
                    onBlur={(e) =>
                      e.target.value.trim() !== e.target.value &&
                      props.onUpdateLane(lane.id, { name: e.target.value.trim() || undefined }, `${lane.id}:name`)
                    }
                  />
                  <select
                    value={lane.fte}
                    aria-label={`Lane ${i + 1} FTE`}
                    onChange={(e) => props.onUpdateLane(lane.id, { fte: Number(e.target.value) })}
                  >
                    <option value={1}>1 FTE</option>
                    <option value={0.5}>0.5 FTE</option>
                  </select>
                  <button
                    className="icon-button"
                    onClick={() => moveLane(lane, i, -1)}
                    aria-disabled={i === 0 || undefined}
                    aria-label={`Move lane ${i + 1} up`}
                  >
                    <Icon name="arrow-up" size={14} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => moveLane(lane, i, 1)}
                    aria-disabled={i === dept.lanes.length - 1 || undefined}
                    aria-label={`Move lane ${i + 1} down`}
                  >
                    <Icon name="arrow-down" size={14} />
                  </button>
                  <button
                    className="icon-button row-remove"
                    aria-label={`Remove lane ${i + 1}`}
                    title={count ? `Remove (its ${count} box${count === 1 ? "" : "es"} will need a new lane)` : "Remove"}
                    onClick={(e) => (count ? askRemove(lane.id, e.currentTarget) : removeLane(e.currentTarget, lane.id))}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <div className="lane-dates-row">
                  {(["start", "end"] as const).map((field) => {
                    const label = field === "start" ? "From" : "Until";
                    const what = field === "start" ? "opens" : "closes";
                    // Names that start with what's shown, so "From" can be said to reach them.
                    const addName = `${label} (set when lane ${i + 1} ${what})`;
                    // Undated: a button, so an empty date field never looks like a real date.
                    if (lane[field] === undefined && !shownDates.has(`${lane.id}:${field}`)) {
                      return (
                        <button
                          key={field}
                          className="add-button small"
                          aria-label={addName}
                          onClick={() => setShownDates((cur) => new Set([...cur, `${lane.id}:${field}`]))}
                        >
                          <Icon name="plus" size={12} />
                          {label}
                        </button>
                      );
                    }
                    // Not a <label>: one around the calendar would take its clicks, and its buttons' names.
                    return (
                      <span key={field} className="lane-date">
                        {label}
                        <DateInput
                          autoFocus={lane[field] === undefined}
                          optional
                          value={lane[field] === undefined ? "" : formatDay(lane[field])}
                          aria-label={`${label} (lane ${i + 1} ${what})`}
                          onChange={(text) => {
                            const key = `${lane.id}:${field}`;
                            // Cleared (its text deleted, or the calendar's Clear): undated, the empty field staying put.
                            if (text === "") {
                              setShownDates((cur) => new Set([...cur, key]));
                              props.onUpdateLane(lane.id, { [field]: undefined }, key);
                              return;
                            }
                            // Else a full, valid date (all DateInput gives). Weekends don't exist: opening moves to Monday, closing to Friday.
                            const picked = parseDay(text)!;
                            const day = field === "start" ? nextWorkday(picked) : prevWorkday(picked);
                            if (day !== picked) announce(`Moved to ${prettyDay(day)}: a lane ${what} on a weekday.`);
                            const patch: Partial<Lane> = { [field]: day };
                            // Keep start ≤ end: moving one past the other takes it along.
                            if (field === "start" && lane.end !== undefined && day > lane.end) patch.end = day;
                            if (field === "end" && lane.start !== undefined && day < lane.start) patch.start = day;
                            props.onUpdateLane(lane.id, patch, key);
                          }}
                        />
                        <button
                          className="icon-button"
                          aria-label={`Clear lane ${i + 1} ${field === "start" ? "opening" : "closing"} date`}
                          onClick={(e) => {
                            // Its + button comes back in its place: focus goes there, not to the page.
                            const row = e.currentTarget.closest(".lane-dates-row");
                            focusLater([() => row?.querySelector(`[aria-label="${addName}"]`)]);
                            setShownDates((cur) => new Set([...cur].filter((k) => k !== `${lane.id}:${field}`)));
                            props.onUpdateLane(lane.id, { [field]: undefined });
                          }}
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </span>
                    );
                  })}
                  {lane.start === undefined && lane.end === undefined && <span className="hint">Always open</span>}
                </div>
                {isRemoving && (
                  <div className="callout warn remove-callout">
                    <span id={question}>
                      {count} box{count === 1 ? " is" : "es are"} in this lane. Move {count === 1 ? "it" : "them"} to:
                    </span>
                    <span className="button-row">
                      <LanePicker
                        departments={sorted}
                        exclude={(l) => l === lane.id}
                        value={removing.moveTo}
                        onChange={(moveTo) => setRemoving({ ...removing, moveTo })}
                        label="Move boxes to"
                        describedBy={question}
                      />
                      <button
                        className="danger"
                        disabled={!removing.moveTo}
                        onClick={(e) => {
                          removeLane(e.currentTarget, lane.id, removing.moveTo);
                          setRemoving(null);
                        }}
                      >
                        Move and remove lane
                      </button>
                      <button
                        onClick={(e) => {
                          const row = e.currentTarget.closest("li");
                          cancelRemove(() => row?.querySelector(".row-remove"));
                        }}
                      >
                        Cancel
                      </button>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <span>
          <button
            className="add-button"
            onClick={() => {
              props.onAddLane(dept.id);
              announce(`Lane ${dept.lanes.length + 1} added.`);
            }}
          >
            <Icon name="plus" size={14} />
            Add lane
          </button>
        </span>
      </div>

      {removing?.what === dept.id ? (
        <div className="callout warn remove-callout">
          {deptBoxes > 0 ? (
            <>
              <span id={question}>
                Delete <strong>{dept.name}</strong>? Its {deptBoxes} box{deptBoxes === 1 ? "" : "es"} will move to:
              </span>
              <LanePicker
                departments={sorted}
                exclude={(l) => laneIds.includes(l)}
                value={removing.moveTo}
                onChange={(moveTo) => setRemoving({ ...removing, moveTo })}
                label="Move boxes to"
                describedBy={describedBy(question, deptPeople > 0 && peopleNote)}
              />
            </>
          ) : (
            <span id={question}>
              Delete <strong>{dept.name}</strong>? It has no boxes.
            </span>
          )}
          {deptPeople > 0 && (
            <p className="hint" id={peopleNote}>
              {deptPeople} engineer{deptPeople === 1 ? "" : "s"} in it will stay on the roster with no department.
            </p>
          )}
          <span className="button-row">
            <button
              className="danger"
              disabled={deptBoxes > 0 && !removing.moveTo}
              aria-describedby={deptBoxes > 0 ? undefined : describedBy(question, deptPeople > 0 && peopleNote)}
              onClick={() => {
                props.onRemove(dept.id, removing.moveTo || undefined);
                setRemoving(null);
                onClose();
              }}
            >
              Delete department
            </button>
            <button onClick={() => cancelRemove(() => deleteButton.current)}>Cancel</button>
          </span>
        </div>
      ) : null}

      <footer className="dialog-foot">
        <button ref={deleteButton} className="danger" onClick={(e) => askRemove(dept.id, e.currentTarget)} style={{ marginRight: "auto" }}>
          Delete department…
        </button>
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </div>,
  );
}

function ColorChoice({ value, onChange }: { value: string; onChange(color: string): void }) {
  return (
    <span className="color-choice">
      {DEPARTMENT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`swatch-button${c.toLowerCase() === value.toLowerCase() ? " chosen" : ""}`}
          style={{ background: c }}
          aria-label={`Colour: ${COLOR_NAMES[c]}`}
          aria-pressed={c.toLowerCase() === value.toLowerCase()}
          onClick={() => onChange(c)}
        />
      ))}
      <input type="color" className="color-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Custom colour" />
    </span>
  );
}

import { useEffect, useRef, useState } from "react";
import { DEPARTMENT_COLORS } from "../model/structure";
import type { Box, Department, Lane, Person } from "../model/types";

export type DepartmentEditorTarget = { kind: "new" } | { kind: "edit"; id: string };

interface Props {
  target: DepartmentEditorTarget;
  departments: Department[];
  boxes: Box[];
  people: Person[];
  onCreate(name: string, color: string): string;
  /** `key` groups typing in one field into one undo step. */
  onUpdate(id: string, patch: Partial<Pick<Department, "name" | "color">>, key?: string): void;
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
}: {
  departments: Department[];
  exclude: (laneId: string) => boolean;
  value: string;
  onChange(laneId: string): void;
  label: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [created, setCreated] = useState<string | null>(null);
  // New department form.
  const used = new Set(departments.map((d) => d.color));
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(() => DEPARTMENT_COLORS.find((c) => !used.has(c)) ?? DEPARTMENT_COLORS[0]);
  // Which lane (or the whole department) is being removed, and where its boxes go.
  const [removing, setRemoving] = useState<{ what: string; moveTo: string } | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) {
      d.showModal();
      // showModal() focuses the first focusable element (the close button); start in the first field instead.
      d.querySelector<HTMLInputElement>("input:not([type=color])")?.focus();
    }
  }, []);

  const id = target.kind === "edit" ? target.id : created;
  const sorted = [...departments].sort((a, b) => a.order - b.order);
  const dept = id ? departments.find((d) => d.id === id) : undefined;
  const index = dept ? sorted.findIndex((d) => d.id === dept.id) : -1;

  const shell = (title: string, body: React.ReactNode) => (
    <dialog
      ref={dialogRef}
      className="save-dialog dept-editor"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="dialog-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      {body}
    </dialog>
  );

  if (!dept) {
    if (target.kind === "edit") return null; // removed (or undone) while open
    return shell(
      "Add a department",
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) setCreated(props.onCreate(newName.trim(), newColor));
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
        <div className="field">
          <span className="field-label">Colour</span>
          <ColorChoice value={newColor} onChange={setNewColor} />
        </div>
        <p className="hint">It starts with one 1-FTE lane. You can add more lanes next.</p>
        <footer className="dialog-foot">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!newName.trim()}>
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

  return shell(
    created ? `Added ${dept.name}` : `Edit ${dept.name}`,
    <div className="form">
      <label>
        Name
        <input
          value={dept.name}
          onChange={(e) => props.onUpdate(dept.id, { name: e.target.value }, `${dept.id}:name`)}
          aria-label="Department name"
        />
        {!dept.name.trim() && <span className="field-error">A name is required to save.</span>}
      </label>
      <div className="field">
        <span className="field-label">Colour</span>
        <ColorChoice value={dept.color} onChange={(color) => props.onUpdate(dept.id, { color }, `${dept.id}:color`)} />
      </div>
      <div className="field">
        <span className="field-label">Position</span>
        <span className="button-row">
          <button onClick={() => props.onMove(dept.id, -1)} disabled={index <= 0}>
            ↑ Move up
          </button>
          <button onClick={() => props.onMove(dept.id, 1)} disabled={index >= sorted.length - 1}>
            ↓ Move down
          </button>
          <span className="hint">
            {index + 1} of {sorted.length}
          </span>
        </span>
      </div>

      <div className="field">
        <span className="field-label">
          Lanes <span className="hint">{fte} FTE in total. Unnamed lanes show as FTE 1, FTE 2…</span>
        </span>
        <ul className="lane-list">
          {dept.lanes.map((lane, i) => {
            const count = boxesInLane(lane.id);
            const isRemoving = removing?.what === lane.id;
            return (
              <li key={lane.id}>
                <div className="lane-edit-row">
                  <input
                    value={lane.name ?? ""}
                    placeholder={`FTE ${i + 1}`}
                    aria-label={`Lane ${i + 1} name`}
                    onChange={(e) => props.onUpdateLane(lane.id, { name: e.target.value.trim() ? e.target.value : undefined }, `${lane.id}:name`)}
                  />
                  <select
                    value={lane.fte}
                    aria-label={`Lane ${i + 1} FTE`}
                    onChange={(e) => props.onUpdateLane(lane.id, { fte: Number(e.target.value) })}
                  >
                    <option value={1}>1 FTE</option>
                    <option value={0.5}>0.5 FTE</option>
                  </select>
                  <button className="icon-button" onClick={() => props.onMoveLane(lane.id, -1)} disabled={i === 0} aria-label={`Move lane ${i + 1} up`}>
                    ↑
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => props.onMoveLane(lane.id, 1)}
                    disabled={i === dept.lanes.length - 1}
                    aria-label={`Move lane ${i + 1} down`}
                  >
                    ↓
                  </button>
                  <button
                    className="icon-button row-remove"
                    aria-label={`Remove lane ${i + 1}`}
                    title={count ? `Remove (its ${count} box${count === 1 ? "" : "es"} will need a new lane)` : "Remove"}
                    onClick={() => (count ? setRemoving({ what: lane.id, moveTo: "" }) : props.onRemoveLane(lane.id))}
                  >
                    ×
                  </button>
                </div>
                {isRemoving && (
                  <div className="callout warn remove-callout">
                    {count} box{count === 1 ? " is" : "es are"} in this lane. Move {count === 1 ? "it" : "them"} to:
                    <span className="button-row">
                      <LanePicker
                        departments={sorted}
                        exclude={(l) => l === lane.id}
                        value={removing.moveTo}
                        onChange={(moveTo) => setRemoving({ ...removing, moveTo })}
                        label="Move boxes to"
                      />
                      <button
                        className="danger"
                        disabled={!removing.moveTo}
                        onClick={() => {
                          props.onRemoveLane(lane.id, removing.moveTo);
                          setRemoving(null);
                        }}
                      >
                        Move and remove lane
                      </button>
                      <button onClick={() => setRemoving(null)}>Cancel</button>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <span>
          <button onClick={() => props.onAddLane(dept.id)}>+ Add lane</button>
        </span>
      </div>

      {removing?.what === dept.id ? (
        <div className="callout warn remove-callout">
          {deptBoxes > 0 ? (
            <>
              Delete <strong>{dept.name}</strong>? Its {deptBoxes} box{deptBoxes === 1 ? "" : "es"} will move to:
              <LanePicker
                departments={sorted}
                exclude={(l) => laneIds.includes(l)}
                value={removing.moveTo}
                onChange={(moveTo) => setRemoving({ ...removing, moveTo })}
                label="Move boxes to"
              />
            </>
          ) : (
            <>
              Delete <strong>{dept.name}</strong>? It has no boxes.
            </>
          )}
          {deptPeople > 0 && (
            <p className="hint">
              {deptPeople} engineer{deptPeople === 1 ? "" : "s"} in it will stay on the roster with no department.
            </p>
          )}
          <span className="button-row">
            <button
              className="danger"
              disabled={deptBoxes > 0 && !removing.moveTo}
              onClick={() => {
                props.onRemove(dept.id, removing.moveTo || undefined);
                setRemoving(null);
                onClose();
              }}
            >
              Delete department
            </button>
            <button onClick={() => setRemoving(null)}>Cancel</button>
          </span>
        </div>
      ) : null}

      <footer className="dialog-foot">
        <button
          className="danger"
          onClick={() => setRemoving({ what: dept.id, moveTo: "" })}
          disabled={removing?.what === dept.id}
          style={{ marginRight: "auto" }}
        >
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
          aria-label={`Colour ${c}`}
          aria-pressed={c.toLowerCase() === value.toLowerCase()}
          onClick={() => onChange(c)}
        />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Custom colour" />
    </span>
  );
}

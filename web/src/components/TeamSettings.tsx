// Team settings: what's in roadmap/settings.yaml. Edits go into the draft like
// any other change (undo, unsaved count) and are saved as a commit for everyone.

import { slugify } from "../model/draft";
import {
  type Box,
  type BoxStatus,
  type BoxType,
  type Settings,
  ZOOM_LEVELS,
  type ZoomLevel,
} from "../model/types";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const ZOOM_NAME: Record<ZoomLevel, string> = {
  weeks: "Weeks",
  months: "Months",
  quarters: "Quarters",
};
const NEW_COLORS = [
  "#4f7cff",
  "#16a34a",
  "#a35cf0",
  "#e8913a",
  "#0d9488",
  "#db2777",
  "#ca8a04",
  "#8a94a6",
];

interface Props {
  settings: Settings;
  /** Settings as loaded: items saved before keep their ids. */
  saved: Settings;
  boxes: Box[];
  /** `key` groups keystrokes in one field into a single undo step. */
  onChange(patch: Partial<Settings>, key: string): void;
  onClose(): void;
}

/** An id for a new item, from its name (ids are lower case with underscores, like `at_risk`). */
function idFor(name: string, taken: Set<string>): string {
  const base = slugify(name).replace(/-/g, "_") || "item";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  return id;
}

/** A shared list editor for box types and flags. */
function ListEditor<T extends BoxType | BoxStatus>({
  onChange,
  field,
  noun,
  items,
  savedIds,
  uses,
  minimum,
  make,
}: {
  onChange: Props["onChange"];
  field: "types" | "statuses";
  noun: string;
  items: T[];
  savedIds: Set<string>;
  uses(id: string): number;
  minimum: number;
  make(id: string, name: string, index: number): T;
}) {
  const set = (next: T[], key: string) =>
    onChange({ [field]: next } as Partial<Settings>, `${field}:${key}`);
  const rename = (i: number, name: string) => {
    const item = items[i];
    // An item that isn't saved yet, and that no box uses, takes its id from its name.
    const followName =
      !savedIds.has(item.id) && uses(item.id) === 0 && name.trim();
    const id = followName
      ? idFor(name, new Set(items.filter((_, j) => j !== i).map((x) => x.id)))
      : item.id;
    set(
      items.map((x, j) => (j === i ? { ...x, id, name } : x)),
      `name:${i}`,
    );
  };
  const move = (i: number, by: number) => {
    const next = [...items];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    set(next, `move:${i}`);
  };
  return (
    <ul className="team-list">
      {items.map((item, i) => {
        const n = uses(item.id);
        const canRemove = n === 0 && items.length > minimum;
        return (
          <li key={i}>
            {"color" in item && (
              <input
                type="color"
                className="color-input"
                value={item.color}
                aria-label={`${item.name} colour`}
                onChange={(e) =>
                  set(
                    items.map((x, j) =>
                      j === i ? { ...x, color: e.target.value } : x,
                    ),
                    `color:${i}`,
                  )
                }
              />
            )}
            <input
              className={`team-name${item.name.trim() ? "" : " invalid"}`}
              value={item.name}
              placeholder={`${noun[0].toUpperCase()}${noun.slice(1)} name`}
              aria-label={`${noun[0].toUpperCase()}${noun.slice(1)} ${i + 1} name`}
              onChange={(e) => rename(i, e.target.value)}
            />
            <span className="hint team-uses">
              {n ? `${n} box${n === 1 ? "" : "es"}` : ""}
            </span>
            <button
              className="icon-button"
              disabled={i === 0}
              aria-label={`Move ${item.name} up`}
              onClick={() => move(i, -1)}
            >
              <Icon name="arrow-up" size={14} />
            </button>
            <button
              className="icon-button"
              disabled={i === items.length - 1}
              aria-label={`Move ${item.name} down`}
              onClick={() => move(i, 1)}
            >
              <Icon name="arrow-down" size={14} />
            </button>
            <button
              className="icon-button"
              disabled={!canRemove}
              aria-label={`Remove ${item.name}`}
              title={
                n
                  ? `${n} box${n === 1 ? " uses" : "es use"} this ${noun}: change ${n === 1 ? "it" : "them"} first`
                  : items.length <= minimum
                    ? `Keep at least one ${noun}`
                    : `Remove`
              }
              onClick={() =>
                set(
                  items.filter((_, j) => j !== i),
                  `remove:${i}`,
                )
              }
            >
              <Icon name="x" size={14} />
            </button>
          </li>
        );
      })}
      <li>
        <button
          className="add-button"
          onClick={() => {
            const name = `New ${noun}`;
            set(
              [
                ...items,
                make(
                  idFor(name, new Set(items.map((x) => x.id))),
                  name,
                  items.length,
                ),
              ],
              "add",
            );
          }}
        >
          <Icon name="plus" size={14} />
          Add {noun}
        </button>
      </li>
    </ul>
  );
}

export function TeamSettings({
  settings,
  saved,
  boxes,
  onChange,
  onClose,
}: Props) {
  const usesType = (id: string) => boxes.filter((b) => b.type === id).length;
  const usesFlag = (id: string) => boxes.filter((b) => b.status === id).length;

  return (
    <Modal title="Team settings" className="team-settings" onClose={onClose}>
      <p className="hint team-intro">
        These apply to everyone. They're saved to settings.yaml with your other
        changes.
      </p>
      <div className="form">
        <label>
          Roadmap title
          <input
            value={settings.title}
            onChange={(e) => onChange({ title: e.target.value }, "title")}
          />
        </label>
        <div className="team-row">
          <label>
            Fiscal year starts in
            <select
              value={settings.fiscal_year_start_month}
              onChange={(e) =>
                onChange(
                  { fiscal_year_start_month: Number(e.target.value) },
                  "fy",
                )
              }
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                  {i === 0 ? " (calendar quarters)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Default zoom
            <select
              value={settings.default_zoom}
              onChange={(e) =>
                onChange({ default_zoom: e.target.value as ZoomLevel }, "zoom")
              }
            >
              {ZOOM_LEVELS.map((z) => (
                <option key={z} value={z}>
                  {ZOOM_NAME[z]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field">
          <span className="field-label">
            Box types{" "}
            <span className="hint">
              the colour every box of that type carries
            </span>
          </span>
          <ListEditor<BoxType>
            onChange={onChange}
            field="types"
            noun="type"
            items={settings.types}
            savedIds={new Set(saved.types.map((t) => t.id))}
            uses={usesType}
            minimum={1}
            make={(id, name, i) => ({
              id,
              name,
              color: NEW_COLORS[i % NEW_COLORS.length],
            })}
          />
        </div>
        <div className="field">
          <span className="field-label">
            Flags{" "}
            <span className="hint">
              set by hand on boxes that need attention
            </span>
          </span>
          <ListEditor<BoxStatus>
            onChange={onChange}
            field="statuses"
            noun="flag"
            items={settings.statuses}
            savedIds={new Set(saved.statuses.map((s) => s.id))}
            uses={usesFlag}
            minimum={1}
            make={(id, name) => ({ id, name })}
          />
        </div>
      </div>
      <footer className="dialog-foot">
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </Modal>
  );
}

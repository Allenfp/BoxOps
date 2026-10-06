// What the gear menu (SettingsMenu.tsx) holds, fetched when it first opens:
// personal preferences (kept in this browser), saving and help, and a way
// into the team settings (saved to settings.yaml for everyone).

import { getToken, setToken } from "../github/token";
import {
  type CollapsedView,
  type Density,
  type Prefs,
  resetPrefs,
  setPrefs,
  type ThemePref,
  usePrefs,
  type ViewMode,
} from "../prefs";
import { ZOOM_LEVELS, type ZoomLevel } from "../model/types";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import type { Target } from "../a11y/focus";
import { APPLE, shifted, shortcut } from "../a11y/keys";

const ZOOM_NAME: Record<ZoomLevel, string> = {
  weeks: "Weeks",
  months: "Months",
  quarters: "Quarters",
};
const VIEW_NAME: Record<ViewMode, string> = {
  timeline: "Timeline",
  table: "Table",
  people: "People",
};

export interface SettingsProps {
  teamZoom: ZoomLevel;
  /** Unsaved changes, for "Discard". */
  changes: number;
  onDiscard(): void;
  /** Use a zoom level now (as well as remembering it). */
  onZoom(zoom: ZoomLevel): void;
  historyUrl: string;
  /** "owner/repo": whose token "Forget token" forgets. */
  repo: string;
  /** Read-only: no saving or team settings, but a token kept (a private branch preview's) can still be forgotten. */
  readOnly?: boolean;
  onOpenKey(): void;
  onOpenShortcuts(): void;
  onOpenTeam(): void;
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange(v: T): void;
}) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <span className="segmented small" role="group" aria-label={label}>
        {options.map(([v, name]) => (
          <button
            key={v}
            aria-pressed={v === value}
            onClick={() => onChange(v)}
          >
            {name}
          </button>
        ))}
      </span>
    </div>
  );
}

function Toggle({ label, pref }: { label: string; pref: keyof Prefs }) {
  const prefs = usePrefs();
  return (
    <label className="setting-row toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={!!prefs[pref]}
        onChange={(e) => setPrefs({ [pref]: e.target.checked })}
      />
    </label>
  );
}

export function SettingsPanel({ close, ...props }: SettingsProps & { close(): void }) {
  const prefs = usePrefs();
  const token = getToken(props.repo);
  const item = (
    label: string,
    onClick: () => void,
    opts: { disabled?: boolean; danger?: boolean } = {},
  ) => (
    <button
      className={`menu-item${opts.danger ? " danger-text" : ""}`}
      disabled={opts.disabled}
      onClick={() => {
        close();
        onClick();
      }}
    >
      {label}
    </button>
  );
  return (
    <>
      <section>
        <h3>Appearance</h3>
        <Choice<ThemePref>
          label="Theme"
          value={prefs.theme}
          options={[
            ["light", "Light"],
            ["dark", "Dark"],
            ["system", "System"],
          ]}
          onChange={(theme) => setPrefs({ theme })}
        />
        <Choice<Density>
          label="Density"
          value={prefs.density}
          options={[
            ["comfortable", "Comfortable"],
            ["compact", "Compact"],
          ]}
          onChange={(density) => setPrefs({ density })}
        />
      </section>

      <section>
        <h3>Boxes show</h3>
        <Toggle label="Codes and Jira keys" pref="showCodes" />
        <Toggle label="Flags" pref="showFlags" />
        <Toggle label="Engineer initials" pref="showInitials" />
        <Toggle label="Scale" pref="showScale" />
      </section>

      <section>
        <h3>Timeline</h3>
        <label className="setting-row">
          <span>Open at zoom</span>
          <select
            value={prefs.zoom ?? ""}
            onChange={(e) => {
              const zoom = (e.target.value || undefined) as
                ZoomLevel | undefined;
              setPrefs({ zoom });
              props.onZoom(zoom ?? props.teamZoom);
            }}
          >
            <option value="">
              Team default ({ZOOM_NAME[props.teamZoom]})
            </option>
            {ZOOM_LEVELS.map((z) => (
              <option key={z} value={z}>
                {ZOOM_NAME[z]}
              </option>
            ))}
          </select>
        </label>
        <label className="setting-row">
          <span>Open on</span>
          <select
            value={prefs.openOn}
            onChange={(e) =>
              setPrefs({ openOn: e.target.value as ViewMode })
            }
          >
            {(Object.keys(VIEW_NAME) as ViewMode[]).map((v) => (
              <option key={v} value={v}>
                {VIEW_NAME[v]}
              </option>
            ))}
          </select>
        </label>
        <Choice<CollapsedView>
          label="Collapsed rows"
          value={prefs.collapsedView}
          options={[
            ["line", "Line"],
            ["bars", "Bars"],
            ["boxes", "Boxes"],
          ]}
          onChange={(collapsedView) => setPrefs({ collapsedView })}
        />
        <Toggle label="Show PTO rows" pref="showPto" />
        <Toggle label="Hide finished boxes (and PTO, in the table)" pref="hideFinished" />
      </section>

      {(!props.readOnly || token) && (
        <section>
          <h3>{props.readOnly ? "GitHub" : "Saving"}</h3>
          <div className="setting-row">
            <span>GitHub token</span>
            {token ? (
              <button
                className="add-button small"
                onClick={() => {
                  setToken(props.repo, null);
                  close();
                }}
              >
                Forget token
              </button>
            ) : (
              <span className="hint">Asked for when you save</span>
            )}
          </div>
          {!props.readOnly && (
            <>
              {item(
                props.changes
                  ? `Discard ${props.changes} unsaved change${props.changes === 1 ? "" : "s"}…`
                  : "No unsaved changes",
                props.onDiscard,
                { disabled: !props.changes, danger: true },
              )}
              <a
                className="menu-item"
                href={props.historyUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
              >
                View history on GitHub <Icon name="external" size={12} />
              </a>
            </>
          )}
        </section>
      )}

      <section>
        <h3>Help</h3>
        {item("Key…", props.onOpenKey)}
        {item("Keyboard shortcuts…", props.onOpenShortcuts)}
      </section>

      {!props.readOnly && (
        <section>
          <h3>Team</h3>
          {item("Team settings…", props.onOpenTeam)}
          <p className="hint menu-note">
            Box types, flags, fiscal year. Saved to settings.yaml for
            everyone.
          </p>
        </section>
      )}

      <section className="settings-foot">
        <span className="hint">
          Your preferences are kept in this browser only.
        </span>
        <button className="add-button small" onClick={resetPrefs}>
          Reset
        </button>
      </section>
    </>
  );
}

/** Option and Shift as each platform writes them, with a key. */
const ALT = APPLE ? "⌥" : "Alt+";
const SHIFT = APPLE ? "⇧" : "Shift";

/** Page Up and Page Down, neither split over two lines where the keys column wraps. */
const PAGE_KEYS = "Page\u00a0Up, Page\u00a0Down";

/** What the keys and the mouse do, by where; each platform's own modifier key (⌘ on a Mac, Ctrl elsewhere). */
const shortcuts = (): { title: string; rows: [string, string][] }[] => [
  {
    title: "Anywhere",
    rows: [
      [shortcut("S"), "Save"],
      [shortcut("Z"), "Undo (in a text field, undo typing)"],
      [`${shortcut("Z", true)}  or  ${shortcut("Y")}`, "Redo"],
      ["Esc", "Close the editor, dialog or menu"],
    ],
  },
  {
    title: "On the timeline",
    rows: [
      ["Tab", "Into the timeline, back where you were; again, out of it"],
      ["← → ↑ ↓", "Between lanes, boxes and PTO; up and down to what runs at the same time"],
      [`Home, End  or  ${shortcut("←")} ${shortcut("→")}`, "Start or end of the row"],
      [`${shortcut("↑")} ${shortcut("↓")}`, "First or last of the timeline"],
      [PAGE_KEYS, "The department heading above or below"],
      ["Enter", "Open the box or PTO"],
      ["I", "Show or hide the box’s scale card (Esc hides it too)"],
      ["Space", "Pick the box or PTO up, to move it"],
      ["N", "New box in the lane (after the box you're on), or PTO in a PTO row"],
      ["Delete", "Delete the box or PTO (undo brings it back)"],
      [`${ALT}↑ ${ALT}↓`, "On a department's name: move it up or down"],
      ["?", "This list"],
    ],
  },
  {
    title: "Moving a box or PTO",
    rows: [
      ["← →", `A working day earlier or later; with ${SHIFT}, a week`],
      [`${ALT}← ${ALT}→`, `Its end date only; with ${SHIFT}, a week`],
      ["↑ ↓", "The lane above or below (a box), into the next department"],
      ["Enter or Space", "Drop it there"],
      [`Esc  or  ${shortcut("Z")}`, "Put it back"],
    ],
  },
  {
    title: "In an editor",
    rows: [
      [`Tab, ${shifted("Tab")}`, "Next or previous field, round the editor (buttons too)"],
      ["Delete button", "Delete the box or PTO (undo brings it back)"],
    ],
  },
  {
    title: "In the table and People",
    rows: [
      ["Enter", `Keep what's typed in the cell, staying in it (${shortcut("Z")} then undoes it)`],
      ["Esc", "Put a text cell back as it was (a choice, or a whole date, is kept at once)"],
      [shifted("Enter"), "New line in a description or notes"],
      [`${ALT}↑ ${ALT}↓`, "On a department's name in the table: move it up or down"],
    ],
  },
  {
    title: "In a date field",
    rows: [
      [`${ALT}↓`, "Open the calendar (or its button beside the date)"],
      ["Esc", "Drop half a date typed (a whole date is kept as soon as it's typed)"],
    ],
  },
  {
    title: "In the calendar",
    rows: [
      ["← →", "The working day before or after (weekends can't be picked)"],
      ["↑ ↓", "A week earlier or later"],
      ["Home, End", "Monday or Friday of that week"],
      [PAGE_KEYS, `The month before or after; with ${SHIFT}, the year`],
      ["Enter or Space", "Pick the day"],
      ["Esc", "Close the calendar, not the editor it's in"],
    ],
  },
  {
    title: "In the Engineers list",
    rows: [
      ["↑ ↓", "Previous or next engineer"],
      ["Space", "Tick or untick"],
      ["Enter or Esc", "Close the list"],
    ],
  },
  {
    title: "With the mouse",
    rows: [
      ["Click a box or PTO", "Open it"],
      ["Double-click a lane", "Add a box"],
      ["Double-click a PTO row", "Book time off"],
      ["Drag a box", "Move it (near an edge, the timeline scrolls on)"],
      ["Drag a box's ends", "Change its dates"],
      ["Drag a department's name", "Move it up or down"],
    ],
  },
];

function ShortcutsContent() {
  return (
    <div className="shortcuts">
      {shortcuts().map(({ title, rows }) => (
        <table key={title}>
          <caption>{title}</caption>
          <tbody>
            {rows.map(([keys, what]) => (
              <tr key={keys}>
                <th scope="row">
                  <kbd>{keys}</kbd>
                </th>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

/** The keyboard shortcuts, in their dialog (from the gear menu, or ? on the timeline). `returnTo`: as Modal's. */
export function ShortcutsDialog({ onClose, returnTo }: { onClose(): void; returnTo?: Target }) {
  return (
    <Modal title="Keyboard shortcuts" className="shortcuts-modal" onClose={onClose} returnTo={returnTo}>
      <ShortcutsContent />
    </Modal>
  );
}

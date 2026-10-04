// The gear menu: personal preferences (kept in this browser), saving and help,
// and a way into the team settings (saved to settings.yaml for everyone).

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
import { Popover } from "./Popover";

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

interface Props {
  teamZoom: ZoomLevel;
  /** Unsaved changes, for "Discard". */
  changes: number;
  onDiscard(): void;
  /** Use a zoom level now (as well as remembering it). */
  onZoom(zoom: ZoomLevel): void;
  historyUrl: string;
  /** Read-only preview: no saving or team settings. */
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

export function SettingsMenu(props: Props) {
  const prefs = usePrefs();
  return (
    <Popover
      className="settings-menu"
      label="Settings"
      buttonClass="icon-only"
      button={<Icon name="settings" size={16} />}
    >
      {(close) => {
        const token = getToken();
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
              <Toggle label="Hide finished boxes" pref="hideFinished" />
            </section>

            {!props.readOnly && (
              <section>
                <h3>Saving</h3>
                <div className="setting-row">
                  <span>GitHub token</span>
                  {token ? (
                    <button
                      className="add-button small"
                      onClick={() => {
                        setToken(null);
                        close();
                      }}
                    >
                      Forget token
                    </button>
                  ) : (
                    <span className="hint">Asked for when you save</span>
                  )}
                </div>
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
      }}
    </Popover>
  );
}

const SHORTCUTS: [string, string][] = [
  ["⌘S", "Save"],
  ["⌘Z", "Undo"],
  ["⇧⌘Z  or  ⌘Y", "Redo"],
  ["Delete", "Delete the selected box or PTO"],
  ["Esc", "Close the editor or menu"],
  ["Double-click a lane", "Add a box"],
  ["Double-click a PTO row", "Book time off"],
  ["Drag a box", "Move it"],
  ["Drag a box's ends", "Change its dates"],
];

export function ShortcutsContent() {
  return (
    <table className="shortcuts">
      <tbody>
        {SHORTCUTS.map(([keys, what]) => (
          <tr key={keys}>
            <td>
              <kbd>{keys}</kbd>
            </td>
            <td>{what}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

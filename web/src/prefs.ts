// Personal preferences: how the app looks for you. Kept in this browser's
// localStorage, never in the repo, so one person's choices don't change anyone
// else's view. Team-wide settings live in roadmap/settings.yaml instead.

import { useSyncExternalStore } from "react";
import { ZOOM_LEVELS, type ZoomLevel } from "./model/types";

export type ThemePref = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";
export type ViewMode = "timeline" | "table" | "people";
/** What a collapsed department's row shows. */
export type CollapsedView = "line" | "bars" | "boxes";

export interface Prefs {
  theme: ThemePref;
  density: Density;
  /** What a box on the timeline shows. */
  showCodes: boolean;
  showScale: boolean;
  showInitials: boolean;
  showFlags: boolean;
  /** Zoom to open with; unset follows the team default. */
  zoom?: ZoomLevel;
  /** View to open with when the link doesn't say. */
  openOn: ViewMode;
  showPto: boolean;
  hideFinished: boolean;
  /** Capacity used, as a line or bars; or the boxes squeezed into one row. */
  collapsedView: CollapsedView;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  density: "comfortable",
  showCodes: false,
  showScale: false,
  showInitials: false,
  showFlags: true,
  openOn: "timeline",
  showPto: true,
  hideFinished: false,
  collapsedView: "line",
};

const KEY = "boxops-prefs";
/** Before preferences existed, only the theme was stored, under its own key. */
const OLD_THEME_KEY = "boxops-theme";
/**
 * What's stored: `version` and the preferences someone chose, nothing else,
 * so a default a newer BoxOps changes reaches everyone who left it alone.
 * Before version 1, every preference was stored, defaults included.
 */
const VERSION = 1;

/** Each preference's possible values: anything else stored (a renamed view, say) is ignored. */
const VALUES: Record<keyof Prefs, readonly unknown[]> = {
  theme: ["light", "dark", "system"] satisfies ThemePref[],
  density: ["comfortable", "compact"] satisfies Density[],
  showCodes: [true, false],
  showScale: [true, false],
  showInitials: [true, false],
  showFlags: [true, false],
  zoom: ZOOM_LEVELS,
  openOn: ["timeline", "table", "people"] satisfies ViewMode[],
  showPto: [true, false],
  hideFinished: [true, false],
  collapsedView: ["line", "bars", "boxes"] satisfies CollapsedView[],
};
const NAMES = Object.keys(VALUES) as (keyof Prefs)[];

/** The preferences chosen in this browser, as stored now; null if storage can't be read. */
function stored(): Partial<Prefs> | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw === null) return localStorage.getItem(OLD_THEME_KEY) === "dark" ? { theme: "dark" } : {};
  } catch {
    return null; // storage blocked: this page's own choices stand
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null) return {};
  const v = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const name of NAMES) {
    if (!VALUES[name].includes(v[name])) continue;
    // Stored before only choices were: one at today's default may never have been chosen, so it follows the default.
    if (v.version === undefined && v[name] === DEFAULT_PREFS[name]) continue;
    out[name] = v[name];
  }
  return out as Partial<Prefs>;
}

/** Only the preferences that differ from the defaults. */
const chosen = (prefs: Prefs) =>
  Object.fromEntries(NAMES.filter((n) => prefs[n] !== undefined && prefs[n] !== DEFAULT_PREFS[n]).map((n) => [n, prefs[n]]));

let current: Prefs = { ...DEFAULT_PREFS, ...stored() };
const listeners = new Set<() => void>();

/** Show these preferences: the theme, then whatever uses them. */
function show(next: Prefs): void {
  const theme = next.theme !== current.theme;
  current = next;
  if (theme) applyTheme(current.theme);
  for (const l of listeners) l();
}

export function getPrefs(): Prefs {
  return current;
}

/** Change some preferences, keeping what another tab may have chosen meanwhile. */
export function setPrefs(patch: Partial<Prefs>): void {
  const next: Prefs = { ...DEFAULT_PREFS, ...(stored() ?? chosen(current)), ...patch };
  try {
    const choices = chosen(next);
    if (Object.keys(choices).length) localStorage.setItem(KEY, JSON.stringify({ version: VERSION, ...choices }));
    else localStorage.removeItem(KEY);
    localStorage.removeItem(OLD_THEME_KEY);
  } catch {
    // Private mode: the choice lasts for this page.
  }
  show(next);
}

/** Back to the defaults, every one: nothing is stored. */
export function resetPrefs(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(OLD_THEME_KEY);
  } catch {
    // ignore
  }
  show(DEFAULT_PREFS);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getPrefs);
}

// ---- Theme ----------------------------------------------------------------

const darkQuery = () =>
  typeof matchMedia === "function"
    ? matchMedia("(prefers-color-scheme: dark)")
    : null;

/** Light or dark, with "system" resolved from the OS setting. */
export function resolvedTheme(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (darkQuery()?.matches ? "dark" : "light") : pref;
}

export function applyTheme(pref: ThemePref): void {
  const theme = resolvedTheme(pref);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme; // native controls (date pickers, selects) match too
}

/**
 * Apply the stored theme and follow the OS when it's set to "system"; take
 * preferences other tabs change (or reset) as they do.
 */
export function initTheme(): void {
  applyTheme(current.theme);
  darkQuery()?.addEventListener("change", () => {
    if (current.theme === "system") applyTheme("system");
  });
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === null) show({ ...DEFAULT_PREFS, ...(stored() ?? chosen(current)) });
  });
}

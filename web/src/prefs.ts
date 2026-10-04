// Personal preferences: how the app looks for you. Kept in this browser's
// localStorage, never in the repo, so one person's choices don't change anyone
// else's view. Team-wide settings live in roadmap/settings.yaml instead.

import { useSyncExternalStore } from "react";
import type { ZoomLevel } from "./model/types";

export type ThemePref = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";
export type ViewMode = "timeline" | "table" | "people";

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
};

const KEY = "boxops-prefs";
/** Before preferences existed, only the theme was stored, under its own key. */
const OLD_THEME_KEY = "boxops-theme";

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw)
      return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
    if (localStorage.getItem(OLD_THEME_KEY) === "dark")
      return { ...DEFAULT_PREFS, theme: "dark" };
  } catch {
    // Storage blocked or unreadable: defaults.
  }
  return DEFAULT_PREFS;
}

let current = read();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return current;
}

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
    localStorage.removeItem(OLD_THEME_KEY);
  } catch {
    // Private mode: the choice lasts for this page.
  }
  if ("theme" in patch) applyTheme(current.theme);
  for (const l of listeners) l();
}

/** Back to the defaults (the stored copy is removed). */
export function resetPrefs(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  setPrefs(DEFAULT_PREFS);
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

/** Apply the stored theme and follow the OS when it's set to "system". */
export function initTheme(): void {
  applyTheme(current.theme);
  darkQuery()?.addEventListener("change", () => {
    if (current.theme === "system") applyTheme("system");
  });
}

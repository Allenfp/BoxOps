// Light / dark theme. Light is the default; choosing dark is remembered per
// browser. The CSS keys off data-theme on <html> (see styles.css).

import { useState } from "react";

export type Theme = "light" | "dark";

const KEY = "boxops-theme";

export function storedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme; // native controls (date pickers, selects) match too
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(storedTheme);
  const next: Theme = theme === "light" ? "dark" : "light";
  const toggle = () => {
    try {
      if (next === "light") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Private mode: the choice just lasts for this page.
    }
    applyTheme(next);
    setTheme(next);
  };
  return (
    <button className="icon-only theme-toggle" onClick={toggle} title={`Switch to ${next} mode`} aria-label={`Switch to ${next} mode`}>
      {theme === "light" ? "☾" : "☀"}
    </button>
  );
}

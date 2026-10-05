import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LiveRegion } from "./a11y/announce";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";
import { initTheme } from "./prefs";
import { stripReloadParam } from "./site";

stripReloadParam();
initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    {/* The app's live regions, on the page from the first paint whatever it shows (a11y/announce.tsx). */}
    <LiveRegion />
  </StrictMode>,
);
// The app is running: the boot watchdog in index.html stands down.
window.__boxopsBoot?.();

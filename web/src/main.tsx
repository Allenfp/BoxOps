import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
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
  </StrictMode>,
);
// The app is running: the boot watchdog in index.html stands down.
window.__boxopsBoot?.();

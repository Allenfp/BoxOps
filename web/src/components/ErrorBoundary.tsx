// The last resort when rendering throws: a message and a way out instead of a
// blank page. Unsaved changes are restored from localStorage before the first
// render, so if they're what trips the app up, every reload crashes again; the
// second time in a row, the screen offers to download them and discard them.

import { Component, type ReactNode } from "react";

const DRAFT_PREFIX = "boxops-draft:";
/** When this tab last crashed (ms since 1970), in sessionStorage. */
const CRASH_KEY = "boxops-crashed-at";
/** A crash this soon after the last one counts as the same crash again. */
const AGAIN_MS = 5 * 60_000;

/** Every stored draft (key → its JSON, parsed when it parses). */
function storedDrafts(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(DRAFT_PREFIX)) continue;
      const raw = localStorage.getItem(key) ?? "";
      try {
        out[key] = JSON.parse(raw);
      } catch {
        out[key] = raw;
      }
    }
  } catch {
    // Storage blocked: there are no drafts to offer.
  }
  return out;
}

function crashedRecently(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(CRASH_KEY) ?? 0) < AGAIN_MS;
  } catch {
    return false;
  }
}

const two = (n: number) => String(n).padStart(2, "0");

function downloadDrafts(): void {
  const json = JSON.stringify(storedDrafts(), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const d = new Date();
  const a = document.createElement("a");
  a.href = url;
  a.download = `boxops-unsaved-changes-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function discardDrafts(): void {
  try {
    for (const key of Object.keys(storedDrafts())) localStorage.removeItem(key);
  } catch {
    // Nothing more to do: reload anyway.
  }
  location.reload();
}

interface State {
  error: Error | null;
  /** It crashed in this tab a moment ago too: likely the same cause, such as a stored draft. */
  again: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, again: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)), again: crashedRecently() };
  }

  componentDidCatch(): void {
    try {
      sessionStorage.setItem(CRASH_KEY, String(Date.now()));
    } catch {
      // Not remembered: the next crash offers only Reload.
    }
  }

  render(): ReactNode {
    const { error, again } = this.state;
    if (!error) return this.props.children;
    const drafts = Object.keys(storedDrafts()).length > 0;
    return (
      <div className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>BoxOps hit a problem it couldn’t recover from:</p>
        <pre className="crash-message">{error.message || error.name}</pre>
        {again && drafts ? (
          <>
            <p>
              It happened again after reloading. Your unsaved changes, kept in this browser, may be what trips it up.
              Download a copy of them (a JSON file), then discard them to start from the saved roadmap.
            </p>
            <div className="crash-actions">
              <button onClick={downloadDrafts}>Download unsaved changes</button>
              <button className="danger-text" onClick={discardDrafts}>
                Discard unsaved changes and reload
              </button>
              <button className="primary" onClick={() => location.reload()}>
                Reload
              </button>
            </div>
          </>
        ) : (
          <>
            {drafts && <p>Your unsaved changes are kept in this browser.</p>}
            <div className="crash-actions">
              <button className="primary" onClick={() => location.reload()}>
                Reload
              </button>
            </div>
          </>
        )}
      </div>
    );
  }
}

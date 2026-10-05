// The last resort when rendering throws: a message and a way out instead of a
// blank page. Unsaved changes are restored from localStorage before the first
// render, so if they're what trips the app up, every reload crashes again; the
// second time in a row, the screen offers to download them and discard them.
// Only this tab's draft of the roadmap on screen: every project site on
// <owner>.github.io shares one origin, and so one localStorage, and other
// tabs keep drafts of their own (model/draftStore.ts).

import { Component, type ReactNode } from "react";
import { DRAFT_PREFIX, downloadJson } from "../model/draftStore";
/** When this tab last crashed (ms since 1970), in sessionStorage; removed once the app has run a while. */
const CRASH_KEY = "boxops-crashed-at";
/** A crash this soon after the last one counts as the same crash again. */
const AGAIN_MS = 5 * 60_000;

/** The localStorage key of this tab's draft of the roadmap on screen, once the app has one. */
let shownDraft: string | null = null;

/** This tab keeps its draft of the roadmap on screen under `key` (model/draftStore.ts): the one a crash offers. */
export function noteDraft(key: string): void {
  shownDraft = key;
}

/** The app has been running fine: a crash from now on isn't the same one again. */
export function runningFine(): void {
  try {
    sessionStorage.removeItem(CRASH_KEY);
  } catch {
    // Storage blocked: nothing was remembered.
  }
}

/** The stored draft of the roadmap on screen (key → its JSON, parsed when it parses), or null. */
function storedDraft(): Record<string, unknown> | null {
  const key = shownDraft;
  if (key === null) return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null; // storage blocked: no draft to offer
  }
  if (raw === null) return null;
  try {
    return { [key]: JSON.parse(raw) };
  } catch {
    return { [key]: raw };
  }
}

/** "acme/roadmap" from `boxops-draft:acme/roadmap@main:<tab id>`. */
const draftRepo = (key: string) => key.slice(DRAFT_PREFIX.length).split("@")[0];

function crashedRecently(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(CRASH_KEY) ?? 0) < AGAIN_MS;
  } catch {
    return false;
  }
}

function downloadDraft(): void {
  downloadJson(storedDraft() ?? {});
}

function discardDraft(): void {
  try {
    if (shownDraft !== null) localStorage.removeItem(shownDraft);
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
    const kept = storedDraft() !== null;
    const draft = kept && shownDraft !== null ? draftRepo(shownDraft) : null;
    return (
      <div className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>BoxOps hit a problem it couldn’t recover from:</p>
        <pre className="crash-message">{error.message || error.name}</pre>
        {again && draft ? (
          <>
            <p>
              It happened again after reloading. Your unsaved changes to {draft}, kept in this browser, may be what trips
              it up. Download a copy of them (a JSON file), then discard them to start from the saved roadmap.
            </p>
            <div className="crash-actions">
              <button onClick={downloadDraft}>Download unsaved changes</button>
              <button className="danger-text" onClick={discardDraft}>
                Discard unsaved changes and reload
              </button>
              <button className="primary" onClick={() => location.reload()}>
                Reload
              </button>
            </div>
          </>
        ) : (
          <>
            {kept && <p>Your unsaved changes are kept in this browser.</p>}
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

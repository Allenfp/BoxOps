import { useEffect, useRef, useState } from "react";
import type { Source } from "../github/save";
import type { ChangeLine } from "../model/summary";

/** Why the dialog is open. Saving itself needs no dialog; this appears only when it needs the user. */
export type SaveProblem =
  | { kind: "token"; rejected?: boolean }
  | { kind: "invalid"; issues: string[] }
  | { kind: "conflict"; items: string[] }
  | { kind: "error"; message: string }
  | {
      /** Pre-save check: others saved since this tab loaded. Their changes are now on screen. */
      kind: "updated";
      saves: { author: string; subject: string }[];
      changes: ChangeLine[];
      /** Items both sides changed. */
      clashes: string[];
    };

interface Props {
  problem: SaveProblem;
  source: Source;
  lines: ChangeLine[];
  busy: boolean;
  onSubmitToken(token: string): void;
  onResolve(keep: "mine" | "theirs"): void;
  /** Save after reviewing others' changes (no clashes). */
  onSaveNow(): void;
  onRetry(): void;
  onClose(): void;
}

const TOKEN_HELP = "https://github.com/settings/personal-access-tokens/new";
const KIND_LABEL: Record<ChangeLine["kind"], string> = { added: "Added", changed: "Changed", deleted: "Deleted" };

/** Render the summary's **bold** markers without using innerHTML. */
function Bolded({ text }: { text: string }) {
  return (
    <>
      {text.split("**").map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>))}
    </>
  );
}

export function SaveDialog({ problem, source, lines, busy, onSubmitToken, onResolve, onSaveNow, onRetry, onClose }: Props) {
  const [token, setToken] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) {
      d.showModal();
      // showModal() focuses the first focusable element (the close button); start in the first field instead.
      d.querySelector<HTMLInputElement>("input:not([type=color])")?.focus();
    }
  }, []);

  const title = {
    token: "Connect to GitHub to save",
    invalid: "Can’t save yet",
    conflict: "Someone else changed the same items",
    error: "Save failed",
    updated: "The roadmap changed since you opened it",
  }[problem.kind];

  return (
    <dialog
      ref={dialogRef}
      className="save-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="dialog-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} disabled={busy} aria-label="Close">
          ×
        </button>
      </header>

      {problem.kind === "token" && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (token.trim()) onSubmitToken(token.trim());
          }}
        >
          {problem.rejected && (
            <div className="callout error">GitHub rejected that token. Check it was copied fully and hasn’t expired.</div>
          )}
          <p className="lead">
            Saving writes your changes straight to <code>{source.branch}</code> of <strong>{source.repo}</strong>. Paste a
            GitHub token once; it’s kept in this tab only and sent only to GitHub.
          </p>
          <label>
            GitHub token
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_…"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              disabled={busy}
            />
            <span className="hint">
              <a href={TOKEN_HELP} target="_blank" rel="noopener noreferrer">
                Create a fine-grained token ↗
              </a>{" "}
              with access to only <strong>{source.repo}</strong> and the permission{" "}
              <strong>Contents: Read and write</strong>.
            </span>
          </label>
          <ChangeList lines={lines} />
          <footer className="dialog-foot">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !token.trim()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </footer>
        </form>
      )}

      {problem.kind === "invalid" && (
        <>
          <div className="callout error">
            These changes would leave the roadmap invalid:
            <ul>
              {problem.issues.map((i, n) => (
                <li key={n}>{i}</li>
              ))}
            </ul>
          </div>
          <footer className="dialog-foot">
            <button className="primary" onClick={onClose}>
              Back to editing
            </button>
          </footer>
        </>
      )}

      {problem.kind === "conflict" && (
        <>
          <p className="lead">
            Since you loaded the roadmap, someone else saved changes to {problem.items.length === 1 ? "an item" : "items"}{" "}
            you also edited:
          </p>
          <ul className="conflict-list">
            {problem.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="hint">Their other changes, and your edits to anything else, are kept either way.</p>
          <footer className="dialog-foot">
            <button onClick={() => onResolve("theirs")} disabled={busy}>
              Keep theirs
            </button>
            <button className="primary" onClick={() => onResolve("mine")} disabled={busy}>
              {busy ? "Saving…" : "Keep mine"}
            </button>
          </footer>
        </>
      )}

      {problem.kind === "updated" && <Updated problem={problem} busy={busy} onResolve={onResolve} onSaveNow={onSaveNow} onClose={onClose} />}

      {problem.kind === "error" && (
        <>
          <div className="callout error">{problem.message}</div>
          <p className="hint">Your changes are still here and still saved in this browser.</p>
          <footer className="dialog-foot">
            <button onClick={onClose} disabled={busy}>
              Close
            </button>
            <button className="primary" onClick={onRetry} disabled={busy}>
              {busy ? "Saving…" : "Try again"}
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}

const MAX_SAVES = 4;

function Updated({
  problem,
  busy,
  onResolve,
  onSaveNow,
  onClose,
}: {
  problem: Extract<SaveProblem, { kind: "updated" }>;
  busy: boolean;
  onResolve(keep: "mine" | "theirs"): void;
  onSaveNow(): void;
  onClose(): void;
}) {
  const { saves, changes, clashes } = problem;
  const shown = saves.slice(-MAX_SAVES);
  return (
    <>
      <p className="lead">Your changes haven’t been saved yet. Since you opened the roadmap:</p>
      {saves.length > 0 && (
        <ul className="save-list">
          {saves.length > MAX_SAVES && <li className="hint">…and {saves.length - MAX_SAVES} earlier saves</li>}
          {shown.map((c, i) => (
            <li key={i}>
              <strong>{c.author}</strong> saved “{c.subject}”
            </li>
          ))}
        </ul>
      )}
      <h3>What changed</h3>
      <ul className="change-list">
        {changes.map((l, i) => (
          <li key={i}>
            <span className={`kind kind-${l.kind}`}>{KIND_LABEL[l.kind]}</span>
            <span>
              <Bolded text={l.text} />
            </span>
          </li>
        ))}
      </ul>
      {clashes.length > 0 && (
        <div className="callout warn">
          You also edited {clashes.length === 1 ? "this item" : "these items"}:
          <ul>
            {clashes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          Review them, or choose whose version to keep.
        </div>
      )}
      <p className="hint">
        Their changes are now on your timeline, outlined in teal. Your unsaved edits are still there; adjust them if
        needed, then save again.
      </p>
      <footer className="dialog-foot">
        {clashes.length > 0 ? (
          <>
            <button onClick={onClose} disabled={busy}>
              Review changes
            </button>
            <button onClick={() => onResolve("theirs")} disabled={busy}>
              Keep theirs &amp; save
            </button>
            <button className="primary" onClick={() => onResolve("mine")} disabled={busy}>
              Keep mine &amp; save
            </button>
          </>
        ) : (
          <>
            <button onClick={onClose} disabled={busy}>
              Review changes
            </button>
            <button className="primary" onClick={onSaveNow} disabled={busy}>
              {busy ? "Saving…" : "Save now"}
            </button>
          </>
        )}
      </footer>
    </>
  );
}

function ChangeList({ lines }: { lines: ChangeLine[] }) {
  return (
    <details className="files">
      <summary>
        {lines.length} change{lines.length === 1 ? "" : "s"} to save
      </summary>
      <ul className="change-list">
        {lines.map((l, i) => (
          <li key={i}>
            <span className={`kind kind-${l.kind}`}>{KIND_LABEL[l.kind]}</span>
            <span>
              <Bolded text={l.text} />
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

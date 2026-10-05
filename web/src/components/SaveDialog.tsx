import { type ReactNode, useEffect, useRef } from "react";
import type { FailureKind, GitHubFailure } from "../github/api";
import { TOKEN_KINDS, failureMessage } from "../github/messages";
import type { Source } from "../github/read";
import type { ChangeLine } from "../model/summary";
import { Icon } from "./Icon";
import { TokenForm, TokenHelp } from "./TokenForm";

/** A choice the user already made for this save, carried through a dialog that interrupts it (so it isn't asked again). */
export interface Resume {
  keep?: "mine" | "theirs";
}

/** Why the dialog is open. Saving itself needs no dialog; this appears only when it needs the user. */
export type SaveProblem =
  | { kind: "token"; rejected?: boolean; resume?: Resume }
  /** The draft holds changes restored from storage, not made in this page view: listed before they're first saved. */
  | { kind: "review"; resume?: Resume }
  | { kind: "invalid"; issues: string[] }
  /** The save would write files the app couldn't fully read; fixing them is a hand edit. */
  | { kind: "unwritable"; files: { path: string; problems: string[] }[] }
  /** `keys` are the clashes listed (`items`, in words): a choice settles those only. */
  | { kind: "conflict"; keys: string[]; items: string[] }
  /** GitHub refused, or couldn't be reached (kinds and words in github/api.ts and messages.ts). */
  | { kind: "github"; failure: GitHubFailure; resume?: Resume }
  | { kind: "error"; message: string; resume?: Resume }
  /** The roadmap on GitHub is in a newer data format: an upgrade is deploying. */
  | { kind: "upgrading"; format: number }
  | {
      /** Pre-save check: others saved since this tab loaded. Their changes are now on screen. */
      kind: "updated";
      saves: { author: string; subject: string }[];
      changes: ChangeLine[];
      /** Items both sides changed: their keys, and in words. */
      keys: string[];
      clashes: string[];
    };

interface Props {
  problem: SaveProblem;
  source: Source;
  lines: ChangeLine[];
  busy: boolean;
  /** This browser is keeping the unsaved changes (its storage takes them). */
  kept: boolean;
  onSubmitToken(token: string): void;
  /** Keep this version of the clashes listed (`keys`), then save. */
  onResolve(keep: "mine" | "theirs", keys: string[]): void;
  /** Save after reviewing others' changes (no clashes). */
  onSaveNow(): void;
  /** Save the changes restored from storage, now the user has seen them listed. */
  onReviewed(): void;
  onRetry(): void;
  /** Ask for another token (the one kept doesn't do). */
  onNewToken(): void;
  /** Load the page again, for a newer BoxOps. */
  onReloadApp(): void;
  onClose(): void;
}

const GITHUB_TITLE: Record<FailureKind, string> = {
  unauthorized: "GitHub rejected the token",
  "no-access": "This token can’t see the repository",
  missing: "The branch isn’t there",
  sso: "Authorize the token for single sign-on",
  "token-policy": "The organization doesn’t accept this token",
  "ip-blocked": "GitHub refused this network",
  "rate-limited": "GitHub asked BoxOps to wait",
  rules: "GitHub’s rules blocked this save",
  "read-only": "This token can’t write to the repository",
  stale: "Others kept saving",
  offline: "Couldn’t reach GitHub",
  timeout: "GitHub didn’t answer",
  server: "GitHub had a problem",
  unknown: "Save failed",
};

/**
 * A write refused because the account, not the token, lacks Write access
 * (GET /repos, asked after the refusal, said so): no token of its can save.
 */
const accountCantWrite = (f: GitHubFailure) => (f.kind === "read-only" || f.kind === "no-access") && !f.detail.read && f.detail.push === false;

/** A GitHub failure's title: by kind, or by what GitHub said the token can do (read-only and no-access refusals). */
function githubTitle(f: GitHubFailure): string {
  if (accountCantWrite(f)) return "Your account can’t write to the repository";
  if (f.kind === "read-only" && f.detail.read) return "This token can’t read the repository’s files";
  if (f.kind === "no-access" && f.detail.visible) return GITHUB_TITLE["read-only"];
  return GITHUB_TITLE[f.kind];
}

const KIND_LABEL: Record<ChangeLine["kind"], string> = { added: "Added", changed: "Changed", deleted: "Deleted" };

/** Render the summary's **bold** markers without using innerHTML. */
function Bolded({ text }: { text: string }) {
  return (
    <>
      {text.split("**").map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>))}
    </>
  );
}

export function SaveDialog({ problem, source, lines, busy, kept, onSubmitToken, onResolve, onSaveNow, onReviewed, onRetry, onNewToken, onReloadApp, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) {
      d.showModal();
      // showModal() focuses the first focusable element (the close button); start in the first field instead.
      d.querySelector<HTMLInputElement>("input:not([type=color])")?.focus();
    }
  }, []);

  const title =
    problem.kind === "github"
      ? githubTitle(problem.failure)
      : {
          token: "Connect to GitHub to save",
          review: "Check these changes before saving",
          invalid: "Can’t save yet",
          unwritable: "Can’t save yet",
          conflict: "Someone else changed the same items",
          error: "Save failed",
          upgrading: "BoxOps is being upgraded",
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
          <Icon name="x" size={16} />
        </button>
      </header>

      {problem.kind === "token" && (
        <TokenForm
          repo={source.repo}
          rejected={problem.rejected}
          busy={busy}
          submitLabel="Save"
          lead={
            <>
              Saving writes your changes straight to <code>{source.branch}</code> of <strong>{source.repo}</strong>. Paste a
              GitHub token once: it’s kept for this tab’s session (Forget token in the gear menu removes it) and sent only
              to GitHub.
            </>
          }
          onSubmit={onSubmitToken}
          onCancel={onClose}
        >
          <ChangeList lines={lines} />
        </TokenForm>
      )}

      {problem.kind === "review" && (
        <>
          <p className="lead">
            These unsaved changes weren’t made in this page: they were kept in this browser, from before a reload or
            from another tab. Saving writes them to <code>{source.branch}</code> of <strong>{source.repo}</strong> as
            you, so check they’re yours:
          </p>
          <Lines lines={lines} />
          <p className="hint">If any aren’t yours, go back and discard them.</p>
          <footer className="dialog-foot">
            <button onClick={onClose}>Back to editing</button>
            <button className="primary" onClick={onReviewed}>
              Save {lines.length} change{lines.length === 1 ? "" : "s"}
            </button>
          </footer>
        </>
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

      {problem.kind === "unwritable" && (
        <>
          <p className="lead">
            Your changes touch {problem.files.length === 1 ? "a file" : "files"} with problems the app can’t work
            around. Saving would delete the parts it couldn’t read, so fix these in the file first (on GitHub or in the
            repo), then save again:
          </p>
          <div className="callout error">
            <ul>
              {problem.files.map((f) => (
                <li key={f.path}>
                  <code>roadmap/{f.path}</code>
                  <ul>
                    {f.problems.map((p, n) => (
                      <li key={n}>{p}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
          <Kept kept={kept}> To save the rest now, undo the changes to these files.</Kept>
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
            <button onClick={() => onResolve("theirs", problem.keys)} disabled={busy}>
              Keep theirs
            </button>
            <button className="primary" onClick={() => onResolve("mine", problem.keys)} disabled={busy}>
              {busy ? "Saving…" : "Keep mine"}
            </button>
          </footer>
        </>
      )}

      {problem.kind === "updated" && <Updated problem={problem} busy={busy} onResolve={onResolve} onSaveNow={onSaveNow} onClose={onClose} />}

      {problem.kind === "github" && (
        <Failure failure={problem.failure} source={source} busy={busy} kept={kept} onRetry={onRetry} onNewToken={onNewToken} onClose={onClose} />
      )}

      {problem.kind === "upgrading" && (
        <>
          <div className="callout warn">
            BoxOps is being upgraded; reload in a minute. The roadmap on GitHub now uses data format {problem.format}, which
            this version of BoxOps doesn’t write, so nothing was saved.
          </div>
          <Kept kept={kept} />
          <footer className="dialog-foot">
            <button onClick={onClose}>Close</button>
            <button className="primary" onClick={onReloadApp}>
              Reload
            </button>
          </footer>
        </>
      )}

      {problem.kind === "error" && (
        <>
          <div className="callout error">{problem.message}</div>
          <Kept kept={kept} />
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

/** Where the changes a save didn't write are: still saved in this browser, unless it won't keep them. */
function Kept({ kept, children }: { kept: boolean; children?: ReactNode }) {
  return (
    <p className="hint">
      {kept
        ? "Your changes are still here and still saved in this browser."
        : "Your changes are still here, but this browser isn’t keeping them: don’t close this tab until they’re saved."}
      {children}
    </p>
  );
}

/** A GitHub failure in words, what to do about it, and GitHub's own answer for whoever helps. */
function Failure({
  failure: f,
  source,
  busy,
  kept,
  onRetry,
  onNewToken,
  onClose,
}: {
  failure: GitHubFailure;
  source: Source;
  busy: boolean;
  kept: boolean;
  onRetry(): void;
  onNewToken(): void;
  onClose(): void;
}) {
  const owner = source.repo.split("/")[0];
  const sso = f.kind === "sso" && f.detail.ssoUrl?.startsWith("https://github.com/") ? f.detail.ssoUrl : undefined;
  // No other token helps an account without Write access, nor does trying again until an admin grants it.
  const account = accountCantWrite(f);
  const newToken = TOKEN_KINDS.includes(f.kind) && !account;
  const said = [
    f.message && `GitHub said: “${f.message.trim()}”`,
    f.detail.status && f.detail.status !== 200 && `HTTP ${f.detail.status}`,
    f.detail.type,
    f.detail.requestId && `request id ${f.detail.requestId}`,
  ].filter(Boolean);
  return (
    <>
      <div className="callout error">{failureMessage(f, source)}</div>
      {sso && (
        <p className="lead">
          <a href={sso} target="_blank" rel="noopener noreferrer">
            Authorize this token for {owner} <Icon name="external" size={12} />
          </a>
        </p>
      )}
      {newToken && f.kind !== "sso" && <TokenHelp repo={source.repo} />}
      <Kept kept={kept} />
      {said.length > 0 && (
        <details className="files">
          <summary>Details</summary>
          <p>{said.join(" · ")}</p>
        </details>
      )}
      <footer className="dialog-foot">
        <button className={account ? "primary" : undefined} onClick={onClose} disabled={busy}>
          Close
        </button>
        {newToken && (
          <button onClick={onNewToken} disabled={busy}>
            Use a different token
          </button>
        )}
        <button className={account ? undefined : "primary"} onClick={onRetry} disabled={busy}>
          {busy ? "Saving…" : "Try again"}
        </button>
      </footer>
    </>
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
  onResolve(keep: "mine" | "theirs", keys: string[]): void;
  onSaveNow(): void;
  onClose(): void;
}) {
  const { saves, changes, keys, clashes } = problem;
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
            <button onClick={() => onResolve("theirs", keys)} disabled={busy}>
              Keep theirs &amp; save
            </button>
            <button className="primary" onClick={() => onResolve("mine", keys)} disabled={busy}>
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

/** Changes, one per line, as the commit message lists them. */
function Lines({ lines }: { lines: ChangeLine[] }) {
  return (
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
  );
}

function ChangeList({ lines }: { lines: ChangeLine[] }) {
  return (
    <details className="files">
      <summary>
        {lines.length} change{lines.length === 1 ? "" : "s"} to save
      </summary>
      <Lines lines={lines} />
    </details>
  );
}

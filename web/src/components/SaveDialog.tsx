import { useEffect, useMemo, useRef, useState } from "react";
import { GitHub } from "../github/api";
import { type SaveStep, type Source, openPullRequest } from "../github/save";
import { getToken, setToken } from "../github/token";
import type { DraftState } from "../model/draft";
import { loadRoadmap } from "../model/load";
import { applyChanges, serializeChanges } from "../model/serialize";
import { type ChangeLine, defaultTitle, describeChanges, prBody } from "../model/summary";
import type { Issue, RoadmapFiles, Settings } from "../model/types";

interface Props {
  source: Source;
  baseFiles: RoadmapFiles;
  baseIssues: Issue[];
  base: DraftState;
  draft: DraftState;
  settings: Settings;
  onClose(): void;
  /** The PR exists; the draft can be cleared. */
  onSaved(pr: { number: number; url: string; branch: string }): void;
}

const STEPS: SaveStep[] = ["Checking access", "Creating commit", "Creating branch", "Opening pull request"];

const TOKEN_HELP = "https://github.com/settings/personal-access-tokens/new";

function defaultBranch(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `roadmap/update-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
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

export function SaveDialog({ source, baseFiles, baseIssues, base, draft, settings, onClose, onSaved }: Props) {
  const lines = useMemo(() => describeChanges(base, draft, settings), [base, draft, settings]);
  const changes = useMemo(() => serializeChanges(baseFiles, base, draft), [baseFiles, base, draft]);

  // Block the PR on any problem CI would reject that this draft introduced.
  const newIssues = useMemo(() => {
    const known = new Set(baseIssues.map((i) => `${i.path}|${i.message}`));
    return loadRoadmap(applyChanges(baseFiles, changes)).issues.filter((i) => !known.has(`${i.path}|${i.message}`));
  }, [baseFiles, baseIssues, changes]);

  const [title, setTitle] = useState(() => defaultTitle(lines));
  const [body, setBody] = useState(() => prBody(lines));
  const [branch, setBranch] = useState(defaultBranch);
  const [token, setTokenText] = useState(() => getToken() ?? "");
  const [hasSavedToken, setHasSavedToken] = useState(() => getToken() !== null);
  const [step, setStep] = useState<SaveStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = step !== null && error === null;

  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  const fileCount = Object.keys(changes).length;
  const canSave = !busy && fileCount > 0 && newIssues.length === 0 && title.trim() && branch.trim() && token.trim();

  const save = async () => {
    setError(null);
    setStep("Checking access");
    try {
      const gh = new GitHub(token.trim());
      await gh.user(); // fails fast on a mistyped or expired token
      setToken(token.trim());
      setHasSavedToken(true);
      const pr = await openPullRequest({
        gh,
        source,
        changes,
        branch: branch.trim(),
        title: title.trim(),
        body,
        onStep: setStep,
      });
      onSaved({ ...pr, branch: branch.trim() });
    } catch (e) {
      const message = (e as Error).message;
      setError(/: 401\b/.test(message) ? "GitHub rejected the token. Check it was copied fully and hasn’t expired." : message);
    }
  };

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
        <h2>Save as a pull request</h2>
        <button className="icon-button" onClick={onClose} disabled={busy} aria-label="Close">
          ×
        </button>
      </header>

      <section>
        <h3>
          {lines.length} change{lines.length === 1 ? "" : "s"} · {fileCount} file{fileCount === 1 ? "" : "s"}
        </h3>
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
        <details className="files">
          <summary>Files</summary>
          <ul>
            {Object.entries(changes).map(([path, text]) => (
              <li key={path}>
                <code>roadmap/{path}</code> {text === null ? "(deleted)" : path in baseFiles ? "" : "(new)"}
              </li>
            ))}
          </ul>
        </details>
      </section>

      {newIssues.length > 0 && (
        <div className="callout error">
          These changes would fail validation, so they can’t be saved yet:
          <ul>
            {newIssues.map((i, n) => (
              <li key={n}>
                <code>{i.path}</code> {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {source.dirty && (
        <div className="callout warn">
          You’re running locally and <code>roadmap/</code> has edits that aren’t committed. The pull request is built on
          commit <code>{source.commit.slice(0, 7)}</code> of <code>{source.branch}</code> as it is on GitHub, so files
          that only exist on your machine won’t be in it.
        </div>
      )}

      <section className="form">
        <label>
          Pull request title
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        </label>
        <label>
          Description
          <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} disabled={busy} />
        </label>
        <label>
          <span>
            New branch <span className="hint">into {source.repo} : {source.branch}</span>
          </span>
          <input value={branch} onChange={(e) => setBranch(e.target.value)} disabled={busy} spellCheck={false} />
        </label>

        {hasSavedToken ? (
          <p className="hint token-row">
            Using the GitHub token saved for this tab.{" "}
            <button
              className="link-button"
              onClick={() => {
                setToken(null);
                setTokenText("");
                setHasSavedToken(false);
              }}
              disabled={busy}
            >
              Use a different token
            </button>
          </p>
        ) : (
          <label>
            GitHub token
            <input
              type="password"
              value={token}
              onChange={(e) => setTokenText(e.target.value)}
              placeholder="github_pat_…"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <span className="hint">
              <a href={TOKEN_HELP} target="_blank" rel="noopener noreferrer">
                Create a fine-grained token ↗
              </a>{" "}
              with access to only <strong>{source.repo}</strong> and permissions <strong>Contents: Read and write</strong>{" "}
              and <strong>Pull requests: Read and write</strong>. It’s kept in this tab only and sent only to GitHub.
            </span>
          </label>
        )}
      </section>

      {step && (
        <ol className="steps">
          {STEPS.map((s) => {
            const at = STEPS.indexOf(step);
            const i = STEPS.indexOf(s);
            const state = i < at ? "done" : i === at ? (error ? "failed" : "active") : "todo";
            return (
              <li key={s} className={`step-${state}`}>
                {s}
              </li>
            );
          })}
        </ol>
      )}
      {error && <div className="callout error">{error}</div>}

      <footer className="dialog-foot">
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="primary" onClick={save} disabled={!canSave}>
          {busy ? "Saving…" : "Create pull request"}
        </button>
      </footer>
    </dialog>
  );
}

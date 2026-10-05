// What shows instead of the roadmap when it can't be shown yet: the site's
// roadmap.json or a ?ref= branch couldn't be read (with Try again, a way back
// from a preview, and another token when the one kept can't read it), or a
// preview of a private repository needs a token.

import { useEffect } from "react";
import { TokenForm } from "./TokenForm";

/** This page without `?ref=`: the live roadmap. */
export function liveUrl(): string {
  const q = new URLSearchParams(window.location.search);
  q.delete("ref");
  return `?${q}`;
}

const focusOnShow = (el: HTMLElement | null) => el?.focus();

const previewing = () => new URLSearchParams(window.location.search).has("ref");

export function LoadProblem({
  title,
  message,
  detail,
  onRetry,
  onNewToken,
}: {
  title: string;
  message: string;
  detail?: string;
  onRetry(): void;
  /** The token kept can't read the branch: forget it and ask for another. */
  onNewToken?: () => void;
}) {
  // Back online: try again without being asked.
  useEffect(() => {
    window.addEventListener("online", onRetry);
    return () => window.removeEventListener("online", onRetry);
  }, [onRetry]);
  return (
    <div className="crash load-problem" role="alert">
      {/* Focused as it shows: after Try again, focus was on the button that went. */}
      <h1 tabIndex={-1} ref={focusOnShow}>
        {title}
      </h1>
      <p>{message}</p>
      {detail && (
        <details className="files">
          <summary>Details</summary>
          <p>{detail}</p>
        </details>
      )}
      <div className="crash-actions">
        {onNewToken && <button onClick={onNewToken}>Use a different token</button>}
        <button className="primary" onClick={onRetry}>
          Try again
        </button>
        {previewing() && <a href={liveUrl()}>Back to the live roadmap</a>}
      </div>
    </div>
  );
}

/** A `?ref=` preview of a private repository: reading it from GitHub needs a token. */
export function PreviewToken({
  repo,
  branch,
  rejected,
  onSubmit,
}: {
  repo: string;
  branch: string;
  rejected: boolean;
  onSubmit(token: string): void;
}) {
  return (
    <div className="save-dialog load-token">
      <header className="dialog-head">
        <h2>Connect to GitHub to preview</h2>
      </header>
      <TokenForm
        repo={repo}
        access="read"
        rejected={rejected}
        submitLabel="Preview"
        lead={
          <>
            <code>{branch}</code> is a branch of <strong>{repo}</strong>, a private repository: previewing it reads it from
            GitHub, which needs a token (Contents: Read-only is enough). It’s kept for this tab’s session (Forget token in
            the gear menu removes it) and sent only to GitHub.
          </>
        }
        onSubmit={onSubmit}
        onCancel={() => window.location.assign(liveUrl())}
      />
    </div>
  );
}

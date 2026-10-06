// What shows instead of the roadmap when it can't be shown yet: the site's
// roadmap.json or a ?ref= branch couldn't be read (with Try again, a way back
// from a preview, and another token when the one kept can't read it). A
// preview of a private repository that needs a token is PreviewToken.tsx's.

import { useEffect } from "react";

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

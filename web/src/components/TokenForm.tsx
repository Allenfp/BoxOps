import { type ReactNode, useState } from "react";
import { isBroadToken } from "../github/token";
import { Icon } from "./Icon";

/**
 * GitHub's page for a new fine-grained token, filled in for this repository:
 * its owner as Resource owner and Contents: Read and write. (The repository
 * itself can't be pre-selected, and the owner may only look selected, so the
 * form asks the user to check both.)
 */
export function tokenUrl(repo: string): string {
  const q = new URLSearchParams({
    name: `BoxOps ${repo}`.slice(0, 40),
    description: `Saves from BoxOps to ${repo}`,
    target_name: repo.split("/")[0],
    contents: "write",
  });
  return `https://github.com/settings/personal-access-tokens/new?${q}`;
}

/** How to make a token that works for this repository: the settings that matter, and the usual reasons one doesn't. */
export function TokenHelp({ repo }: { repo: string }) {
  const owner = repo.split("/")[0];
  return (
    <div className="token-help">
      <a href={tokenUrl(repo)} target="_blank" rel="noopener noreferrer">
        Create a fine-grained token for {repo} <Icon name="external" size={12} />
      </a>
      , and check on GitHub’s page that:
      <ul>
        <li>
          <strong>Resource owner</strong> shows <strong>{owner}</strong>
        </li>
        <li>
          <strong>Repository access</strong> is Only select repositories → <strong>{repo}</strong>
        </li>
        <li>
          <strong>Permissions</strong>: Contents → <strong>Read and write</strong>
        </li>
      </ul>
      <p className="hint">
        If {owner} approves tokens, yours works once an owner has approved it. An outside collaborator, or anyone whose
        organization allows only classic tokens, needs a classic token with the <code>repo</code> scope instead
        (authorized for single sign-on if {owner} uses it).
      </p>
    </div>
  );
}

/** Paste a token: for a save, or to preview a branch of a private repository. */
export function TokenForm({
  repo,
  lead,
  submitLabel,
  rejected,
  busy,
  onSubmit,
  onCancel,
  children,
}: {
  repo: string;
  lead: ReactNode;
  submitLabel: string;
  /** GitHub rejected the last token (401). */
  rejected?: boolean;
  busy?: boolean;
  onSubmit(token: string): void;
  onCancel(): void;
  children?: ReactNode;
}) {
  const [token, setToken] = useState("");
  const value = token.trim();
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (value) onSubmit(value);
      }}
    >
      {rejected && <div className="callout error">GitHub rejected that token. Check it was copied fully and hasn’t expired.</div>}
      <p className="lead">{lead}</p>
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
        {isBroadToken(value) && (
          <span className="hint warn-text broad-token">
            That’s a classic token (or one from the GitHub CLI), which can write to every repository you can. It works,
            but a fine-grained token for {repo} alone is safer.
          </span>
        )}
      </label>
      <TokenHelp repo={repo} />
      {children}
      <footer className="dialog-foot">
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy || !value}>
          {busy ? "Saving…" : submitLabel}
        </button>
      </footer>
    </form>
  );
}

// A `?ref=` preview of a private repository and no token: the token form, in
// place of the roadmap. Fetched only then (it brings the token form).

import { liveUrl } from "./LoadScreen";
import { TokenForm } from "./TokenForm";

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

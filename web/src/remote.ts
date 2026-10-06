// What the app reads from GitHub itself, beyond the site's roadmap.json: the
// check for saves newer than the deployed copy, made once that copy shows,
// and a ?ref= branch preview. The app fetches this (and with it the GitHub
// client) when it first needs it, so showing a deploy never waits for it.

import { GitHubClient, GitHubFailure, isBranchName } from "./github/api";
import { TOKEN_KINDS, failureMessage } from "./github/messages";
import { readSnapshot } from "./github/read";
import { type Snapshot, TooManyChanges, canRead } from "./github/snapshot";
import { getToken, setToken } from "./github/token";
import { thousands } from "./model/count";

/**
 * The roadmap at the head of `base`'s branch, if anyone saved since `base`
 * (else `base` itself): the load-time check. Every call stops once `signal`
 * aborts. A token GitHub rejects (401) is forgotten; the next save asks for
 * one.
 */
export async function readNewer(base: Snapshot, seen: ReadonlySet<string>, signal: AbortSignal): Promise<Snapshot> {
  const gh = new GitHubClient({ token: getToken(base.source.repo), signal });
  try {
    return await readSnapshot(gh, base, { seen });
  } catch (e) {
    if (e instanceof GitHubFailure && e.kind === "unauthorized") setToken(base.source.repo, null);
    throw e;
  }
}

/** Why a branch can't be shown, in words. `newToken`: a different token could read it. */
export interface PreviewProblem {
  status: "error";
  title: string;
  message: string;
  detail?: string;
  newToken?: { repo: string; branch: string };
}

/** A branch of a private repository, and no token to read it with (`rejected`: GitHub refused the one kept). */
export interface PreviewNeedsToken {
  status: "needs-token";
  repo: string;
  branch: string;
  rejected: boolean;
}

/**
 * A `?ref=` branch, read-only, read from GitHub (only files that differ from
 * the deployed copy `base` are fetched), then made ready to show by `open`.
 */
export async function loadPreview<T extends object>(
  base: Snapshot,
  branch: string,
  open: (s: Snapshot) => Promise<T>,
): Promise<({ status: "ready" } & T) | PreviewProblem | PreviewNeedsToken> {
  const { repo } = base.source;
  const title = `Couldn’t show branch “${branch}”`;
  if (!isBranchName(branch)) return { status: "error", title, message: `“${branch}” isn’t a branch name.` };
  if (base.source.local) {
    return {
      status: "error",
      title,
      message: "A copy built from the files on disk never reads from GitHub, so it can’t preview a branch. Check the branch out, or preview it on the deployed site.",
    };
  }
  const gh = new GitHubClient({ token: getToken(repo) });
  // A private repository: ask for a token rather than make a call that can only fail.
  if (!canRead(base.source, gh)) return { status: "needs-token", repo, branch, rejected: false };
  try {
    return { status: "ready", ...(await open(await readSnapshot(gh, base, { branch }))) };
  } catch (e) {
    if (e instanceof GitHubFailure && e.kind === "unauthorized") {
      setToken(repo, null);
      return base.source.private ? { status: "needs-token", repo, branch, rejected: true } : loadPreview(base, branch, open);
    }
    // A branch is never deployed, so waiting for a deploy (as for main) won't help.
    if (e instanceof TooManyChanges) {
      return {
        status: "error",
        title,
        message: `“${branch}” differs from the deployed roadmap in ${thousands(e.count)} files, more than BoxOps reads at once (${thousands(e.limit)}). Check the branch out to see it.`,
      };
    }
    if (!(e instanceof GitHubFailure)) return { status: "error", title, message: (e as Error).message };
    if (e.kind === "offline") {
      return { status: "error", title, message: "Couldn’t reach GitHub: you may be offline, or a network filter may be blocking api.github.com." };
    }
    if (e.kind === "timeout") return { status: "error", title, message: "GitHub didn’t answer in time. Try again in a moment." };
    // The token kept for this repository can't read it: Try again alone would only reuse it.
    const newToken = base.source.private && gh.authenticated && TOKEN_KINDS.includes(e.kind) ? { repo, branch } : undefined;
    return { status: "error", title, message: failureMessage(e, { repo, branch }), detail: `GitHub said: “${e.message}”`, newToken };
  }
}

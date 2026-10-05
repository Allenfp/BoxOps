// The pasted GitHub token, one per repository ("owner/repo"). It's kept as
// soon as it's submitted, in sessionStorage (it survives reloads; the browser
// forgets it with the tab's session) and in memory (for when storage is
// blocked), and it's forgotten only when GitHub rejects it (401) or the user
// says so. It's never written into the repo or the URL, and only ever sent
// to api.github.com. Every project site on <owner>.github.io shares one
// origin, so the key names the repository: two roadmaps there don't share a
// token. (Scripts of the other sites, opened in the same tab, could still
// read it; private Pages and custom domains get an origin of their own.)

const PREFIX = "boxops-github-token:";
/** Before tokens were kept per repository, one key held the only one. */
const OLD_KEY = "boxops-github-token";

const memory = new Map<string, string>();

export function getToken(repo: string): string | null {
  try {
    const old = sessionStorage.getItem(OLD_KEY);
    if (old !== null) {
      // Moved once, to the first repository that asks: the one this tab was saving to.
      sessionStorage.removeItem(OLD_KEY);
      if (sessionStorage.getItem(PREFIX + repo) === null) sessionStorage.setItem(PREFIX + repo, old);
    }
    return sessionStorage.getItem(PREFIX + repo) ?? memory.get(repo) ?? null;
  } catch {
    return memory.get(repo) ?? null;
  }
}

export function setToken(repo: string, token: string | null): void {
  if (token) memory.set(repo, token);
  else memory.delete(repo);
  try {
    if (token) sessionStorage.setItem(PREFIX + repo, token);
    else sessionStorage.removeItem(PREFIX + repo);
  } catch {
    // Storage blocked: the token lasts for this page view, in memory.
  }
}

/** A classic personal access token, or one from an OAuth app or the GitHub CLI: it can reach every repository its owner can. */
export const isBroadToken = (token: string) => /^gh[pousr]_/.test(token);

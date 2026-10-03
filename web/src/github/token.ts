// The pasted GitHub token lives in sessionStorage: it survives reloads but is
// forgotten when the tab closes, and is never written into the repo or the URL.

const KEY = "boxops-github-token";

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the token only lasts for this page view.
  }
}

// The little of GitHub the command-line tool asks, and only where it must:
// doctor (is the pin a release?), upgrade and init (which commit is a tag?
// fetch a release's files), and preview and build (the app's files, once).
// Reads only; a token is used if there is one (GH_TOKEN, GITHUB_TOKEN or the
// GitHub CLI's for github.com), for private mirrors and the API's rate
// limit. Node-only.

import { execFileSync } from "node:child_process";
import type { Env } from "./gha.ts";

export const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const TIMEOUT_MS = 30_000;

/** A failed call: the HTTP status (0: no answer), and what GitHub said. */
export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface GitHub {
  fetch: typeof fetch;
  /** The token, looked up on first use; undefined if there's none. */
  token(): string | undefined;
}

/** A GitHub client over `fetchImpl`, with the token from the environment or the GitHub CLI. */
export function gitHub(env: Env, fetchImpl: typeof fetch = fetch): GitHub {
  let token: string | undefined | null = null;
  return {
    fetch: fetchImpl,
    token() {
      if (token === null) token = env.GH_TOKEN || env.GITHUB_TOKEN || ghToken();
      return token || undefined;
    },
  };
}

/**
 * The GitHub CLI's token for github.com, the one host BoxOps asks. Never the
 * host gh would choose by itself (GH_HOST, or the only one it's signed in
 * to): a GitHub Enterprise Server's token isn't sent to api.github.com.
 */
function ghToken(): string | undefined {
  try {
    return execFileSync("gh", ["auth", "token", "--hostname", "github.com"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const REPO = /^[\w.-]+\/[\w.-]+$/;

async function get(gh: GitHub, url: string, accept: string, auth: boolean): Promise<Response> {
  const token = auth ? gh.token() : undefined;
  const headers: Record<string, string> = { Accept: accept, "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await gh.fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new GitHubError(`couldn’t reach GitHub (${(e as Error).message})`, 0);
  }
  return res;
}

/** GET an API path ("repos/o/r/…"); the JSON, or a GitHubError. */
export async function api(gh: GitHub, path: string): Promise<unknown> {
  const res = await get(gh, `${API}/${path}`, "application/vnd.github+json", true);
  if (!res.ok) {
    let message = "";
    try {
      message = String(((await res.json()) as { message?: unknown }).message ?? "");
    } catch {
      // No JSON.
    }
    throw new GitHubError(`GitHub answered ${res.status} to ${path}${message ? ` (${message})` : ""}`, res.status);
  }
  return res.json();
}

/** A file of `repo` at commit `sha`: from raw.githubusercontent.com (public), else the contents API (private mirrors, with a token). */
export async function fileAt(gh: GitHub, repo: string, sha: string, path: string): Promise<Uint8Array> {
  if (!REPO.test(repo) || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`can’t fetch ${repo}@${sha}`);
  const raw = await get(gh, `${RAW}/${repo}/${sha}/${path}`, "*/*", false).catch(() => null);
  if (raw?.ok) return new Uint8Array(await raw.arrayBuffer());
  const res = await get(gh, `${API}/repos/${repo}/contents/${path}?ref=${sha}`, "application/vnd.github.raw+json", true);
  if (!res.ok) throw new GitHubError(`couldn’t fetch ${path} from ${repo}@${sha.slice(0, 7)} (HTTP ${res.status})`, res.status);
  return new Uint8Array(await res.arrayBuffer());
}

interface Ref {
  ref: string;
  object: { type: string; sha: string };
}

/** The commit a ref's object comes to: an annotated tag is followed to what it tags. */
async function peel(gh: GitHub, repo: string, object: Ref["object"]): Promise<string> {
  let at = object;
  for (let i = 0; i < 5 && at.type === "tag"; i++) at = ((await api(gh, `repos/${repo}/git/tags/${at.sha}`)) as { object: Ref["object"] }).object;
  if (at.type !== "commit") throw new GitHubError(`a tag in ${repo} names a ${at.type}, not a commit`, 0);
  return at.sha;
}

/** The commit tag `tag` of `repo` names. */
export async function tagCommit(gh: GitHub, repo: string, tag: string): Promise<string> {
  if (!/^v\d+\.\d+\.\d+(-rc\.\d+)?$/.test(tag)) throw new Error(`"${tag}" isn’t a BoxOps release tag (vX.Y.Z)`);
  let ref: Ref;
  try {
    ref = (await api(gh, `repos/${repo}/git/ref/tags/${tag}`)) as Ref;
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) throw new GitHubError(`${repo} has no tag ${tag}`, 404);
    throw e;
  }
  return peel(gh, repo, ref.object);
}

/** Every tag of `repo` (`git/matching-refs/tags`), with the commit it names. */
export async function tags(gh: GitHub, repo: string): Promise<{ tag: string; commit: string }[]> {
  const out: { tag: string; commit: string }[] = [];
  for (let page = 1; page <= 10; page++) {
    const refs = (await api(gh, `repos/${repo}/git/matching-refs/tags?per_page=100&page=${page}`)) as Ref[];
    if (!Array.isArray(refs)) break;
    for (const r of refs) out.push({ tag: r.ref.replace(/^refs\/tags\//, ""), commit: await peel(gh, repo, r.object) });
    if (refs.length < 100) break;
  }
  return out;
}

/** `repo`'s 30 newest releases, as the API lists them (its drafts too, to those who may see them). */
export async function releases(gh: GitHub, repo: string): Promise<unknown> {
  return api(gh, `repos/${repo}/releases?per_page=30`);
}

/** The release of `tag` in `repo`, as the API gives it; null if the tag has none (a mirror's tags have none). */
export async function releaseOfTag(gh: GitHub, repo: string, tag: string): Promise<unknown> {
  try {
    return await api(gh, `repos/${repo}/releases/tags/${tag}`);
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

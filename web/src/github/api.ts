// GitHub's REST and GraphQL APIs: the calls BoxOps makes to read a roadmap
// folder (read.ts) and to commit a save straight to its branch (save.ts).
//
// One request function serves both. Its timeout also covers reading the
// response, so a stalled body can't hang a save, and any failure after a
// mutation was sent is marked ambiguous: it may have been applied. One
// classifier turns every failure, REST or GraphQL (whose errors mostly arrive
// as HTTP 200), into a GitHubFailure of one kind; messages.ts words them.
// Every value put into a URL is checked first, so a link can't steer a call.
// No request sets a cache mode: Safari may add Cache-Control to the request,
// which GitHub's CORS preflight doesn't allow. The head read busts the cache
// with a query parameter instead.

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const API_VERSION = "2022-11-28";

/** Milliseconds before a call is given up, reading the response included. Writes wait past GitHub's 10 s processing limit. */
export const TIMEOUTS = { read: 15_000, blob: 20_000, write: 30_000 };

export type FailureKind =
  /** 401: the token is wrong, expired or revoked. */
  | "unauthorized"
  /** 404 (or NOT_FOUND): the token can't see the repository. */
  | "no-access"
  /** The repository is readable but the branch isn't there. */
  | "missing"
  /** The organization uses SAML single sign-on and the token isn't authorized for it. */
  | "sso"
  /** The organization forbids this kind of token, or its lifetime. */
  | "token-policy"
  /** An IP allow list or a Conditional Access policy refused this network. */
  | "ip-blocked"
  /** A primary (hourly, `resetAt`) or secondary (`retryAfter`) rate limit. */
  | "rate-limited"
  /** A ruleset or branch protection refused the commit (pull requests, signatures, status checks, metadata). */
  | "rules"
  /** The token or the account can't write to the repository. */
  | "read-only"
  /** GraphQL STALE_DATA: the branch moved since the head the save was checked against. */
  | "stale"
  | "offline"
  | "timeout"
  /** 5xx, or GitHub's own timeout. */
  | "server"
  | "unknown";

export interface FailureDetail {
  /** HTTP status; 200 for a GraphQL error. */
  status?: number;
  /** GraphQL error type (STALE_DATA, FORBIDDEN, …). */
  type?: string;
  /** Seconds to wait (secondary rate limit). */
  retryAfter?: number;
  /** When the hourly allowance comes back, ms since 1970 (primary rate limit). */
  resetAt?: number;
  secondary?: boolean;
  /** Where to authorize the token for single sign-on. */
  ssoUrl?: string;
  requestId?: string;
  /** From GET /repos after a read-only or no-access failure: whether the account may write, whether the token sees the repository. */
  push?: boolean;
  visible?: boolean;
}

export class GitHubFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    /** GitHub's own text, or ours; never the token. */
    message: string,
    readonly detail: FailureDetail = {},
    /** The call was a write that may or may not have been applied. */
    readonly ambiguous = false,
  ) {
    super(message);
    this.name = "GitHubFailure";
  }
}

/** What a failed answer said, for classify(). */
export interface FailedAnswer {
  status: number;
  headers: Headers;
  message: string;
  /** GraphQL error type. */
  type?: string;
}

const RATE_TEXT = /rate limit|abuse detection|too many requests|too quickly/i;
const IP_TEXT = /IP allow list|Conditional Access|IP address is not permitted/i;
const POLICY_TEXT = /forbids access via|personal access tokens? (?:is|are) not (?:allowed|permitted)|lifetime/i;
const RULES_TEXT =
  /rule violation|repository rule|protected branch|required status check|signed commit|verified signature|changes must be made through a pull request|pull request is required|commit message|author email|committer email|GH006|GH013/i;
const READ_ONLY_TEXT = /not accessible by|must have (?:push|write|admin) access|permission to \S+ denied/i;

/**
 * One reading of a failure for both transports: status, GraphQL type, the
 * headers GitHub exposes, then the message. A spent allowance
 * (x-ratelimit-remaining: 0) is the last clue: a refusal for another reason
 * (a ruleset, a token policy) can come with the hour's last request.
 */
export function classify(a: FailedAnswer): { kind: FailureKind; detail: FailureDetail } {
  const h = a.headers;
  const num = (name: string) => {
    const v = h.get(name)?.trim();
    return v && Number.isFinite(Number(v)) ? Number(v) : undefined;
  };
  const detail: FailureDetail = { status: a.status };
  if (a.type) detail.type = a.type;
  const requestId = h.get("x-github-request-id");
  if (requestId) detail.requestId = requestId;
  const m = a.message;

  if (a.type === "STALE_DATA") return { kind: "stale", detail };
  if (a.status === 401) return { kind: "unauthorized", detail };
  const sso = h.get("x-github-sso");
  if ((sso && /^required/i.test(sso)) || /SAML enforcement|single sign-on/i.test(m)) {
    const url = sso ? /url=(\S+)/i.exec(sso)?.[1] : undefined;
    return { kind: "sso", detail: url ? { ...detail, ssoUrl: url } : detail };
  }
  const retryAfter = num("retry-after");
  const spent = h.get("x-ratelimit-remaining") === "0";
  const refusal = a.status === 403 || a.status === 200;
  // Said outright: GraphQL's type, 429, a retry-after (sent with secondary limits), or the words.
  const limited = a.type === "RATE_LIMITED" || a.status === 429 || (refusal && (retryAfter !== undefined || RATE_TEXT.test(m)));
  if (!limited) {
    if (IP_TEXT.test(m)) return { kind: "ip-blocked", detail };
    if (POLICY_TEXT.test(m)) return { kind: "token-policy", detail };
    if (RULES_TEXT.test(m)) return { kind: "rules", detail };
    if (a.type === "FORBIDDEN" || (a.status === 403 && READ_ONLY_TEXT.test(m))) return { kind: "read-only", detail };
    if (a.status === 404 || a.type === "NOT_FOUND" || /could not resolve to a repository/i.test(m)) return { kind: "no-access", detail };
  }
  // A GraphQL error of another type says what it is; an untyped refusal with the allowance spent is the limit.
  if (limited || (refusal && spent && !a.type)) {
    const primary = spent && retryAfter === undefined && !/secondary/i.test(m);
    const reset = num("x-ratelimit-reset");
    if (primary) return { kind: "rate-limited", detail: { ...detail, secondary: false, ...(reset ? { resetAt: reset * 1000 } : {}) } };
    // GitHub: without retry-after, wait at least a minute.
    return { kind: "rate-limited", detail: { ...detail, secondary: true, retryAfter: retryAfter ?? 60 } };
  }
  if (a.status >= 500 || /something went wrong|timed? ?out/i.test(m)) return { kind: "server", detail };
  return { kind: "unknown", detail };
}

// --- What may go into a URL ---------------------------------------------------

const SHA = /^[0-9a-f]{40}$/;
export const isSha = (s: string) => SHA.test(s);

/** "owner/name" as GitHub spells them; never "." or ".." for either part. */
export function isRepoName(repo: string): boolean {
  const parts = repo.split("/");
  return parts.length === 2 && parts.every((p) => /^[A-Za-z0-9_.-]{1,100}$/.test(p) && p !== "." && p !== "..");
}

/** A branch name git accepts (`git check-ref-format --branch`), so `?ref=` can't name another endpoint. */
export function isBranchName(name: string): boolean {
  if (name === "" || name === "@" || name.length > 255 || name.startsWith("-") || name.startsWith("/") || name.endsWith("/")) return false;
  if (name.endsWith(".") || name.includes("..") || name.includes("//") || name.includes("@{")) return false;
  for (const ch of name) {
    const c = ch.charCodeAt(0);
    if (c <= 0x20 || c === 0x7f || "~^:?*[\\".includes(ch)) return false;
  }
  return name.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

function checked(what: string, value: string, ok: boolean): string {
  if (!ok) throw new Error(`“${value}” isn't a valid ${what}.`);
  return value;
}
const repoPath = (repo: string) => `/repos/${checked("repository name", repo, isRepoName(repo))}`;
const shaPath = (sha: string) => checked("git object id", sha, isSha(sha));
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

// --- The client -----------------------------------------------------------------

export interface CommitInfo {
  sha: string;
  /** The root tree. */
  tree: string;
  parents: string[];
  author: string;
  /** Committer date (ISO 8601). */
  date: string;
  message: string;
}

/** An entry of a tree listing; `path` is relative to the listed tree. */
export interface TreeItem {
  path: string;
  mode: string;
  /** "blob", "tree" or "commit" (a submodule). */
  type: string;
  sha: string;
  size?: number;
}

export interface FileAddition {
  path: string;
  /** Base64 of the file's bytes (utf8ToBase64). */
  contents: string;
}

export interface CommitInput {
  repo: string;
  branch: string;
  /** The head the commit goes on top of; GitHub refuses (STALE_DATA) if the branch has moved. */
  expectedHeadOid: string;
  headline: string;
  /** Left out when empty. */
  body: string;
  additions: FileAddition[];
  deletions: { path: string }[];
}

export interface CreatedCommit {
  oid: string;
  url: string;
  /** Committer date (ISO 8601); "" if GitHub didn't say. */
  date: string;
  /** Whether GitHub signed it; null if it didn't say. */
  signed: boolean | null;
}

export interface ClientOptions {
  token: string | null;
  /** Aborting it stops every call of this client, under way or later, as a timeout: a deadline for a whole read. */
  signal?: AbortSignal;
  fetch?: typeof fetch;
  /** For tests: waiting between retries. */
  sleep?(ms: number): Promise<void>;
  /** For tests: the clock rate limits are compared with. */
  now?(): number;
}

interface Call {
  url: string;
  method?: "GET" | "POST";
  /** Accept for api.github.com; raw.githubusercontent.com gets no headers at all (a simple request). */
  accept?: string;
  json?: unknown;
  timeout: number;
  mutation?: boolean;
}

interface Reply {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
}

const utf8 = new TextDecoder();
function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(utf8.decode(bytes));
  } catch {
    return undefined;
  }
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

const SAVE_MUTATION = `mutation BoxOpsSave($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) {
    commit { oid url committedDate signature { isValid wasSignedByGitHub } }
  }
}`;

let busted = 0;

export class GitHubClient {
  private readonly token: string | null;
  private readonly signal?: AbortSignal;
  private readonly fetchImpl: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;

  constructor(o: ClientOptions) {
    this.token = o.token || null;
    this.signal = o.signal;
    this.fetchImpl = o.fetch ?? ((...args) => fetch(...args));
    this.sleep = o.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = o.now ?? (() => Date.now());
  }

  /** Whether calls carry a token. Without one, BoxOps only reads public repositories. */
  get authenticated(): boolean {
    return this.token !== null;
  }

  private async send(c: Call): Promise<Reply> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new GitHubFailure("offline", "You’re offline.");
    if (this.signal?.aborted) throw new GitHubFailure("timeout", "BoxOps stopped waiting for GitHub.", {}, c.mutation === true);
    const headers: Record<string, string> = {};
    if (c.url.startsWith(`${API}/`)) {
      headers.Accept = c.accept ?? "application/vnd.github+json";
      if (!c.url.startsWith(`${API}/graphql`)) headers["X-GitHub-Api-Version"] = API_VERSION;
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
    }
    if (c.json !== undefined) headers["Content-Type"] = "application/json";
    // setTimeout rather than AbortSignal.timeout(), so a fake clock (the browser tests') drives it.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), c.timeout);
    const stop = () => ctrl.abort();
    this.signal?.addEventListener("abort", stop);
    try {
      const res = await this.fetchImpl(c.url, {
        method: c.method ?? "GET",
        headers,
        body: c.json === undefined ? undefined : JSON.stringify(c.json),
        signal: ctrl.signal,
      });
      // Under the same timer: the headers can arrive and the body stall.
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { status: res.status, headers: res.headers, bytes };
    } catch {
      const timeout = ctrl.signal.aborted;
      throw new GitHubFailure(
        timeout ? "timeout" : "offline",
        timeout ? "GitHub didn’t answer in time." : "Couldn’t reach GitHub.",
        {},
        c.mutation === true,
      );
    } finally {
      clearTimeout(timer);
      this.signal?.removeEventListener("abort", stop);
    }
  }

  /** A failure from a non-2xx answer. After a write, a 5xx may have been applied. */
  private failed(r: Reply, mutation = false): GitHubFailure {
    const body = parseJson(r.bytes);
    const message = isRecord(body) && typeof body.message === "string" ? body.message : `HTTP ${r.status}`;
    const { kind, detail } = classify({ status: r.status, headers: r.headers, message });
    return new GitHubFailure(kind, message, detail, mutation && r.status >= 500);
  }

  private async get(path: string, accept?: string, timeout = TIMEOUTS.read): Promise<Reply> {
    const r = await this.send({ url: `${API}${path}`, accept, timeout });
    if (r.status < 200 || r.status >= 300) throw this.failed(r);
    return r;
  }

  private async getJson(path: string): Promise<Record<string, unknown>> {
    const body = parseJson((await this.get(path)).bytes);
    if (!isRecord(body)) throw new GitHubFailure("server", `GitHub sent an answer BoxOps couldn’t read (GET ${path.split("?")[0]}).`);
    return body;
  }

  /**
   * The commit at the tip of a branch. The browser may cache refs (GitHub
   * sends max-age=60), so each read asks for a URL it hasn't seen. A 404 is
   * told apart: a missing branch, or a repository this token can't see.
   */
  async head(repo: string, branch: string): Promise<string> {
    const path = `${repoPath(repo)}/git/ref/heads/${encodePath(checked("branch name", branch, isBranchName(branch)))}`;
    let body: Record<string, unknown>;
    try {
      body = await this.getJson(`${path}?_=${this.now().toString(36)}${(++busted).toString(36)}`);
    } catch (e) {
      if (e instanceof GitHubFailure && e.kind === "no-access" && (await this.repository(repo).catch(() => null))) {
        throw new GitHubFailure("missing", `${repo} has no branch “${branch}”.`, e.detail);
      }
      throw e;
    }
    const sha = isRecord(body.object) ? str(body.object.sha) : "";
    if (!isSha(sha)) throw new GitHubFailure("server", `GitHub sent no commit for ${branch}.`);
    return sha;
  }

  async commit(repo: string, sha: string): Promise<CommitInfo> {
    const c = await this.getJson(`${repoPath(repo)}/git/commits/${shaPath(sha)}`);
    const tree = isRecord(c.tree) ? str(c.tree.sha) : "";
    if (!isSha(tree)) throw new GitHubFailure("server", `GitHub sent no tree for commit ${sha}.`);
    const person = (v: unknown) => (isRecord(v) ? v : {});
    return {
      sha,
      tree,
      parents: Array.isArray(c.parents) ? c.parents.map((p) => (isRecord(p) ? str(p.sha) : "")).filter(isSha) : [],
      author: str(person(c.author).name),
      date: str(person(c.committer).date),
      message: str(c.message),
    };
  }

  /** A tree's entries; `recursive` lists everything under it (GitHub may truncate that listing). */
  async tree(repo: string, sha: string, recursive: boolean): Promise<{ items: TreeItem[]; truncated: boolean }> {
    const t = await this.getJson(`${repoPath(repo)}/git/trees/${shaPath(sha)}${recursive ? "?recursive=1" : ""}`);
    const items = (Array.isArray(t.tree) ? t.tree : []).filter(isRecord).map((e) => ({
      path: str(e.path),
      mode: str(e.mode),
      type: str(e.type),
      sha: str(e.sha),
      ...(typeof e.size === "number" ? { size: e.size } : {}),
    }));
    return { items, truncated: t.truncated === true };
  }

  /** A blob's bytes, exactly (raw media type: no base64, no transcoding). */
  async blob(repo: string, sha: string): Promise<Uint8Array> {
    return (await this.get(`${repoPath(repo)}/git/blobs/${shaPath(sha)}`, "application/vnd.github.raw+json", TIMEOUTS.blob)).bytes;
  }

  /**
   * A file of a public repository from raw.githubusercontent.com: a plain GET
   * with no headers, which spares the 60-an-hour anonymous API allowance. It
   * can't carry a token, so it never works for a private repository.
   */
  async rawFile(repo: string, commit: string, path: string): Promise<Uint8Array> {
    const r = await this.send({ url: `${RAW}/${checked("repository name", repo, isRepoName(repo))}/${shaPath(commit)}/${encodePath(path)}`, timeout: TIMEOUTS.blob });
    if (r.status < 200 || r.status >= 300) throw this.failed(r);
    return r.bytes;
  }

  /** Commits after `base` up to `head`, oldest first: who saved what in between. */
  async compare(repo: string, base: string, head: string): Promise<{ sha: string; author: string; subject: string }[]> {
    const r = await this.getJson(`${repoPath(repo)}/compare/${shaPath(base)}...${shaPath(head)}`);
    return (Array.isArray(r.commits) ? r.commits : []).filter(isRecord).map((c) => {
      const commit = isRecord(c.commit) ? c.commit : {};
      return {
        sha: str(c.sha),
        author: str(isRecord(commit.author) ? commit.author.name : ""),
        subject: str(commit.message).split("\n")[0],
      };
    });
  }

  /** GET /repos: only to explain a failure (permissions.push reflects the account, not what the token was granted). */
  async repository(repo: string): Promise<{ private: boolean; push: boolean | null }> {
    const r = await this.getJson(repoPath(repo));
    return { private: r.private !== false, push: isRecord(r.permissions) && typeof r.permissions.push === "boolean" ? r.permissions.push : null };
  }

  /**
   * One commit on top of `expectedHeadOid` that moves the branch, made by
   * GitHub: authored by the token's owner, committed (and signed, where GitHub
   * supports it) by GitHub. Needs a token.
   */
  async createCommitOnBranch(i: CommitInput): Promise<CreatedCommit> {
    const input = {
      branch: { repositoryNameWithOwner: checked("repository name", i.repo, isRepoName(i.repo)), branchName: checked("branch name", i.branch, isBranchName(i.branch)) },
      expectedHeadOid: shaPath(i.expectedHeadOid),
      message: i.body ? { headline: i.headline, body: i.body } : { headline: i.headline },
      fileChanges: { additions: i.additions, deletions: i.deletions },
    };
    const r = await this.send({ url: `${API}/graphql`, method: "POST", json: { query: SAVE_MUTATION, variables: { input } }, timeout: TIMEOUTS.write, mutation: true });
    if (r.status < 200 || r.status >= 300) throw this.failed(r, true);
    const body = parseJson(r.bytes);
    if (!isRecord(body)) throw new GitHubFailure("server", "GitHub sent an answer BoxOps couldn’t read.", { status: r.status }, true);
    const data = isRecord(body.data) && isRecord(body.data.createCommitOnBranch) ? body.data.createCommitOnBranch : {};
    const c = isRecord(data.commit) ? data.commit : {};
    // A commit id means it was made, even if a field beside it (the signature) reported an error.
    if (isSha(str(c.oid))) {
      const sig = isRecord(c.signature) ? c.signature : null;
      return {
        oid: str(c.oid),
        url: str(c.url) || `https://github.com/${i.repo}/commit/${str(c.oid)}`,
        date: str(c.committedDate),
        signed: sig ? sig.isValid === true && sig.wasSignedByGitHub === true : null,
      };
    }
    const errors = (Array.isArray(body.errors) ? body.errors : []).filter(isRecord);
    const first = errors[0];
    if (!first) throw new GitHubFailure("unknown", "GitHub sent no commit and no error.", { status: r.status }, true);
    const message = str(first.message) || "GitHub refused the save.";
    const { kind, detail } = classify({ status: r.status, headers: r.headers, message, type: str(first.type) || undefined });
    // An error in a field of the commit (path ["createCommitOnBranch", "commit", …]),
    // which GraphQL then reports as null, came after the mutation ran: it may have been made.
    const nested = errors.some((e) => Array.isArray(e.path) && e.path.length > 1);
    throw new GitHubFailure(kind, message, detail, nested || kind === "server");
  }
}

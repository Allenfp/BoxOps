import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubClient, GitHubFailure, TIMEOUTS, classify, isBranchName, isRepoName } from "./api";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

interface Seen {
  url: string;
  init: RequestInit;
}

/** A fetch that answers from `answer` and records each call. */
function fake(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Seen[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return answer(String(input), init);
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const headersOf = (s: Seen) => new Headers(s.init.headers);
/** A fetch that never answers, until its signal aborts it. */
const hang = (_url: string, init: RequestInit) =>
  new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
/** Headers now, then a body that never ends (until aborted). */
const stalledBody = (_url: string, init: RequestInit) =>
  new Response(new ReadableStream({ start: (c) => init.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError"))) }), {
    status: 200,
  });

const commitInput = {
  repo: "acme/roadmap",
  branch: "main",
  expectedHeadOid: SHA,
  headline: "Box A: renamed",
  body: "- Box A: renamed\n\nSaved from the BoxOps web app.",
  additions: [{ path: "roadmap/boxes/a.yaml", contents: "aWQ6IGEK" }],
  deletions: [{ path: "roadmap/boxes/old.yaml" }],
};

afterEach(() => vi.useRealTimers());

describe("requests", () => {
  it("send the token only to the API, and only with one", async () => {
    const { calls, fetchImpl } = fake((url) => (url.includes("raw.") ? new Response("x") : json(200, { object: { sha: SHA } })));
    await new GitHubClient({ token: "t0ken", fetch: fetchImpl }).head("acme/roadmap", "main");
    await new GitHubClient({ token: null, fetch: fetchImpl }).head("acme/roadmap", "main");
    await new GitHubClient({ token: null, fetch: fetchImpl }).rawFile("acme/roadmap", SHA, "roadmap/boxes/a b.yaml");
    expect(headersOf(calls[0]).get("authorization")).toBe("Bearer t0ken");
    expect(headersOf(calls[0]).get("x-github-api-version")).toBe("2022-11-28");
    expect(headersOf(calls[1]).get("authorization")).toBeNull();
    // raw.githubusercontent.com: a simple request, no headers at all (no preflight).
    expect(calls[2].url).toBe(`https://raw.githubusercontent.com/acme/roadmap/${SHA}/roadmap/boxes/a%20b.yaml`);
    expect([...headersOf(calls[2]).keys()]).toEqual([]);
  });

  it("read the head from a new URL each time, with no cache mode or cache header", async () => {
    const { calls, fetchImpl } = fake(() => json(200, { object: { sha: SHA } }));
    const gh = new GitHubClient({ token: "t", fetch: fetchImpl });
    expect(await gh.head("acme/roadmap", "feature/x")).toBe(SHA);
    await gh.head("acme/roadmap", "feature/x");
    const [a, b] = calls.map((c) => new URL(c.url));
    expect(a.pathname).toBe("/repos/acme/roadmap/git/ref/heads/feature/x");
    expect(a.searchParams.get("_")).toBeTruthy();
    expect(a.search).not.toBe(b.search);
    for (const c of calls) {
      expect(c.init.cache).toBeUndefined();
      expect(headersOf(c).has("cache-control")).toBe(false);
    }
  });

  it("refuse a branch or repository name that could steer the call, before any request", async () => {
    const { calls, fetchImpl } = fake(() => json(200, {}));
    const gh = new GitHubClient({ token: "t", fetch: fetchImpl });
    await expect(gh.head("acme/roadmap", "../../../../user")).rejects.toThrow(/isn't a valid branch name/);
    await expect(gh.head("acme/..", "main")).rejects.toThrow(/repository name/);
    await expect(gh.blob("acme/roadmap", "../x")).rejects.toThrow(/git object id/);
    expect(calls).toHaveLength(0);
  });

  it("tell a missing branch from a repository the token can't see", async () => {
    const visible = fake((url) => (url.includes("/git/ref/") ? json(404, { message: "Not Found" }) : json(200, { private: true })));
    await expect(new GitHubClient({ token: "t", fetch: visible.fetchImpl }).head("acme/roadmap", "nope")).rejects.toMatchObject({ kind: "missing" });
    const hidden = fake(() => json(404, { message: "Not Found" }));
    await expect(new GitHubClient({ token: "t", fetch: hidden.fetchImpl }).head("acme/roadmap", "main")).rejects.toMatchObject({ kind: "no-access" });
  });

  it("time out a call GitHub never answers", async () => {
    vi.useFakeTimers();
    const gh = new GitHubClient({ token: "t", fetch: fake(hang).fetchImpl });
    const read = gh.head("acme/roadmap", "main").catch((e) => e);
    await vi.advanceTimersByTimeAsync(TIMEOUTS.read + 1);
    expect(await read).toMatchObject({ kind: "timeout", ambiguous: false });
  });

  it("time out a body that stalls after the headers arrived", async () => {
    vi.useFakeTimers();
    const gh = new GitHubClient({ token: "t", fetch: fake(stalledBody).fetchImpl });
    const read = gh.commit("acme/roadmap", SHA).catch((e) => e);
    const save = gh.createCommitOnBranch(commitInput).catch((e) => e);
    await vi.advanceTimersByTimeAsync(TIMEOUTS.write + 1);
    expect(await read).toMatchObject({ kind: "timeout", ambiguous: false });
    // The commit may have been made: ambiguous.
    expect(await save).toMatchObject({ kind: "timeout", ambiguous: true });
  });

  it("stop every call, under way or later, once the client's signal aborts (a deadline)", async () => {
    const ctrl = new AbortController();
    const f = fake(hang);
    const gh = new GitHubClient({ token: "t", fetch: f.fetchImpl, signal: ctrl.signal });
    const read = gh.head("acme/roadmap", "main").catch((e) => e);
    ctrl.abort();
    expect(await read).toMatchObject({ kind: "timeout", ambiguous: false });
    await expect(gh.commit("acme/roadmap", SHA)).rejects.toMatchObject({ kind: "timeout" });
    expect(f.calls).toHaveLength(1);
  });

  it("report a network failure as offline; after a mutation, as ambiguous", async () => {
    const gh = new GitHubClient({ token: "t", fetch: fake(() => Promise.reject(new TypeError("Load failed"))).fetchImpl });
    await expect(gh.head("acme/roadmap", "main")).rejects.toMatchObject({ kind: "offline", ambiguous: false });
    await expect(gh.createCommitOnBranch(commitInput)).rejects.toMatchObject({ kind: "offline", ambiguous: true });
  });
});

describe("createCommitOnBranch", () => {
  const ok = { data: { createCommitOnBranch: { commit: { oid: OTHER, url: "u", committedDate: "2026-10-04T10:00:00Z", signature: { isValid: true, wasSignedByGitHub: true } } } } };

  it("sends one mutation with branchName, expectedHeadOid and the message split", async () => {
    const { calls, fetchImpl } = fake(() => json(200, ok));
    const c = await new GitHubClient({ token: "t", fetch: fetchImpl }).createCommitOnBranch(commitInput);
    expect(c).toEqual({ oid: OTHER, url: "u", date: "2026-10-04T10:00:00Z", signed: true });
    expect(calls[0].url).toBe("https://api.github.com/graphql");
    expect(headersOf(calls[0]).has("x-github-api-version")).toBe(false);
    const { query, variables } = JSON.parse(String(calls[0].init.body));
    expect(query).toContain("createCommitOnBranch(input: $input)");
    expect(variables.input).toEqual({
      branch: { repositoryNameWithOwner: "acme/roadmap", branchName: "main" },
      expectedHeadOid: SHA,
      message: { headline: "Box A: renamed", body: "- Box A: renamed\n\nSaved from the BoxOps web app." },
      fileChanges: { additions: commitInput.additions, deletions: commitInput.deletions },
    });
  });

  it("leaves out an empty body", async () => {
    const { calls, fetchImpl } = fake(() => json(200, ok));
    await new GitHubClient({ token: "t", fetch: fetchImpl }).createCommitOnBranch({ ...commitInput, body: "" });
    expect(JSON.parse(String(calls[0].init.body)).variables.input.message).toEqual({ headline: "Box A: renamed" });
  });

  it("counts a commit id as success even with an error beside it", async () => {
    const both = { ...ok, errors: [{ type: "INTERNAL", message: "signature unavailable" }] };
    const c = await new GitHubClient({ token: "t", fetch: fake(() => json(200, both)).fetchImpl }).createCommitOnBranch(commitInput);
    expect(c.oid).toBe(OTHER);
  });

  it("classifies GraphQL errors that arrive as HTTP 200", async () => {
    const cases: [object, Record<string, string>, Partial<GitHubFailure> & { detail?: object }][] = [
      [{ type: "STALE_DATA", message: `Expected branch to point to "${SHA}" but it did not. Pull and try again.` }, {}, { kind: "stale" }],
      [{ type: "FORBIDDEN", message: "Resource not accessible by personal access token" }, {}, { kind: "read-only" }],
      [{ type: "FORBIDDEN", message: "Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization." }, {}, { kind: "sso" }],
      [{ type: "NOT_FOUND", message: "Could not resolve to a Repository with the name 'acme/roadmap'." }, {}, { kind: "no-access" }],
      [{ type: "RATE_LIMITED", message: "API rate limit exceeded for user ID 1." }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1791108000" }, { kind: "rate-limited", detail: { secondary: false, resetAt: 1791108000000 } }],
      [{ message: "You have exceeded a secondary rate limit. Please wait a few minutes before you try again." }, {}, { kind: "rate-limited", detail: { secondary: true, retryAfter: 60 } }],
      [{ type: "UNPROCESSABLE", message: "Repository rule violations found\n\nCommits must have verified signatures." }, {}, { kind: "rules" }],
      [{ type: "FORBIDDEN", message: "The 'acme' organization forbids access via a fine-grained personal access tokens if the token's lifetime is greater than 366 days." }, {}, { kind: "token-policy" }],
      [{ type: "FORBIDDEN", message: "Although you appear to have the correct authorization credentials, the `acme` organization has enabled OIDC Conditional Access Policies." }, {}, { kind: "ip-blocked" }],
      [{ message: "Something went wrong while executing your query. This may be the result of a timeout." }, {}, { kind: "server", ambiguous: true }],
    ];
    for (const [error, headers, want] of cases) {
      const gh = new GitHubClient({ token: "t", fetch: fake(() => json(200, { data: { createCommitOnBranch: null }, errors: [error] }, headers)).fetchImpl });
      const e = await gh.createCommitOnBranch(commitInput).catch((x) => x);
      expect(e, JSON.stringify(error)).toBeInstanceOf(GitHubFailure);
      expect(e, JSON.stringify(error)).toMatchObject({ ambiguous: false, ...want });
    }
  });

  it("treats a 5xx or an unreadable answer after the mutation as ambiguous, and a 4xx as not", async () => {
    const run = (r: () => Response) => new GitHubClient({ token: "t", fetch: fake(r).fetchImpl }).createCommitOnBranch(commitInput).catch((e) => e);
    expect(await run(() => json(502, { message: "Server Error" }))).toMatchObject({ kind: "server", ambiguous: true });
    expect(await run(() => new Response("<html>oops", { status: 200 }))).toMatchObject({ kind: "server", ambiguous: true });
    expect(await run(() => json(401, { message: "Bad credentials" }))).toMatchObject({ kind: "unauthorized", ambiguous: false });
    expect(await run(() => json(403, { message: "You have exceeded a secondary rate limit." }, { "retry-after": "30" }))).toMatchObject({
      kind: "rate-limited",
      ambiguous: false,
      detail: { secondary: true, retryAfter: 30 },
    });
  });
});

describe("classify (REST)", () => {
  const of = (status: number, message: string, headers: Record<string, string> = {}) => classify({ status, message, headers: new Headers(headers) });
  it("reads the status, the headers GitHub exposes, then the message", () => {
    expect(of(401, "Bad credentials").kind).toBe("unauthorized");
    expect(of(404, "Not Found").kind).toBe("no-access");
    expect(of(403, "Resource protected by organization SAML enforcement.", { "x-github-sso": "required; url=https://github.com/orgs/acme/sso?authorization_request=X" })).toEqual({
      kind: "sso",
      detail: { status: 403, ssoUrl: "https://github.com/orgs/acme/sso?authorization_request=X" },
    });
    expect(of(403, "Although you appear to have the correct authorization credentials, the `acme` organization has an IP allow list enabled").kind).toBe("ip-blocked");
    expect(of(403, "`acme` forbids access via a personal access token (classic). Please use a GitHub App, OAuth App, or a personal access token with fine-grained permissions.").kind).toBe("token-policy");
    expect(of(403, "API rate limit exceeded", { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "100" })).toMatchObject({ kind: "rate-limited", detail: { secondary: false, resetAt: 100_000 } });
    expect(of(429, "Too many requests", { "retry-after": "12" })).toMatchObject({ kind: "rate-limited", detail: { secondary: true, retryAfter: 12 } });
    expect(of(403, "Resource not accessible by personal access token").kind).toBe("read-only");
    expect(of(422, "Repository rule violations found").kind).toBe("rules");
    expect(of(503, "Unavailable", { "x-github-request-id": "ABC:1" })).toEqual({ kind: "server", detail: { status: 503, requestId: "ABC:1" } });
    expect(of(418, "I'm a teapot").kind).toBe("unknown");
  });
});

describe("names", () => {
  it("accepts the branch names git accepts", () => {
    for (const ok of ["main", "feature/x", "release-0.1", "a.b", "ünï", "a@b"]) expect(isBranchName(ok), ok).toBe(true);
    for (const bad of ["", "@", "-x", "/x", "x/", "a//b", "a..b", "../user", "x.", ".x", "a/.b", "x.lock", "a/b.lock/c", "a@{1}", "a b", "a~1", "a^", "a:b", "a?", "a*", "a[", "a\\b", "a\u0001b", "a\u007fb"]) {
      expect(isBranchName(bad), JSON.stringify(bad)).toBe(false);
    }
  });
  it("accepts owner/name only", () => {
    expect(isRepoName("acme/roadmap")).toBe(true);
    expect(isRepoName("jdoe_acme/road.map-2")).toBe(true);
    for (const bad of ["acme", "acme/road/map", "../x", "acme/..", "acme/.", "acme/a b", "/x"]) expect(isRepoName(bad), bad).toBe(false);
  });
});

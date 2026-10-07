// A small stateful stand-in for GitHub (REST and GraphQL APIs, raw files) and
// for the deployed site's roadmap.json, so tests never touch the network, the
// real repo or the live roadmap data. Browser tests install it on a page;
// unit tests use it as `fetch`. Blobs and trees are real git objects
// (git-objects.ts), so every SHA the app compares is git's; commit ids are
// 40-hex digests of a commit's content, not git's commit hashes, which
// nothing checks. Each deploy's roadmap.json is made by the build's own code
// (cli/site.ts).
//
// Like GitHub, it answers 401 to a token it doesn't know, on every endpoint;
// in private mode it answers 404 to every unauthenticated API call and raw
// file; it lists trees recursively only when asked (and can truncate the
// listing); serves a blob raw only with the raw media type; makes a commit
// with createCommitOnBranch only on top of expectedHeadOid (STALE_DATA, as
// HTTP 200, otherwise); and keeps the branch head for 60 s the way a browser
// cache would, unless the URL busts the cache. Calls a correct app never makes
// (REST writes, anything unauthenticated on a private repo, an empty commit,
// a custom header GitHub's CORS preflight refuses) are recorded in
// `forbidden`, which every browser test checks is empty.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { readRoadmapDir } from "../cli/git";
import { appInfo, assembleBundle, hashFolder } from "../cli/site";
import { type GitFileMode, gitBlobSha, gitTreeSha } from "../src/github/git-objects";
import type { AppInfo, Bundle } from "../src/model/bundle";

export const REPO = "acme/roadmap";
export const BRANCH = "main";
/** Contents: read and write on acme/roadmap. */
export const TOKEN = "github_pat_TEST";
/** Contents: read only. */
export const READ_TOKEN = "github_pat_READONLY";
/** Made with the wrong resource owner: sees nothing private of acme's. */
export const OTHER_OWNER_TOKEN = "github_pat_OTHEROWNER";
/** A classic token with the repo scope: writes like TOKEN. */
export const CLASSIC_TOKEN = "ghp_TEST";
const TOKENS = new Set([TOKEN, READ_TOKEN, OTHER_OWNER_TOKEN, CLASSIC_TOKEN]);

type Files = Record<string, string>;

export interface Commit {
  parent: string | null;
  /** The roadmap folder (paths inside it). */
  files: Files;
  /** Files outside the roadmap folder (paths from the repository root). */
  outside: Files;
  message: string;
  author: string;
  /** Committer date, ISO 8601. */
  date: string;
  /** Signed by GitHub: createCommitOnBranch commits, while `signCommits`. */
  signed: boolean;
}

/** What a test can make the next matching call do. */
export type Injected =
  | "unauthorized"
  | "no-access"
  | "sso"
  | "token-policy"
  | "ip-blocked"
  | "rate-limit"
  | "secondary-limit"
  | "rules"
  | "server"
  /** Never answer. */
  | "hang"
  /** Send the headers, then a body that never ends (unit tests; a browser test sees a hang). */
  | "stall-body"
  /** GraphQL: make the commit, then drop the connection before answering. */
  | "lost-response"
  /** GraphQL: make the commit, then answer with an error in one of its fields (so `commit: null`). */
  | "field-error";
export type Endpoint = "graphql" | "ref" | "commit" | "tree" | "blob" | "raw" | "compare" | "repo";

interface TreeItem {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
}

export interface FakeRequest {
  method: string;
  url: string;
  /** Lower-case names. */
  headers: Record<string, string>;
  body?: string;
}

export type FakeReply =
  | { status: number; headers: Record<string, string>; body?: string | Uint8Array; stall?: boolean }
  | { abort: true }
  | { hang: true };

const FIXTURE = fileURLToPath(new URL("./fixtures/roadmap", import.meta.url));
/**
 * The app under test, as the build saw it (same build id as the JS): from the
 * built index.html's <meta name="boxops-build"> and "boxops-build-time", since
 * a commit after `npm run build` changes what git says (and every test would
 * then see a newer BoxOps). Without a build (unit tests may run first), git's
 * answer.
 */
const APP = builtApp() ?? appInfo(fileURLToPath(new URL("..", import.meta.url)));

/** The app in dist/app, as its index.html names it; null if there's no build. */
export function builtApp(): AppInfo | null {
  let html: string;
  try {
    html = readFileSync(new URL("../dist/app/index.html", import.meta.url), "utf8");
  } catch {
    return null;
  }
  const meta = (name: string) => new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html)?.[1];
  const build = meta("boxops-build");
  return build ? { version: build.split("+")[0], build, time: meta("boxops-build-time") ?? "" } : null;
}
const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Commits are a minute apart, starting the day before the tests' "today". */
const date = (n: number) => new Date(Date.UTC(2026, 9, 2, 16, n)).toISOString().replace(".000Z", "Z");

/** GitHub's CORS answer (checked live): what a page may send, and which answer headers it may read. */
const ALLOWED_HEADERS = [
  "authorization", "content-type", "if-match", "if-modified-since", "if-none-match", "if-unmodified-since",
  "accept-encoding", "x-github-otp", "x-requested-with", "user-agent", "graphql-features", "x-github-next-global-id",
  "x-github-api-version",
];
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers":
    "ETag, Link, Location, Retry-After, X-GitHub-OTP, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Used, " +
    "X-RateLimit-Resource, X-RateLimit-Reset, X-OAuth-Scopes, X-Accepted-OAuth-Scopes, X-Poll-Interval, " +
    "X-GitHub-Media-Type, X-GitHub-SSO, X-GitHub-Request-Id, Deprecation, Sunset",
};

const abortError = () => new DOMException("The operation was aborted.", "AbortError");

export class FakeGitHub {
  readonly commits: Record<string, Commit> = {};
  readonly root: string;
  head: string;
  /** What the "deployed site" currently serves as roadmap.json. */
  deployed: string;
  visibility: "public" | "private";
  /** Branches besides main (name → commit), for previews. */
  branches: Record<string, string> = {};
  /** Runs just before a branch update is applied (e.g. to simulate a racing save). */
  beforeRefUpdate?: () => void;
  /** Whether GitHub signs the commits createCommitOnBranch makes. */
  signCommits = true;
  /** Whether the signed-in account may write (GET /repos's `permissions.push`): one with Read access may not, whatever its token. */
  writer = true;
  /** Truncate recursive tree listings ("recursive"), or every listing below the root ("all"). */
  truncate: "none" | "recursive" | "all" = "none";
  /** Changes to every roadmap.json the site serves: an app update, notices, a build from files on disk. */
  patchBundle?: (b: Bundle) => Bundle;
  /** Git modes for paths from the repository root (a symlink, a submodule); 100644 otherwise. */
  modes: Record<string, GitFileMode> = {};
  /** Every call, in order. */
  readonly requests: { method: string; host: string; endpoint: Endpoint | "other"; path: string; query: string; authed: boolean }[] = [];
  /** Calls GitHub would refuse that a correct app never makes. */
  readonly forbidden: string[] = [];
  private injections: { on: Endpoint; as: Injected; times: number }[] = [];
  private objects = new Map<string, Promise<{ root: string; dir: string | null }>>();
  private trees = new Map<string, TreeItem[]>();
  private roots = new Set<string>();
  private blobs = new Map<string, Uint8Array>();
  /** What a browser would have cached for a ref URL without a cache buster. */
  private refCache = new Map<string, { sha: string; at: number }>();
  private n = 0;

  /** A repo whose only commit holds the fixture roadmap (or `files`), deployed. */
  static async create(files?: Files, o: { visibility?: "public" | "private" } = {}): Promise<FakeGitHub> {
    return new FakeGitHub(files ?? (await readRoadmapDir(FIXTURE)).files, o.visibility ?? "public");
  }

  private constructor(files: Files, visibility: "public" | "private") {
    this.visibility = visibility;
    this.root = this.add({ parent: null, files, outside: { "README.md": "# Roadmap\n" }, message: "Initial roadmap", author: "Setup", date: date(0), signed: false });
    this.head = this.root;
    this.deployed = this.root;
  }

  private add(c: Commit): string {
    const id = createHash("sha1").update(JSON.stringify([++this.n, c])).digest("hex");
    this.commits[id] = c;
    return id;
  }

  /** File at the tip of the branch. */
  file(path: string): string | undefined {
    return this.commits[this.head].files[path];
  }

  headCommit(): Commit {
    return this.commits[this.head];
  }

  /** Someone else saves: apply edits (path → transform; undefined deletes) as a new commit on the branch. */
  otherSave(edits: Record<string, (text: string) => string | undefined>, author = "Sam Lee", message = "Roadmap update"): string {
    const at = this.commits[this.head];
    const files = { ...at.files };
    for (const [path, edit] of Object.entries(edits)) {
      const text = edit(files[path]);
      if (text === undefined) delete files[path];
      else files[path] = text;
    }
    this.head = this.add({ parent: this.head, files, outside: at.outside, message, author, date: date(this.n + 1), signed: false });
    return this.head;
  }

  /** Someone commits a file outside the roadmap folder (a README, app code). */
  outsideSave(path: string, text: string, author = "Sam Lee", message = `Update ${path}`): string {
    const at = this.commits[this.head];
    this.head = this.add({ parent: this.head, files: at.files, outside: { ...at.outside, [path]: text }, message, author, date: date(this.n + 1), signed: false });
    return this.head;
  }

  /** The site finishes redeploying `commit` (default: the branch tip). */
  deploy(commit = this.head): void {
    this.deployed = commit;
  }

  /** The next `times` calls to `on` fail as `as`. */
  inject(on: Endpoint, as: Injected, times = 1): void {
    this.injections.push({ on, as, times });
  }

  /** Calls made to an endpoint (or to GitHub at all). */
  calls(endpoint?: Endpoint): number {
    return this.requests.filter((r) => endpoint === undefined || r.endpoint === endpoint).length;
  }

  /** The roadmap.json the site's build would make from `commit`. */
  async bundle(commit: string): Promise<Bundle> {
    const c = this.commits[commit];
    const folder = await hashFolder(c.files);
    const history: string[] = [];
    for (let at: string | null = commit; at && history.length < 50; at = this.commits[at].parent) history.push(at);
    const bundle = assembleBundle(
      APP,
      {
        repo: REPO,
        branch: BRANCH,
        commit,
        dir: "roadmap",
        tree: folder.tree,
        visibility: this.visibility,
        private: this.visibility !== "public",
        readonly: false,
        author: c.author,
        subject: c.message.split("\n")[0],
        date: c.date,
        history,
      },
      folder,
      // Parsed as by the app just built, even from uncommitted changes (a ".dirty" id).
      { parsed: true },
    );
    return this.patchBundle ? this.patchBundle(bundle) : bundle;
  }

  async install(page: Page): Promise<void> {
    await page.route("**/roadmap.json*", async (route) => {
      const bundle = await this.bundle(this.deployed);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(bundle) });
    });
    await page.route(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, async (route) => {
      const req = route.request();
      const reply = await this.handle({ method: req.method(), url: req.url(), headers: req.headers(), body: req.postData() ?? undefined });
      if ("hang" in reply || ("stall" in reply && reply.stall)) return; // never answered
      if ("abort" in reply) return route.abort("connectionreset");
      const body = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : Buffer.from(reply.body);
      return route.fulfill({ status: reply.status, headers: reply.headers, body });
    });
  }

  /** The fake as `fetch`, for unit tests: the same answers, without a browser. Honours the abort signal. */
  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const signal = init.signal;
    if (signal?.aborted) throw abortError();
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const reply = await this.handle({ method: init.method ?? "GET", url, headers, body: typeof init.body === "string" ? init.body : undefined });
    if ("abort" in reply) throw new TypeError("Load failed");
    if ("hang" in reply) return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(abortError())));
    if (reply.stall) {
      const stalled = new ReadableStream({ start: (c) => signal?.addEventListener("abort", () => c.error(abortError())) });
      return new Response(stalled, { status: reply.status, headers: reply.headers });
    }
    const body = reply.status === 204 ? null : typeof reply.body === "object" ? new Uint8Array(reply.body) : (reply.body ?? "");
    return new Response(body, { status: reply.status, headers: reply.headers });
  };

  /** The commit's root tree and roadmap folder SHAs; every tree and blob in it becomes fetchable. */
  private objectsOf(commit: string): Promise<{ root: string; dir: string | null }> {
    let p = this.objects.get(commit);
    if (!p) this.objects.set(commit, (p = this.store(this.commits[commit])));
    return p;
  }

  private async store(c: Commit): Promise<{ root: string; dir: string | null }> {
    const files: { path: string; mode: GitFileMode; sha: string; size: number }[] = [];
    const all: Files = { ...c.outside };
    for (const [path, text] of Object.entries(c.files)) all[`roadmap/${path}`] = text;
    for (const [path, text] of Object.entries(all)) {
      const bytes = utf8.encode(text);
      const sha = await gitBlobSha(bytes);
      this.blobs.set(sha, bytes);
      files.push({ path, mode: this.modes[path] ?? "100644", sha, size: bytes.length });
    }
    const folders = new Set([""]);
    for (const f of files) {
      const parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
    }
    const shas = new Map<string, string>();
    // Deepest first, so a folder's subfolders have their SHAs.
    const depth = (folder: string) => (folder ? folder.split("/").length : 0);
    for (const folder of [...folders].sort((a, b) => depth(b) - depth(a))) {
      const prefix = folder ? `${folder}/` : "";
      const inside = files.filter((f) => f.path.startsWith(prefix));
      const sha = await gitTreeSha(inside.map((f) => ({ path: f.path.slice(prefix.length), mode: f.mode, sha: f.sha })));
      shas.set(folder, sha);
      const items: TreeItem[] = inside
        .filter((f) => !f.path.slice(prefix.length).includes("/"))
        .map((f) => ({ path: f.path.slice(prefix.length), mode: f.mode, type: f.mode === "160000" ? "commit" : "blob", sha: f.sha, size: f.size }));
      for (const sub of folders) {
        if (sub && sub !== folder && sub.startsWith(prefix) && !sub.slice(prefix.length).includes("/")) {
          items.push({ path: sub.slice(prefix.length), mode: "040000", type: "tree", sha: shas.get(sub)! });
        }
      }
      this.trees.set(sha, items.sort((a, b) => (a.path < b.path ? -1 : 1)));
    }
    this.roots.add(shas.get("")!);
    return { root: shas.get("")!, dir: shas.get("roadmap") ?? null };
  }

  /** Everything under a tree, paths relative to it, subfolders included (as GitHub lists them). */
  private listAll(sha: string, prefix = ""): TreeItem[] {
    return (this.trees.get(sha) ?? []).flatMap((e) => {
      const item = { ...e, path: prefix + e.path };
      return e.type === "tree" ? [item, ...this.listAll(e.sha, `${item.path}/`)] : [item];
    });
  }

  /** One call, answered as GitHub would. */
  async handle(req: FakeRequest): Promise<FakeReply> {
    const url = new URL(req.url);
    const reply = (status: number, body: unknown, headers: Record<string, string> = {}): FakeReply => ({
      status,
      headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...headers },
      body: JSON.stringify(body),
    });
    if (req.method === "OPTIONS") {
      return { status: 204, headers: { ...CORS, "access-control-allow-headers": ALLOWED_HEADERS.join(", "), "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE" } };
    }
    const auth = req.headers["authorization"];
    const token = auth?.replace(/^(?:Bearer|token) /i, "");
    const endpoint = this.endpoint(url);
    this.requests.push({ method: req.method, host: url.host, endpoint, path: url.pathname, query: url.search, authed: !!token });
    const what = `${req.method} ${url.host}${url.pathname}`;

    // Headers a CORS preflight would refuse (the browser tests can't see preflights). Not
    // Cache-Control or Pragma: with routing on, WebKit's cache is off and it adds both itself.
    const extra = Object.keys(req.headers).filter((h) =>
      url.host === "raw.githubusercontent.com"
        ? h === "authorization" || h === "content-type" || h.startsWith("x-")
        : h.startsWith("x-") && !ALLOWED_HEADERS.includes(h),
    );
    if (extra.length) this.forbidden.push(`${what}: sends ${extra.join(", ")}, which GitHub's CORS preflight refuses`);

    if (url.host === "raw.githubusercontent.com") {
      if (this.visibility !== "public") {
        this.forbidden.push(`${what}: raw.githubusercontent.com can't read a private repository`);
        return { status: 404, headers: { ...CORS, "content-type": "text/plain" }, body: "404: Not Found" };
      }
      const injected = this.injected("raw");
      if (injected) return injected;
      // /acme/roadmap/<commit>/<path>
      const [, owner, name, commit, ...rest] = url.pathname.split("/").map(decodeURIComponent);
      const c = `${owner}/${name}` === REPO ? this.commits[commit] : undefined;
      const path = rest.join("/");
      const text = c && (path.startsWith("roadmap/") ? c.files[path.slice("roadmap/".length)] : c.outside[path]);
      if (text === undefined) return { status: 404, headers: { ...CORS, "content-type": "text/plain" }, body: "404: Not Found" };
      return { status: 200, headers: { ...CORS, "content-type": "text/plain; charset=utf-8" }, body: utf8.encode(text) };
    }

    if (token !== undefined && !TOKENS.has(token)) return reply(401, { message: "Bad credentials", status: "401" });
    if (url.pathname === "/graphql" && req.method === "POST") return this.graphql(req, token);
    if (req.method !== "GET") {
      this.forbidden.push(`${what}: BoxOps writes only through GraphQL`);
      return reply(410, { message: "Gone" });
    }
    const prefix = `/repos/${REPO}`;
    const sees = this.visibility === "public" || token === TOKEN || token === READ_TOKEN || token === CLASSIC_TOKEN;
    if (!sees && !token) this.forbidden.push(`${what}: unauthenticated call to a private repository`);
    if (!url.pathname.startsWith(prefix) || !sees) return reply(404, { message: "Not Found", status: "404" });
    const injected = endpoint !== "other" ? this.injected(endpoint) : undefined;
    if (injected) return injected;
    const p = url.pathname.slice(prefix.length);
    let m: RegExpExecArray | null;

    if (p === "") {
      // permissions describe the account (a writer, unless `writer` is false), not what the token was granted.
      return reply(200, { full_name: REPO, private: this.visibility !== "public", visibility: this.visibility, ...(token ? { permissions: { push: this.writer, pull: true } } : {}) });
    }
    if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(p))) {
      const branch = m[1].split("/").map(decodeURIComponent).join("/");
      const sha = branch === BRANCH ? this.head : this.branches[branch];
      if (!sha) return reply(404, { message: "Not Found", status: "404" });
      // A browser answers a repeat of the same URL from its cache for 60 s (GitHub sends max-age=60).
      let answer = sha;
      if (!url.searchParams.has("_")) {
        const cached = this.refCache.get(p);
        if (cached && Date.now() - cached.at < 60_000) answer = cached.sha;
        else this.refCache.set(p, { sha, at: Date.now() });
      }
      return reply(200, { ref: `refs/heads/${branch}`, object: { sha: answer, type: "commit" } });
    }
    if ((m = /^\/git\/commits\/([0-9a-f]{40})$/.exec(p))) {
      const c = this.commits[m[1]];
      if (!c) return reply(404, { message: "Not Found", status: "404" });
      const { root } = await this.objectsOf(m[1]);
      return reply(200, {
        sha: m[1],
        tree: { sha: root },
        parents: c.parent ? [{ sha: c.parent }] : [],
        author: { name: c.author, email: "noreply@example.com", date: c.date },
        committer: { name: c.signed ? "GitHub" : c.author, email: "noreply@github.com", date: c.date },
        message: c.message,
        verification: { verified: c.signed, reason: c.signed ? "valid" : "unsigned" },
      });
    }
    if ((m = /^\/git\/trees\/([0-9a-f]{40})$/.exec(p))) {
      // Make every commit's trees known (a tree id says nothing about its commit).
      for (const id of Object.keys(this.commits)) await this.objectsOf(id);
      const items = this.trees.get(m[1]);
      if (!items) return reply(404, { message: "Not Found", status: "404" });
      if (url.searchParams.get("recursive")) {
        const all = this.listAll(m[1]);
        if (this.truncate !== "none") return reply(200, { sha: m[1], tree: all.slice(0, Math.ceil(all.length / 2)), truncated: true });
        return reply(200, { sha: m[1], tree: all, truncated: false });
      }
      if (this.truncate === "all" && !this.roots.has(m[1])) return reply(200, { sha: m[1], tree: items.slice(0, Math.ceil(items.length / 2)), truncated: true });
      return reply(200, { sha: m[1], tree: items, truncated: false });
    }
    if ((m = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(p))) {
      for (const id of Object.keys(this.commits)) await this.objectsOf(id);
      const bytes = this.blobs.get(m[1]);
      if (!bytes) return reply(404, { message: "Not Found", status: "404" });
      if (req.headers["accept"] === "application/vnd.github.raw+json") {
        return { status: 200, headers: { ...CORS, "content-type": "application/vnd.github.raw+json; charset=utf-8" }, body: bytes };
      }
      return reply(200, { sha: m[1], size: bytes.length, content: Buffer.from(bytes).toString("base64").replace(/(.{60})/g, "$1\n"), encoding: "base64" });
    }
    if ((m = /^\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/.exec(p))) {
      const commits = [];
      for (let c: string | null = m[2]; c && c !== m[1]; c = this.commits[c]?.parent ?? null) {
        const { author, message } = this.commits[c];
        commits.unshift({ sha: c, commit: { author: { name: author }, message } });
      }
      return reply(200, { commits });
    }
    return reply(404, { message: `Not Found: ${req.method} ${p}`, status: "404" });
  }

  private endpoint(url: URL): Endpoint | "other" {
    if (url.host === "raw.githubusercontent.com") return "raw";
    const p = url.pathname;
    if (p === "/graphql") return "graphql";
    if (p === `/repos/${REPO}`) return "repo";
    const names: Record<string, Endpoint> = { "git/ref": "ref", "git/commits": "commit", "git/trees": "tree", "git/blobs": "blob", compare: "compare" };
    const m = /^\/repos\/[^/]+\/[^/]+\/(git\/\w+|compare)\//.exec(p);
    return (m && names[m[1]]) || "other";
  }

  /** A queued failure for this endpoint, if any. */
  private injected(on: Endpoint): FakeReply | undefined {
    const i = this.injections.findIndex((x) => x.on === on);
    if (i < 0) return undefined;
    const { as } = this.injections[i];
    if (--this.injections[i].times <= 0) this.injections.splice(i, 1);
    if (as === "lost-response" || as === "field-error") return undefined; // handled by graphql()
    return this.failure(on, as);
  }

  private failure(on: Endpoint, as: Injected): FakeReply {
    const json = (status: number, body: unknown, headers: Record<string, string> = {}): FakeReply => ({
      status,
      headers: { "content-type": "application/json; charset=utf-8", ...CORS, "x-github-request-id": "FAKE:1", ...headers },
      body: JSON.stringify(body),
    });
    const gql = on === "graphql";
    const error = (type: string, message: string, headers: Record<string, string> = {}) =>
      json(200, { data: { createCommitOnBranch: null }, errors: [{ type, path: ["createCommitOnBranch"], message }] }, headers);
    const reset = String(Math.floor(Date.now() / 1000) + 600);
    switch (as) {
      case "unauthorized":
        return json(401, { message: "Bad credentials", status: "401" });
      case "no-access":
        return gql ? error("NOT_FOUND", `Could not resolve to a Repository with the name '${REPO}'.`) : json(404, { message: "Not Found", status: "404" });
      case "sso":
        return json(403, { message: "Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization." }, {
          "x-github-sso": "required; url=https://github.com/orgs/acme/sso?authorization_request=FAKE",
        });
      case "token-policy":
        return json(403, { message: "The 'acme' organization forbids access via a fine-grained personal access tokens if the token's lifetime is greater than 366 days." });
      case "ip-blocked":
        return json(403, {
          message: "Although you appear to have the correct authorization credentials, the `acme` organization has an IP allow list enabled, and your IP address is not permitted to access this resource.",
        });
      case "rate-limit":
        return gql
          ? error("RATE_LIMITED", "API rate limit exceeded for user ID 1.", { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset })
          : json(403, { message: "API rate limit exceeded for user ID 1." }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset });
      case "secondary-limit":
        return json(403, { message: "You have exceeded a secondary rate limit. Please wait a few minutes before you try again." }, { "retry-after": "30" });
      case "rules":
        return gql ? error("UNPROCESSABLE", "Repository rule violations found\n\nCommits must have verified signatures.\n") : json(422, { message: "Repository rule violations found" });
      case "server":
        return json(502, { message: "Server Error" });
      case "hang":
        return { hang: true };
      case "stall-body":
        return { status: 200, headers: { "content-type": "application/json; charset=utf-8", ...CORS }, stall: true };
      case "lost-response":
      case "field-error":
        return { abort: true };
    }
  }

  /** POST /graphql: createCommitOnBranch only, enforcing what GitHub enforces. */
  private async graphql(req: FakeRequest, token: string | undefined): Promise<FakeReply> {
    const json = (status: number, body: unknown, headers: Record<string, string> = {}): FakeReply => ({
      status,
      headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...headers },
      body: JSON.stringify(body),
    });
    const error = (type: string, message: string) => json(200, { data: { createCommitOnBranch: null }, errors: [{ type, path: ["createCommitOnBranch"], message }] });
    if (!token) return json(401, { message: "This endpoint requires you to be authenticated." });
    const after = this.injections.find((x) => x.on === "graphql")?.as;
    const injected = this.injected("graphql");
    if (injected) return injected;

    const { query, variables } = JSON.parse(req.body ?? "{}") as {
      query?: string;
      variables?: {
        input?: {
          branch?: { repositoryNameWithOwner?: string; branchName?: string };
          expectedHeadOid?: string;
          message?: { headline?: string; body?: string };
          fileChanges?: { additions?: { path: string; contents: string }[]; deletions?: { path: string }[] };
        };
      };
    };
    if (!query?.includes("createCommitOnBranch") || !variables?.input) return json(200, { errors: [{ message: "The fake only knows createCommitOnBranch." }] });
    const input = variables.input;
    if (token === OTHER_OWNER_TOKEN || input.branch?.repositoryNameWithOwner !== REPO) {
      return error("NOT_FOUND", `Could not resolve to a Repository with the name '${input.branch?.repositoryNameWithOwner}'.`);
    }
    if (token === READ_TOKEN || !this.writer) return error("FORBIDDEN", "Resource not accessible by personal access token");
    if (input.branch.branchName !== BRANCH) return error("NOT_FOUND", `Could not resolve to a Ref with the name 'refs/heads/${input.branch.branchName}'.`);
    if (!input.message?.headline) return error("UNPROCESSABLE", "A commit message headline is required.");
    const additions = input.fileChanges?.additions ?? [];
    const deletions = input.fileChanges?.deletions ?? [];
    const paths = [...additions.map((a) => a.path), ...deletions.map((d) => d.path)];
    if (new Set(paths).size !== paths.length) return error("UNPROCESSABLE", "Paths must be unique across additions and deletions.");
    const texts: Files = {};
    for (const a of additions) {
      const bytes = Buffer.from(a.contents, "base64");
      // Strict RFC 4648: padded, nothing but base64.
      if (bytes.toString("base64") !== a.contents) return error("UNPROCESSABLE", `Invalid base64 for ${a.path}.`);
      try {
        texts[a.path] = strictUtf8.decode(bytes);
      } catch {
        return error("UNPROCESSABLE", `${a.path} isn't UTF-8 (the fake stores text).`);
      }
    }

    const hook = this.beforeRefUpdate; // once; a hook may set itself again
    this.beforeRefUpdate = undefined;
    hook?.();
    if (input.expectedHeadOid !== this.head) {
      return error("STALE_DATA", `Expected branch to point to "${input.expectedHeadOid}" but it did not. Pull and try again.`);
    }
    const at = this.commits[this.head];
    const files = { ...at.files };
    const outside = { ...at.outside };
    const target = (path: string) => (path.startsWith("roadmap/") ? { map: files, key: path.slice("roadmap/".length) } : { map: outside, key: path });
    for (const d of deletions) {
      const { map, key } = target(d.path);
      if (!(key in map)) return error("UNPROCESSABLE", `A path was requested for deletion which does not exist as of commit oid \`${this.head}\`.`);
      delete map[key];
    }
    for (const [path, text] of Object.entries(texts)) {
      const { map, key } = target(path);
      map[key] = text;
    }
    if (!paths.length) this.forbidden.push("POST /graphql: an empty commit (no file changes)");
    const { headline, body } = input.message;
    const id = this.add({ parent: this.head, files, outside, message: body ? `${headline}\n\n${body}` : headline, author: "Me", date: date(this.n + 1), signed: this.signCommits });
    this.head = id;
    if (after === "lost-response") return { abort: true };
    if (after === "field-error") {
      return json(200, {
        data: { createCommitOnBranch: { commit: null } },
        errors: [{ type: "INTERNAL", path: ["createCommitOnBranch", "commit", "signature"], message: "The signature couldn’t be loaded." }],
      });
    }
    return json(200, {
      data: {
        createCommitOnBranch: {
          commit: {
            oid: id,
            url: `https://github.com/${REPO}/commit/${id}`,
            committedDate: this.commits[id].date,
            signature: this.signCommits ? { isValid: true, wasSignedByGitHub: true } : null,
          },
        },
      },
    });
  }
}

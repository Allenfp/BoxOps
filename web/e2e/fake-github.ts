// A small stateful stand-in for GitHub (REST API + raw files) and for the
// deployed site's roadmap.json, so browser tests never touch the network,
// the real repo, or the live roadmap data. Each deploy's roadmap.json is made
// by the build's own code (cli/site.ts), with real git blob and tree SHAs.

import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import { readRoadmapDir } from "../cli/git";
import { appInfo, assembleBundle, hashFolder } from "../cli/site";
import { gitBlobSha } from "../src/github/git-objects";
import type { Bundle } from "../src/model/bundle";

export const REPO = "acme/roadmap";
export const BRANCH = "main";
export const TOKEN = "github_pat_TEST";

type Files = Record<string, string>;

interface Commit {
  parent: string | null;
  files: Files;
  message: string;
  author: string;
  /** Committer date, ISO 8601. */
  date: string;
}

const FIXTURE = fileURLToPath(new URL("./fixtures/roadmap", import.meta.url));
/** The app under test, as the build saw it (same build id as the JS). */
const APP = appInfo(fileURLToPath(new URL("..", import.meta.url)));

const sha = (prefix: string, n: number) => `${prefix}${n}`.padEnd(40, "0");
/** Commits are a minute apart, starting the day before the tests' "today". */
const date = (n: number) => new Date(Date.UTC(2026, 9, 2, 16, n)).toISOString().replace(".000Z", "Z");

export class FakeGitHub {
  readonly commits: Record<string, Commit> = {};
  head: string;
  /** What the "deployed site" currently serves as roadmap.json. */
  deployed: string;
  /** Runs just before a branch update is applied (e.g. to simulate a racing save). */
  beforeRefUpdate?: () => void;
  private trees: Record<string, Files> = {};
  private n = 0;

  /** A repo whose only commit holds the fixture roadmap (or `files`), deployed. */
  static async create(files?: Files): Promise<FakeGitHub> {
    return new FakeGitHub(files ?? (await readRoadmapDir(FIXTURE)).files);
  }

  private constructor(files: Files) {
    const root = sha("c0", 0);
    this.commits[root] = { parent: null, files, message: "Initial roadmap", author: "Setup", date: date(0) };
    this.head = root;
    this.deployed = root;
  }

  get root(): string {
    return sha("c0", 0);
  }

  /** File at the tip of the branch. */
  file(path: string): string | undefined {
    return this.commits[this.head].files[path];
  }

  headCommit(): Commit {
    return this.commits[this.head];
  }

  /** Someone else saves: apply edits (path → transform) as a new commit on the branch. */
  otherSave(edits: Record<string, (text: string) => string>, author = "Sam Lee", message = "Roadmap update"): string {
    const files = { ...this.commits[this.head].files };
    for (const [path, edit] of Object.entries(edits)) files[path] = edit(files[path]);
    const id = sha("other", ++this.n);
    this.commits[id] = { parent: this.head, files, message, author, date: date(this.n) };
    this.head = id;
    return id;
  }

  /** The site finishes redeploying `commit` (default: the branch tip). */
  deploy(commit = this.head): void {
    this.deployed = commit;
  }

  /** The roadmap.json the site's build would make from `commit`. */
  async bundle(commit: string): Promise<Bundle> {
    const c = this.commits[commit];
    const folder = await hashFolder(c.files);
    const history: string[] = [];
    for (let at: string | null = commit; at && history.length < 50; at = this.commits[at].parent) history.push(at);
    return assembleBundle(
      APP,
      {
        repo: REPO,
        branch: BRANCH,
        commit,
        dir: "roadmap",
        tree: folder.tree,
        visibility: "public",
        private: false,
        readonly: false,
        author: c.author,
        subject: c.message.split("\n")[0],
        date: c.date,
        history,
      },
      folder,
    );
  }

  async install(page: Page): Promise<void> {
    await page.route("**/roadmap.json*", async (route) => {
      const bundle = await this.bundle(this.deployed);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(bundle) });
    });
    await page.route(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, (route) => this.handle(route));
  }

  private handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.host === "raw.githubusercontent.com") {
      // /acme/roadmap/<sha>/roadmap/<path>
      const [, , , commit, , ...rest] = url.pathname.split("/");
      const text = this.commits[commit]?.files[rest.join("/")];
      return route.fulfill({ status: text === undefined ? 404 : 200, body: text ?? "" });
    }

    const prefix = `/repos/${REPO}`;
    if (url.pathname === "/user") {
      return req.headers()["authorization"] === `Bearer ${TOKEN}`
        ? json(200, { login: "tester" })
        : json(401, { message: "Bad credentials" });
    }
    if (!url.pathname.startsWith(prefix)) return json(404, { message: "Not Found" });
    const p = url.pathname.slice(prefix.length);
    const authed = req.headers()["authorization"] === `Bearer ${TOKEN}`;
    if (req.method() !== "GET" && !authed) return json(401, { message: "Bad credentials" });
    let m: RegExpExecArray | null;

    if (p === "") return authed ? json(200, { permissions: { push: true } }) : json(401, { message: "Bad credentials" });
    if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(p))) {
      return decodeURIComponent(m[1]) === BRANCH ? json(200, { object: { sha: this.head } }) : json(404, { message: "Not Found" });
    }
    if ((m = /^\/git\/commits\/(\w+)$/.exec(p))) {
      return this.commits[m[1]] ? json(200, { sha: m[1], tree: { sha: `t-${m[1]}` } }) : json(422, { message: "No commit found" });
    }
    if ((m = /^\/git\/trees\/(t-[\w-]+)$/.exec(p))) {
      // The recursive listing, with roadmap/'s real tree SHA and its files' blob SHAs.
      const files = this.trees[m[1]] ?? this.commits[m[1].slice(2)]?.files ?? {};
      const blob = (text: string) => gitBlobSha(new TextEncoder().encode(text));
      return Promise.all([
        hashFolder(files),
        ...Object.entries(files).map(async ([f, text]) => ({ path: `roadmap/${f}`, mode: "100644", type: "blob", sha: await blob(text) })),
      ]).then(([{ tree }, ...entries]) =>
        json(200, { tree: [{ path: "roadmap", mode: "040000", type: "tree", sha: tree }, ...entries], truncated: false }),
      );
    }
    if ((m = /^\/compare\/(\w+)\.\.\.(\w+)$/.exec(p))) {
      const commits = [];
      for (let c: string | null = m[2]; c && c !== m[1]; c = this.commits[c].parent) {
        const { author, message } = this.commits[c];
        commits.unshift({ sha: c, commit: { author: { name: author }, message } });
      }
      return json(200, { commits });
    }
    if (p === "/git/trees" && req.method() === "POST") {
      const body = req.postDataJSON() as { base_tree: string; tree: { path: string; content?: string; sha?: null }[] };
      const files = { ...this.commits[body.base_tree.slice(2)].files };
      for (const e of body.tree) {
        const path = e.path.replace(/^roadmap\//, "");
        if (e.sha === null) delete files[path];
        else files[path] = e.content!;
      }
      const id = `t-new-${++this.n}`;
      this.trees[id] = files;
      return json(201, { sha: id });
    }
    if (p === "/git/commits" && req.method() === "POST") {
      const body = req.postDataJSON() as { message: string; tree: string; parents: string[] };
      const id = sha("mine", ++this.n);
      this.commits[id] = { parent: body.parents[0], files: this.trees[body.tree], message: body.message, author: "Me", date: date(this.n) };
      return json(201, { sha: id });
    }
    if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(p)) && req.method() === "PATCH") {
      this.beforeRefUpdate?.();
      this.beforeRefUpdate = undefined;
      const body = req.postDataJSON() as { sha: string };
      if (this.commits[body.sha].parent !== this.head) return json(422, { message: "Update is not a fast forward" });
      this.head = body.sha;
      return json(200, {});
    }
    return json(404, { message: `Not Found: ${req.method()} ${p}` });
  }
}

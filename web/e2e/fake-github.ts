// A small stateful stand-in for GitHub (REST API + raw files) and for the
// deployed site's roadmap.json, so browser tests never touch the network,
// the real repo, or the live roadmap data.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";

export const REPO = "acme/roadmap";
export const BRANCH = "main";
export const TOKEN = "github_pat_TEST";

type Files = Record<string, string>;

interface Commit {
  parent: string | null;
  files: Files;
  message: string;
  author: string;
}

const FIXTURE = fileURLToPath(new URL("./fixtures/roadmap", import.meta.url));

function readDir(dir: string): Files {
  const out: Files = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[relative(dir, full).split(sep).join("/")] = readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return out;
}

const sha = (prefix: string, n: number) => `${prefix}${n}`.padEnd(40, "0");

export class FakeGitHub {
  readonly commits: Record<string, Commit> = {};
  head: string;
  /** What the "deployed site" currently serves as roadmap.json. */
  deployed: string;
  /** Runs just before a branch update is applied (e.g. to simulate a racing save). */
  beforeRefUpdate?: () => void;
  private trees: Record<string, Files> = {};
  private n = 0;

  constructor(files: Files = readDir(FIXTURE)) {
    const root = sha("c0", 0);
    this.commits[root] = { parent: null, files, message: "Initial roadmap", author: "Setup" };
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
    this.commits[id] = { parent: this.head, files, message, author };
    this.head = id;
    return id;
  }

  /** The site finishes redeploying `commit` (default: the branch tip). */
  deploy(commit = this.head): void {
    this.deployed = commit;
  }

  async install(page: Page): Promise<void> {
    await page.route("**/roadmap.json*", (route) => {
      const c = this.commits[this.deployed];
      const [subject] = c.message.split("\n");
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          files: c.files,
          source: { repo: REPO, branch: BRANCH, commit: this.deployed, author: c.author, subject },
        }),
      });
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
      const files = this.trees[m[1]] ?? this.commits[m[1].slice(2)]?.files ?? {};
      return json(200, {
        tree: Object.keys(files).map((f) => ({ path: `roadmap/${f}`, type: "blob", sha: f })),
        truncated: false,
      });
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
      this.commits[id] = { parent: body.parents[0], files: this.trees[body.tree], message: body.message, author: "Me" };
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

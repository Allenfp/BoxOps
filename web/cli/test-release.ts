// Fixtures for the command-line tool's and the action's unit tests: a fake
// release (BUILD.json and a tiny app) in the system's temp folder, a fake
// GitHub serving releases, a GitHub Actions environment around a TestRepo,
// the starter's sample roadmap, and a reader for $GITHUB_OUTPUT.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Io } from "./context";
import type { ReleaseEntry } from "./notices";
import { buildJsonText, type Identity, makeBuildJson } from "./release";
import type { Entry } from "./test-repo";

export const ID: Identity = { version: "0.1.0", build: "0.1.0+0123456789ab", time: "2026-10-01T00:00:00Z", source: "0123456789ab".padEnd(40, "c") };

/** The app files of the fake release (path in dist/app → text). */
export const APP_FILES: Record<string, string> = {
  "index.html": '<!doctype html><meta charset="UTF-8"><meta name="boxops-build" content="0.1.0+0123456789ab"><script type="module" src="./assets/index-A1.js"></script>\n',
  "assets/index-A1.js": "console.log('app');\n",
  "assets/parse-B2.js": "console.log('parser');\n",
  "favicon.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>\n",
};

/** Whether the temp folder's disk ignores case, as macOS's and Windows' do by default. */
export const IGNORES_CASE = existsSync(tmpdir().toUpperCase()) && existsSync(tmpdir().toLowerCase());

/** Temp folders made here, removed by cleanUp(). */
const temps: string[] = [];

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "boxops-test-"));
  temps.push(dir);
  return dir;
}

export function cleanUp(): void {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
}

/**
 * A release laid out as a release commit is (BUILD.json, dist/boxops.mjs,
 * dist/action.mjs, dist/app/**) for `id`; returns the dist/ folder, where the
 * CLI would be.
 */
export function makeRelease(id: Identity = ID, app: Record<string, string> = APP_FILES): string {
  const root = tempDir();
  const files: Record<string, Uint8Array> = {
    "dist/boxops.mjs": Buffer.from("export async function main() { return 0; }\n"),
    "dist/action.mjs": Buffer.from('import { runAction } from "./boxops.mjs";\n'),
  };
  for (const [path, text] of Object.entries(app)) files[`dist/app/${path}`] = Buffer.from(text);
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
  writeFileSync(join(root, "BUILD.json"), buildJsonText(makeBuildJson(id, files)));
  return join(root, "dist");
}

/**
 * A fake GitHub: tags per repository (tag → commit), releases per repository,
 * and files per commit. Every call is listed in `calls`. git/matching-refs,
 * for which GitHub documents no paging, gives every tag whatever `per_page`
 * and `page` say, unless `refsPaged` has it page them.
 */
export function fakeGitHub(o: {
  tags?: Record<string, Record<string, string>>;
  files?: Record<string, Record<string, string | Uint8Array>>;
  releases?: Record<string, ReleaseEntry[]>;
  refsPaged?: boolean;
}) {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    let m = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/git\/ref\/tags\/(.+)$/.exec(url);
    if (m) {
      const sha = o.tags?.[m[1]]?.[m[2]];
      return sha ? json({ ref: `refs/tags/${m[2]}`, object: { type: "commit", sha } }) : json({ message: "Not Found" }, 404);
    }
    m = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/git\/matching-refs\/tags\?per_page=(\d+)&page=(\d+)$/.exec(url);
    if (m) {
      const refs = Object.entries(o.tags?.[m[1]] ?? {}).map(([tag, sha]) => ({ ref: `refs/tags/${tag}`, object: { type: "commit", sha } }));
      const [size, page] = [Number(m[2]), Number(m[3])];
      return json(o.refsPaged ? refs.slice((page - 1) * size, page * size) : refs);
    }
    m = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/releases\?per_page=30$/.exec(url);
    if (m) return json(o.releases?.[m[1]] ?? []);
    m = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/releases\/tags\/(.+)$/.exec(url);
    if (m) {
      const tag = m[2];
      const release = o.releases?.[m[1]]?.find((r) => r.tag_name === tag && r.draft !== true);
      return release ? json(release) : json({ message: "Not Found" }, 404);
    }
    m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([0-9a-f]{40})\/(.+)$/.exec(url);
    if (m) {
      const file = o.files?.[m[2]]?.[m[3]];
      return file === undefined ? new Response("404: Not Found", { status: 404 }) : new Response(typeof file === "string" ? file : Buffer.from(file));
    }
    return json({ message: "Not Found" }, 404);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

/** A release's files as GitHub serves them at its commit: BUILD.json, dist/boxops.mjs, the app. */
export function releaseFiles(id: Identity, cli = "export async function main() { return 0; }\n"): Record<string, string | Uint8Array> {
  const files: Record<string, Uint8Array> = { "dist/boxops.mjs": Buffer.from(cli), "dist/action.mjs": Buffer.from('import "./boxops.mjs";\n') };
  for (const [p, t] of Object.entries(APP_FILES)) files[`dist/app/${p}`] = Buffer.from(t);
  return { ...files, "BUILD.json": buildJsonText(makeBuildJson(id, files)) };
}

/** The starter's sample roadmap (the starter repo's roadmap/), by path in the folder. */
export const SAMPLE: Record<string, string> = {
  "settings.yaml":
    "# Team settings for this roadmap.\nformat: 1 # BoxOps data format\ntitle: Our roadmap\nfiscal_year_start_month: 1\ndefault_zoom: months\n" +
    'types:\n  - id: project\n    name: Project\n    color: "#4f7cff"\n  - id: maintenance\n    name: Maintenance\n    color: "#8a94a6"\n' +
    "statuses:\n  - id: at_risk\n    name: At risk\n",
  "people.yaml": "people:\n  - id: example-ada\n    name: Ada Example\n    department: engineering\n",
  "departments/engineering.yaml": 'id: engineering\ncode: ENG\nname: Engineering\ncolor: "#4f7cff"\norder: 1\nlanes:\n  - id: eng-1\n  - id: eng-2\n',
  "boxes/bx-1a2b-example-project.yaml":
    "id: bx-1a2b-example-project\ncode: K7P\ntitle: Example project (delete me)\nlane: eng-1\nstart: 2026-11-02\nend: 2026-11-13\ntype: project\nengineers:\n  - example-ada\n",
};

/** SAMPLE under roadmap/, plus `extra` (paths from the repository's top level). */
export const sampleRepo = (extra: Record<string, Entry> = {}): Record<string, Entry> => ({
  ...Object.fromEntries(Object.entries(SAMPLE).map(([p, t]) => [`roadmap/${p}`, t])),
  ...extra,
});

export interface ActionsEnv extends Record<string, string> {
  GITHUB_OUTPUT: string;
  GITHUB_STEP_SUMMARY: string;
  RUNNER_TEMP: string;
}

/**
 * GitHub Actions' environment for a run on acme/roadmap's main, with the
 * workspace at `workspace` and this event payload's repository fields.
 */
export function actionsEnv(workspace: string, repository: Record<string, unknown> = {}, extra: Record<string, string> = {}): ActionsEnv {
  const dir = tempDir();
  const event = join(dir, "event.json");
  writeFileSync(event, JSON.stringify({ repository: { full_name: "acme/roadmap", default_branch: "main", private: true, visibility: "private", ...repository } }));
  writeFileSync(join(dir, "output"), "");
  writeFileSync(join(dir, "summary"), "");
  mkdirSync(join(dir, "temp"));
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "acme/roadmap",
    GITHUB_REF_NAME: "main",
    GITHUB_REF_TYPE: "branch",
    GITHUB_RUN_ID: "123",
    GITHUB_WORKSPACE: workspace,
    GITHUB_EVENT_PATH: event,
    GITHUB_OUTPUT: join(dir, "output"),
    GITHUB_STEP_SUMMARY: join(dir, "summary"),
    RUNNER_OS: "Linux",
    RUNNER_TEMP: join(dir, "temp"),
    ...extra,
  };
}

/** What the runner makes of $GITHUB_OUTPUT (heredoc form only, which is all the action writes). */
export function readOutputs(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([^<]+)<<(.+)$/.exec(lines[i]);
    if (!m) continue;
    const value: string[] = [];
    for (i++; lines[i] !== m[2]; i++) {
      if (i >= lines.length) throw new Error(`unterminated output ${m[1]}`);
      value.push(lines[i]);
    }
    out[m[1]] = value.join("\n");
  }
  return out;
}

/**
 * The workflow command the runner would read `line` as, or null: what
 * actions/runner's ActionCommand.TryParseV2 (`::name …::data` once leading
 * white space is trimmed), then TryParse (the older `##[name …]data`,
 * anywhere in the line), accept, matching ordinally. Any name counts, not
 * only the runner's commands, to be strict.
 */
export function runnerCommand(line: string): string | null {
  const name = (info: string) => {
    const n = info.split(" ")[0];
    return /^[A-Za-z][\w-]*$/.test(n) ? n : null;
  };
  // .NET's TrimStart(): JavaScript's white space, and U+0085.
  const trimmed = line.replace(/^[\s\u0085]+/, "");
  if (trimmed.startsWith("::")) {
    const end = trimmed.indexOf("::", 2);
    const n = end < 0 ? null : name(trimmed.slice(2, end));
    if (n) return n;
  }
  const at = line.indexOf("##[");
  const close = at < 0 ? -1 : line.indexOf("]", at);
  return close < 0 ? null : name(line.slice(at + 3, close));
}

/** The characters in `text` a terminal or GitHub's log viewer would obey: control characters but tab and line feed, and bidirectional controls. */
export const obeyed = (text: string): string[] => [...text].filter((c) => c !== "\t" && c !== "\n" && /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(c));

/**
 * A value holding what a terminal would obey: ESC (a window's title set, a
 * line erased), BEL, CR (back to the line's start), a C1 control (CSI, to
 * some terminals) and a right-to-left override. NASTY_YAML is it in YAML's
 * double-quoted escapes, and NASTY_SHOWN as BoxOps prints it.
 */
export const NASTY = "\u001b]0;owned\u0007\u001b[2K\rfake OK\u009b31m\u202e";
export const NASTY_YAML = "\\e]0;owned\\a\\e[2K\\rfake OK\\x9b31m\\u202e";
export const NASTY_SHOWN = "\\u001b]0;owned\\u0007\\u001b[2K\\rfake OK\\u009b31m\\u202e";

export interface Captured extends Io {
  stdout: string[];
  stderr: string[];
}

/** An Io for the command-line tool that records what it prints, with a fresh fake release; no network unless `fetch` is given. */
export function capture(o: Partial<Io> = {}): Captured {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (t) => stdout.push(...t.split("\n")),
    err: (t) => stderr.push(...t.split("\n")),
    cwd: tempDir(),
    env: {},
    fetch: () => Promise.reject(new Error("no network in this test")),
    cliDir: makeRelease(),
    identity: () => ID,
    ...o,
  };
}

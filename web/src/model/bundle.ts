// roadmap.json, the "bundle": the roadmap files and where they came from,
// served next to index.html. The build writes it (cli/site.ts); the app reads
// it with readBundle(), which also accepts bundles from before schema 1.

import type { RoadmapFiles } from "./types.ts"; // with .ts: vite.config.ts imports this file

/** The bundle layout written by this BoxOps. Tabs of every version read `schema` and `app.build`, so those never move. */
export const SCHEMA = 1;

/** The app that built the bundle. */
export interface AppInfo {
  /** web/package.json's version. */
  version: string;
  /**
   * Changes when the app's code changes, never on roadmap-only saves:
   * "<version>+<12 hex>" (".dirty" added when built with uncommitted app
   * changes). vite.config.ts also defines it for the app as __BOXOPS_BUILD__. "" when unknown.
   */
  build: string;
  /** Committer date of the app's commit (ISO 8601, UTC); __BOXOPS_BUILD_TIME__ for the app. "" when unknown. */
  time: string;
}

export type Visibility = "public" | "private" | "internal";

/** Where the files came from. */
export interface BundleSource {
  /** "owner/repo"; "" when unknown. */
  repo: string;
  branch: string;
  /** The commit the files were read from; "" outside a git repository. */
  commit: string;
  /** The roadmap folder's path in the repository. */
  dir: string;
  /** SHA of the `dir` tree at `commit`; null when the files aren't exactly that tree (a local build with edits) or it isn't known. */
  tree: string | null;
  /** The repository's visibility; null when unknown. */
  visibility: Visibility | null;
  /** True unless the repository is known to be public (the safe guess): the app never calls GitHub without a token when true. */
  private: boolean;
  /** The site never saves. */
  readonly: boolean;
  /** Built from a working tree, not from a commit: `npm run dev`, or a local build with uncommitted roadmap changes. */
  local?: boolean;
  /** Author of `commit` and the first line of its message. */
  author: string;
  subject: string;
  /** Committer date of `commit` (ISO 8601, UTC); "" when unknown. */
  date: string;
  /** Up to 50 first-parent commits, newest first, starting with `commit`. */
  history: string[];
  /** The GitHub Actions run that built the site. */
  run?: string;
}

/** A plain-text message for everyone who opens the site (security releases and the like). */
export interface Notice {
  level: "security" | "warning" | "info";
  text: string;
}

export interface Bundle {
  /** SCHEMA; 0 for a bundle from before schema 1. */
  schema: number;
  /** The data format the building app reads (model/format.ts); 0 when unknown. */
  format: number;
  app: AppInfo;
  source: BundleSource;
  /** Roadmap files (path in the roadmap folder → text). */
  files: RoadmapFiles;
  /** Path → git blob SHA of each file in `files`; {} when unknown. */
  blobs: Record<string, string>;
  /** Other files in the roadmap folder, not read: the loader reports them as unexpected. */
  ignored: string[];
  notices: Notice[];
}

/** A roadmap folder as read from git or from disk. */
export interface RoadmapFolder {
  files: RoadmapFiles;
  blobs: Record<string, string>;
  ignored: string[];
  /** The folder's tree SHA; null when it was read from disk. */
  tree: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isSha = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{40}$/.test(v);
const text = (v: unknown) => (typeof v === "string" ? v : "");
const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
function textRecord(v: unknown): Record<string, string> | null {
  return isRecord(v) && Object.values(v).every((x) => typeof x === "string") ? (v as Record<string, string>) : null;
}
const VISIBILITIES: unknown[] = ["public", "private", "internal"] satisfies Visibility[];
const LEVELS: unknown[] = ["security", "warning", "info"] satisfies Notice["level"][];

/**
 * A fetched roadmap.json as a Bundle. Anything a bundle lacks (one from before
 * schema 1 has only `files` and `source.repo/branch/commit/author/subject`)
 * counts as unknown: no tree, private, no build id. Throws if there are no files.
 */
export function readBundle(raw: unknown): Bundle {
  const b = isRecord(raw) ? raw : {};
  const files = textRecord(b.files);
  if (!files) throw new Error("roadmap.json holds no roadmap files");
  const app = isRecord(b.app) ? b.app : {};
  const s = isRecord(b.source) ? b.source : {};
  const commit = text(s.commit);
  return {
    schema: count(b.schema),
    format: count(b.format),
    app: { version: text(app.version), build: text(app.build), time: text(app.time) },
    source: {
      repo: text(s.repo),
      branch: text(s.branch),
      commit,
      dir: text(s.dir) || "roadmap",
      tree: isSha(s.tree) ? s.tree : null,
      visibility: VISIBILITIES.includes(s.visibility) ? (s.visibility as Visibility) : null,
      private: s.private !== false,
      readonly: s.readonly === true,
      // Before schema 1, a local build with uncommitted roadmap edits said `dirty`.
      ...(s.local === true || s.dirty === true ? { local: true } : {}),
      author: text(s.author),
      subject: text(s.subject),
      date: text(s.date),
      history: Array.isArray(s.history) && s.history.every(isSha) ? s.history : commit ? [commit] : [],
      ...(typeof s.run === "string" ? { run: s.run } : {}),
    },
    files,
    blobs: textRecord(b.blobs) ?? {},
    ignored: Array.isArray(b.ignored) ? b.ignored.filter((p) => typeof p === "string") : [],
    notices: Array.isArray(b.notices)
      ? b.notices.filter((n): n is Notice => isRecord(n) && LEVELS.includes(n.level) && typeof n.text === "string")
      : [],
  };
}

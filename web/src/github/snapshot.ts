// The roadmap folder at one commit, as the app holds it: from the site's
// roadmap.json on load and on every poll, or from GitHub (read.ts, which the
// app fetches only when it first reads from GitHub: after the roadmap shows,
// to save, or for a ?ref= preview). What's here is what showing a deploy
// needs, and the failures the app tells apart whichever read it was.

import type { Bundle, BundleSource } from "../model/bundle";
import type { RoadmapFiles } from "../model/types";
import { textBlobSha } from "./git-objects";

/** Where a snapshot came from: the bundle's fields, plus what the reader learns. */
export interface Source extends BundleSource {
  /** The first parent of `commit`, when it was read from GitHub. */
  parent?: string;
}

/** The roadmap folder at one commit. */
export interface Snapshot {
  source: Source;
  /** Roadmap files (path in the folder → text). */
  files: RoadmapFiles;
  /** Path → git blob SHA of each file in `files`. */
  blobs: Record<string, string>;
  /** The folder's other files, not read; the loader reports them as unexpected. */
  ignored: string[];
}

/** Blob fetches one read may make. More means a stale site or a mass edit: better to say so than to spend the rate limit. */
export const MAX_BLOB_FETCHES = 300;

/** More files changed than one read fetches. */
export class TooManyChanges extends Error {
  constructor(
    readonly count: number,
    readonly limit = MAX_BLOB_FETCHES,
  ) {
    super(
      `${count} roadmap files changed since this copy was loaded, more than BoxOps reads at once (${limit}). Reload once the site has redeployed.`,
    );
  }
}

/** The roadmap folder on GitHub breaks the rules the build holds it to; nothing is read until it's fixed. */
export class FolderProblems extends Error {
  /** Each problem in words, after its path: "roadmap/boxes/a.yaml: is a symlink; …". */
  readonly lines: string[];
  constructor(
    readonly dir: string,
    readonly problems: { path: string; message: string }[],
  ) {
    const lines = problems.map((p) => `${p.path ? `${dir}/${p.path}` : dir}: ${p.message}`);
    super(lines.join("\n"));
    this.lines = lines;
  }
}

/** Whether a client may read the repository: with a token, or without one only when the build said it's public. */
export const canRead = (source: Source, gh: { readonly authenticated: boolean }) => gh.authenticated || source.private === false;

/** Blob SHA → text, for every file this tab has held; blobs never change, so entries never go stale. */
const blobCache = new Map<string, string>();

/** The text of a blob this tab has held, if any. */
export const knownBlob = (sha: string): string | undefined => blobCache.get(sha);

/** Keep a snapshot's files in the session's blob cache, so later reads needn't fetch them. Returns the snapshot. */
export function remember(s: Snapshot): Snapshot {
  for (const [path, sha] of Object.entries(s.blobs)) {
    const text = s.files[path];
    if (text !== undefined) blobCache.set(sha, text);
  }
  return s;
}

/** For tests: start with an empty blob cache. */
export function forgetBlobs(): void {
  blobCache.clear();
}

/** A bundle as a snapshot. A bundle from before schema 1 has no blob SHAs; they're computed from the text. */
export async function fromBundle(b: Bundle): Promise<Snapshot> {
  const blobs: Record<string, string> = {};
  for (const [path, text] of Object.entries(b.files)) blobs[path] = b.blobs[path] ?? (await textBlobSha(text));
  return { source: b.source, files: b.files, blobs, ignored: b.ignored };
}

/** Whether two snapshots hold the same roadmap files (other files in the folder don't count). */
export function sameBlobs(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

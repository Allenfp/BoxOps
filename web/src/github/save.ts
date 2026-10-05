// Saving = one commit straight onto the branch the roadmap was loaded from,
// made with GitHub's GraphQL createCommitOnBranch: GitHub writes the commit
// and moves the branch in one step, authored by the token's owner and signed
// by GitHub where it supports that. It refuses (STALE_DATA) unless the branch
// is still at expectedHeadOid, the head this save was checked against.
//
// Before writing, the head is read (read.ts) and compared, file by file and
// by blob SHA, with the copy the edits were made on. Someone else's saves to
// other files stay and ours go on top; a file both of us changed is a
// conflict the user settles. A head older than that copy is GitHub's answer
// lagging: the save stops, to be tried again a moment later, rather than take
// it for newer saves and roll the screen back. The roadmap as it would be
// after the save is validated first; if someone else's saves are what make
// it invalid, they're shown for review instead. Files the head already holds
// exactly as ours are left out, and an empty change is never sent. A head in
// a newer data format (an upgrade merged, its deploy still running) is never
// written to.
//
// Retrying is safe: every attempt names the head it goes on, so at most one
// lands. After STALE_DATA, or a failure that leaves unclear whether the
// commit was made (a timeout, a dropped connection), the head is read again;
// if it holds our content in every changed file, the save already landed.

import { FORMAT } from "../model/format";
import { settingsFormat } from "../model/parse";
import { isRoadmapPath } from "../model/paths";
import { type FileChanges, applyChanges } from "../model/serialize";
import type { RoadmapFiles } from "../model/types";
import { type GitHubClient, GitHubFailure } from "./api";
import { textBlobSha, utf8ToBase64 } from "./git-objects";
import { type Snapshot, type Source, readSnapshot, remember, sameBlobs } from "./read";

/**
 * Others saved roadmap changes since the edits' base (with `review`, or ones
 * the edits would be invalid on): shown for review before anything is written.
 */
export class NewerSaves extends Error {
  constructor(readonly head: Snapshot) {
    super("The roadmap changed since you opened it.");
  }
}

/** Files we changed that someone else also changed (or deleted, or created) since the edits' base. */
export class SaveConflict extends Error {
  constructor(
    readonly paths: string[],
    readonly head: Snapshot,
  ) {
    super(`${paths.length} item(s) were changed by someone else since you loaded the roadmap.`);
  }
}

/**
 * The head's settings.yaml states a newer data format than this BoxOps writes:
 * an upgrade was merged and its deploy is still running. Nothing is written.
 */
export class NewerFormat extends Error {
  constructor(readonly format: number) {
    super("BoxOps is being upgraded; reload in a minute.");
  }
}

/** Throws NewerFormat if this head is in a data format newer than FORMAT. */
function checkFormat(head: Snapshot): void {
  const format = settingsFormat(head.files["settings.yaml"]);
  if (format !== null && format > FORMAT) throw new NewerFormat(format);
}

/** Retries after STALE_DATA or an unclear failure, on top of the first attempt. */
const RETRIES = 2;
/** One commit's size, until a live check measures what GitHub takes. */
const MAX_FILES = 1000;
const MAX_BASE64 = 8 * 1024 * 1024;

export interface SaveRequest {
  gh: GitHubClient;
  /** The copy the edits were made on. */
  base: Snapshot;
  /** Path in the roadmap folder → new text, or null to delete. */
  changes: FileChanges;
  /** commitMessage(): headline, blank line, body. */
  message: string;
  /** Stop with NewerSaves if the roadmap files changed since `base`. */
  review?: boolean;
  /** Commits the tab has already shown or moved past (see ReadOptions). */
  seen?: ReadonlySet<string>;
  /** Problems with the files as they would be after this save; any problem stops the save (with NewerSaves, on others' newer saves). */
  validate?(files: RoadmapFiles): string[];
  /** Told what the save is doing, for a progress line: a save can wait on GitHub for a minute or two. */
  onProgress?(step: SaveStep): void;
}

/** Reading the head; making the commit; reading the head after an unclear failure; waiting to try again. */
export type SaveStep = "checking" | "writing" | "verifying" | "retrying";

export type SaveResult =
  /** Committed. `parent` is the head it went on (ours, or someone else's newer one), made by `parentAuthor`. */
  | { status: "saved"; commit: string; parent: string; parentAuthor: string; parentSubject: string; url: string; signed: boolean | null; snapshot: Snapshot }
  /** The head already holds these changes: an earlier attempt whose answer was lost landed. `snapshot` is that head. */
  | { status: "alreadySaved"; commit: string; url: string; snapshot: Snapshot }
  /** Nothing to write: the head already has every change. */
  | { status: "noop"; snapshot: Snapshot };

/** [skip ci] and the like: GitHub runs no workflow for such a commit, so it would never deploy. */
const SKIP_MARKER = /\[\s*(skip\s+ci|ci\s+skip|no\s+ci|skip\s+actions|actions\s+skip)\s*\]/gi;

/** A commit message as the mutation takes it: the first line as headline (on one line), the rest after the blank line as body. */
export function commitParts(message: string): { headline: string; body: string } {
  const [first, ...rest] = message.replace(SKIP_MARKER, "($1)").split("\n");
  return {
    headline: first.replace(/\s+/g, " ").trim() || "Update the roadmap",
    body: rest.join("\n").replace(/^\n+/, "").trimEnd(),
  };
}

const commitUrl = (repo: string, sha: string) => `https://github.com/${repo}/commit/${sha}`;

export async function saveRoadmap(req: SaveRequest): Promise<SaveResult> {
  const { gh, base, changes } = req;
  const { repo, branch, dir } = base.source;
  if (base.source.readonly) throw new Error("This site is read-only: it never saves.");
  const paths = Object.keys(changes).sort();
  const odd = paths.filter((p) => !isRoadmapPath(p));
  if (odd.length) throw new Error(`BoxOps writes only roadmap files, not ${odd.map((p) => `${dir}/${p}`).join(", ")}.`);
  const mine: Record<string, string | null> = {};
  for (const p of paths) {
    const text = changes[p];
    mine[p] = text === null ? null : await textBlobSha(text);
  }
  const contents: Record<string, string> = {};
  for (const p of paths) if (changes[p] !== null) contents[p] = utf8ToBase64(changes[p]!);
  const size = Object.values(contents).reduce((n, c) => n + c.length, 0);
  if (paths.length > MAX_FILES || size > MAX_BASE64) {
    throw new Error(
      `This save is too big for one commit (${paths.length} files, ${(size / 1024 / 1024).toFixed(1)} MB). Undo some changes, save, then redo them.`,
    );
  }
  const { headline, body } = commitParts(req.message);
  if (!paths.length) return { status: "noop", snapshot: base };
  /** Every changed file at this head is exactly ours. */
  const landed = (s: Snapshot) => paths.every((p) => (s.blobs[p] ?? null) === mine[p]);

  const progress = (step: SaveStep) => req.onProgress?.(step);
  progress("checking");
  let head = await readSnapshot(gh, base, { seen: req.seen });
  checkFormat(head);
  // An earlier save whose answer never arrived may be there already, even under later saves.
  if (head !== base && landed(head)) return { status: "alreadySaved", commit: head.source.commit, url: commitUrl(repo, head.source.commit), snapshot: head };
  if (req.review && !sameBlobs(head.blobs, base.blobs)) throw new NewerSaves(head);

  let unclear = false; // an attempt may have landed without our hearing
  for (let attempt = 0; ; attempt++) {
    const at = (p: string) => head.blobs[p];
    const conflicts = paths.filter((p) => at(p) !== base.blobs[p] && (at(p) ?? null) !== mine[p]);
    if (conflicts.length) throw new SaveConflict(conflicts, head);
    // Someone else's save could, e.g., delete a lane our boxes use: then their
    // roadmap comes in for review, as before any save, where the edits are
    // carried onto it and what they left pointing at nothing is put right.
    // (Saving again with the same choice would only fail the same way.)
    const next = applyChanges(head.files, changes);
    const problems = req.validate?.(next) ?? [];
    if (problems.length && !sameBlobs(head.blobs, base.blobs)) throw new NewerSaves(head);
    if (problems.length) throw new Error(`This save would leave the roadmap invalid: ${problems.join("; ")}`);

    const additions = paths.filter((p) => mine[p] !== null && at(p) !== mine[p]).map((p) => ({ path: `${dir}/${p}`, contents: contents[p] }));
    // Deleting a path that isn't there makes GitHub refuse the whole commit.
    const deletions = paths.filter((p) => mine[p] === null && at(p) !== undefined).map((p) => ({ path: `${dir}/${p}` }));
    if (!additions.length && !deletions.length) return { status: "noop", snapshot: head };

    try {
      progress("writing");
      const c = await gh.createCommitOnBranch({ repo, branch, expectedHeadOid: head.source.commit, headline, body, additions, deletions });
      const blobs = { ...head.blobs };
      for (const p of paths) {
        if (mine[p] === null) delete blobs[p];
        else blobs[p] = mine[p]!;
      }
      const source: Source = {
        ...head.source,
        commit: c.oid,
        parent: head.source.commit,
        tree: null, // not known until the next read
        author: "",
        subject: headline,
        date: c.date,
        history: [c.oid, ...head.source.history].slice(0, 50),
      };
      const snapshot = remember({ source, files: next, blobs, ignored: head.ignored });
      const { author: parentAuthor, subject: parentSubject } = head.source;
      return { status: "saved", commit: c.oid, parent: head.source.commit, parentAuthor, parentSubject, url: c.url, signed: c.signed, snapshot };
    } catch (e) {
      if (!(e instanceof GitHubFailure)) throw e;
      if (!e.ambiguous && (e.kind === "read-only" || e.kind === "no-access")) throw await explain(gh, repo, e);
      if (e.kind !== "stale" && !e.ambiguous) throw e;
      unclear ||= e.ambiguous;
      let fresh: Snapshot;
      progress("verifying");
      try {
        fresh = await readSnapshot(gh, head, { seen: req.seen }); // fetches only blobs changed since `head`
      } catch (x) {
        // Still unclear whether it was made: say so. Otherwise nothing was written, and what
        // stopped the re-read (too many changes, the folder's problems, a rate limit, a
        // token that can't see the repository, a lagging answer) is what stops the save.
        throw e.ambiguous ? e : x;
      }
      if (fresh !== head && landed(fresh)) {
        if (!unclear) return { status: "noop", snapshot: fresh }; // someone else made the same changes
        // Ours went straight onto `head`; anything after it is someone else's.
        const ours =
          fresh.source.parent === head.source.commit
            ? fresh.source.commit
            : ((await gh.compare(repo, head.source.commit, fresh.source.commit).catch(() => []))[0]?.sha ?? fresh.source.commit);
        return { status: "alreadySaved", commit: ours, url: commitUrl(repo, ours), snapshot: fresh };
      }
      if (attempt >= RETRIES) {
        // Checked: nothing landed, so it isn't unclear any more.
        throw e.kind === "stale"
          ? new GitHubFailure("stale", "Others kept saving while BoxOps was saving.", e.detail)
          : new GitHubFailure(e.kind, e.message, e.detail, false);
      }
      head = fresh;
      checkFormat(head);
      progress("retrying");
      await gh.sleep(1000 * (attempt + 1)); // GitHub asks for a second or more between writes
    }
  }
}

/** A read-only or no-access refusal, with what GET /repos says about the account (only asked after a failure). */
async function explain(gh: GitHubClient, repo: string, e: GitHubFailure): Promise<GitHubFailure> {
  try {
    const r = await gh.repository(repo);
    return new GitHubFailure(e.kind, e.message, { ...e.detail, visible: true, ...(r.push === null ? {} : { push: r.push }) }, e.ambiguous);
  } catch (x) {
    return x instanceof GitHubFailure && x.kind === "no-access" ? new GitHubFailure(e.kind, e.message, { ...e.detail, visible: false }, e.ambiguous) : e;
  }
}

// What a save that didn't simply go through comes to, for the save dialog,
// and whose saves one that did brought in with it. Part of saving's code
// (saving.ts), fetched once someone starts editing.

import type { Resume, SaveProblem } from "../components/SaveDialog";
import { type DraftState, rebaseDraft } from "../model/draft";
import { loadRoadmap } from "../model/parse";
import type { FileChanges } from "../model/serialize";
import { describeChanges } from "../model/summary";
import { type GitHubClient, GitHubFailure } from "./api";
import { NewerFormat, type NewerSaves, type SaveResult } from "./save";
import { FolderProblems, TooManyChanges } from "./snapshot";

/**
 * Others saved since this tab loaded (the pre-save check found them, `e`): who saved what (from
 * commit `from` on), and the items both sides changed, by key and in words (`describe`). The
 * draft goes onto their roadmap meanwhile.
 */
export async function newerSaves(
  gh: GitHubClient,
  from: string,
  e: NewerSaves,
  base: DraftState,
  draft: DraftState,
  describe: (key: string) => string,
): Promise<Extract<SaveProblem, { kind: "updated" }>> {
  const { head } = e;
  const saves = await gh.compare(head.source.repo, from, head.source.commit).catch(() => []);
  const { roadmap: latest } = loadRoadmap(head.files, head.ignored);
  const theirs: DraftState = { boxes: latest.boxes, departments: latest.departments, people: latest.people, settings: latest.settings };
  const keys = rebaseDraft(base, draft, theirs).conflicts;
  return { kind: "updated", saves, changes: describeChanges(base, theirs), keys, clashes: keys.map(describe) };
}

/** Why a save failed with `e`, for the save dialog; `resume`, how to go on from it. A rejected token (`token`) is to be forgotten. */
export function failedSave(e: unknown, resume: Resume): SaveProblem {
  if (e instanceof NewerFormat) return { kind: "upgrading", format: e.format };
  if (e instanceof GitHubFailure) return e.kind === "unauthorized" ? { kind: "token", rejected: true, resume } : { kind: "github", failure: e, resume };
  // Not this tab's to fix: trying again fails the same way until someone fixes the folder.
  if (e instanceof FolderProblems) return { kind: "folder", problems: e.lines };
  // The same read fails until this tab reloads onto a newer deploy.
  if (e instanceof TooManyChanges) return { kind: "error", message: e.message, reload: "instead" };
  return { kind: "error", message: (e as Error).message, resume };
}

/**
 * Someone else's saves a save of ours brought in: a racing save it went on
 * top of (or one already on top of an earlier attempt of ours). Roadmap files
 * it didn't write that differ from the copy it was made on are theirs. Named
 * by the newest of them when that's known.
 */
export function othersIn(result: SaveResult, blobs: Record<string, string>, changes: FileChanges): { author?: string; subject?: string } | null {
  const after = result.snapshot.blobs;
  if (!Object.keys({ ...blobs, ...after }).some((p) => !(p in changes) && blobs[p] !== after[p])) return null;
  if (result.status === "saved") return { author: result.parentAuthor, subject: result.parentSubject };
  // The head is ours: whose saves are under it isn't known.
  if (result.status === "alreadySaved" && result.snapshot.source.commit === result.commit) return {};
  return { author: result.snapshot.source.author, subject: result.snapshot.source.subject };
}

// Saving = one commit straight onto the branch the roadmap was loaded from.
// If someone else saved in the meantime, our files go on top of theirs; only
// files that both of us changed count as a conflict, and the user decides.

import { isRoadmapPath } from "../model/paths";
import { type FileChanges, applyChanges } from "../model/serialize";
import type { RoadmapFiles } from "../model/types";
import { GitHub, GitHubError, type RepoRef, type TreeEntry } from "./api";

/** Where the loaded roadmap came from; written into roadmap.json at build time. */
export interface Source {
  /** "owner/repo" */
  repo: string;
  branch: string;
  /** Commit the files were read from. */
  commit: string;
  /** Local dev only: roadmap/ has edits that aren't in `commit`. */
  dirty?: boolean;
  /** Author and first line of `commit`'s message. */
  author?: string;
  subject?: string;
}

export const ROADMAP_DIR = "roadmap";

export function parseRepo(repo: string): RepoRef {
  const [owner, name] = repo.split("/");
  return { owner, repo: name };
}

/** Files we changed that someone else also changed (or deleted) since we loaded. */
export class SaveConflict extends Error {
  constructor(
    readonly paths: string[],
    readonly headCommit: string,
    readonly headFiles: RoadmapFiles,
  ) {
    super(`${paths.length} item(s) were changed by someone else since you loaded the roadmap.`);
  }
}

export interface SaveRequest {
  gh: GitHub;
  source: Source;
  /** The files as loaded; `changes` were computed against these. */
  baseFiles: RoadmapFiles;
  changes: FileChanges;
  message: string;
  /** Write our version of these conflicting paths anyway. */
  overwrite?: string[];
  /** Problems with the files as they would be after this save; any problem stops the save. */
  validate?(files: RoadmapFiles): string[];
  fetchImpl?: typeof fetch;
}

export interface SaveResult {
  commit: string;
  /** The commit this save went on top of (ours, or someone else's newer one). */
  parent: string;
  url: string;
  /** The whole roadmap as of the new commit, including anyone else's saves. */
  files: RoadmapFiles;
}

export async function saveToBranch(req: SaveRequest): Promise<SaveResult> {
  const { gh, source, baseFiles, changes, message, overwrite = [], validate, fetchImpl } = req;
  const repo = parseRepo(source.repo);

  const info = await gh.repo(repo);
  if (!info.permissions?.push) {
    throw new Error(
      `This token can’t write to ${source.repo}. Give it “Contents: Read and write” access to this repository.`,
    );
  }

  // Two tries: if someone saves between our read and our write, GitHub refuses
  // the non-fast-forward update and we redo the check against their commit.
  for (let attempt = 0; ; attempt++) {
    const head = await gh.branchSha(repo, source.branch);
    let headFiles = baseFiles;
    if (head !== source.commit) {
      headFiles = await loadCommit(gh, source.repo, head, fetchImpl);
      const conflicts = Object.keys(changes).filter((p) => headFiles[p] !== baseFiles[p] && !overwrite.includes(p));
      if (conflicts.length) throw new SaveConflict(conflicts, head, headFiles);
    }
    // Someone else's save could, e.g., delete a lane our boxes use.
    const problems = validate?.(applyChanges(headFiles, changes)) ?? [];
    if (problems.length) throw new Error(`This save would leave the roadmap invalid: ${problems.join("; ")}`);

    const entries: TreeEntry[] = Object.entries(changes).map(([path, text]) =>
      text === null
        ? { path: `${ROADMAP_DIR}/${path}`, mode: "100644", type: "blob", sha: null }
        : { path: `${ROADMAP_DIR}/${path}`, mode: "100644", type: "blob", content: text },
    );
    const baseTree = (await gh.commit(repo, head)).tree.sha;
    const tree = await gh.createTree(repo, baseTree, entries);
    const commit = await gh.createCommit(repo, message, tree.sha, head);
    try {
      await gh.updateBranch(repo, source.branch, commit.sha);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 422 && /fast.?forward/i.test(e.message) && attempt === 0) continue;
      if (e instanceof GitHubError && (e.status === 403 || /protected/i.test(e.message))) {
        throw new Error(
          `${source.branch} is a protected branch, so saves can’t be written to it directly. Remove the protection rule or ask an admin.`,
        );
      }
      throw e;
    }
    return {
      commit: commit.sha,
      parent: head,
      url: `https://github.com/${source.repo}/commit/${commit.sha}`,
      files: applyChanges(headFiles, changes),
    };
  }
}

/** Latest commit on the branch, or null if GitHub can't be reached (offline, rate-limited). */
export async function latestCommit(gh: GitHub, source: Source): Promise<string | null> {
  try {
    return await gh.branchSha(parseRepo(source.repo), source.branch);
  } catch {
    return null;
  }
}

/**
 * Read roadmap/ at the tip of a branch. Uses the API for the listing and
 * raw.githubusercontent.com for contents, so it works without a token on a
 * public repo.
 */
export async function loadFromGitHub(
  gh: GitHub,
  repoName: string,
  branch: string,
  fetchImpl?: typeof fetch,
): Promise<{ files: RoadmapFiles; source: Source }> {
  const commit = await gh.branchSha(parseRepo(repoName), branch);
  const files = await loadCommit(gh, repoName, commit, fetchImpl);
  return { files, source: { repo: repoName, branch, commit } };
}

/** roadmap/ files exactly as they are in `commit`. */
export async function loadCommit(
  gh: GitHub,
  repoName: string,
  commit: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<RoadmapFiles> {
  const repo = parseRepo(repoName);
  const { tree } = await gh.commit(repo, commit).then((c) => gh.tree(repo, c.tree.sha));
  const paths = tree
    .filter((t) => t.type === "blob" && t.path.startsWith(`${ROADMAP_DIR}/`) && isRoadmapPath(t.path.slice(ROADMAP_DIR.length + 1)))
    .map((t) => t.path);
  const files: RoadmapFiles = {};
  await Promise.all(
    paths.map(async (path) => {
      const res = await fetchImpl(`https://raw.githubusercontent.com/${repoName}/${commit}/${path}`);
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      files[path.slice(ROADMAP_DIR.length + 1)] = await res.text();
    }),
  );
  return files;
}

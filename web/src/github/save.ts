// Draft → branch → pull request, as one atomic commit made through the Git Data API.

import type { FileChanges } from "../model/serialize";
import type { RoadmapFiles } from "../model/types";
import { GitHub, GitHubError, type RepoRef, type TreeEntry } from "./api";

/** Where the loaded roadmap came from; written into roadmap.json at build time. */
export interface Source {
  /** "owner/repo" */
  repo: string;
  branch: string;
  /** Commit the files were read from. PR branches start here, so conflicts surface honestly. */
  commit: string;
  /** Local dev only: roadmap/ has edits that aren't in `commit`. */
  dirty?: boolean;
}

export const ROADMAP_DIR = "roadmap";

export function parseRepo(repo: string): RepoRef {
  const [owner, name] = repo.split("/");
  return { owner, repo: name };
}

export type SaveStep = "Checking access" | "Creating commit" | "Creating branch" | "Opening pull request";

export interface SaveRequest {
  gh: GitHub;
  source: Source;
  changes: FileChanges;
  branch: string;
  title: string;
  body: string;
  onStep?(step: SaveStep): void;
}

export async function openPullRequest(req: SaveRequest): Promise<{ number: number; url: string }> {
  const { gh, source, changes, branch, title, body, onStep } = req;
  const repo = parseRepo(source.repo);

  onStep?.("Checking access");
  const info = await gh.repo(repo);
  if (!info.permissions?.push) {
    throw new Error(
      `This token can’t write to ${source.repo}. Give it “Contents” and “Pull requests” read-and-write access to this repository.`,
    );
  }
  let baseTree: string;
  try {
    baseTree = (await gh.commit(repo, source.commit)).tree.sha;
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 404 || e.status === 422)) {
      throw new Error(
        `The version you’re editing (commit ${source.commit.slice(0, 7)}) isn’t on GitHub. Push it first, then save again.`,
      );
    }
    throw e;
  }

  onStep?.("Creating commit");
  const entries: TreeEntry[] = Object.entries(changes).map(([path, text]) =>
    text === null
      ? { path: `${ROADMAP_DIR}/${path}`, mode: "100644", type: "blob", sha: null }
      : { path: `${ROADMAP_DIR}/${path}`, mode: "100644", type: "blob", content: text },
  );
  const tree = await gh.createTree(repo, baseTree, entries);
  const commit = await gh.createCommit(repo, `${title}\n\n${body}`, tree.sha, source.commit);

  onStep?.("Creating branch");
  try {
    await gh.createBranch(repo, branch, commit.sha);
  } catch (e) {
    if (e instanceof GitHubError && e.status === 422) {
      throw new Error(`A branch named “${branch}” already exists. Pick another branch name.`);
    }
    throw e;
  }

  onStep?.("Opening pull request");
  const pr = await gh.createPull(repo, { title, body, head: branch, base: source.branch });
  return { number: pr.number, url: pr.html_url };
}

/**
 * Read roadmap/ at any branch or commit, for previewing a PR. Uses one API call
 * for the listing and raw.githubusercontent.com for contents, so it works
 * without a token on a public repo.
 */
export async function loadFromGitHub(
  gh: GitHub,
  repoName: string,
  ref: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<{ files: RoadmapFiles; source: Source }> {
  const repo = parseRepo(repoName);
  const commit = /^[0-9a-f]{40}$/.test(ref) ? ref : await gh.branchSha(repo, ref);
  const { tree } = await gh.commit(repo, commit).then((c) => gh.tree(repo, c.tree.sha));
  const paths = tree
    .filter((t) => t.type === "blob" && t.path.startsWith(`${ROADMAP_DIR}/`) && /\.ya?ml$/.test(t.path))
    .map((t) => t.path);
  const files: RoadmapFiles = {};
  await Promise.all(
    paths.map(async (path) => {
      const res = await fetchImpl(`https://raw.githubusercontent.com/${repoName}/${commit}/${path}`);
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      files[path.slice(ROADMAP_DIR.length + 1)] = await res.text();
    }),
  );
  return { files, source: { repo: repoName, branch: ref, commit } };
}

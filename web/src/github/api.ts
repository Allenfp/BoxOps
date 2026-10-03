// Minimal GitHub REST client: just the calls BoxOps needs to read a repo and
// turn a set of file changes into a branch + pull request.

export interface RepoRef {
  owner: string;
  repo: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type Fetch = typeof fetch;

export class GitHub {
  constructor(
    private token: string | null,
    private fetchImpl: Fetch = (...args) => fetch(...args),
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.fetchImpl(`https://api.github.com${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const err = (await res.json()) as { message?: string; errors?: { message?: string }[] };
        detail = [err.message, ...(err.errors ?? []).map((e) => e.message)].filter(Boolean).join(" — ");
      } catch {
        // Non-JSON error body.
      }
      throw new GitHubError(`${method} ${path}: ${res.status}${detail ? ` ${detail}` : ""}`, res.status);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  user() {
    return this.request<{ login: string }>("GET", "/user");
  }

  repo({ owner, repo }: RepoRef) {
    return this.request<{ default_branch: string; permissions?: { push?: boolean } }>(
      "GET",
      `/repos/${owner}/${repo}`,
    );
  }

  branchSha({ owner, repo }: RepoRef, branch: string) {
    return this.request<{ object: { sha: string } }>(
      "GET",
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    ).then((r) => r.object.sha);
  }

  commit({ owner, repo }: RepoRef, sha: string) {
    return this.request<{ sha: string; tree: { sha: string } }>("GET", `/repos/${owner}/${repo}/git/commits/${sha}`);
  }

  tree({ owner, repo }: RepoRef, sha: string) {
    return this.request<{ tree: { path: string; type: string; sha: string }[]; truncated: boolean }>(
      "GET",
      `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    );
  }

  /** Text content of a blob. */
  blob({ owner, repo }: RepoRef, sha: string) {
    return this.request<{ content: string; encoding: string }>("GET", `/repos/${owner}/${repo}/git/blobs/${sha}`).then(
      (b) => (b.encoding === "base64" ? decodeBase64Utf8(b.content) : b.content),
    );
  }

  createTree({ owner, repo }: RepoRef, baseTree: string, entries: TreeEntry[]) {
    return this.request<{ sha: string }>("POST", `/repos/${owner}/${repo}/git/trees`, {
      base_tree: baseTree,
      tree: entries,
    });
  }

  createCommit({ owner, repo }: RepoRef, message: string, tree: string, parent: string) {
    return this.request<{ sha: string }>("POST", `/repos/${owner}/${repo}/git/commits`, {
      message,
      tree,
      parents: [parent],
    });
  }

  /** Commits after `base` up to `head`, oldest first: who saved what in between. */
  compare({ owner, repo }: RepoRef, base: string, head: string) {
    return this.request<{ commits: { sha: string; commit: { author: { name: string }; message: string } }[] }>(
      "GET",
      `/repos/${owner}/${repo}/compare/${base}...${head}`,
    ).then((r) => r.commits.map((c) => ({ sha: c.sha, author: c.commit.author.name, subject: c.commit.message.split("\n")[0] })));
  }

  /** Move a branch to `sha`; GitHub refuses (422) unless it is a fast-forward. */
  updateBranch({ owner, repo }: RepoRef, branch: string, sha: string) {
    return this.request<unknown>("PATCH", `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      sha,
      force: false,
    });
  }
}

export interface TreeEntry {
  path: string;
  mode: "100644";
  type: "blob";
  /** New file text; omitted when deleting. */
  content?: string;
  /** `null` deletes the path. */
  sha?: null;
}

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// The docs' link check (scripts/check-doc-links.mjs), run as CI runs it: the
// repository's Markdown as it is, then a small repository with a link of
// every kind it reads, right and broken, and anchors made as GitHub makes
// them.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanUp, tempDir } from "../cli/test-release";

afterEach(cleanUp);

const SCRIPT = fileURLToPath(new URL("./check-doc-links.mjs", import.meta.url));
const WEB = fileURLToPath(new URL("..", import.meta.url));

/** A git repository holding `files` (path → text), all added to the index but `untracked`. */
function repo(files: Record<string, string>, untracked: Record<string, string> = {}): string {
  const dir = tempDir();
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  execFileSync("git", ["init", "-q", dir], { env });
  for (const [path, text] of Object.entries({ ...files, ...untracked })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  execFileSync("git", ["-C", dir, "add", "--", ...Object.keys(files)], { env });
  return dir;
}

/** Runs the check on the repository at `root`: its exit code and output. */
function check(root: string, env: Record<string, string> = {}, args = ["--root", root]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: WEB, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "", ...env } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const DOC = `---
# a YAML comment in front matter, not a heading
title: x
---
# A

## Second heading

## Same

## Same

### \`departments/<id>.yaml\`

## What's **new** in _0.2.0_ — 2026-11-02?

<a name="custom"></a>

> ## Quoted heading
>
> \`\`\`
> # Not a heading: in a fence, in a quote
> \`\`\`

\`\`\`
# Not a heading either
\`\`\`

[self](#a) [self, wrong](#zzz) [code heading](#departmentsidyaml) [quoted](#quoted-heading)
[repeat](#same-1) [punctuation](#whats-new-in-020--2026-11-02) [fenced](#not-a-heading-either)
[front matter](#a-yaml-comment-in-front-matter-not-a-heading)
`;

const README = `# <img src="icon.svg" alt=""> Title

[ok](docs/a.md) [an anchor](docs/a.md#second-heading) [a custom one](docs/a.md#custom)
[missing](docs/missing.md) [no such anchor](docs/a.md#nope) [upper case](docs/a.md#Second-Heading)
[a folder](docs) [a folder too](docs/) [an anchor in a folder](docs#x)
![an image](icon.svg) <a href="docs/a.md#same">html</a> <img src='missing.png'>
[a line](run.sh#L3) [lines](run.sh#L3-L5) [not a line](run.sh#top)
[outside](../x.md) [from the top](/docs/a.md) [a query](docs/a.md?plain=1#second-heading)
[external](https://example.com/missing.md#y) [mail](mailto:someone@example.com)
[BoxOps' docs, outside starter/](https://github.com/Allenfp/BoxOps/blob/<SOURCE_COMMIT_SHA>/nowhere.md)
[this text spans
two lines](docs/a.md)
\`[in code](missing-code.md)\` and \`\`a [span](missing-span.md) with \` in it\`\`

\`\`\`md
[in a fence](missing-fence.md)
\`\`\`

<!-- [in a comment](missing-comment.md) -->

[a definition]: docs/missing-definition.md
[untracked](untracked.md) [encoded](docs/with%20space.md)
`;

const STARTER = `See [the guide](https://github.com/Allenfp/BoxOps/blob/<SOURCE_COMMIT_SHA>/docs/a.md#second-heading),
[a page that isn't there](https://github.com/Allenfp/BoxOps/blob/<SOURCE_COMMIT_SHA>/docs/nope.md),
[a folder as a blob](https://github.com/Allenfp/BoxOps/blob/<SOURCE_COMMIT_SHA>/docs),
[a folder](https://github.com/Allenfp/BoxOps/tree/<SOURCE_COMMIT_SHA>/docs),
[a file as a tree](https://github.com/Allenfp/BoxOps/tree/<SOURCE_COMMIT_SHA>/docs/a.md),
[a wrong anchor](https://github.com/Allenfp/BoxOps/blob/<SOURCE_COMMIT_SHA>/docs/a.md#nope).
`;

describe("the docs' link check", () => {
  it("passes this repository's Markdown as it is, from web/ as CI runs it", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: WEB, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "" } });
    expect(r.stderr).toBe("");
    expect(r.stdout).toMatch(/^\d+ Markdown files: every relative link and anchor resolves\.\n$/);
    expect(r.status).toBe(0);
  });

  it("finds every link that doesn't resolve, and only those", () => {
    const root = repo(
      { "README.md": README, "docs/a.md": DOC, "docs/with space.md": "# Spaced\n", "run.sh": "echo\n", "icon.svg": "<svg/>", "starter/README.md": STARTER },
      { "untracked.md": "# Not added\n" },
    );
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr.trimEnd().split("\n")).toEqual([
      "README.md:4: links to docs/missing.md, which git doesn’t track (docs/missing.md)",
      "README.md:4: links to #nope, which no heading of docs/a.md makes (docs/a.md#nope)",
      "README.md:4: links to #Second-Heading, which no heading of docs/a.md makes: GitHub’s anchors are lowercase (docs/a.md#Second-Heading)",
      "README.md:5: links to an anchor, #x, in a folder (docs#x)",
      "README.md:6: links to missing.png, which git doesn’t track (missing.png)",
      "README.md:7: links to #top in run.sh, which only has line anchors (#L12) (run.sh#top)",
      "README.md:8: links to ../x.md, outside the repository",
      "README.md:11: the text of the link to docs/a.md spans lines: GitHub says such a link won’t work; keep it on one line",
      "README.md:21: links to docs/missing-definition.md, which git doesn’t track (docs/missing-definition.md)",
      "README.md:22: links to untracked.md, which git doesn’t track (untracked.md)",
      "docs/a.md:29: links to #zzz, which no heading of docs/a.md makes (#zzz)",
      "docs/a.md:30: links to #not-a-heading-either, which no heading of docs/a.md makes (#not-a-heading-either)",
      "docs/a.md:31: links to #a-yaml-comment-in-front-matter-not-a-heading, which no heading of docs/a.md makes (#a-yaml-comment-in-front-matter-not-a-heading)",
      "starter/README.md:2: links to docs/nope.md, which git doesn’t track (https://github.com/Allenfp/BoxOps/blob/<SOURCE_COMMIT_SHA>/docs/nope.md)",
      "starter/README.md:3: links to docs as a file (blob), but it’s a folder: use tree (https://github.com/Allenfp/BoxOps/blob/<SOURCE_COMMIT_SHA>/docs)",
      "starter/README.md:5: links to docs/a.md as a folder (tree), but it’s a file: use blob (https://github.com/Allenfp/BoxOps/tree/<SOURCE_COMMIT_SHA>/docs/a.md)",
      "starter/README.md:6: links to #nope, which no heading of docs/a.md makes (https://github.com/Allenfp/BoxOps/blob/<SOURCE_COMMIT_SHA>/docs/a.md#nope)",
    ]);
  });

  it("annotates each problem in GitHub Actions, and says how it's run when it's run wrong", () => {
    const root = repo({ "README.md": "[gone](gone.md)\n" });
    const r = check(root, { GITHUB_ACTIONS: "true" });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("::error file=README.md,line=1,title=Docs link::links to gone.md, which git doesn’t track (gone.md)\n");
    expect(check(root, {}, ["--nope"])).toMatchObject({ code: 2, stderr: expect.stringContaining("Usage: node scripts/check-doc-links.mjs [--root DIR]") });
    expect(check(tempDir())).toMatchObject({ code: 2, stderr: expect.stringContaining("check-doc-links: ") });
    expect(check(repo({ "README.md": "[ok](#t)\n\n# T\n" }))).toMatchObject({ code: 0, stdout: "1 Markdown file: every relative link and anchor resolves.\n" });
  });

  it("makes a heading's anchor as GitHub does", () => {
    const text = [
      "# The command-line tool and the action",
      "## 0.2.0 — 2026-11-02",
      "## Café, naïve: snake_case (yes!)",
      "# A",
      "# A",
      "# A-1",
      "## `x/<y>.yaml`",
      "### [Link](a.md) and **bold**",
      "",
      "[1](#the-command-line-tool-and-the-action) [2](#020--2026-11-02) [3](#café-naïve-snake_case-yes)",
      "[4](#a) [5](#a-1) [6](#a-1-1) [7](#xyyaml) [8](#link-and-bold) [9](a.md#a-1-1)",
      "",
    ].join("\n");
    expect(check(repo({ "a.md": text }))).toMatchObject({ code: 0, stderr: "" });
  });
});

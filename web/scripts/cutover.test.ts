// The files staged in cutover/ (see its README) for the commit that moves the
// live demo to its own repository: each is the live file with the cutover's
// changes made and nothing else, so copying it over the live one then undoes
// no change made since. When a live file changes, this fails until its staged
// copy is made again: copy the live file over it, then make the changes below.
// The README names each doc that names npm run dev, validate or report, whose
// default folder the cutover changes, for the cutover commit to reword.
// The redirect the cutover publishes at allenfp.github.io/BoxOps/ is checked
// too: it keeps the address's query and hash, under its own CSP. So is the
// README's step 3, which makes the demo's history: it lists the history's
// addresses, maps those alone that the maintainer sets in OLD at the time
// (the README names none, being public), and the check after it names any
// other address left.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { scriptHash } from "../cli/csp";
import { cleanUp, tempDir } from "../cli/test-release";
import { SHELLS } from "../cli/test-shell";

/** A file's text, by its path from the repository's top level. */
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/**
 * Each staged file, by the path it replaces, and the cutover's changes to the
 * live one: [before, after]. null for a file the cutover replaces whole
 * (pages.yml) or adds (the redirect), which has no live version to follow.
 */
const STAGED: Record<string, [string, string][] | null> = {
  ".github/workflows/ci.yml": [
    [
      "# CI, the check every change gets: on pull requests and every push to a\n" +
        "# branch other than main (which pages.yml checks before deploying), by hand,\n" +
        "# weekly (main, and the latest release), and for a release (release.yml calls\n",
      "# CI, the check every change gets: on every pull request and push to main\n" +
        "# (pages.yml deploys main untested since the demo moved), by hand, weekly\n" +
        "# (main, and the latest release), and for a release (release.yml calls\n",
    ],
    [
      "#                 repository's, the starter's, Path B's, the cutover's) and\n",
      "#                 repository's, the starter's and Path B's) and\n",
    ],
    [
      "  push:\n" +
        "    branches-ignore: [main]\n",
      "  push:\n" +
        "    branches: [main]\n",
    ],
    [
      "# A newer push to the same branch or pull request replaces a run still going.\n" +
        "# A release's run, the weekly one and one by hand each have a group of their\n" +
        "# own, and are never cancelled.\n" +
        "concurrency:\n" +
        "  group: ci-${{ (github.event_name == 'push' || github.event_name == 'pull_request') && github.ref || github.run_id }}\n" +
        "  cancel-in-progress: ${{ github.event_name == 'push' || github.event_name == 'pull_request' }}\n",
      "# A newer push to a pull request replaces its run still going. A push to\n" +
        "# main, a release's run, the weekly one and one by hand each have a group of\n" +
        "# their own, and are never cancelled: a run on main may be the only test of\n" +
        "# what a merge made (the main ruleset doesn't make a pull request test main's\n" +
        "# latest commit first).\n" +
        "concurrency:\n" +
        "  group: ci-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}\n" +
        "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n",
    ],
    [
      "    # A pull request from a branch of this repo is already checked by the push\n" +
        "    # run on that branch, so only pull requests from forks run here.\n" +
        "    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name != github.repository\n",
      "",
    ],
    [
      "    name: release tree\n" +
        "    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name != github.repository\n",
      "    name: release tree\n",
    ],
    [
      "    name: workflows\n" +
        "    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name != github.repository\n",
      "    name: workflows\n",
    ],
    [
      "      # starter's files; then the site it writes from the starter's roadmap at\n" +
        "      # this commit, and from roadmap/ (the demo's, as pages.yml writes it,\n" +
        "      # until the cutover moves it).\n" +
        "      - name: The release's tool on the starter, and the sites it writes\n",
      "      # starter's files; then the site it writes from the starter's roadmap at\n" +
        "      # this commit.\n" +
        "      - name: The release's tool on the starter, and the site it writes\n",
    ],
    [
      '          node ../build/release/dist/boxops.mjs build --out "$RUNNER_TEMP/demo-site"\n',
      "",
    ],
    [
      "      - name: Lint the workflows (this repository's, the starter's, Path B's, the cutover's)\n",
      "      - name: Lint the workflows (this repository's, the starter's and Path B's)\n",
    ],
    [
      " templates/path-b/*.yml cutover/.github/workflows/*.yml\n",
      " templates/path-b/*.yml\n",
    ],
  ],
  ".github/dependabot.yml": [["      - /cutover/.github/workflows\n", ""]],
  ".github/workflows/pages.yml": null,
  "pages/redirect.html": null,
  "web/vite.config.ts": [
    ["else this repo's roadmap/. */", "else the browser tests' roadmap (e2e/fixtures/roadmap). */"],
    ['  : resolve(REPO_DIR, "roadmap");', '  : resolve(WEB_DIR, "e2e/fixtures/roadmap");'],
  ],
  "web/scripts/roadmap-dir.ts": [
    [
      "// only argument (`npm run validate -- <dir>`), else ../roadmap. The folder is\n" +
        "// read from disk with cli/git.ts's reader: a symlink, a file that isn't UTF-8\n" +
        "// or one over the size limits stops the check (exit 1) before anything is\n" +
        "// validated.\n",
      "// only argument (`npm run validate -- <dir>`), else the browser tests' roadmap\n" +
        "// (e2e/fixtures/roadmap). The folder is read from disk with cli/git.ts's\n" +
        "// reader: a symlink, a file that isn't UTF-8 or one over the size limits stops\n" +
        "// the check (exit 1) before anything is validated.\n",
    ],
    ["(default: ../roadmap)`", "(default: e2e/fixtures/roadmap)`"],
    ['resolve("../roadmap")', 'resolve("e2e/fixtures/roadmap")'],
  ],
  "web/scripts/workflows.test.ts": [
    [
      "// The rules every workflow here keeps (this repository's, the starter's, Path\n" +
        "// B's and the cutover's): no permissions but what each job asks for, a time\n",
      "// The rules every workflow here keeps (this repository's, the starter's and\n" +
        "// Path B's): no permissions but what each job asks for, a time\n",
    ],
    [' "templates/path-b", "cutover/.github/workflows"]', ' "templates/path-b"]'],
    [`it("is found: this repository's, the starter's, Path B's and the cutover's"`, `it("is found: this repository's, the starter's and Path B's"`],
    ['        "cutover/.github/workflows/pages.yml",\n', ""],
  ],
};

/** Every file git tracks under cutover/ but its README (not a .DS_Store Finder left), by the path it replaces. */
function stagedFiles(): string[] {
  const listed = execFileSync("git", ["ls-files", "-z", "--", "cutover"], { cwd: new URL("../..", import.meta.url), encoding: "utf8" });
  return listed
    .split("\0")
    .filter((path) => path && path !== "cutover/README.md")
    .map((path) => path.slice("cutover/".length))
    .sort();
}

describe("the files staged for the cutover (cutover/)", () => {
  for (const [path, changes] of Object.entries(STAGED)) {
    if (changes === null) continue;
    it(`stages ${path}: the live file with the cutover's changes, and nothing else`, () => {
      let expected = read(path);
      for (const [before, after] of changes) {
        expect(expected.split(before).length - 1, `${path} holds “${before}” once`).toBe(1);
        expected = expected.replace(before, () => after);
      }
      expect(read(`cutover/${path}`), `cutover/${path} is out of date: copy ${path} over it, then make this test's changes again`).toBe(expected);
    });
  }

  it("stages the redirect: on to the demo with the address's query and hash, its one script allowed by hash", () => {
    const html = read("cutover/pages/redirect.html");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(1);
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)" \/>/.exec(html)?.[1];
    expect(policy).toBe(`default-src 'none'; script-src ${scriptHash(scripts[0])}; base-uri 'none'; form-action 'none'; object-src 'none'`);
    // Before anything it governs, and <meta charset> in the first 1024 bytes.
    expect(html.indexOf('<meta charset="UTF-8" />')).toBeLessThan(1024);
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script>"));
    const went: string[] = [];
    for (const [search, hash] of [["?view=table", "#bx-1a2b"], ["", ""], ["?zoom=weeks&ref=x", ""]]) {
      runInNewContext(scripts[0], { location: { search, hash, replace: (url: string) => went.push(url) } });
    }
    expect(went).toEqual(["/boxops-demo/?view=table#bx-1a2b", "/boxops-demo/", "/boxops-demo/?zoom=weeks&ref=x"]);
    // Without script, links on: to the demo and the starter.
    expect(html).toContain('<a href="https://allenfp.github.io/boxops-demo/">');
    expect(html).toContain('<a href="https://github.com/Allenfp/boxops-starter">');
    // The staged pages.yml publishes it as the site's index.html.
    expect(read("cutover/.github/workflows/pages.yml")).toContain("cp pages/redirect.html _site/index.html");
  });

  it("stages only those, and its README names each", () => {
    expect(stagedFiles(), "the files git tracks in cutover/ (git add a new one)").toEqual(Object.keys(STAGED).sort());
    const readme = read("cutover/README.md");
    for (const path of Object.keys(STAGED)) expect(readme).toContain(`\`${path}\``);
  });

  it("has its README name each doc that names npm run dev, validate or report, for the cutover commit to reword", () => {
    // The staged vite.config.ts and roadmap-dir.ts move what those read by default from roadmap/, which
    // the cutover commit deletes, to the browser tests' roadmap. A doc of this repository that names one
    // (not starter/'s or templates/', which are a roadmap repository's) changes in that commit too.
    const listed = execFileSync("git", ["ls-files", "-z", "--", "*.md", ":!cutover", ":!starter", ":!templates"], { cwd: new URL("../..", import.meta.url), encoding: "utf8" });
    const docs = listed.split("\0").filter((path) => path && /\bnpm run (?:dev|validate|report)\b/.test(read(path)));
    expect(docs).toContain("README.md");
    const readme = read("cutover/README.md");
    expect(docs.filter((path) => !readme.includes(`\`${path}\``)), "docs the cutover README should say what the cutover commit changes in").toEqual([]);
  });
});

describe("the demo's history, as its README's step 3 has it made (before the cutover commit)", () => {
  afterEach(cleanUp);

  /** A GitHub no-reply address: one the demo's public history may keep. */
  const noReply = (address: string) => address.endsWith("@users.noreply.github.com") || address === "noreply@github.com";

  it("names no address but GitHub's no-reply ones: the maintainer's own are set in OLD at the time", () => {
    // An SSH remote's user, git@ (git@github.com:Allenfp/boxops-demo.git), is no one's address.
    const named = new Set(read("cutover/README.md").match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g));
    expect([...named].filter((address) => !noReply(address) && !address.startsWith("git@"))).toEqual([]);
  });

  it("lists the history's addresses, maps those set in OLD alone, and its check names any other left, for a decision by hand", () => {
    const readme = read("cutover/README.md");
    // The first block: the clone, then the addresses of every commit of it but GitHub's no-reply ones.
    const first = /```sh\n(\s*git clone --no-local [^\n]* boxops-demo && cd boxops-demo &&[\s\S]*?)```/.exec(readme)?.[1] ?? "";
    const list = first.slice(first.indexOf("cd boxops-demo &&") + "cd boxops-demo &&".length).trim();
    // The next: ../demo-mailmap written from $OLD, then filter-repo, then the check.
    const second = /```sh\n([^`]*\.\.\/demo-mailmap[\s\S]*?)```/.exec(readme)?.[1] ?? "";
    const mailmap = second.split("git filter-repo")[0].trim().replace(/&&$/, "");
    // The check, given the addresses as the mailmap makes them: git's own reading of it (%aE, %cE)
    // stands in for filter-repo's rewrite, which this machine needn't have. Both match an address
    // whatever its case.
    const awk = /awk '[^']*still in the history[^']*'/.exec(readme)?.[0] ?? "";
    expect([list.includes("git log --all"), mailmap.includes('"$OLD"') && mailmap.includes(">../demo-mailmap"), awk !== ""]).toEqual([true, true, true]);
    // Example addresses: the maintainer's own in the history, one of them in two spellings; and OLD as
    // they'd set it at the time, that one in one spelling, as typed, its spaces and all.
    const own = ["old@example.com", "Old@example.com", "older@example.org"];
    const set = [own[0], own[2]];
    const OLD = `  ${set[0]}  \t${set[1]} `;
    const noreply = "29790605+Allenfp@users.noreply.github.com";
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "x", GIT_COMMITTER_NAME: "x", OLD };
    /** A clone, boxops-demo in a folder of its own, whose commits on main have these authors and committers, and one more on another branch. */
    const clone = (people: [string, string][], branch: string) => {
      const dir = join(tempDir(), "boxops-demo");
      execFileSync("git", ["init", "-q", "-b", "main", dir], { env });
      const commit = (author: string, committer: string) =>
        execFileSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "x"], { env: { ...env, GIT_AUTHOR_EMAIL: author, GIT_COMMITTER_EMAIL: committer } });
      for (const [author, committer] of people) commit(author, committer);
      execFileSync("git", ["-C", dir, "switch", "-q", "-c", "elsewhere"], { env });
      commit(branch, branch);
      execFileSync("git", ["-C", dir, "switch", "-q", "main"], { env });
      return dir;
    };
    // The maintainer's, GitHub's (a save, an edit on its site), and others' at the same domains.
    const ours: [string, string][] = [
      [own[0], own[0]],
      [own[1], "noreply@github.com"],
      [own[2], own[2]],
      [noreply, "noreply@github.com"],
    ];
    const others: [string, string][] = [
      ["a-teammate@example.org", "noreply@github.com"],
      ["someone-else@example.com", "someone-else@example.com"],
    ];
    for (const shell of SHELLS) {
      const sh = (cwd: string, script: string) => spawnSync(shell[0], [...shell.slice(1), "-c", script], { cwd, encoding: "utf8", env });
      for (const [people, left] of [
        [ours, []],
        [[...ours, ...others], ["a-teammate@example.org", "someone-else@example.com"]],
      ] as [[string, string][], string[]][]) {
        const dir = clone(people, "on-a-branch@example.net");
        const map = join(dir, "..", "demo-mailmap");
        // Every address of every commit, on any branch, but GitHub's no-reply ones.
        const listed = sh(dir, list);
        const all = [...people.flat(), "on-a-branch@example.net"].filter((address) => !noReply(address));
        expect([shell[0], left, listed.status, listed.stdout.trim().split("\n").sort()]).toEqual([shell[0], left, 0, [...new Set(all)].sort()]);
        // The mailmap: OLD's addresses alone, each mapped to the no-reply address.
        expect(sh(dir, mailmap).status).toBe(0);
        expect([shell[0], left, readFileSync(map, "utf8").trim().split("\n").sort()]).toEqual([shell[0], left, set.map((a) => `<${noreply}> <${a}>`).sort()]);
        const r = sh(dir, `git -c mailmap.file='${map}' log --format='%aE%n%cE' | sort -u | ${awk}`);
        expect([shell[0], left, r.status, r.stdout]).toEqual([shell[0], left, left.length ? 1 : 0, left.map((a) => `still in the history: ${a}\n`).join("")]);
      }
    }
  });
});

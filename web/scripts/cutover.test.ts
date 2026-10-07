// The files staged in cutover/ (see its README) for the commit that moves the
// live demo to its own repository: each is the live file with the cutover's
// changes made and nothing else, so copying it over the live one then undoes
// no change made since. When a live file changes, this fails until its staged
// copy is made again: copy the live file over it, then make the changes below.
// The redirect the cutover publishes at allenfp.github.io/BoxOps/ is checked
// too: it keeps the address's query and hash, under its own CSP.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { scriptHash } from "../cli/csp";

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
});

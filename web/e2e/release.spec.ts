// The command-line tool and the app of the build under test, together
// (e2e/app-dir.ts: with $BOXOPS_RELEASE_DIR, a release tree's, as CI runs
// it): the roadmap.json the tool writes (`build`, the action's code) for a
// repository holding the browser tests' roadmap is the one the fake GitHub
// serves every other test, but for what only a real commit has (its id,
// author, date); the site it writes is the app under test, byte for byte,
// plus that roadmap.json; and the app opens it, asking GitHub nothing (a
// private repository and no token).

import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readRoadmapDir } from "../cli/git";
import { TestRepo } from "../cli/test-repo";
import type { Bundle } from "../src/model/bundle";
import { APP_DIR, CLI } from "./app-dir";
import { FakeGitHub, REPO } from "./fake-github";
import { expect, morningIn, test } from "./helpers";

const FIXTURE = fileURLToPath(new URL("./fixtures/roadmap", import.meta.url));

/** Every file under `dir`, "/"-separated, sorted. */
function walk(dir: string, rel = ""): string[] {
  return readdirSync(join(dir, rel))
    .sort()
    .flatMap((name) => {
      const path = rel ? `${rel}/${name}` : name;
      return lstatSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path];
    });
}

test("the tool writes the roadmap.json the tests serve, beside the app under test, which opens it", async ({ page, timezoneId }) => {
  const { files } = await readRoadmapDir(FIXTURE);
  const repo = new TestRepo();
  const work = mkdtempSync(join(tmpdir(), "boxops-e2e-"));
  try {
    repo.commit({ "README.md": "# Roadmap\n", ...Object.fromEntries(Object.entries(files).map(([path, text]) => [`roadmap/${path}`, text])) }, "Initial roadmap");
    repo.checkout();
    repo.git(["remote", "add", "origin", `https://github.com/${REPO}.git`]);
    const site = join(work, "site");
    // As on a laptop: no GitHub Actions variables from the shell running the tests.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GITHUB_") && !key.startsWith("BOXOPS_")));
    const said = execFileSync(process.execPath, [CLI, "build", "--root", repo.dir, "--out", site], { encoding: "utf8", env: { ...env, GITHUB_ACTIONS: "" } });
    expect(said).toContain("— OK");

    // The tool's roadmap.json is the fake's for the same files.
    const written = readFileSync(join(site, "roadmap.json"));
    const tool = JSON.parse(written.toString("utf8")) as Bundle;
    const github = await FakeGitHub.create(undefined, { visibility: "private" });
    const fake = await github.bundle(github.head);
    const { source: toolSource, parsed: toolParsed, ...toolRest } = tool;
    const { source: fakeSource, parsed: fakeParsed, ...fakeRest } = fake;
    expect(toolRest).toEqual(fakeRest);
    // A build with uncommitted changes (".dirty") leaves `parsed` out; the fake always has it.
    if (toolParsed) expect(toolParsed).toEqual(fakeParsed);
    const shared = (s: Bundle["source"]) => ({ repo: s.repo, dir: s.dir, tree: s.tree, private: s.private, readonly: s.readonly, local: s.local });
    expect(shared(toolSource)).toEqual(shared(fakeSource));
    expect(toolSource.commit).toBe(repo.git(["rev-parse", "HEAD"]));
    expect(toolSource.tree).toBe(repo.git(["rev-parse", "HEAD:roadmap"]));

    // The site is the app under test, byte for byte, and that roadmap.json.
    const app = walk(APP_DIR);
    expect(walk(site)).toEqual([...app, "roadmap.json"].sort());
    for (const path of app) expect(readFileSync(join(site, path)).equals(readFileSync(join(APP_DIR, path))), path).toBe(true);

    // The app opens it.
    const calls: string[] = [];
    await page.route(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, (route) => {
      calls.push(route.request().url());
      return route.abort();
    });
    await page.route("**/roadmap.json*", (route) => route.fulfill({ contentType: "application/json", body: written }));
    await page.clock.install({ time: morningIn(timezoneId) });
    await page.goto("./?zoom=months");
    await expect(page.locator(".box:not(.compact)")).toHaveCount(12); // as timeline.spec.ts: ML Platform starts collapsed
    await expect(page).toHaveTitle("BoxOps Roadmap");
    expect(calls, "calls to GitHub, for a private repository without a token").toEqual([]);
  } finally {
    repo.remove();
    rmSync(work, { recursive: true, force: true });
  }
});

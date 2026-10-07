// `npm run dry-run:starter`: a roadmap repository made from the starter, end
// to end on this machine and without the network, against a release built
// from this checkout (the npm script builds the app and the tool first), or
// the release tree in $BOXOPS_RELEASE_DIR (npm run release:build's, relative
// to web/), as CI runs it:
//
//   1. The release: that release tree, or web/dist laid out as a release
//      commit is (action.yml, BUILD.json, dist/boxops.mjs, dist/action.mjs,
//      dist/app/**), each file checked against BUILD.json, committed to the
//      `releases` branch of a stand-in for github.com, which git is told to
//      fetch from.
//   2. The starter, written by the release's own `init` (its two calls to
//      GitHub answered from the stand-in) and the same as cli/starter.ts
//      makes it; then `git init` and a first commit.
//   3. The launcher, with BOXOPS_CLI set to the release's tool: version,
//      validate, report, guide, sync --check, migrate --check, build, and
//      preview (fetched, a file edited on disk, fetched again).
//   4. The action as `uses:` runs it: dist/action.mjs with the runner's
//      INPUT_* variables, a push event's payload and a releases file naming a
//      newer security release; then in check mode.
//   5. Path B: its deploy step's script, run with bash, fetching the release
//      by commit from the stand-in; it assembles the same site.
//   6. WebKit (Playwright) on the site the action assembled, served as Pages
//      serves it, and on the preview: the app shows the roadmap (and the
//      security notice), with no error, no Content-Security-Policy violation
//      and no request off this machine; the preview shows a saved edit.
//
// Every Node process it starts runs with the network cut off: a module given
// to --import (scripts/smoke/no-net.mjs) makes sockets, DNS, HTTP and fetch
// fail and notes each try (only init's two calls are answered, by the
// stand-in). None may try. Each
// step prints "ok"; the first that fails stops it, keeping its folder in the
// temp folder to look at (--keep keeps it anyway).

import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { type Server, createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webkit } from "@playwright/test";
import { parse } from "yaml";
import { starterFiles } from "../cli/embedded.ts";
import { rewritePins } from "../cli/pins.ts";
import { type BuildJson, digest, parseBuildJson } from "../cli/release.ts";
import { renderStarter } from "../cli/starter.ts";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const REPO = resolve(WEB, "..");
const DIST = join(WEB, "dist");
/** A release tree to use in place of web/dist laid out as one. */
const RELEASE_DIR = process.env.BOXOPS_RELEASE_DIR ? resolve(WEB, process.env.BOXOPS_RELEASE_DIR) : null;
const UPSTREAM = "Allenfp/BoxOps";

/** Cuts a Node process off the network, noting each try (scripts/smoke/no-net.mjs: init's two calls are answered from a table). */
const NET_MODULE = join(WEB, "scripts", "smoke", "no-net.mjs");

let failed = false;
let n = 0;

/** A step: prints its title, runs it, prints ok (or what went wrong, and stops the run). */
async function step(title: string, run: () => unknown): Promise<void> {
  n++;
  process.stdout.write(`${n}. ${title} … `);
  await run();
  console.log("ok");
}

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(what);
}

function same(actual: unknown, expected: unknown, what: string): void {
  const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
  check(a === e, `${what}: got ${a.slice(0, 600)}, expected ${e.slice(0, 600)}`);
}

/** Every file under `dir`, "/"-separated, relative to it, sorted. */
function walk(dir: string, rel = ""): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((e) => (e.isDirectory() ? walk(dir, rel ? `${rel}/${e.name}` : e.name) : [rel ? `${rel}/${e.name}` : e.name]));
}

/** $GITHUB_OUTPUT as the runner reads it (the action writes heredocs only). */
function outputs(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([^<]+)<<(.+)$/.exec(lines[i]);
    if (!m) continue;
    const value: string[] = [];
    for (i++; i < lines.length && lines[i] !== m[2]; i++) value.push(lines[i]);
    out[m[1]] = value.join("\n");
  }
  return out;
}

/** Serves `dir`'s files on 127.0.0.1, as Pages serves a site (index.html for a folder); resolves to its address. */
async function serve(dir: string): Promise<{ url: string; server: Server }> {
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain" };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://site").pathname);
    const file = resolve(dir, `.${path.endsWith("/") ? `${path}index.html` : path}`);
    try {
      if (!file.startsWith(dir + sep)) throw new Error("outside");
      const body = readFileSync(file);
      res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, server };
}

/** GET a URL on this machine: status and body. */
function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((done, reject) => {
    request(url, (res) => {
      let body = "";
      res.setEncoding("utf8").on("data", (d) => (body += d));
      res.on("end", () => done({ status: res.statusCode ?? 0, body }));
    })
      .on("error", reject)
      .end();
  });
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function main(): Promise<number> {
  const keep = process.argv.includes("--keep");
  const work = realpathSync(mkdtempSync(join(tmpdir(), "boxops-dry-run-")));
  const nodeDir = dirname(process.execPath);
  for (const d of ["home", "tmp", "runner-temp", "runner-temp-b"]) mkdirSync(join(work, d));
  const netLog = join(work, "net.log");
  const githubLog = join(work, "github.log");
  writeFileSync(netLog, "");
  writeFileSync(githubLog, "");
  /** A bare environment: nothing of this shell's (no token, no proxy, no git configuration). */
  const bare = { PATH: `${nodeDir}:/usr/bin:/bin`, HOME: join(work, "home"), TMPDIR: join(work, "tmp"), LANG: "en_US.UTF-8", BOXOPS_NO_NET_LOG: netLog, BOXOPS_NO_NET_ANSWERED: githubLog };
  const nodeArgs = ["--import", pathToFileURL(NET_MODULE).href];
  const git = (cwd: string, args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...bare, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Dry Run", GIT_AUTHOR_EMAIL: "dry-run@example.com", GIT_COMMITTER_NAME: "Dry Run", GIT_COMMITTER_EMAIL: "dry-run@example.com" },
    }).trim();
  const node = (cwd: string, args: string[], env: Record<string, string> = {}) => spawnSync(process.execPath, [...nodeArgs, ...args], { cwd, encoding: "utf8", env: { ...bare, ...env } });
  let preview: ChildProcess | undefined;
  const servers: Server[] = [];

  try {
    const release = RELEASE_DIR ?? join(work, "release");
    let build: BuildJson | undefined;
    let sha = "";
    const tag = () => `v${build?.version}`;

    const what = RELEASE_DIR ? `the release tree in ${relative(process.cwd(), RELEASE_DIR) || "."}` : "web/dist laid out as a release commit";
    await step(`The release: ${what}, every file as BUILD.json says`, () => {
      if (RELEASE_DIR) {
        build = parseBuildJson(readFileSync(join(release, "BUILD.json"), "utf8"));
        for (const [path, want] of Object.entries(build.files)) check(digest(readFileSync(join(release, path))) === want, `${path} isn't the file BUILD.json describes`);
        same(walk(release).filter((p) => p !== "BUILD.json").sort(), Object.keys(build.files).sort(), "the release's files");
      } else {
        build = parseBuildJson(readFileSync(join(DIST, "BUILD.json"), "utf8"));
        for (const [path, want] of Object.entries(build.files)) {
          const to = join(release, path);
          mkdirSync(dirname(to), { recursive: true });
          copyFileSync(join(DIST, path.slice("dist/".length)), to);
          check(digest(readFileSync(to)) === want, `${path} isn't the file BUILD.json describes: run npm run build and npm run build:cli again`);
        }
        copyFileSync(join(DIST, "BUILD.json"), join(release, "BUILD.json"));
        copyFileSync(join(REPO, "release", "action.yml"), join(release, "action.yml"));
      }
      check(readFileSync(join(release, "dist", "app", "index.html"), "utf8").includes(`<meta name="boxops-build" content="${build.build}"`), "dist/app is another build than BUILD.json's");
      const app = walk(join(release, "dist", "app")).map((p) => `dist/app/${p}`);
      same(app, Object.keys(build.files).filter((p) => p.startsWith("dist/app/")), "the app's files");
    });

    const github = join(work, "github");
    await step("…committed to `releases` of a stand-in for github.com", () => {
      const bareRepo = join(github, UPSTREAM);
      mkdirSync(bareRepo, { recursive: true });
      git(bareRepo, ["init", "-q", "--bare", "-b", "releases"]);
      git(release, ["--git-dir", bareRepo, "--work-tree", release, "add", "-A"]);
      git(release, ["--git-dir", bareRepo, "--work-tree", release, "commit", "-q", "-m", `BoxOps ${build?.version}`]);
      sha = git(bareRepo, ["rev-parse", "refs/heads/releases"]);
      writeFileSync(join(work, "gitconfig"), `[url "file://${github}/"]\n\tinsteadOf = https://github.com/\n`);
    });

    const roadmap = join(work, "acme-roadmap");
    await step("The starter, from the release's init: what cli/starter.ts makes for the release", () => {
      const ref = join(work, "ref.json");
      writeFileSync(ref, JSON.stringify({ ref: `refs/tags/${tag()}`, object: { type: "commit", sha } }));
      writeFileSync(
        join(work, "github.json"),
        JSON.stringify({
          [`https://api.github.com/repos/${UPSTREAM}/git/ref/tags/${tag()}`]: ref,
          [`https://raw.githubusercontent.com/${UPSTREAM}/${sha}/BUILD.json`]: join(release, "BUILD.json"),
        }),
      );
      const r = node(work, [join(release, "dist", "boxops.mjs"), "init", "acme-roadmap"], { BOXOPS_NO_NET_TABLE: join(work, "github.json") });
      check(r.status === 0, `init exited ${r.status}: ${r.stderr}`);
      const made = renderStarter(starterFiles(), { repo: UPSTREAM, sha, tag: tag(), source: build?.source ?? "" });
      same(Object.fromEntries(walk(roadmap).map((p) => [p, readFileSync(join(roadmap, p), "utf8")])), made, "init's files");
      git(roadmap, ["init", "-q", "-b", "main"]);
      git(roadmap, ["remote", "add", "origin", "https://github.com/acme/roadmap.git"]);
      git(roadmap, ["add", "-A"]);
      git(roadmap, ["commit", "-q", "-m", `Start roadmap from BoxOps ${tag()}`]);
    });
    const head = git(roadmap, ["rev-parse", "HEAD"]);

    const launch = (args: string[]) => node(roadmap, [join(roadmap, ".boxops", "boxops.mjs"), ...args], { BOXOPS_CLI: join(release, "dist", "boxops.mjs") });
    await step("The launcher (BOXOPS_CLI): version, validate, report, guide, sync --check, migrate --check, build", () => {
      const run = (args: string[]) => {
        const r = launch(args);
        check(r.status === 0, `${args.join(" ")} exited ${r.status}: ${r.stderr.trim()}`);
        check(r.stderr.trim() === "", `${args.join(" ")} said on stderr: ${r.stderr.trim()}`);
        return r.stdout.trim();
      };
      same(run(["version"]), `BoxOps ${build?.version} (${UPSTREAM}@${sha.slice(0, 7)}, build ${build?.build}, data format ${build?.format})`, "version");
      same(run(["validate"]), "1 departments, 2 lanes, 2 boxes — OK", "validate");
      check(run(["report"]).startsWith("Departments\n  Engineering (engineering): 2 FTE of lanes, 2 boxes"), "report's first lines");
      check(run(["guide"]).startsWith(`BoxOps ${build?.version}: the guide for this release.`), "guide");
      for (const topic of ["overview", "recipes", "commits", "format", "upgrading"]) check(run(["guide", topic]).startsWith("# BoxOps guide: "), `guide ${topic}`);
      check(run(["sync", "--check"]).includes("are this release’s"), "sync --check");
      run(["migrate", "--check"]);
      run(["build", "--out", join(work, "site-build")]);
      for (const p of walk(join(release, "dist", "app"))) {
        check(readFileSync(join(work, "site-build", p)).equals(readFileSync(join(release, "dist", "app", p))), `build's ${p} isn't the release's`);
      }
      same(JSON.parse(readFileSync(join(work, "site-build", "roadmap.json"), "utf8")).source.commit, head, "build's roadmap.json commit");
    });

    let previewUrl = "";
    await step("The launcher's preview: the working tree's roadmap, live", async () => {
      preview = spawn(process.execPath, [...nodeArgs, join(roadmap, ".boxops", "boxops.mjs"), "preview", "--port", "0"], {
        cwd: roadmap,
        env: { ...bare, BOXOPS_CLI: join(release, "dist", "boxops.mjs") },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let said = "";
      preview.stdout?.setEncoding("utf8").on("data", (d: string) => (said += d));
      preview.stderr?.setEncoding("utf8").on("data", (d: string) => (said += d));
      for (let i = 0; i < 100 && !/http:\/\/127\.0\.0\.1:\d+\//.test(said); i++) await sleep(100);
      previewUrl = /http:\/\/127\.0\.0\.1:\d+\//.exec(said)?.[0] ?? "";
      check(previewUrl !== "", `preview didn't say where it is: ${said}`);
      const first = JSON.parse((await get(`${previewUrl}roadmap.json`)).body);
      same([first.source.local, first.app.build], [true, build?.build], "the preview's roadmap.json");
    });

    const event = join(work, "event.json");
    writeFileSync(event, JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "acme/roadmap", default_branch: "main", private: true, visibility: "private" } }));
    const releases = [
      { tag_name: "v9.9.9", name: "Security: BoxOps 9.9.9", prerelease: false },
      { tag_name: tag(), name: `BoxOps ${build?.version}`, prerelease: false },
    ];
    writeFileSync(join(work, "runner-temp", "boxops-releases.json"), JSON.stringify(releases));
    writeFileSync(join(work, "runner-temp-b", "boxops-releases.json"), JSON.stringify(releases));
    /** What the runner gives every step of a push to main's run. */
    const actions = (temp: string, out: string) => ({
      GITHUB_ACTIONS: "true",
      CI: "true",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_API_URL: "https://api.github.com",
      GITHUB_REPOSITORY: "acme/roadmap",
      GITHUB_REF: "refs/heads/main",
      GITHUB_REF_NAME: "main",
      GITHUB_REF_TYPE: "branch",
      GITHUB_EVENT_NAME: "push",
      GITHUB_EVENT_PATH: event,
      GITHUB_SHA: head,
      GITHUB_WORKSPACE: roadmap,
      GITHUB_RUN_ID: "1",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_OUTPUT: join(out, "output"),
      GITHUB_STEP_SUMMARY: join(out, "summary"),
      RUNNER_OS: "Linux",
      RUNNER_TEMP: temp,
    });
    const actionOut = join(work, "action");
    let site = "";
    await step("The action, as uses: runs it: inputs, a push event, a releases file with a newer security release", () => {
      mkdirSync(actionOut);
      writeFileSync(join(actionOut, "output"), "");
      writeFileSync(join(actionOut, "summary"), "");
      const inputs = {
        INPUT_MODE: "build",
        INPUT_ROADMAP: "roadmap",
        INPUT_PATH: ".",
        "INPUT_ON-PROBLEMS": "deploy",
        "INPUT_RELEASES-FILE": join(work, "runner-temp", "boxops-releases.json"),
        "INPUT_READ-ONLY": "false",
        INPUT_REPOSITORY: "acme/roadmap",
        INPUT_SUMMARY: "true",
      };
      const r = node(roadmap, [join(release, "dist", "action.mjs")], { ...actions(join(work, "runner-temp"), actionOut), ...inputs, GITHUB_ACTION_REF: sha, GITHUB_ACTION_REPOSITORY: UPSTREAM });
      check(r.status === 0, `the action exited ${r.status}: ${r.stdout}${r.stderr}`);
      check(/^::warning title=BoxOps::BoxOps v9\.9\.9 /m.test(r.stdout), `no warning of the security release: ${r.stdout}`);
      const out = outputs(join(actionOut, "output"));
      site = out.site;
      same(
        [out.site, out.version, out.build, out.format, out.commit, out.problems, out.result],
        [join(work, "runner-temp", "boxops-site"), build?.version, build?.build, "1", head, "0", "1 departments, 2 lanes, 2 boxes — OK"],
        "the action's outputs",
      );
      check(readFileSync(join(actionOut, "summary"), "utf8").startsWith(`### BoxOps ${build?.version}`), "the job summary");
      same(walk(site).sort(), [...walk(join(release, "dist", "app")), "roadmap.json"].sort(), "the site's files");
      for (const p of walk(join(release, "dist", "app"))) check(readFileSync(join(site, p)).equals(readFileSync(join(release, "dist", "app", p))), `the site's ${p} isn't the release's`);
      const bundle = JSON.parse(readFileSync(join(site, "roadmap.json"), "utf8"));
      same(
        [bundle.schema, bundle.format, bundle.app.build, bundle.source.repo, bundle.source.branch, bundle.source.commit, bundle.source.private, bundle.source.readonly, bundle.notices[0]?.level],
        [1, 1, build?.build, "acme/roadmap", "main", head, true, false, "security"],
        "roadmap.json",
      );
      const check_ = node(roadmap, [join(release, "dist", "action.mjs")], { ...actions(join(work, "runner-temp"), actionOut), ...inputs, INPUT_MODE: "check", GITHUB_EVENT_NAME: "pull_request" });
      check(check_.status === 0, `check mode exited ${check_.status}: ${check_.stdout}`);
    });

    await step("Path B: its deploy step fetches the release by commit with git and assembles the same site", () => {
      const pathB = rewritePins(readFileSync(join(REPO, "templates", "path-b", "deploy.yml"), "utf8"), sha, tag());
      const steps = (parse(pathB) as { jobs: { build: { steps: { env?: Record<string, string>; run?: string }[] } } }).jobs.build.steps;
      const boxops = steps.find((s) => s.env?.BOXOPS_ACTION);
      check(boxops?.env?.BOXOPS_ACTION === `${UPSTREAM}@${sha}`, "Path B's pin");
      const out = join(work, "path-b");
      mkdirSync(out);
      writeFileSync(join(out, "output"), "");
      writeFileSync(join(out, "summary"), "");
      writeFileSync(join(out, "step.sh"), boxops?.run ?? "");
      const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", join(out, "step.sh")], {
        cwd: roadmap,
        encoding: "utf8",
        env: {
          ...bare,
          ...actions(join(work, "runner-temp-b"), out),
          BOXOPS_ACTION: boxops?.env?.BOXOPS_ACTION ?? "",
          GIT_CONFIG_GLOBAL: join(work, "gitconfig"),
          GIT_CONFIG_NOSYSTEM: "1",
          NODE_OPTIONS: `--import=${pathToFileURL(NET_MODULE).href}`,
        },
      });
      check(r.status === 0, `Path B's step exited ${r.status}: ${r.stdout}${r.stderr}`);
      const siteB = outputs(join(out, "output")).site;
      same(siteB, join(work, "runner-temp-b", "boxops-site"), "Path B's site output");
      same(walk(siteB), walk(site), "Path B's site's files");
      for (const p of walk(site)) check(readFileSync(join(siteB, p)).equals(readFileSync(join(site, p))), `Path B's ${p} differs from the action's`);
    });

    await step("WebKit: the site, served as Pages would, and the preview, with nothing fetched off this machine", async () => {
      const served = await serve(site);
      servers.push(served.server);
      const browser = await webkit.launch();
      try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const offsite: string[] = [];
        const errors: string[] = [];
        await context.route("**/*", (route) => {
          if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
          offsite.push(route.request().url());
          return route.abort();
        });
        await context.addInitScript(() =>
          document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || "inline code"}`)),
        );
        context.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text());
        });
        context.on("weberror", (e) => errors.push(e.error().message));
        context.setDefaultTimeout(20_000);

        const page = await context.newPage();
        await page.goto(served.url);
        await page.locator('[data-box-id="bx-1a2b-example-project"]').first().waitFor();
        await page.waitForFunction(() => document.title === "Our roadmap");
        const notice = (await page.locator(".banner.notice-security").textContent()) ?? "";
        check(notice.includes("v9.9.9"), `the security notice: “${notice}”`);
        await sleep(1500);

        const live = await context.newPage();
        await live.goto(previewUrl);
        const name = live.locator('[data-box-id="bx-1a2b-example-project"] .box-name').first();
        await name.waitFor();
        const file = join(roadmap, "roadmap", "boxes", "bx-1a2b-example-project.yaml");
        writeFileSync(file, readFileSync(file, "utf8").replace("title: Example project (delete me)", "title: Edited on disk"));
        await live.waitForFunction(() => document.querySelector('[data-box-id="bx-1a2b-example-project"] .box-name')?.textContent?.includes("Edited on disk"), undefined, { timeout: 5000 });
        await sleep(500);
        same(offsite, [], "requests off this machine");
        same(errors, [], "errors in the page");
      } finally {
        await browser.close();
      }
    });

    await step("No Node process tried the network; init asked the stand-in only for the tag and BUILD.json", () => {
      same(readFileSync(netLog, "utf8").split("\n").filter(Boolean), [], "network tries");
      same(readFileSync(githubLog, "utf8").split("\n").filter(Boolean), [`https://api.github.com/repos/${UPSTREAM}/git/ref/tags/${tag()}`, `https://raw.githubusercontent.com/${UPSTREAM}/${sha}/BUILD.json`], "init's calls");
    });
    console.log(`\nThe starter's dry run passed: BoxOps ${build?.build} (${relative(REPO, RELEASE_DIR ?? DIST)}), release commit ${sha.slice(0, 12)}.`);
  } catch (e) {
    failed = true;
    console.log("FAILED");
    console.error(`\n${(e as Error).message}\nWhat it made is in ${work}`);
  } finally {
    preview?.kill("SIGTERM");
    for (const s of servers) s.close();
    if (!failed && !keep) rmSync(work, { recursive: true, force: true });
    else if (!failed) console.log(`Kept ${work}`);
  }
  return failed ? 1 : 0;
}

process.exitCode = await main();

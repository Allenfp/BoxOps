// A hostile workspace: a roadmap repository whose files and git configuration
// try to run code or steer BoxOps (a vite.config.js, npm scripts and .npmrc,
// a tsconfig.json plugin, a .env, git hooks, filters, textconv, fsmonitor, a
// pager, a `git` of its own where a relative folder on PATH finds it, and
// GIT_* variables in the environment). The action and the offline commands
// must neither run any of it (sentinel files stay unwritten) nor be
// influenced by it (the site is the same as a clean workspace's), and the
// only program the action starts is git, hardened and as plumbing.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every program started through node:child_process, with its arguments, environment and folder. */
const started = vi.hoisted(() => [] as { file: string; args: string[]; env?: Record<string, string | undefined>; cwd?: string }[]);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const record = (file: unknown, args: unknown, options: unknown) => {
    const o = options as { env?: Record<string, string>; cwd?: string } | undefined;
    started.push({ file: String(file), args: Array.isArray(args) ? args.map(String) : [], env: o?.env, cwd: o?.cwd });
  };
  return {
    ...actual,
    execFileSync: ((file: string, args?: readonly string[], options?: object) => {
      record(file, args, options);
      return actual.execFileSync(file, args, options);
    }) as typeof actual.execFileSync,
    execFile: ((file: string, ...rest: unknown[]) => {
      record(file, rest[0], rest[1]);
      return (actual.execFile as (...a: unknown[]) => unknown)(file, ...rest);
    }) as typeof actual.execFile,
    spawn: ((file: string, args?: readonly string[], options?: object) => {
      record(file, args, options);
      return actual.spawn(file, args ?? [], options ?? {});
    }) as typeof actual.spawn,
    spawnSync: ((file: string, args?: readonly string[], options?: object) => {
      record(file, args, options);
      return actual.spawnSync(file, args ?? [], options ?? {});
    }) as typeof actual.spawnSync,
    exec: ((command: string, ...rest: unknown[]) => {
      record(command, [], rest[0]);
      return (actual.exec as (...a: unknown[]) => unknown)(command, ...rest);
    }) as typeof actual.exec,
    execSync: ((command: string, options?: object) => {
      record(command, [], options);
      return actual.execSync(command, options);
    }) as typeof actual.execSync,
    fork: ((file: string, ...rest: unknown[]) => {
      record(file, rest[0], rest[1]);
      return (actual.fork as (...a: unknown[]) => unknown)(file, ...rest);
    }) as typeof actual.fork,
  };
});

const { runAction } = await import("./action");
const { main } = await import("./boxops");
const { TestRepo } = await import("./test-repo");
const { actionsEnv, capture, cleanUp, makeRelease, readOutputs, sampleRepo, tempDir, ID } = await import("./test-release");
const { embedded } = await import("./embedded");

// Run from source, the tool reads what it carries (the starter's launcher, which the action compares the
// workspace's with, say) from this checkout, once, with git; a release has it compiled in. Read it now, so
// the runs below start only what a release's would.
embedded();

// Each test runs the action and commands on a workspace, and git many times: over a second on a
// quiet machine, and several times that under load, near or past vitest's 5.
vi.setConfig({ testTimeout: 30_000 });

const repos: InstanceType<typeof TestRepo>[] = [];
const savedEnv = { ...process.env };
beforeEach(() => {
  started.length = 0;
});
afterEach(() => {
  for (const r of repos.splice(0)) r.remove();
  cleanUp();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

/** Shell code that leaves a file named `name` in `sentinels`: proof that something ran. */
const touch = (sentinels: string, name: string) => `touch ${JSON.stringify(join(sentinels, name))}`;

/** PATH with relative folders first, as `node_modules/.bin`, `.` and an empty entry (`.` too): run in the workspace, they find its own `git`. */
const relativePath = () => ["node_modules/.bin", ".", "", savedEnv.PATH].join(delimiter);

/** A workspace with the sample roadmap and every trap we know of, committed and checked out. */
function hostileWorkspace(sentinels: string): InstanceType<typeof TestRepo> {
  const evil = join(sentinels, "..", "evil.cjs");
  writeFileSync(evil, `require("node:fs").writeFileSync(${JSON.stringify(join(sentinels, "node-options"))}, "ran");\n`);
  const hook = `#!/bin/sh\n${touch(sentinels, "hook")}\n`;
  const repo = new TestRepo();
  repos.push(repo);
  repo.commit(
    sampleRepo({
      "vite.config.js": `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(join(sentinels, "vite"))}, "ran");\nexport default {};\n`,
      "vite.config.ts": `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(join(sentinels, "vite-ts"))}, "ran");\nexport default {};\n`,
      "package.json": JSON.stringify({ name: "x", scripts: Object.fromEntries(["preinstall", "install", "postinstall", "prepare", "build", "validate"].map((s) => [s, touch(sentinels, `npm-${s}`)])) }),
      ".npmrc": `node-options=--require ${evil}\nscript-shell=/bin/sh\n`,
      "tsconfig.json": JSON.stringify({ compilerOptions: { plugins: [{ name: evil }] } }),
      ".env": `NODE_OPTIONS=--require ${evil}\nGIT_DIR=/nonexistent\nBOXOPS_CLI=${evil}\n`,
      ".gitattributes": "* filter=evil diff=evil\n*.yaml filter=evil\n",
      ".boxops/boxops.mjs": `// BoxOps launcher (launcher: 1)\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(join(sentinels, "launcher"))}, "ran");\n`,
      "hooks/post-checkout": { mode: "100755", content: hook },
      "roadmap/.hidden/evil.sh": { mode: "100755", content: hook },
      // A git of its own (an editor's token can commit one, executable, through the API): a relative folder on PATH finds it.
      git: { mode: "100755", content: `#!/bin/sh\n${touch(sentinels, "git")}\nexit 1\n` },
      "node_modules/.bin/git": { mode: "100755", content: `#!/bin/sh\n${touch(sentinels, "node_modules-git")}\nexit 1\n` },
    }),
    "Add the example project",
  );
  repo.checkout();
  // Configuration only this clone has: every way git could be made to run something.
  const config = join(repo.dir, ".git", "config");
  writeFileSync(
    config,
    readFileSync(config, "utf8") +
      [
        "[core]",
        `\tfsmonitor = ${touch(sentinels, "fsmonitor")}`,
        `\tpager = ${touch(sentinels, "pager")}`,
        `\thooksPath = ${join(repo.dir, "hooks")}`,
        `\tsshCommand = ${touch(sentinels, "ssh")}`,
        `\teditor = ${touch(sentinels, "editor")}`,
        '[filter "evil"]',
        `\tsmudge = ${touch(sentinels, "smudge")}`,
        `\tclean = ${touch(sentinels, "clean")}`,
        `\tprocess = ${touch(sentinels, "filter-process")}`,
        '[diff "evil"]',
        `\ttextconv = ${touch(sentinels, "textconv")}`,
        "[credential]",
        `\thelper = !${touch(sentinels, "credential")}`,
        "[protocol]",
        "\tallow = always",
        "[alias]",
        `\tls = !${touch(sentinels, "alias")}`,
        "",
      ].join("\n"),
  );
  for (const name of ["post-checkout", "pre-commit", "post-index-change", "reference-transaction", "fsmonitor-watchman"]) {
    writeFileSync(join(repo.dir, ".git", "hooks", name), hook);
    chmodSync(join(repo.dir, ".git", "hooks", name), 0o755);
  }
  return repo;
}

/** GIT_* variables a hostile environment could set, to point git elsewhere or change its configuration. */
function hostileGitEnv(sentinels: string): void {
  Object.assign(process.env, {
    GIT_DIR: "/nonexistent",
    GIT_WORK_TREE: "/",
    GIT_CONFIG_PARAMETERS: `'core.fsmonitor'='${touch(sentinels, "env-fsmonitor")}'`,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.pager",
    GIT_CONFIG_VALUE_0: touch(sentinels, "env-pager"),
    GIT_EXTERNAL_DIFF: touch(sentinels, "env-diff"),
    GIT_SSH_COMMAND: touch(sentinels, "env-ssh"),
    GIT_ASKPASS: touch(sentinels, "env-askpass"),
    GIT_TRACE: join(sentinels, "env-trace"),
  });
}

describe("a hostile workspace", () => {
  it("runs nothing of the workspace's, and builds the same site as a clean one", async () => {
    const sentinels = join(tempDir(), "ran");
    mkdirSync(sentinels);
    const repo = hostileWorkspace(sentinels);
    hostileGitEnv(sentinels);
    process.env.PATH = relativePath();
    const cliDir = makeRelease();
    const env = { ...actionsEnv(repo.dir), NODE_OPTIONS: "", BOXOPS_CLI: join(sentinels, "..", "evil.cjs") };
    started.length = 0;
    const log: string[] = [];
    const code = await runAction({ env, out: (l) => log.push(l), cliDir, identity: ID, today: "2026-10-06" });
    expect(log.filter((l) => l.startsWith("::error"))).toEqual([]);
    expect(code).toBe(0);
    expect(readdirSync(sentinels)).toEqual([]);

    // Only git, as plumbing, hardened, with no GIT_* variable of the environment's; the git in PATH's absolute
    // folders, run in the .git folder (where no commit can put a file): never the workspace's own.
    expect(new Set(started.map((s) => s.file))).toEqual(new Set(["git"]));
    for (const s of started) {
      expect(s.args.slice(0, 6)).toEqual(["--git-dir", join(realpathSync(repo.dir), ".git"), "-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never"]);
      expect([s.cwd, s.env?.PATH]).toEqual([s.args[1], process.env.PATH?.split(delimiter).filter(isAbsolute).join(delimiter)]);
      expect(["rev-parse", "cat-file", "ls-tree"]).toContain(s.args[6]);
      expect(s.args).not.toContain("--filters");
      expect(s.args).not.toContain("--textconv");
      expect(s.env).toMatchObject({ GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1" });
      expect(Object.keys(s.env ?? {}).filter((k) => k.startsWith("GIT_") && !["GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "GIT_TERMINAL_PROMPT", "GIT_NO_REPLACE_OBJECTS", "GIT_NO_LAZY_FETCH"].includes(k))).toEqual([]);
    }

    // The same site as a clean workspace with the same roadmap.
    for (const key of Object.keys(process.env)) if (key.startsWith("GIT_") && !(key in savedEnv)) delete process.env[key];
    process.env.PATH = savedEnv.PATH;
    const clean = new TestRepo();
    repos.push(clean);
    clean.commit(sampleRepo(), "Add the example project");
    const cleanEnv = actionsEnv(clean.dir);
    expect(await runAction({ env: cleanEnv, out: () => {}, cliDir, identity: ID, today: "2026-10-06" })).toBe(0);
    const site = (e: Record<string, string>) => JSON.parse(readFileSync(join(readOutputs(e.GITHUB_OUTPUT).site, "roadmap.json"), "utf8"));
    const [hostile, plain] = [site(env), site(cleanEnv)];
    expect([hostile.files, hostile.blobs, hostile.ignored]).toEqual([plain.files, plain.blobs, plain.ignored]);
    // Its roadmap/ tree is the commit's own (which also holds a hidden file the clean one doesn't).
    expect(hostile.source.tree).toBe(repo.git(["rev-parse", "HEAD:roadmap"]));
  });

  it("has real traps: ordinary git in the workspace sets them off", async () => {
    const sentinels = join(tempDir(), "ran");
    mkdirSync(sentinels);
    const repo = hostileWorkspace(sentinels);
    writeFileSync(join(repo.dir, "roadmap", "people.yaml"), "people: []\n");
    // (They aren't real hooks or filters, so git fails after running them.)
    expect(() => repo.git(["status"])).toThrow();
    expect(readdirSync(sentinels)).toContain("fsmonitor");
    // A relative folder on PATH finds the workspace's own git, which fails too.
    for (const folder of ["node_modules/.bin", ".", ""]) {
      expect(() => execFileSync("git", ["--version"], { cwd: repo.dir, env: { ...process.env, PATH: `${folder}${delimiter}${process.env.PATH}` }, stdio: "pipe" })).toThrow();
    }
    expect(readdirSync(sentinels)).toEqual(expect.arrayContaining(["git", "node_modules-git"]));
  });

  // On a person's machine the environment is theirs, so only the workspace's traps here, and a PATH with
  // relative folders (as `./node_modules/.bin`), which no git BoxOps starts looks in.
  it("the offline commands run nothing of it either", async () => {
    const sentinels = join(tempDir(), "ran");
    mkdirSync(sentinels);
    const repo = hostileWorkspace(sentinels);
    process.env.PATH = relativePath();
    const out = join(tempDir(), "site");
    const codes: Record<string, number> = {};
    for (const argv of [["validate"], ["report"], ["migrate", "--check"], ["sync", "--check"], ["guide"], ["version"], ["build", "--out", out, "--commit", "HEAD"]]) {
      codes[argv.join(" ")] = await main(argv, {}, capture({ cwd: repo.dir, env: { BOXOPS_CLI: join(sentinels, "..", "evil.cjs") } }));
    }
    // sync --check: the workspace's "launcher" isn't this release's (and there's no AGENTS.md).
    expect(codes).toEqual({ validate: 0, report: 0, "migrate --check": 0, "sync --check": 1, guide: 0, version: 0, [`build --out ${out} --commit HEAD`]: 0 });
    expect(existsSync(join(out, "roadmap.json"))).toBe(true);
    expect(readdirSync(sentinels)).toEqual([]);
    expect([...new Set(started.map((s) => s.file))]).toEqual(["git"]);
    for (const s of started) expect((s.env?.PATH ?? "").split(delimiter).every(isAbsolute)).toBe(true);
  });
});

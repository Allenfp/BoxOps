// The action, and every command but doctor, upgrade, init and preview's or
// build's first fetch of the app, work without the network: with every way
// Node reaches it (sockets, TLS, DNS, HTTP, fetch, UDP) made to fail and
// noted, through a module's object or a name imported from it, they run as
// usual and nothing is noted. Git, the one program the action starts, is
// told to use no transport (cli/git.ts) and never fetches what a clone lacks.
// And scripts/smoke/no-net.mjs, which cuts a Node process off the same way
// for the smoke tests and the starter's dry run, stops and notes each way;
// no-net.sh, which runs a release's action under it, trusts no run, its
// control's included, that didn't load it.

import { spawnSync } from "node:child_process";
import dgram, { createSocket } from "node:dgram";
import dns, { lookup, resolve4 } from "node:dns";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAction } from "./action";
import { main } from "./boxops";
import { ID, actionsEnv, capture, cleanUp, makeRelease, readOutputs, sampleRepo, tempDir } from "./test-release";
import { TestRepo } from "./test-repo";

// The action and a dozen commands read a repository with git: under a second on a quiet machine,
// and several times that under load, near or past vitest's 5.
vi.setConfig({ testTimeout: 30_000 });

/** Network calls attempted while the guard is on. */
const attempts: string[] = [];
const restore: (() => void)[] = [];

/** Replaces `obj[key]` with a function that notes the call and throws, until restored. */
function block(obj: object, key: string, label: string): void {
  const target = obj as Record<string, unknown>;
  const original = target[key];
  target[key] = (...args: unknown[]) => {
    attempts.push(`${label}(${args.filter((a) => typeof a !== "function").map((a) => (typeof a === "object" ? JSON.stringify(a)?.slice(0, 80) : String(a))).join(", ")})`);
    throw new Error(`no network: ${label}`);
  };
  restore.push(() => (target[key] = original));
}

const repos: TestRepo[] = [];
// The ways out no-net.mjs cuts, the same.
beforeEach(() => {
  attempts.length = 0;
  block(net.Socket.prototype, "connect", "net.Socket.connect");
  block(net, "connect", "net.connect");
  block(net, "createConnection", "net.createConnection");
  block(tls, "connect", "tls.connect");
  // Every DNS query, which goes out without a socket of Node's: the functions of dns and
  // dns.promises, and the methods of their Resolvers, of which those functions are bound copies.
  for (const [obj, label] of [
    [dns, "dns"],
    [dns.promises, "dns.promises"],
    [dns.Resolver.prototype, "dns.Resolver"],
    [dns.promises.Resolver.prototype, "dns.promises.Resolver"],
  ] as const) {
    for (const key of Object.getOwnPropertyNames(obj)) if (/^(lookup|lookupService|resolve\w*|reverse)$/.test(key)) block(obj, key, `${label}.${key}`);
  }
  block(http, "request", "http.request");
  block(http, "get", "http.get");
  block(https, "request", "https.request");
  block(https, "get", "https.get");
  block(dgram, "createSocket", "dgram.createSocket");
  for (const key of Object.getOwnPropertyNames(dgram.Socket.prototype)) if (/^(connect|send)/.test(key)) block(dgram.Socket.prototype, key, `dgram.Socket.${key}`);
  block(globalThis, "fetch", "fetch");
  // A name imported from one of Node's modules (`import { lookup } from "node:dns"`, as the tool
  // imports them) is the function it had when first imported, not the one above, until this.
  syncBuiltinESMExports();
});
afterEach(() => {
  for (const undo of restore.splice(0).reverse()) undo();
  syncBuiltinESMExports();
  for (const r of repos.splice(0)) r.remove();
  cleanUp();
});

function checkout(): TestRepo {
  const repo = new TestRepo();
  repos.push(repo);
  repo.commit(sampleRepo(), "Add the example project");
  repo.checkout();
  return repo;
}

describe("without the network", () => {
  it("the guard notes and stops every way out (so the tests below mean something)", async () => {
    expect(() => fetch("https://api.github.com/")).toThrow("no network: fetch");
    expect(() => net.connect(443, "github.com")).toThrow("no network: net.connect");
    expect(() => new net.Socket().connect(443, "github.com")).toThrow("no network: net.Socket.connect");
    expect(() => https.get("https://github.com/")).toThrow("no network: https.get");
    expect(() => dns.lookup("github.com", () => {})).toThrow("no network: dns.lookup");
    expect(() => dns.resolveTxt("github.com", () => {})).toThrow("no network: dns.resolveTxt");
    expect(() => new dns.Resolver().resolve4("github.com", () => {})).toThrow("no network: dns.Resolver.resolve4");
    expect(() => dns.promises.resolveMx("github.com")).toThrow("no network: dns.promises.resolveMx");
    expect(() => Reflect.apply(dgram.Socket.prototype.send, {}, ["x", 53, "192.0.2.1"])).toThrow("no network: dgram.Socket.send");
    // Through names imported from Node's modules, as the tool imports them.
    expect(() => lookup("github.com", () => {})).toThrow("no network: dns.lookup");
    expect(() => resolve4("github.com", () => {})).toThrow("no network: dns.resolve4");
    expect(() => createSocket("udp4")).toThrow("no network: dgram.createSocket");
    expect(attempts).toHaveLength(12);
  });

  it("the action checks and builds a site", async () => {
    const repo = checkout();
    const env = { ...actionsEnv(repo.dir), "INPUT_RELEASES-FILE": join(tempDir(), "none.json") };
    const log: string[] = [];
    expect(await runAction({ env, out: (l) => log.push(l), cliDir: makeRelease(), identity: ID, today: "2026-10-06" })).toBe(0);
    expect(JSON.parse(readFileSync(join(readOutputs(env.GITHUB_OUTPUT).site, "roadmap.json"), "utf8")).files["people.yaml"]).toBeDefined();
    const check = { ...actionsEnv(repo.dir), INPUT_MODE: "check" };
    expect(await runAction({ env: check, out: () => {}, cliDir: makeRelease(), identity: ID })).toBe(0);
    expect(attempts).toEqual([]);
  });

  it("the offline commands run", async () => {
    const repo = checkout();
    const out = join(tempDir(), "site");
    const codes: Record<string, number> = {};
    for (const argv of [["validate"], ["validate", "--json"], ["report"], ["report", "--json"], ["migrate", "--check"], ["migrate"], ["sync", "--check"], ["guide"], ["guide", "format"], ["version"], ["help"], ["build", "--out", out]]) {
      // The default fetch: the blocked global one.
      codes[argv.join(" ")] = await main(argv, {}, capture({ cwd: repo.dir, fetch: globalThis.fetch }));
    }
    expect(codes).toEqual({
      validate: 0,
      "validate --json": 0,
      report: 0,
      "report --json": 0,
      "migrate --check": 0,
      migrate: 0,
      "sync --check": 1, // a bare repository: no AGENTS.md or launcher yet
      guide: 0,
      "guide format": 0,
      version: 0,
      help: 0,
      [`build --out ${out}`]: 0,
    });
    expect(attempts).toEqual([]);
  });
});

describe("scripts/smoke/no-net.mjs, given to node --import", () => {
  // Every way out, tried once; the name never resolves and the address is one kept for documentation,
  // so a way left open reaches nothing. Then an IP address, looked up as a server on 127.0.0.1 is.
  const PROBE = `
import { Socket, createSocket } from "node:dgram";
import dns, { Resolver, lookup, lookupService, resolve4 } from "node:dns";
import { resolveTxt } from "node:dns/promises";
import { request } from "node:http";
import { get } from "node:https";
import { connect } from "node:net";
import { connect as connectTls } from "node:tls";
for (const way of [
  () => dns.lookup("github.invalid", () => {}),
  () => lookup("github.invalid", () => {}),
  () => resolve4("github.invalid", () => {}),
  () => lookupService("192.0.2.1", 53, () => {}),
  () => new Resolver().resolveMx("github.invalid", () => {}),
  () => resolveTxt("github.invalid"),
  () => createSocket("udp4"),
  () => new Socket("udp4").send("x", 53, "192.0.2.1"),
  () => connect(443, "github.invalid"),
  () => connectTls(443, "github.invalid"),
  () => get("https://github.invalid/"),
  () => request("http://github.invalid/"),
  () => fetch("https://github.invalid/"),
]) {
  try { way()?.catch?.(() => {}); } catch {}
}
console.log(await new Promise((done) => lookup("127.0.0.1", (error, address) => done(error ? String(error) : address))));
process.exit(0);
`;

  it("stops and notes every way out, through a module's object or a name imported from it, as the release's bundle imports them", () => {
    const log = join(tempDir(), "net.log");
    writeFileSync(log, "");
    const module = fileURLToPath(new URL("../scripts/smoke/no-net.mjs", import.meta.url));
    const r = spawnSync(process.execPath, [`--import=${pathToFileURL(module).href}`, "--input-type=module", "-e", PROBE], {
      encoding: "utf8",
      env: { ...process.env, BOXOPS_NO_NET_LOG: log },
    });
    expect([r.status, r.stderr, r.stdout]).toEqual([0, "", "127.0.0.1\n"]);
    expect(readFileSync(log, "utf8").split("\n")).toEqual([
      "dns.lookup github.invalid",
      "dns.lookup github.invalid",
      "dns.resolve4 github.invalid",
      "dns.lookupService 192.0.2.1",
      "dns.Resolver.resolveMx github.invalid",
      "dns.promises.resolveTxt github.invalid",
      "dgram.createSocket udp4",
      "dgram.Socket.send x",
      "net.connect 443",
      "tls.connect 443",
      "https.get https://github.invalid/",
      "http.request http://github.invalid/",
      "fetch https://github.invalid/",
      "",
    ]);
  });
});

describe("scripts/smoke/no-net.sh", () => {
  const script = fileURLToPath(new URL("../scripts/smoke/no-net.sh", import.meta.url));

  /** A release whose dist/action.mjs runs `body`, then says the roadmap is OK and, in build mode, writes the site's roadmap.json. */
  function release(body = ""): string {
    const dir = tempDir();
    mkdirSync(join(dir, "dist"));
    const site = 'const site = process.env.RUNNER_TEMP + "/boxops-site";\nif (process.env.INPUT_MODE === "build") { mkdirSync(site, { recursive: true }); writeFileSync(site + "/roadmap.json", "{}"); }';
    writeFileSync(join(dir, "dist", "action.mjs"), `import { mkdirSync, writeFileSync } from "node:fs";\n${body}\n${site}\nconsole.log("1 departments, 2 lanes, 2 boxes — OK");\n`);
    return dir;
  }

  /** Runs no-net.sh on that release with this PATH. */
  function noNet(dir: string, path = process.env.PATH ?? "") {
    const repo = join(tempDir(), "roadmap");
    mkdirSync(repo);
    const r = spawnSync("bash", [script, dir, repo], { encoding: "utf8", env: { ...process.env, PATH: path } });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  it("passes an action that makes no network call, and fails one that tries", () => {
    const ok = "ok: check mode, no network call (1 departments, 2 lanes, 2 boxes — OK)\nok: build mode, no network call (1 departments, 2 lanes, 2 boxes — OK)\n";
    expect(noNet(release())).toEqual({ code: 0, stdout: ok, stderr: "" });
    expect(noNet(release('try { await fetch("https://api.github.com/"); } catch {}'))).toEqual({
      code: 1,
      stdout: "",
      stderr: "no-net.sh: the action tried the network in check mode:\n    | fetch https://api.github.com/\n",
    });
  });

  it("stops where no-net.mjs wasn't loaded, the control first: a run without it proves nothing", () => {
    // A node that drops NODE_OPTIONS, as each run is given no-net.mjs, the control's too.
    const bin = tempDir();
    writeFileSync(join(bin, "node"), `#!/bin/sh\nunset NODE_OPTIONS\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });
    const r = noNet(release(), `${bin}:${process.env.PATH}`);
    expect([r.code, r.stdout, r.stderr.split("\n")[0]]).toEqual([1, "", "no-net.sh: no-net.mjs wasn't loaded in the control, so nothing was cut off:"]);
  });
});

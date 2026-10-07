// The action, and every command but doctor, upgrade, init and preview's or
// build's first fetch of the app, work without the network: with every way
// Node reaches it (sockets, TLS, DNS, HTTP, fetch, UDP) made to fail and
// noted, they run as usual and nothing is noted. Git, the one program the
// action starts, is told to use no transport (cli/git.ts) and never fetches
// what a clone lacks.

import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAction } from "./action";
import { main } from "./boxops";
import { ID, actionsEnv, capture, cleanUp, makeRelease, readOutputs, sampleRepo, tempDir } from "./test-release";
import { TestRepo } from "./test-repo";

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
beforeEach(() => {
  attempts.length = 0;
  block(net.Socket.prototype, "connect", "net.Socket.connect");
  block(net, "connect", "net.connect");
  block(net, "createConnection", "net.createConnection");
  block(tls, "connect", "tls.connect");
  block(dns, "lookup", "dns.lookup");
  block(dns, "resolve", "dns.resolve");
  block(dns.promises, "lookup", "dns.promises.lookup");
  block(http, "request", "http.request");
  block(http, "get", "http.get");
  block(https, "request", "https.request");
  block(https, "get", "https.get");
  block(dgram, "createSocket", "dgram.createSocket");
  block(globalThis, "fetch", "fetch");
});
afterEach(() => {
  for (const undo of restore.splice(0).reverse()) undo();
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
    expect(attempts).toHaveLength(5);
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

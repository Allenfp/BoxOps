// What every command of the command-line tool gets: the launcher's context,
// where to print, and its arguments. Node-only.

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Env } from "./gha.ts";
import { HERE, type Identity, identity } from "./release.ts";
import { findRepo } from "./site.ts";

/** What the launcher (.boxops/boxops.mjs) passes `main`: the contract `main(argv, ctx) → Promise<number>`, frozen across 0.x. */
export interface LaunchContext {
  /** The roadmap repository's top level. */
  root?: string;
  /** The pinned release: "owner/repo", its commit, and the `# vX.Y.Z` comment's tag. */
  repo?: string;
  sha?: string;
  tag?: string;
  /** The launcher's own contract number. */
  launcher?: number;
  /**
   * The launcher has compared itself, AGENTS.md's BoxOps block and
   * deploy.yml's Pages guard with this release's BUILD.json, and warned of
   * any that differ, so the tool doesn't again (launcher 1 does for the
   * commands that warn, WARNING_COMMANDS, whenever it has a BUILD.json:
   * always, but for a BOXOPS_CLI that has none beside it). `upgrade` gives
   * the new release's `migrate --check` it too: that release's `validate`
   * warns, after its `sync`.
   */
  checked?: boolean;
}

export interface Io {
  /** stdout, a line or more at a time. */
  out(text: string): void;
  /** stderr. */
  err(text: string): void;
  /** Where the command was typed: relative paths are relative to it. */
  cwd: string;
  env: Env;
  fetch: typeof fetch;
  /** The folder dist/boxops.mjs is in. */
  cliDir: string;
  identity(): Identity;
}

export const defaultIo = (): Io => ({
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  cwd: process.cwd(),
  env: process.env,
  fetch: globalThis.fetch,
  cliDir: HERE,
  identity,
});

/** Exit codes: 0 OK, 1 problems, 2 usage or environment, 3 data format mismatch. */
export const EXIT = { ok: 0, problems: 1, usage: 2, format: 3 } as const;

/** A mistake in how the command was run, or in its environment: say so, exit 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** `text` as one word for a POSIX shell: in single quotes. */
export const shellWord = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

/**
 * Steps as one command for bash or zsh, to print: indented two spaces (four
 * on the lines that continue it), each line's steps and the lines joined
 * with `&&`, the lines continued with `\`. Pasted whole, it stops at the
 * first step that fails. Lines of their own wouldn't: the shell a command is
 * pasted into has no `-e`, so after a failed `cd` or clone the rest would
 * run in the folder it was pasted in.
 */
export const oneCommand = (lines: string[][]): string[] =>
  lines.map((steps, i) => `${i ? "    " : "  "}${steps.join(" && ")}${i < lines.length - 1 ? " && \\" : ""}`);

export interface Args {
  positional: string[];
  /** `--name value` (or `--name=value`) and `--switch` (true). */
  flags: Record<string, string | true>;
}

/** Parses argv for a command that takes these `values` (`--port 4173`) and `switches` (`--json`). */
export function parseArgs(argv: string[], values: string[] = [], switches: string[] = []): Args {
  const args: Args = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      args.positional.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith("--")) {
      args.positional.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (switches.includes(name)) {
      if (inline !== undefined) throw new UsageError(`--${name} takes no value`);
      args.flags[name] = true;
    } else if (values.includes(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined || value === "") throw new UsageError(`--${name} needs a value`);
      args.flags[name] = value;
    } else {
      const known = [...values, ...switches].map((n) => `--${n}`);
      throw new UsageError(`Unknown option --${name}${known.length ? ` (this command takes ${known.join(", ")})` : " (this command takes none)"}`);
    }
  }
  return args;
}

/** A flag's value as text (undefined if not given). */
export const flag = (args: Args, name: string): string | undefined => (typeof args.flags[name] === "string" ? (args.flags[name] as string) : undefined);

/** The roadmap repository's top level: --root, the launcher's, else the git repository around the folder the command was typed in. */
export function rootOf(args: Args, ctx: LaunchContext, io: Io): string {
  const given = flag(args, "root");
  const root = given !== undefined ? resolve(io.cwd, given) : (ctx.root ?? findRepo(io.cwd) ?? io.cwd);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new UsageError(`No folder at ${root}`);
  return root;
}

/** The roadmap folder: a folder given, else --roadmap (default "roadmap") in the repository. */
export function roadmapOf(args: Args, ctx: LaunchContext, io: Io, folder?: string): string {
  const dir = folder !== undefined ? resolve(io.cwd, folder) : join(rootOf(args, ctx, io), flag(args, "roadmap") ?? "roadmap");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new UsageError(`No roadmap folder at ${dir}`);
  return dir;
}

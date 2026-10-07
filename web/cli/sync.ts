// `sync [--check]`: keeps a roadmap repository's BoxOps files in step with the
// release that runs: the managed block in AGENTS.md (between its
// `<!-- boxops:begin block=N … -->` and `<!-- boxops:end -->` markers; the
// team's notes outside it stay), the launcher (.boxops/boxops.mjs), and
// CLAUDE.md, made if it's missing. Never the workflows: changing those is
// `upgrade`'s, or a person's. Node-only.

import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { carried } from "./embedded.ts";
import { AGENTS_BLOCK } from "./release.ts";

const BEGIN = /<!--\s*boxops:begin\b[^>]*-->/;
const END = /<!--\s*boxops:end\s*-->/;
const FRONT = /^---\r?\nblock: (\d+)\r?\n---\r?\n/;

/** The block this release writes: its number, and its text with the markers (LF line ends). */
export function agentsBlock(): { number: number; text: string } {
  const source = carried("templates/agents-block.md");
  const m = FRONT.exec(source);
  if (!m) throw new Error("templates/agents-block.md has no `block: N` front matter");
  const number = Number(m[1]);
  if (number !== AGENTS_BLOCK) throw new Error(`templates/agents-block.md is block ${number}, but this BoxOps writes ${AGENTS_BLOCK}`);
  const body = source.slice(m[0].length).replace(/\r\n/g, "\n");
  const text = `<!-- boxops:begin block=${number} — written by \`node .boxops/boxops.mjs sync\`; edits inside are overwritten. Team notes go below the end marker. -->\n${body.endsWith("\n") ? body : `${body}\n`}<!-- boxops:end -->`;
  return { number, text };
}

/** The launcher this release writes. */
export const launcherText = () => carried("starter/.boxops/boxops.mjs");

/**
 * AGENTS.md with this release's block: replaced between the markers, or, in
 * a file without them, put after its first heading (or at the top). Without
 * an AGENTS.md, the starter's. Line ends follow the file's (LF or CRLF).
 */
export function withAgentsBlock(current: string | undefined): string {
  if (current === undefined) return carried("starter/AGENTS.md");
  const crlf = current.includes("\r\n");
  const block = crlf ? agentsBlock().text.replace(/\n/g, "\r\n") : agentsBlock().text;
  const eol = crlf ? "\r\n" : "\n";
  const begin = BEGIN.exec(current);
  const end = END.exec(current);
  if (begin && end && end.index > begin.index) {
    return current.slice(0, begin.index) + block + current.slice(end.index + end[0].length);
  }
  if (begin || end) throw new Error("AGENTS.md has one BoxOps marker without the other (<!-- boxops:begin … --> and <!-- boxops:end -->): fix it by hand, then sync again");
  const heading = /^# .*(\r?\n)/.exec(current);
  if (heading) return `${heading[0]}${eol}${block}${eol}${current.slice(heading[0].length).replace(/^(\r?\n)+/, eol)}`;
  return `${block}${eol}${eol}${current}`;
}

export interface SyncChange {
  /** Path from the repository's top level. */
  path: string;
  text: string;
  created: boolean;
}

/**
 * A file's text if it's a plain file; undefined if it's missing, or a
 * symlink, folder, device or pipe. For the BoxOps files the tool only reads
 * for their numbers: a read through a symlink to /dev/zero, say, never ends.
 */
export function plainText(file: string): string | undefined {
  try {
    return lstatSync(file).isFile() ? readFileSync(file, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

/** A file's text, or undefined if there's none; refuses one that isn't a plain file (sync follows no symlink). */
function readPlain(file: string, path: string): string | undefined {
  const st = lstatSync(file, { throwIfNoEntry: false });
  if (!st) return undefined;
  if (!st.isFile()) throw new Error(`${path} isn’t a plain file${st.isSymbolicLink() ? " (it’s a symlink)" : ""}; sync won’t write through it`);
  return readFileSync(file, "utf8");
}

/** What sync would change in the repository at `root`. */
export function planSync(root: string): SyncChange[] {
  const dotBoxops = lstatSync(join(root, ".boxops"), { throwIfNoEntry: false });
  if (dotBoxops && !dotBoxops.isDirectory()) throw new Error(".boxops isn’t a folder; sync won’t write through it");
  const changes: SyncChange[] = [];
  const want: [string, (current: string | undefined) => string | undefined][] = [
    ["AGENTS.md", withAgentsBlock],
    [".boxops/boxops.mjs", () => launcherText()],
    ["CLAUDE.md", (current) => (current === undefined ? "@AGENTS.md\n" : undefined)],
  ];
  for (const [path, make] of want) {
    const current = readPlain(join(root, path), path);
    const text = make(current);
    if (text !== undefined && text !== current) changes.push({ path, text, created: current === undefined });
  }
  return changes;
}

/** Writes the changes. */
export function applySync(root: string, changes: SyncChange[]): void {
  for (const c of changes) {
    const file = join(root, c.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, c.text);
  }
}

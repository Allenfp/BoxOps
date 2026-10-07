// `node scripts/check-doc-links.mjs [--root DIR]` (from web/): checks that
// every relative link and anchor in the repository's Markdown resolves, as
// GitHub resolves them, as CI does on every change:
//   - the files: every Markdown file git tracks (README.md, AGENTS.md,
//     docs/, starter/, templates/ and the rest);
//   - a link or image (`[text](dest)`, `![alt](src)`, `[label]: dest`, an
//     HTML `href` or `src`) to a path, relative to its file (or, starting
//     with `/`, to the repository's top level): git must track that file, or
//     a file in that folder, as GitHub shows only what's committed;
//   - an anchor (`#…`, alone or after a path to a Markdown file): a heading
//     of that file must make it, as GitHub makes anchors from headings
//     (lowercase; spaces to hyphens; other punctuation dropped; `-1`, `-2`
//     on repeats), or an HTML `id` or `name` give it. A file other than
//     Markdown takes only line anchors (`#L12`, `#L12-L20`);
//   - in starter/, BoxOps' docs as the starter links to them,
//     `https://github.com/Allenfp/BoxOps/(blob|tree)/<SOURCE_COMMIT_SHA>/…`
//     (cli/starter.ts fills in the commit), are paths here too;
//   - a link's text stays on one line: GitHub's docs say a link whose text
//     spans lines won't work.
// Other absolute links (https:, mailto:) aren't fetched. Code (fenced blocks,
// `spans`), HTML comments and YAML front matter are skipped. Problems go to
// stderr as FILE:LINE: …, and as error annotations in GitHub Actions. Exit 0
// if every link resolves, 1 if not, 2 for a mistake in how it's run. Plain
// JavaScript and git, as check-changelog.mjs.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** The starter's links to BoxOps' docs, before cli/starter.ts makes them a release's. */
const STARTER_DOCS = /^https:\/\/github\.com\/Allenfp\/BoxOps\/(blob|tree)\/<SOURCE_COMMIT_SHA>\/([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/;

/** `s` with every character but line ends made a space: offsets and line numbers stay. */
const blank = (s) => s.replace(/[^\n]/g, " ");

/** A line without the `>` marks of the block quotes it's in. */
const unquoted = (line) => line.replace(/^(?: {0,3}>[ \t]?)+/, "");

/**
 * The text without what GitHub never reads as links or headings, blanked out
 * in place: YAML front matter, fenced code blocks and HTML comments.
 */
export function withoutBlocks(text) {
  let out = text.replace(/\r\n?/g, "\n");
  const front = /^---\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(out);
  if (front) out = blank(front[0]) + out.slice(front[0].length);
  const lines = out.split("\n");
  let fence = null;
  for (const [i, line] of lines.entries()) {
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(unquoted(line));
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      lines[i] = blank(line);
      continue;
    }
    const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(unquoted(line));
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      fence = open[1];
      lines[i] = blank(line);
    }
  }
  return lines.join("\n").replace(/<!--[\s\S]*?-->/g, blank);
}

/** The text with code spans blanked out (backticks and all); a span never runs past a blank line. */
export function withoutSpans(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = /(?<!\\)`+/g;
    open.lastIndex = i;
    const m = open.exec(text);
    if (!m) break;
    const end = text.indexOf("\n\n", m.index);
    const limit = end === -1 ? text.length : end;
    const close = new RegExp(`(?<!\`)${m[0]}(?!\`)`, "g");
    close.lastIndex = m.index + m[0].length;
    const c = close.exec(text);
    if (!c || c.index >= limit) {
      out += text.slice(i, m.index + m[0].length);
      i = m.index + m[0].length;
      continue;
    }
    out += text.slice(i, m.index) + blank(text.slice(m.index, c.index + c[0].length));
    i = c.index + c[0].length;
  }
  return out + text.slice(i);
}

/** A heading's text as GitHub shows it: links and code without their markup, no images, HTML or emphasis. */
function headingText(raw) {
  return raw
    .split(/(`+[^`]*?`+)/)
    .map((part, n) => {
      if (n % 2) return part.replace(/^`+ ?|`+$/g, "").replace(/ $/, "");
      return part
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
        .replace(/<[^>]+>/g, "")
        .replace(/\*+/g, "")
        .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, "$1")
        .replace(/\\(.)/g, "$1");
    })
    .join("")
    .trim();
}

/** GitHub's anchor for a heading's text: lowercase, letters, numbers, `_` and `-` kept, spaces to hyphens. */
export const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");

/** Every anchor a Markdown file has: its headings' (repeats numbered as GitHub numbers them), and HTML ids and names. */
export function anchors(text) {
  const plain = withoutBlocks(text);
  const out = new Set();
  for (const line of plain.split("\n")) {
    const m = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(unquoted(line));
    if (!m) continue;
    const base = slug(headingText(m[2] ?? ""));
    let id = base;
    for (let n = 1; out.has(id); n++) id = `${base}-${n}`;
    out.add(id);
  }
  for (const m of withoutSpans(plain).matchAll(/<[a-z][^>]*?\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) out.add(m[1] ?? m[2]);
  return out;
}

/** Every link in a Markdown file: { dest, line, multiline (its text spans lines) }. */
export function links(text) {
  const plain = withoutSpans(withoutBlocks(text));
  const starts = [0];
  for (let i = 0; i < plain.length; i++) if (plain[i] === "\n") starts.push(i + 1);
  const lineOf = (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const out = [];
  const inline = /(?<!\\)!?\[((?:[^[\]\\]|\\.|\[(?:[^[\]\\]|\\.)*\])*)\]\(\s*(<[^<>\n]*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/g;
  for (const m of plain.matchAll(inline)) out.push({ dest: m[2], line: lineOf(m.index), multiline: m[1].includes("\n") });
  for (const m of plain.matchAll(/^ {0,3}\[((?:[^[\]\\]|\\.)+)\]:[ \t]*\n?[ \t]*(<[^<>\n]*>|\S+)/gm)) out.push({ dest: m[2], line: lineOf(m.index), multiline: false });
  for (const m of plain.matchAll(/<[a-z][^>]*?\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) out.push({ dest: m[1] ?? m[2], line: lineOf(m.index), multiline: false });
  return out;
}

const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * The problem with one link of `from` (a path from the top level), or null if
 * it resolves. `files`: every path git tracks; `dirs`: every folder holding
 * one; `anchorsOf(path)`: a tracked Markdown file's anchors.
 */
export function problemWith(link, from, { files, dirs, anchorsOf }) {
  let dest = link.dest.replace(/^<(.*)>$/, "$1");
  let kind = null;
  let path;
  let fragment;
  const docs = STARTER_DOCS.exec(dest);
  if (docs && from.startsWith("starter/")) {
    [, kind, path, fragment] = docs;
    path = posix.normalize(decode(path)).replace(/\/$/, "");
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith("//")) {
    return null; // Absolute: not fetched.
  } else {
    const hash = dest.indexOf("#");
    fragment = hash === -1 ? undefined : dest.slice(hash + 1);
    dest = hash === -1 ? dest : dest.slice(0, hash);
    dest = dest.replace(/\?.*$/, "");
    if (dest === "") path = from;
    else {
      const joined = dest.startsWith("/") ? dest.slice(1) : posix.join(posix.dirname(from), decode(dest));
      path = posix.normalize(joined).replace(/\/$/, "");
      if (path === "." || path === "") path = "";
      if (path === ".." || path.startsWith("../")) return `links to ${link.dest}, outside the repository`;
    }
  }

  const isFile = files.has(path);
  const isDir = path === "" || dirs.has(path);
  if (!isFile && !isDir) return `links to ${path}, which git doesn’t track (${link.dest})`;
  if (kind === "blob" && !isFile) return `links to ${path} as a file (blob), but it’s a folder: use tree (${link.dest})`;
  if (kind === "tree" && !isDir) return `links to ${path} as a folder (tree), but it’s a file: use blob (${link.dest})`;
  if (fragment === undefined || fragment === "") return null;
  const anchor = decode(fragment);
  if (!isFile) return `links to an anchor, #${anchor}, in a folder (${link.dest})`;
  if (!/\.md$/i.test(path)) return /^L\d+(?:-L\d+)?$/.test(anchor) ? null : `links to #${anchor} in ${path}, which only has line anchors (#L12) (${link.dest})`;
  if (anchorsOf(path).has(anchor)) return null;
  const hint = anchor !== anchor.toLowerCase() && anchorsOf(path).has(anchor.toLowerCase()) ? ": GitHub’s anchors are lowercase" : "";
  return `links to #${anchor}, which no heading of ${path} makes${hint} (${link.dest})`;
}

/** Every problem with the Markdown files' links in the repository at `root`: { file, line, message }. */
export function checkDocLinks(root) {
  const listed = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const files = new Set(listed.split("\0").filter(Boolean));
  const dirs = new Set();
  for (const f of files) for (let d = posix.dirname(f); d !== "."; d = posix.dirname(d)) dirs.add(d);
  const texts = new Map();
  const read = (path) => {
    if (!texts.has(path)) texts.set(path, readFileSync(resolve(root, path), "utf8"));
    return texts.get(path);
  };
  const anchorCache = new Map();
  const anchorsOf = (path) => {
    if (!anchorCache.has(path)) anchorCache.set(path, anchors(read(path)));
    return anchorCache.get(path);
  };
  const markdown = [...files].filter((f) => /\.md$/i.test(f)).sort();
  const problems = [];
  for (const file of markdown) {
    const found = [];
    for (const link of links(read(file))) {
      if (link.multiline) found.push({ file, line: link.line, message: `the text of the link to ${link.dest} spans lines: GitHub says such a link won’t work; keep it on one line` });
      const message = problemWith(link, file, { files, dirs, anchorsOf });
      if (message) found.push({ file, line: link.line, message });
    }
    problems.push(...found.sort((a, b) => a.line - b.line));
  }
  return { checked: markdown.length, problems };
}

/** An annotation's message, escaped as the runner reads it. */
const escapeData = (s) => s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

function main(argv) {
  let args;
  try {
    args = parseArgs({ args: argv, options: { root: { type: "string" } } });
  } catch (e) {
    console.error(`check-doc-links: ${e.message}\nUsage: node scripts/check-doc-links.mjs [--root DIR]`);
    return 2;
  }
  const root = resolve(args.values.root ?? fileURLToPath(new URL("../..", import.meta.url)));
  let result;
  try {
    result = checkDocLinks(root);
  } catch (e) {
    console.error(`check-doc-links: ${e.message}`);
    return 2;
  }
  for (const p of result.problems) {
    console.error(`${p.file}:${p.line}: ${p.message}`);
    if (process.env.GITHUB_ACTIONS === "true") console.log(`::error file=${p.file},line=${p.line},title=Docs link::${escapeData(p.message)}`);
  }
  if (result.problems.length) return 1;
  console.log(`${result.checked} Markdown file${result.checked === 1 ? "" : "s"}: every relative link and anchor resolves.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));

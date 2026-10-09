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
//     of that file (`# Title`, or a paragraph underlined with `===` or
//     `---`) must make it, as GitHub makes anchors from headings (lowercase;
//     spaces to hyphens; other punctuation dropped; `-1`, `-2` on repeats),
//     or an HTML `id` or `name` give it. A file other than Markdown takes
//     only line anchors (`#L12`, `#L12-L20`);
//   - in starter/, BoxOps' docs as the starter links to them,
//     `https://github.com/Allenfp/BoxOps/(blob|tree)/<SOURCE_COMMIT_SHA>/…`
//     (cli/starter.ts fills in the commit), are paths here too;
//   - a link's text stays on one line: GitHub's docs say a link whose text
//     spans lines won't work.
// Other absolute links (https:, mailto:) aren't fetched. Code (fenced blocks,
// blocks indented 4 columns past the list item or quote they're in, or the
// page, `spans`), HTML comments, YAML front matter and footnotes' `[^1]:` are
// skipped (a footnote's text isn't: its links are checked). Problems go to
// stderr as FILE:LINE: …, and as error annotations in GitHub Actions. Exit 0
// if every link resolves, 1 if not, 2 for a mistake in how it's run. Plain
// JavaScript and git, as check-changelog.mjs.
//
// Where it still reads blocks otherwise than GitHub does (found against
// pandoc's GFM reader, and left, being rare): a block quote that starts
// right after a list marker (`1. > …`), or 4 columns or more into its line
// (in a list item), isn't read as one, so neither a fence in it nor its
// headings' anchors are seen; a `10.` line, or a list item without text,
// right after a quote's paragraph (and without its `>`) goes on with that
// paragraph, where GitHub starts a list; and HTML blocks but comments
// (`<details>`, `<div>`) are read as Markdown. Tables too, found against
// cmark-gfm, which GitHub renders with (its table extension's source, and a
// build of 0.29.0.gfm.13; pandoc reads the first and last as this check
// does): a delimiter row (`--- | ---`) 4 columns or more into its container
// starts a table here, where GitHub's paragraph goes on; so does one with
// more or fewer cells than the line above it; and a table starts here only
// under a paragraph of one line, where GitHub takes a longer one's last line
// as its header row (the lines before stay a paragraph). Each changes which
// lines are one block, so a setext heading's anchor, or a link a comment or
// code span hides, can be found where GitHub has none, or missed.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** The starter's links to BoxOps' docs, before cli/starter.ts makes them a release's. */
const STARTER_DOCS = /^https:\/\/github\.com\/Allenfp\/BoxOps\/(blob|tree)\/<SOURCE_COMMIT_SHA>\/([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/;

/** `s` with every character but line ends made a space: offsets and line numbers stay. */
const blank = (s) => s.replace(/[^\n]/g, " ");

/** The `>` marks of the block quotes a line is in, and the spaces after them. */
const QUOTES = /^(?: {0,3}>[ \t]?)*/;

/** A line without the `>` marks of the block quotes it's in. */
const unquoted = (line) => line.slice(QUOTES.exec(line)[0].length);

/**
 * A line's block quotes: how many (`depth`); where the text in them starts
 * (`at`) and at what column of the line (`start`); the column its indentation
 * counts from (`zero`), the innermost quote's content, which starts past its
 * `>` and the space or tab after it (a tab's other columns are the text's
 * indentation); and each `>`'s column in the quote it's in, or the page
 * (`marks`).
 */
function quoteOf(line) {
  const prefix = QUOTES.exec(line)[0];
  const marks = [];
  let column = 0;
  let zero = 0;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] === ">") {
      marks.push(column - zero);
      zero = column + (prefix[i + 1] === " " || prefix[i + 1] === "\t" ? 2 : 1);
      column += 1;
    } else column += prefix[i] === "\t" ? 4 - (column % 4) : 1;
  }
  return { depth: marks.length, at: prefix.length, start: column, zero, marks };
}

/**
 * The width in columns of the spaces and tabs `text` starts with, and where
 * its text starts: `text` starts at column `from` of its line, and a tab goes
 * to the line's next multiple of 4.
 */
function indentOf(text, from = 0) {
  let column = from;
  let at = 0;
  for (; text[at] === " " || text[at] === "\t"; at++) column += text[at] === "\t" ? 4 - (column % 4) : 1;
  return { width: column - from, at };
}

// What starts a block, matched on a line's text after its indentation.
const ATX = /^(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^(`{3,}|~{3,})(.*)$/;
const BREAK = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const ITEM = /^(?:[-+*]|(\d{1,9})[.)])(?=[ \t]|$)/;
const FOOTNOTE = /^\[\^[^\]\n]+\]:[ \t]*/;
const DELIMITER = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** A fence that opens a code block: three backticks or tildes (backticks with none in the info string). */
const fenceOf = (rest) => {
  const f = FENCE.exec(rest);
  return f && !(f[1][0] === "`" && f[2].includes("`")) ? f[1] : null;
};

/**
 * Whether a line's text, at most 3 columns into its container, ends the
 * paragraph above it by starting a block. A list item does when it has text,
 * and is a bullet, starts a list at 1 or is in a list already; a footnote's
 * `[^1]:` does too, in GitHub's Markdown.
 */
function interrupts(rest, inList) {
  if (ATX.test(rest) || BREAK.test(rest) || fenceOf(rest) || rest.startsWith("<!--") || FOOTNOTE.test(rest)) return true;
  const item = ITEM.exec(rest);
  return item !== null && rest.slice(item[0].length).trim() !== "" && (item[1] === undefined || inList || Number(item[1]) === 1);
}

/**
 * `text` (LF line ends), `edit`ed a block at a time: the lines of a paragraph,
 * a heading or a table's row (`blockOf` gives each line's, -1 for any other),
 * together; any other line alone. A comment or a code span ends in its block.
 */
function byBlock(text, blockOf, edit) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; ) {
    let end = i + 1;
    if (blockOf[i] >= 0) while (end < lines.length && blockOf[end] === blockOf[i]) end++;
    out.push(edit(lines.slice(i, end).join("\n")));
    i = end;
  }
  return out.join("\n");
}

/**
 * The text with what GitHub never reads as links or headings blanked out in
 * place (YAML front matter, fenced and indented code blocks, HTML comments),
 * its headings, each { start, end, col, atx }: its first line, the line after
 * its text (a setext heading's underline), and where its text starts on the
 * first line; and each line's block (`byBlock`). The blocks are read as GitHub
 * reads them (CommonMark), as far as finding these needs: a line indented 4 or
 * more columns past the list item or block quote it's in (or the page) is
 * code, unless it goes on with a paragraph; a paragraph underlined with `===`
 * or `---` is a heading; a fence or an HTML block ends with the quote or list
 * item it's in.
 */
function scan(text) {
  let out = text.replace(/\r\n?/g, "\n");
  const front = /^---\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(out);
  if (front) out = blank(front[0]) + out.slice(front[0].length);
  const lines = out.split("\n");
  const headings = [];
  // The content columns of the list items (and footnotes) open, for each depth of block quotes.
  const stacks = [[]];
  let depth = 0;
  // The block the line before was in: blank (or a container's start), para, table, code, html (a
  // comment going on) or other (a heading, a fence or a break, ended).
  let prev = "blank";
  // The paragraph going on: { start, col, base (its container's content column), depth, block }.
  let para = null;
  // Each line's paragraph, heading or table row (a number, the same for all its lines), where a comment
  // in its text can be; -1 elsewhere.
  const blockOf = lines.map(() => -1);
  let blocks = 0;
  // The fence or HTML comment going on: { depth, base } (the quotes it's in, and its list item's
  // content column), and a fence's mark.
  let fence = null;
  let html = null;
  // Whether a line is past the end of the container such a block is in, which ends it too: a quote
  // it's in has ended, or the line has text left of its list item's (or footnote's) content.
  const outside = (block, quote, inner) => {
    if (quote.depth < block.depth) return true;
    if (quote.depth > block.depth) return quote.marks[block.depth] < block.base;
    return inner.trim() !== "" && quote.start - quote.zero + indentOf(inner, quote.start).width < block.base;
  };
  for (const [i, line] of lines.entries()) {
    const quote = quoteOf(line);
    const inner = line.slice(quote.at);
    if (fence && !outside(fence, quote, inner)) {
      // A closing fence is at most 3 columns into the fence's container.
      const lead = indentOf(inner, quote.start);
      const close =
        quote.depth === fence.depth && quote.start - quote.zero + lead.width - fence.base <= 3 && /^(`{3,}|~{3,})[ \t]*$/.exec(inner.slice(lead.at));
      if (close && close[1][0] === fence.mark[0] && close[1].length >= fence.mark.length) {
        fence = null;
        prev = "other";
      }
      lines[i] = blank(line);
      continue;
    }
    if (prev === "html" && !outside(html, quote, inner)) {
      // An HTML block is the whole of its lines, through the one with `-->`.
      if (line.includes("-->")) prev = "other";
      lines[i] = blank(line);
      continue;
    }
    if (fence || prev === "html") {
      // Its container has ended, and so has it: the line is read as any other.
      fence = null;
      prev = "other";
    }
    const empty = inner.trim() === "";
    const quotes = quote.depth;
    // A line with fewer quotes than the paragraph before it goes on with it, lazily, unless it starts
    // a block (below); the quotes stay open meanwhile.
    const lazy = quotes < depth && prev === "para" && !empty;
    if (quotes !== depth && !lazy) {
      if (quotes > depth) {
        // A quote that starts left of a list item's (or footnote's) content ends it.
        const outer = stacks[depth];
        while (outer.length && outer.at(-1) > quote.marks[depth]) outer.pop();
        for (let d = depth + 1; d <= quotes; d++) stacks[d] = [];
      }
      // A block quote's first line starts its content; a line without the quote's mark ends it.
      prev = "blank";
      depth = quotes;
    }
    if (empty) {
      prev = "blank";
      continue;
    }
    // Columns count from the quote's content (or the page's); a tab's, from the line's start.
    const lead = indentOf(inner, quote.start);
    const width = quote.start - quote.zero + lead.width;
    const at = lead.at;
    const rest = inner.slice(at);
    const stack = stacks[quotes];
    const base = stack.findLast((col) => col <= width) ?? 0;
    if (prev === "para" || prev === "table") {
      if (!lazy && prev === "para" && para.depth === depth && width >= para.base && width - para.base <= 3 && UNDERLINE.test(rest)) {
        headings.push({ start: para.start, end: i, col: para.col, atx: false });
        prev = "other";
        continue;
      }
      if (!lazy && prev === "para" && para.start === i - 1 && rest.includes("|") && lines[para.start].includes("|") && DELIMITER.test(rest)) {
        prev = "table";
        continue;
      }
      // Anything else that doesn't start a block goes on with it, lazily too (a table's rows, each a block).
      if (width - base > 3 || !interrupts(rest, stack.length > 0)) {
        blockOf[i] = prev === "para" ? para.block : ++blocks;
        continue;
      }
    }
    if (lazy) {
      // It starts a block: the quotes it hasn't the marks of have ended.
      depth = quotes;
      prev = "blank";
    }
    // A block starts: the line is in the list items whose content starts at or before it.
    while (stack.length && stack.at(-1) > width) stack.pop();
    if (width - base >= 4) {
      lines[i] = blank(line);
      prev = "code";
      continue;
    }
    // List items (one inside another on one line too), then what the innermost one's text starts.
    const quoted = line.length - inner.length;
    let pos = at;
    let col = width;
    let item;
    let left = null; // What a list item left the line as, when its text doesn't start on it.
    while (!BREAK.test(inner.slice(pos)) && (item = ITEM.exec(inner.slice(pos)))) {
      const marker = pos + item[0].length;
      const after = indentOf(inner.slice(marker), quote.zero + col + item[0].length);
      if (marker + after.at === inner.length) {
        stack.push(col + item[0].length + 1);
        left = "blank"; // No text yet: its content may start on the next line, code too.
        break;
      }
      if (after.width > 4) {
        stack.push(col + item[0].length + 1);
        lines[i] = line.slice(0, quoted + marker) + blank(line.slice(quoted + marker));
        left = "code"; // Its text starts a column after the marker, with code.
        break;
      }
      stack.push(col + item[0].length + after.width);
      col += item[0].length + after.width;
      pos = marker + after.at;
    }
    if (left) {
      prev = left;
      continue;
    }
    const first = inner.slice(pos);
    const opened = fenceOf(first);
    if (opened) {
      fence = { mark: opened, depth, base: stack.at(-1) ?? 0 };
      lines[i] = blank(line);
      prev = "other";
    } else if (ATX.test(first)) {
      headings.push({ start: i, end: i + 1, col: quoted + pos, atx: true });
      blockOf[i] = ++blocks;
      prev = "other";
    } else if (BREAK.test(first)) {
      prev = "other";
    } else if (first.startsWith("<!--")) {
      // An HTML block, the rest of the line and those after it through the one with `-->`.
      lines[i] = line.slice(0, quoted + pos) + blank(line.slice(quoted + pos));
      html = { depth, base: stack.at(-1) ?? 0 };
      prev = first.includes("-->", 4) ? "other" : "html";
    } else {
      const note = FOOTNOTE.exec(first);
      // A footnote's lines go on 4 columns into its container, however far in its `[^1]:` is: into
      // the list item whose marker it's right after, if it is.
      if (note) stack.push((stack.at(-1) ?? 0) + 4);
      para = { start: i, col: quoted + pos + (note ? note[0].length : 0), base: stack.at(-1) ?? 0, depth, block: ++blocks };
      blockOf[i] = para.block;
      prev = "para";
    }
  }
  // A comment left, in a paragraph, a heading or a table's row, ends in its block, or is text.
  return { plain: byBlock(lines.join("\n"), blockOf, (block) => block.replace(/<!--[\s\S]*?-->/g, blank)), headings, blockOf };
}

/** The text without what GitHub never reads as links or headings, blanked out in place (`scan`). */
export const withoutBlocks = (text) => scan(text).plain;

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

/**
 * Every anchor a Markdown file has: its headings' (repeats numbered as GitHub
 * numbers them), and HTML ids and names. A setext heading's lines are its
 * text, the line breaks dropped as GitHub drops them (they're neither letters
 * nor spaces).
 */
export function anchors(text) {
  const { plain, headings, blockOf } = scan(text);
  const lines = plain.split("\n");
  const out = new Set();
  for (const h of headings) {
    // In an HTML comment, it isn't one.
    if (!lines[h.end - (h.atx ? 1 : 0)].trim()) continue;
    const raw = h.atx
      ? (ATX.exec(lines[h.start].slice(h.col))?.[2] ?? "")
      : lines
          .slice(h.start, h.end)
          .map((line, n) => (n ? unquoted(line) : line.slice(h.col)).trim())
          .filter(Boolean)
          .join("\n");
    const base = slug(headingText(raw));
    let id = base;
    for (let n = 1; out.has(id); n++) id = `${base}-${n}`;
    out.add(id);
  }
  for (const m of byBlock(plain, blockOf, withoutSpans).matchAll(/<[a-z][^>]*?\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) out.add(m[1] ?? m[2]);
  return out;
}

/** Every link in a Markdown file: { dest, line, multiline (its text spans lines) }. */
export function links(text) {
  const blocks = scan(text);
  const plain = byBlock(blocks.plain, blocks.blockOf, withoutSpans);
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
  // `[label]: dest`, but not a footnote's `[^label]: text`.
  for (const m of plain.matchAll(/^ {0,3}\[(?!\^)((?:[^[\]\\]|\\.)+)\]:[ \t]*\n?[ \t]*(<[^<>\n]*>|\S+)/gm)) out.push({ dest: m[2], line: lineOf(m.index), multiline: false });
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

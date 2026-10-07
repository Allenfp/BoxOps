// The BoxOps pin: which release a repository runs. It's the commit SHA on
// each `uses: <owner>/<repo with "boxops" in its name>@<sha> # vX.Y.Z` line of
// its workflows (and, for Path B, on a `BOXOPS_ACTION: …` line), never
// anywhere else. The launcher (starter/.boxops/boxops.mjs) reads the first
// one in deploy.yml with the same pattern; doctor and the action check that
// they all agree; upgrade and init rewrite them. Dependabot keeps the comment
// on the same line, so a line is all there is to read or rewrite. Line ends
// (LF or CRLF), indentation, quotes and any words after the tag are kept.

/** A BoxOps pin line: indent and key, quote, owner/repo, ref, then optionally ` # tag` and more of the comment. */
const PIN_LINE =
  /^(\s*(?:-\s+)?(?:uses|BOXOPS_ACTION)\s*:\s*)(["']?)([\w.-]+\/[\w.-]*boxops[\w.-]*)@([^\s"'#]+)\2(?:(\s+#\s*)(\S+)(.*?))?(\s*)$/i;

/** What a release commit's SHA looks like. */
export const COMMIT_SHA = /^[0-9a-f]{40}$/;

export interface Pin {
  /** 1-based. */
  line: number;
  /** "owner/repo". */
  repo: string;
  /** What it's pinned to: a 40-hex commit SHA, or (wrongly) a tag or branch. */
  ref: string;
  /** The `# vX.Y.Z` comment's first word, if there is one. */
  tag?: string;
  /** A Path B `BOXOPS_ACTION:` line rather than `uses:`. */
  pathB: boolean;
}

/** Every BoxOps pin in a workflow's text. */
export function findPins(text: string): Pin[] {
  const pins: Pin[] = [];
  text.split("\n").forEach((raw, i) => {
    const m = PIN_LINE.exec(raw.replace(/\r$/, ""));
    if (!m) return;
    pins.push({ line: i + 1, repo: m[3], ref: m[4], ...(m[6] !== undefined && { tag: m[6] }), pathB: /BOXOPS_ACTION/i.test(m[1]) });
  });
  return pins;
}

/**
 * The workflow with every BoxOps pin moved to `sha` and its comment to `tag`
 * (added if there was none), and to `repo` if given (a mirror). Nothing else
 * changes.
 */
export function rewritePins(text: string, sha: string, tag: string, repo?: string): string {
  return text
    .split("\n")
    .map((raw) => {
      const cr = raw.endsWith("\r") ? "\r" : "";
      const line = cr ? raw.slice(0, -1) : raw;
      const m = PIN_LINE.exec(line);
      if (!m) return raw;
      const [, key, quote, oldRepo, , gap, , rest, end] = m;
      return `${key}${quote}${repo ?? oldRepo}@${sha}${quote}${gap ?? " # "}${tag}${rest ?? ""}${end}${cr}`;
    })
    .join("\n");
}

/** Reads `name: N` style contract numbers (`launcher: 1`, `boxops-guard: 1`, `block=1`) from a file's text. */
export function contractNumber(text: string, marker: "launcher" | "guard" | "block"): number | null {
  const re = {
    launcher: /\(launcher: (\d+)\)/,
    guard: /#\s*boxops-guard:\s*(\d+)/,
    block: /<!--\s*boxops:begin block=(\d+)/,
  }[marker];
  const m = re.exec(text);
  return m ? Number(m[1]) : null;
}

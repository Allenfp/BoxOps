// The starter repository's files (starter/), made for one release: what
// `init` writes, and what web/scripts/publish-starter.ts publishes as
// Allenfp/boxops-starter, byte for byte. starter/ is canonical and holds two
// placeholders. Every BoxOps pin is `Allenfp/BoxOps@<RELEASE_COMMIT_SHA> #
// vX.Y.Z` (the workflows' `uses:` lines, and the Path B step README.md
// shows), rewritten as upgrade rewrites pins. README.md's links to BoxOps'
// docs are at `<SOURCE_COMMIT_SHA>`, the commit of main the release was
// built from (its BUILD.json's `source`): a release commit holds only the
// built release, so a link at its tag would find no docs there. Node-only.

import { COMMIT_SHA, rewritePins } from "./pins.ts";
import { UPSTREAM } from "./release.ts";

/** Where a release commit goes in starter/. */
export const RELEASE_PLACEHOLDER = "<RELEASE_COMMIT_SHA>";
/** Where the commit a release was built from goes in starter/. */
export const SOURCE_PLACEHOLDER = "<SOURCE_COMMIT_SHA>";

/** The release a starter is made for. */
export interface StarterRelease {
  /** The repository the pins name: Allenfp/BoxOps, or a mirror of it. */
  repo: string;
  /** The release's commit (40 hex). */
  sha: string;
  /** Its tag: vX.Y.Z, or vX.Y.Z-rc.N. */
  tag: string;
  /** The commit of main it was built from (40 hex), where README.md's links to BoxOps' docs point. */
  source: string;
}

/** The files a BoxOps pin can be on. */
const pinned = (path: string) => path.startsWith(".github/workflows/") || path === "README.md";

/**
 * The starter's files (path in the starter → text) made for release `r`.
 * Throws if `r` isn't a release, or if a placeholder is left anywhere (one
 * on a line rewritePins doesn't take for a pin).
 */
export function renderStarter(files: Record<string, string>, r: StarterRelease): Record<string, string> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(r.repo)) throw new Error(`"${r.repo}" isn’t a repository (owner/name)`);
  if (!COMMIT_SHA.test(r.sha)) throw new Error(`"${r.sha}" isn’t a release commit (40 lowercase hex)`);
  if (!/^v\d+\.\d+\.\d+(-rc\.\d+)?$/.test(r.tag)) throw new Error(`"${r.tag}" isn’t a release tag (vX.Y.Z)`);
  if (!COMMIT_SHA.test(r.source)) throw new Error(`"${r.source}" isn’t the commit the release was built from (40 lowercase hex)`);
  const out: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    const made = (pinned(path) ? rewritePins(text, r.sha, r.tag, r.repo) : text).split(SOURCE_PLACEHOLDER).join(r.source);
    const left = /<(?:RELEASE|SOURCE)_COMMIT_SHA>/.exec(made);
    if (left) throw new Error(`starter/${path} still has ${left[0]} once made for ${r.tag}: it’s on a line BoxOps doesn’t fill in`);
    out[path] = made;
  }
  return out;
}

/**
 * The pages of BoxOps' docs the files link to at `source` (a commit, or
 * SOURCE_PLACEHOLDER in starter/ itself): `blob/<source>/…` files and
 * `tree/<source>/…` folders, by path in BoxOps.
 */
export function docLinks(files: Record<string, string>, source: string): Map<string, "blob" | "tree"> {
  const links = new Map<string, "blob" | "tree">();
  const re = new RegExp(`https://github\\.com/${UPSTREAM}/(blob|tree)/${source}/([^\\s)#?"'<>]+)`, "g");
  for (const text of Object.values(files)) for (const m of text.matchAll(re)) links.set(m[2].replace(/\/$/, ""), m[1] as "blob" | "tree");
  return links;
}

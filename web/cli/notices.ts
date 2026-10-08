// Update and security notices: the action compares the BoxOps releases the
// workflow looked up (its `releases-file`, written by a `gh api` step) with
// its own version. The result goes in the run's annotations and, as plain
// text, in roadmap.json's `notices`, which the app shows everyone. Dependabot
// raises no alerts for actions pinned by SHA, so this is how a deploy learns
// that a security fix is out. The comparison lives in the release, so a fix
// to it arrives with the next pin bump; the lookup never fails a deploy.

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { Notice } from "../src/model/bundle.ts";

/**
 * One release as `gh api …/releases --jq '[.[] | {tag_name, name, prerelease, published_at}]'`
 * lists it (the API also says whether it's a draft). `published_at` is
 * optional: a list without it is read all the same.
 */
export interface ReleaseEntry {
  tag_name: string;
  name: string | null;
  prerelease: boolean;
  draft?: boolean;
  published_at?: string | null;
}

/**
 * The security releases of newer minors whose fixes this release carries
 * too. A patch of an older minor that takes a newer one's security fix (a
 * backport: docs/releasing.md, "Security releases") names that release's tag
 * here, so its deploys don't warn of it even when the releases list can't
 * tell by its dates (releaseNotices). None in this release.
 */
export const FIXES_INCLUDED: readonly string[] = [];

/** major, minor, patch, and the release candidate's number (null for a release). */
type Version = [number, number, number, number | null];

/** "0.1.0", "v0.1.0" or "0.1.0-rc.2" as numbers; null for anything else ("0.1.0-dev", "main"). */
export function parseVersion(text: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? null : Number(m[4])] : null;
}

/** Negative if a comes before b: 0.1.0-rc.1 < 0.1.0 < 0.1.1-rc.1 < 0.1.1. */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  if (a[3] === b[3]) return 0;
  if (a[3] === null) return 1;
  if (b[3] === null) return -1;
  return a[3] - b[3];
}

export interface NoticeAnnotation {
  level: "warning" | "notice";
  message: string;
}

export interface Notices {
  /** For roadmap.json: what the app shows. */
  notices: Notice[];
  /** For the run. */
  annotations: NoticeAnnotation[];
}

const isEntry = (r: unknown): r is ReleaseEntry =>
  typeof r === "object" &&
  r !== null &&
  typeof (r as ReleaseEntry).tag_name === "string" &&
  ((r as ReleaseEntry).name === null || typeof (r as ReleaseEntry).name === "string") &&
  typeof (r as ReleaseEntry).prerelease === "boolean";

const title = (r: ReleaseEntry) => (r.name ?? "").trim();

/** When it was published, in ms; null if the list doesn't say (an older lookup's, or a draft's). */
const publishedAt = (r: ReleaseEntry): number | null => {
  const t = typeof r.published_at === "string" ? Date.parse(r.published_at) : Number.NaN;
  return Number.isNaN(t) ? null : t;
};

/**
 * A release titled "Withdrawn: …": found bad after it was published
 * (docs/releasing.md, "A bad release"), so never one to move to.
 */
export const isWithdrawn = (r: { name?: unknown }): boolean => typeof r.name === "string" && /^withdrawn:/i.test(r.name.trim());

/**
 * The tag of the newest release (by version) in a list of them as GitHub's
 * API gives it, to move to when none is named: a vX.Y.Z that isn't a release
 * candidate, a draft or withdrawn. Not GitHub's "latest", which a withdrawn
 * release stays until another is published. Undefined if there's none.
 */
export function newestRelease(releases: unknown): string | undefined {
  if (!Array.isArray(releases)) return undefined;
  return releases
    .filter(isEntry)
    .filter((r) => r.draft !== true && !r.prerelease && !isWithdrawn(r))
    .map((r) => ({ tag: r.tag_name, v: parseVersion(r.tag_name) }))
    .filter((x): x is { tag: string; v: Version } => x.v !== null && x.v[3] === null && x.tag.startsWith("v"))
    .sort((a, b) => compareVersions(b.v, a.v))[0]?.tag;
}

/**
 * The notices for a site running BoxOps `own` (its version, "0.1.0"), given
 * the releases list (anything that isn't one is ignored). Only tags vX.Y.Z
 * count, not drafts, and release candidates (vX.Y.Z-rc.N, marked
 * prerelease) only while running one. A newer release titled "Security: …"
 * gives a security notice and a warning, unless this release carries its
 * fix: it's in `included` (FIXES_INCLUDED), or the list's dates say this
 * release came out after it (an older minor's patch carries the fixes of
 * the security releases before it: docs/releasing.md). The one named is a
 * patch of this release's minor if there's one, which needs no migration
 * (the newest release, a newer minor's, then gets a note), else the newest.
 * Any other newer release gives an info notice and a notice annotation; a
 * withdrawn one ("Withdrawn: …") none. If this release is titled
 * "Withdrawn: …", a warning, in the app too.
 */
export function releaseNotices(own: string, releases: unknown, included: readonly string[] = FIXES_INCLUDED): Notices {
  const mine = parseVersion(own);
  const out: Notices = { notices: [], annotations: [] };
  if (!mine || !Array.isArray(releases)) return out;
  const candidate = mine[3] !== null;
  const known = releases
    .filter(isEntry)
    .filter((r) => r.draft !== true)
    .map((r) => ({ r, v: parseVersion(r.tag_name) }))
    .filter((x): x is { r: ReleaseEntry; v: Version } => x.v !== null && x.r.tag_name.startsWith("v"))
    .filter((x) => candidate || (x.v[3] === null && !x.r.prerelease));
  const newest = (list: typeof known): (typeof known)[number] | undefined => [...list].sort((a, b) => compareVersions(b.v, a.v))[0];
  const sameMinor = (v: Version) => v[0] === mine[0] && v[1] === mine[1];
  // Until the release that fixes it is out, a withdrawn one may well be the newest: never offered.
  const newer = known.filter((x) => compareVersions(x.v, mine) > 0 && !isWithdrawn(x.r));
  const latest = newest(newer);
  const self = known.find((x) => compareVersions(x.v, mine) === 0);
  const since = self ? publishedAt(self.r) : null;
  const fixCarried = (r: ReleaseEntry) => {
    const at = publishedAt(r);
    return included.includes(r.tag_name) || (since !== null && at !== null && at <= since);
  };
  const fixes = newer.filter((x) => /^security:/i.test(title(x.r)) && !fixCarried(x.r));
  const security = newest(fixes.filter((x) => sameMinor(x.v))) ?? newest(fixes);
  // Dependabot's pull request moves to the newest release. A patch of this minor while the newest
  // is a newer minor's (which, for there to be such a patch, raised the data format) is the way
  // without a migration: that patch is the one to take, and the pull request is the longer way.
  const patch = security !== undefined && latest !== undefined && sameMinor(security.v) && !sameMinor(latest.v);
  const upgrade = (tag: string) => `merge the BoxOps upgrade pull request, or run \`node .boxops/boxops.mjs upgrade ${tag}\``;
  if (security) {
    const tag = security.r.tag_name;
    out.notices.push({
      level: "security",
      text: `BoxOps ${tag} fixes a security problem; this site runs v${own}. Ask a repository admin to ${patch ? `upgrade it to ${tag}` : "merge the upgrade pull request"}.`,
    });
    out.annotations.push({
      level: "warning",
      message: `BoxOps ${tag} fixes a security problem (“${title(security.r)}”); this run used v${own}: ${patch ? `run \`node .boxops/boxops.mjs upgrade ${tag}\`, a patch of this minor release that needs no migration` : upgrade(tag)}.`,
    });
  }
  if (latest && (!security || patch)) {
    if (!security) out.notices.push({ level: "info", text: `BoxOps ${latest.r.tag_name} is available; this site runs v${own}.` });
    out.annotations.push({ level: "notice", message: `BoxOps ${latest.r.tag_name} is available; this run used v${own}: ${upgrade(latest.r.tag_name)}.` });
  }
  if (self && isWithdrawn(self.r)) {
    out.notices.push({ level: "warning", text: `This site runs BoxOps v${own}, which was withdrawn. Ask a repository admin to upgrade it.` });
    out.annotations.push({
      level: "warning",
      message: `BoxOps v${own} was withdrawn (“${title(self.r)}”): upgrade to a newer release${latest ? ` (${latest.r.tag_name})` : ""}.`,
    });
  }
  return out;
}

/** The most of a releases-file read: 30 releases' names and tags are a few KiB. */
const MAX_BYTES = 1024 * 1024;

/**
 * The releases-file's list, or why it couldn't be had: not set, missing or
 * empty (the lookup step didn't run, or failed: its `>` makes the file
 * before gh runs, so a failed gh leaves it empty), too big or not JSON.
 * Never an error: notices are optional.
 */
export function readReleasesFile(path: string): { releases: unknown } | { skipped: string } {
  if (!path) return { skipped: "no releases-file given" };
  const failed = "(the lookup step didn’t run or failed)";
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return { skipped: `no releases-file at ${path} ${failed}` };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { skipped: `${path} isn’t a file` };
    if (st.size > MAX_BYTES) return { skipped: `${path} is over 1 MiB` };
    const bytes = Buffer.alloc(st.size);
    let n = 0;
    while (n < bytes.length) {
      const got = readSync(fd, bytes, n, bytes.length - n, null);
      if (got === 0) break;
      n += got;
    }
    const text = bytes.subarray(0, n).toString("utf8");
    if (!text.trim()) return { skipped: `${path} is empty ${failed}` };
    return { releases: JSON.parse(text) };
  } catch (e) {
    return { skipped: `${path} isn’t a list of releases (${(e as Error).message})` };
  } finally {
    closeSync(fd);
  }
}

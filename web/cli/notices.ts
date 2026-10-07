// Update and security notices: the action compares the BoxOps releases the
// workflow looked up (its `releases-file`, written by a `gh api` step) with
// its own version. The result goes in the run's annotations and, as plain
// text, in roadmap.json's `notices`, which the app shows everyone. Dependabot
// raises no alerts for actions pinned by SHA, so this is how a deploy learns
// that a security fix is out. The comparison lives in the release, so a fix
// to it arrives with the next pin bump; the lookup never fails a deploy.

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { Notice } from "../src/model/bundle.ts";

/** One release as `gh api …/releases --jq '[.[] | {tag_name, name, prerelease}]'` lists it. */
export interface ReleaseEntry {
  tag_name: string;
  name: string | null;
  prerelease: boolean;
}

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

/**
 * The notices for a site running BoxOps `own` (its version, "0.1.0"), given
 * the releases list (anything that isn't one is ignored). Only tags vX.Y.Z
 * count, and release candidates (vX.Y.Z-rc.N, marked prerelease) only while
 * running one. A newer release titled "Security: …" gives a security notice
 * and a warning; any other newer one an info notice and a notice annotation.
 * If this release is titled "Withdrawn: …", a warning, in the app too.
 */
export function releaseNotices(own: string, releases: unknown): Notices {
  const mine = parseVersion(own);
  const out: Notices = { notices: [], annotations: [] };
  if (!mine || !Array.isArray(releases)) return out;
  const candidate = mine[3] !== null;
  const known = releases
    .filter(isEntry)
    .map((r) => ({ r, v: parseVersion(r.tag_name) }))
    .filter((x): x is { r: ReleaseEntry; v: Version } => x.v !== null && x.r.tag_name.startsWith("v"))
    .filter((x) => candidate || (x.v[3] === null && !x.r.prerelease));
  const newest = (list: typeof known) => [...list].sort((a, b) => compareVersions(b.v, a.v))[0]?.r;
  const newer = known.filter((x) => compareVersions(x.v, mine) > 0);
  const security = newest(newer.filter((x) => /^security:/i.test(title(x.r))));
  const latest = newest(newer);
  const upgrade = (tag: string) => `merge the BoxOps upgrade pull request, or run \`node .boxops/boxops.mjs upgrade ${tag}\``;
  if (security) {
    out.notices.push({
      level: "security",
      text: `BoxOps ${security.tag_name} fixes a security problem; this site runs v${own}. Ask a repository admin to merge the upgrade pull request.`,
    });
    out.annotations.push({
      level: "warning",
      message: `BoxOps ${security.tag_name} fixes a security problem (“${title(security)}”); this run used v${own}: ${upgrade(security.tag_name)}.`,
    });
  } else if (latest) {
    out.notices.push({ level: "info", text: `BoxOps ${latest.tag_name} is available; this site runs v${own}.` });
    out.annotations.push({ level: "notice", message: `BoxOps ${latest.tag_name} is available; this run used v${own}: ${upgrade(latest.tag_name)}.` });
  }
  const self = known.find((x) => compareVersions(x.v, mine) === 0 && /^withdrawn:/i.test(title(x.r)));
  if (self) {
    out.notices.push({ level: "warning", text: `This site runs BoxOps v${own}, which was withdrawn. Ask a repository admin to upgrade it.` });
    out.annotations.push({
      level: "warning",
      message: `BoxOps v${own} was withdrawn (“${title(self.r)}”): upgrade to a newer release${latest ? ` (${latest.tag_name})` : ""}.`,
    });
  }
  return out;
}

/** The most of a releases-file read: 30 releases' names and tags are a few KiB. */
const MAX_BYTES = 1024 * 1024;

/**
 * The releases-file's list, or why it couldn't be had: not set, missing,
 * too big or not JSON. Never an error: notices are optional.
 */
export function readReleasesFile(path: string): { releases: unknown } | { skipped: string } {
  if (!path) return { skipped: "no releases-file given" };
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return { skipped: `no releases-file at ${path} (the lookup step didn’t run or failed)` };
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
    return { releases: JSON.parse(bytes.subarray(0, n).toString("utf8")) };
  } catch (e) {
    return { skipped: `${path} isn’t a list of releases (${(e as Error).message})` };
  } finally {
    closeSync(fd);
  }
}

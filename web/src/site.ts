// The deployed site around the app: its roadmap.json, the app build behind
// it, and reloading onto a newer one.

import { type AppInfo, type Bundle, type BundleSource, readBundle } from "./model/bundle";

/**
 * Set by a reload that must not be answered from the browser's cache (Pages
 * caches index.html for 10 minutes): the app's own "Reload" after an update,
 * and the boot watchdog in index.html. The app removes it once it has started.
 */
export const RELOAD_PARAM = "boxops-reload";

/** Take RELOAD_PARAM out of the address bar, keeping everything else. */
export function stripReloadParam(): void {
  const q = new URLSearchParams(location.search);
  if (!q.has(RELOAD_PARAM)) return;
  q.delete(RELOAD_PARAM);
  const search = q.toString();
  history.replaceState(history.state, "", `${location.pathname}${search ? `?${search}` : ""}${location.hash}`);
}

/**
 * Load the page again from a URL no cache has seen (`./?boxops-reload=<tag>`,
 * other parameters and the hash kept), so a new deploy's index.html and app
 * come in. A field being typed in is committed first, so the draft has it.
 */
export function reloadApp(tag: string): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  const q = new URLSearchParams(location.search);
  q.set(RELOAD_PARAM, tag || Date.now().toString(36));
  // On the next tick, once the blur's edit is in the draft and the draft is stored.
  setTimeout(() => location.replace(`./?${q}${location.hash}`), 0);
}

/** roadmap.json couldn't be fetched (`status` 0: no answer at all; `timeout`: none in time) or read. */
export class SiteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly timeout = false,
  ) {
    super(message);
    this.name = "SiteError";
  }
}

/**
 * The site's own copy of the roadmap, rewritten by every deploy. `no-cache`
 * revalidates, so an unchanged file costs a 304. Same-origin: on private
 * Pages, once the sign-in cookie has expired, the request is redirected to
 * github.com, which fetch can't follow, so that fails like being offline.
 * `timeoutMs` gives up (status 0) on an answer that stalls, body included.
 */
export async function fetchBundle(timeoutMs?: number): Promise<Bundle> {
  const abort = new AbortController();
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => abort.abort(), timeoutMs);
  try {
    let res: Response;
    const late = () => new SiteError(`roadmap.json: no answer within ${(timeoutMs ?? 0) / 1000} s`, 0, true);
    try {
      res = await fetch("roadmap.json", { cache: "no-cache", signal: abort.signal });
    } catch (e) {
      throw abort.signal.aborted ? late() : new SiteError(`roadmap.json: ${(e as Error).message}`, 0);
    }
    if (!res.ok) throw new SiteError(`roadmap.json: HTTP ${res.status}`, res.status);
    try {
      return readBundle(await res.json());
    } catch (e) {
      throw abort.signal.aborted ? late() : new SiteError(`roadmap.json: ${(e as Error).message}`, res.status);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether a polled roadmap.json moves the tab forward from the commit on
 * screen: its history (the deploy's last 50 first-parent commits) holds that
 * commit. Deploys finish out of order and the tab may have read a newer head
 * from GitHub, so anything else is ignored if the tab has seen it, if the
 * commit on screen's own history holds it (even one made the same second),
 * or if it's older; a bundle without a usable date or history (one from
 * before schema 1) counts as newer unless seen.
 */
export function movesForward(
  next: BundleSource,
  current: Pick<BundleSource, "commit" | "date" | "history">,
  seen: ReadonlySet<string>,
): boolean {
  if (next.commit === current.commit) return false;
  if (next.history.includes(current.commit)) return true;
  if (seen.has(next.commit) || current.history.includes(next.commit)) return false;
  return !(Date.parse(next.date) < Date.parse(current.date));
}

/**
 * When this app was built (AppInfo.time), from index.html; "" when unknown.
 * Not in the JavaScript, which then stays the same across roadmap saves.
 */
export function builtAt(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="boxops-build-time"]')?.content ?? "";
}

/**
 * Whether roadmap.json was built by a newer BoxOps than the one running in
 * this tab: another build id, made later. One direction only, so a CDN that
 * briefly serves an older roadmap.json with newer JavaScript doesn't flag the
 * newer tab, and an unknown build or time never flags anything. A tab running
 * older code must not save: it could drop what the newer app writes.
 */
export function isNewerApp(app: AppInfo, mine: Pick<AppInfo, "build" | "time"> = { build: __BOXOPS_BUILD__, time: builtAt() }): boolean {
  if (!app.build || !mine.build || app.build === mine.build) return false;
  return Date.parse(app.time) > Date.parse(mine.time);
}

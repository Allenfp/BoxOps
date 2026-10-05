// The deployed site around the app: its roadmap.json, the app build behind
// it, and reloading onto a newer one.

import { type Bundle, readBundle } from "./model/bundle";

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

/** roadmap.json couldn't be fetched (`status` 0: no answer at all) or read. */
export class SiteError extends Error {
  constructor(
    message: string,
    readonly status: number,
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
 */
export async function fetchBundle(): Promise<Bundle> {
  let res: Response;
  try {
    res = await fetch("roadmap.json", { cache: "no-cache" });
  } catch (e) {
    throw new SiteError(`roadmap.json: ${(e as Error).message}`, 0);
  }
  if (!res.ok) throw new SiteError(`roadmap.json: HTTP ${res.status}`, res.status);
  try {
    return readBundle(await res.json());
  } catch (e) {
    throw new SiteError(`roadmap.json: ${(e as Error).message}`, res.status);
  }
}

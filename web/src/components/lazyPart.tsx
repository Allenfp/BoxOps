// Parts of the app that aren't needed to show the timeline, each in a file of
// its own, fetched the first time it's shown (React.lazy; put it under a
// Suspense). `preload()` fetches it ahead: when the pointer reaches the tab
// that shows it, say. A part whose file can't be fetched (a deploy replaced
// the app's files since this page opened) says so, with Reload.

import { type ComponentType, type LazyExoticComponent, lazy } from "react";
import { reloadApp } from "../site";

/** `T`: any component, whatever its props, as React.lazy takes. */
export function lazyPart<T extends ComponentType<any>>(load: () => Promise<T>): LazyExoticComponent<T> & { preload(): void } {
  let fetching: Promise<{ default: T }> | undefined;
  // Unavailable stands in for any part: it takes the part's props and ignores them.
  const fetch = () => (fetching ??= load().then((part) => ({ default: part }), () => ({ default: Unavailable as unknown as T })));
  return Object.assign(lazy(fetch), { preload: () => void fetch() });
}

function Unavailable() {
  return (
    <div className="banner" role="alert">
      <span>This part of BoxOps couldn’t load: the site may have been updated since this page opened.</span>
      <button onClick={() => reloadApp("")}>Reload</button>
    </div>
  );
}

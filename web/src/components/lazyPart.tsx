// Parts of the app that aren't needed to show the timeline, each in a file of
// its own, fetched the first time it's shown (React.lazy; put it under a
// Suspense). `preload()` fetches it ahead: when the pointer reaches the tab
// that shows it, say. A part whose file can't be fetched (the connection
// dropped, or a deploy replaced the app's files since this page opened) says
// so, with Try again and Reload. The app keeps no failure: the next try, or
// the next preload, fetches the file again. WebKit and Chromium (Safari,
// Chrome, Edge) keep a module file that failed to load until the page
// reloads, though, so a second failure says to reload.

import { type ComponentType, lazy, useSyncExternalStore } from "react";
import { reloadApp } from "../site";
import { Banner } from "./Banner";

/** `T`: any component, whatever its props, as React.lazy takes. */
export function lazyPart<T extends ComponentType<any>>(load: () => Promise<T>): T & { preload(): void } {
  let fetching: Promise<T> | undefined;
  /** Fetches that failed, preloads too: after the first, trying again in this page may not help. */
  let failures = 0;
  const fetch = () =>
    (fetching ??= load().then(
      (part) => {
        failures = 0;
        return part;
      },
      (e: unknown) => {
        fetching = undefined;
        failures++;
        throw e;
      },
    ));
  // React.lazy keeps what it resolved to, so trying again needs a new one;
  // every place showing the part then renders again (useSyncExternalStore).
  // Failed stands in for any part: it takes the part's props and ignores them.
  const attempt = () => lazy(() => fetch().then((part) => ({ default: part }), () => ({ default: Failed as unknown as T })));
  let current = attempt();
  let tries = 0;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  const retry = () => {
    current = attempt();
    tries++;
    for (const listener of listeners) listener();
  };
  function Failed() {
    return <Unavailable again={failures > 1} onRetry={retry} />;
  }
  function Part(props: Record<string, unknown>) {
    useSyncExternalStore(subscribe, () => tries);
    const Current = current as unknown as ComponentType<Record<string, unknown>>;
    return <Current {...props} />;
  }
  return Object.assign(Part as unknown as T, { preload: () => void fetch().catch(() => {}) });
}

/**
 * `again`: it failed before too, so only reloading is offered. Said as it
 * appears; Try again, once the part is here (or fails again), leaves focus
 * on the roadmap.
 */
function Unavailable({ again, onRetry }: { again: boolean; onRetry(): void }) {
  if (again) {
    return (
      <Banner live="assertive">
        <span>This part of BoxOps couldn’t load. Once you’re connected, reload the page.</span>
        <button className="primary" onClick={() => reloadApp("")}>
          Reload
        </button>
      </Banner>
    );
  }
  return (
    <Banner live="assertive">
      <span>
        This part of BoxOps couldn’t load. Check your connection and try again; if the site was updated since this page
        opened, reload.
      </span>
      <button className="primary" onClick={onRetry}>
        Try again
      </button>
      <button onClick={() => reloadApp("")}>Reload</button>
    </Banner>
  );
}

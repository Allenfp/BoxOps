// Parts of the app that aren't needed to show the timeline, each in a file of
// its own, fetched the first time it's shown (React.lazy; put it under a
// Suspense). `preload()` fetches it ahead: when the pointer reaches the tab
// that shows it, say. A part whose file can't be fetched (the connection
// dropped, or a deploy replaced the app's files since this page opened) says
// so, with Try again and Reload. The app keeps no failure: the next try, or
// the next preload, fetches the file again. WebKit and Chromium (Safari,
// Chrome, Edge) keep a module file that failed to load until the page
// reloads, though, so a fetch that fails after another had failed before it
// began says to reload; what it says is settled as it begins, so a preload
// failing meanwhile (the pointer passing the part's tab again) changes nothing.

import { type ComponentType, lazy, useSyncExternalStore } from "react";
import { reloadApp } from "../site";
import { Banner } from "./Banner";

/** `T`: any component, whatever its props, as React.lazy takes. */
export function lazyPart<T extends ComponentType<any>>(load: () => Promise<T>): T & { preload(): void } {
  let fetching: Promise<T> | undefined;
  /** Fetches that failed, preloads too: after one, trying again in this page may not help. */
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
  // A failure stands in for any part: it takes the part's props and ignores
  // them. Which one is settled as the part is asked for: if a fetch had
  // failed before, trying again may not help. The fetch it waits for began
  // then, or is under way (none settles meanwhile), so a preload that fails
  // after it began changes nothing.
  const attempt = () =>
    lazy(() => {
      const Failed = failures > 0 ? FailedAgain : FailedFirst;
      return fetch().then((part) => ({ default: part }), () => ({ default: Failed as unknown as T }));
    });
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
  function FailedFirst() {
    return <Unavailable again={false} onRetry={retry} />;
  }
  function FailedAgain() {
    return <Unavailable again onRetry={retry} />;
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

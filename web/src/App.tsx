import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { DepartmentEditorTarget } from "./components/DepartmentEditor";
import type { Resume, SaveProblem } from "./components/SaveDialog";
import { lazyPart } from "./components/lazyPart";
import { type PtoRef, ptoClashes, ptoKey, ptoRange } from "./model/pto";
import { type BoxPlacement, Timeline } from "./components/Timeline";
import { GitHubClient, GitHubFailure, isBranchName } from "./github/api";
import { TOKEN_KINDS, failureMessage } from "./github/messages";
import { FolderProblems, type Snapshot, TooManyChanges, canRead, fromBundle, readSnapshot, remember, sameBlobs } from "./github/read";
import type { SaveResult, SaveStep } from "./github/save";
import { getToken, setToken } from "./github/token";
import { KeyContent } from "./components/KeyContent";
import { Modal } from "./components/Modal";
import { SettingsMenu } from "./components/SettingsMenu";
import { getPrefs, setPrefs, usePrefs, type ViewMode } from "./prefs";
import { Logo } from "./components/Logo";
import { Popover } from "./components/Popover";
import { type WarningGroup, WarningsMenu } from "./components/WarningsMenu";
import { overCapacity, overloadText } from "./model/report";
import { type DraftOffer, type DraftState, diffBoxes, rebaseDraft, SETTINGS_KEY, useDraft } from "./model/draft";
import { downloadJson } from "./model/draftStore";
import { addWorkdays, prettyDay, startOfWeek } from "./model/dates";
import { useToday } from "./components/useToday";
import type { AppInfo, Bundle, Notice } from "./model/bundle";
import { FORMAT } from "./model/format";
import { type LoadResult, loadFolder, loadFolderNow, loadParser, rememberParsed, reservedBoxes, reservedDepartments } from "./model/load";
import type { FileChanges } from "./model/serialize";
import { type Violation, findViolations } from "./model/relations";
import { type ChangeLine, commitMessage, describeChanges } from "./model/summary";
import type { Box, Issue, RoadmapFiles, TimeOff, ZoomLevel } from "./model/types";
import { ZOOM_LEVELS } from "./model/types";
import { Icon } from "./components/Icon";
import { noteDraft, runningFine } from "./components/ErrorBoundary";
import { LoadProblem, PreviewToken, liveUrl } from "./components/LoadScreen";
import { SiteError, fetchBundle, guardReload, isNewerApp, movesForward, reloadApp } from "./site";

interface Loaded extends LoadResult, Snapshot {
  /** Showing a branch other than the one this site was built from (`?ref=`). */
  preview: boolean;
}

type LoadState =
  | { status: "loading" }
  /** The site's roadmap.json, or a `?ref=` branch, couldn't be read. `newToken`: a different token could read the branch. */
  | { status: "error"; title: string; message: string; detail?: string; newToken?: { repo: string; branch: string } }
  /** A `?ref=` preview of a private repository, and no token to read it with. */
  | { status: "needs-token"; repo: string; branch: string; rejected: boolean }
  | ({ status: "ready" } & Loaded);

const ZOOM_LABEL: Record<ZoomLevel, string> = { weeks: "Weeks", months: "Months", quarters: "Quarters" };

/** How often open tabs look for other people's saves. */
const POLL_MS = 2 * 60_000;
/** Failed polls in a row before the tab says it has lost the site. */
const LOST_AFTER = 2;
/** The longest wait between polls while they fail. */
const MAX_BACKOFF_MS = 15 * 60_000;
/** How long the load-time check for saves newer than the deployed copy may take; that copy is on screen meanwhile. */
const FRESHNESS_MS = 4000;
/** How long saving waits for the site's roadmap.json (a check for a newer BoxOps) before going on without it. */
const SITE_CHECK_MS = 5000;
/** How long loading, or a poll, waits for the site's roadmap.json, body included: then Try again, or the poll's backoff. */
const SITE_MS = 20_000;

// Not needed to show the timeline: each fetched when first shown (lazyPart).
const TableView = lazyPart(() => import("./components/TableView").then((m) => m.TableView));
const PeopleView = lazyPart(() => import("./components/PeopleView").then((m) => m.PeopleView));
const BoxEditor = lazyPart(() => import("./components/BoxEditor").then((m) => m.BoxEditor));
const PtoEditor = lazyPart(() => import("./components/PtoEditor").then((m) => m.PtoEditor));
const DepartmentEditor = lazyPart(() => import("./components/DepartmentEditor").then((m) => m.DepartmentEditor));
const TeamSettings = lazyPart(() => import("./components/TeamSettings").then((m) => m.TeamSettings));
const SaveDialog = lazyPart(() => import("./components/SaveDialog").then((m) => m.SaveDialog));
const ShortcutsContent = lazyPart(() => import("./components/SettingsPanel").then((m) => m.ShortcutsContent));
/** Views by tab, fetched when the pointer or focus reaches the tab. */
const VIEW_PARTS: Partial<Record<ViewMode, { preload(): void }>> = { table: TableView, people: PeopleView };
/** How long after the roadmap shows that the editors are fetched, unless it's read-only. */
const EDITORS_AFTER_MS = 1000;

type Saving = typeof import("./saving");
/** Saving's code, once loaded. */
let saving: Saving | undefined;
let savingLoad: Promise<Saving> | undefined;
/** Fetches of saving's code that failed in a row: after the first, this browser may keep the failure until a reload (lazyPart.tsx). */
let savingFailures = 0;

/**
 * Fetch saving's code and the parser, which bring the yaml library: started
 * as soon as someone begins editing, so a save never waits for it. A failure
 * isn't kept, as for loadParser().
 */
function loadSaving(): Promise<Saving> {
  savingLoad ??= Promise.all([import("./saving"), loadParser()]).then(
    ([m]) => {
      savingFailures = 0;
      return (saving = m);
    },
    (e: unknown) => {
      savingLoad = undefined;
      savingFailures++;
      throw e;
    },
  );
  return savingLoad;
}

/** A newer BoxOps that built the site, and the data format it reads (0: unknown). */
interface AppUpdate extends AppInfo {
  format: number;
}

/** A save by someone else that just arrived in this tab. */
interface RemoteUpdate {
  author?: string;
  subject?: string;
}

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "table", label: "Table" },
  { id: "people", label: "People" },
];

/** View state lives in the URL so a link reproduces what you see. */
function readUrlState(): { view?: ViewMode; zoom?: ZoomLevel; collapsed?: Set<string> } {
  const q = new URLSearchParams(window.location.search);
  const zoom = q.get("zoom") as ZoomLevel | null;
  const collapsed = q.get("collapsed");
  return {
    view: VIEWS.find((v) => v.id === q.get("view"))?.id,
    zoom: zoom && ZOOM_LEVELS.includes(zoom) ? zoom : undefined,
    collapsed: collapsed === null ? undefined : new Set(collapsed.split(",").filter(Boolean)),
  };
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Why the site's roadmap.json couldn't be had, in words. */
function siteProblem(e: unknown): Extract<LoadState, { status: "error" }> {
  const title = "Couldn’t load the roadmap";
  const detail = (e as Error).message;
  if (e instanceof SiteError && e.timeout) {
    return { status: "error", title, message: "The site didn’t answer in time. Check your connection, then try again.", detail };
  }
  if (!(e instanceof SiteError) || e.status === 0) {
    return { status: "error", title, message: "This browser couldn’t reach the site. Check your connection, then try again.", detail };
  }
  if (e.status === 404) return { status: "error", title, message: "The site has no roadmap yet: it may be in the middle of a deploy. Try again in a minute.", detail };
  if (e.status >= 400) return { status: "error", title, message: `The site answered with an error (HTTP ${e.status}). Try again in a minute.`, detail };
  return { status: "error", title, message: "The site’s roadmap.json couldn’t be read.", detail };
}

/**
 * Why the load-time check won't bring in newer saves, for a notice; null for
 * a failure that needs none (the deployed copy stays either way, and a save
 * reads the head again).
 */
function newerProblem(e: unknown): string | null {
  if (e instanceof TooManyChanges) return `Newer saves aren’t shown: ${e.message}`;
  if (!(e instanceof FolderProblems)) return null;
  const shown = e.lines.slice(0, 3);
  const more = e.lines.length - shown.length;
  return (
    `Newer saves aren’t shown, and saving won’t work, until the roadmap folder on GitHub is fixed: ${shown.join("; ")}` +
    `${more ? `; and ${more} more` : ""}.`
  );
}

/** The roadmap arrived but couldn't be opened. */
function openProblem(e: unknown): Extract<LoadState, { status: "error" }> {
  return {
    status: "error",
    title: "Couldn’t load the roadmap",
    message: "The roadmap arrived, but BoxOps couldn’t open it. Try again; if it keeps happening, pass the details on to whoever looks after this site.",
    detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
  };
}

/** A `?ref=` branch, read-only, read from GitHub (only files that differ from the deployed copy are fetched). */
async function loadPreview(base: Snapshot, branch: string): Promise<Exclude<LoadState, { status: "loading" }>> {
  const { repo } = base.source;
  const title = `Couldn’t show branch “${branch}”`;
  if (!isBranchName(branch)) return { status: "error", title, message: `“${branch}” isn’t a branch name.` };
  if (base.source.local) {
    return {
      status: "error",
      title,
      message: "A copy built from the files on disk never reads from GitHub, so it can’t preview a branch. Check the branch out, or preview it on the deployed site.",
    };
  }
  const gh = new GitHubClient({ token: getToken(repo) });
  // A private repository: ask for a token rather than make a call that can only fail.
  if (!canRead(base.source, gh)) return { status: "needs-token", repo, branch, rejected: false };
  try {
    return { status: "ready", ...(await fromSnapshot(await readSnapshot(gh, base, { branch }), true)) };
  } catch (e) {
    if (e instanceof GitHubFailure && e.kind === "unauthorized") {
      setToken(repo, null);
      return base.source.private ? { status: "needs-token", repo, branch, rejected: true } : loadPreview(base, branch);
    }
    // A branch is never deployed, so waiting for a deploy (as for main) won't help.
    if (e instanceof TooManyChanges) {
      return {
        status: "error",
        title,
        message: `“${branch}” differs from the deployed roadmap in ${e.count} files, more than BoxOps reads at once (${e.limit}). Check the branch out to see it.`,
      };
    }
    if (!(e instanceof GitHubFailure)) return { status: "error", title, message: (e as Error).message };
    if (e.kind === "offline") {
      return { status: "error", title, message: "Couldn’t reach GitHub: you may be offline, or a network filter may be blocking api.github.com." };
    }
    if (e.kind === "timeout") return { status: "error", title, message: "GitHub didn’t answer in time. Try again in a moment." };
    // The token kept for this repository can't read it: Try again alone would only reuse it.
    const newToken = base.source.private && gh.authenticated && TOKEN_KINDS.includes(e.kind) ? { repo, branch } : undefined;
    return { status: "error", title, message: failureMessage(e, { repo, branch }), detail: `GitHub said: “${e.message}”`, newToken };
  }
}

/**
 * Whether a newer snapshot changes anything on screen: a roadmap file, or the
 * other files in the folder (reported as unexpected). A commit elsewhere in
 * the repository (the app, its README) doesn't, and gets no notice.
 */
function changesScreen(next: Pick<Snapshot, "blobs" | "ignored">, current: Pick<Snapshot, "blobs" | "ignored">): boolean {
  const others = (s: Pick<Snapshot, "ignored">) => [...s.ignored].sort().join("\n");
  return !sameBlobs(next.blobs, current.blobs) || others(next) !== others(current);
}

/**
 * A snapshot loaded for the screen. Only files this tab hasn't parsed before
 * (by blob SHA) are parsed, which may first load the parser. The ignored files
 * (a snapshot lists them) are reported as unexpected.
 */
async function fromSnapshot(s: Snapshot, preview = false): Promise<Loaded> {
  return { ...(await loadFolder(s)), ...s, preview };
}

/**
 * A fetched roadmap.json as a snapshot, its files kept for later reads. What
 * the build parsed them to is kept too, if this build's parser did it: then
 * showing them needs no parsing.
 */
async function snapshotOf(bundle: Bundle): Promise<Snapshot> {
  if (bundle.parsed?.parser === __BOXOPS_BUILD__) rememberParsed(bundle.parsed.files);
  return remember(await fromBundle(bundle));
}

/** fromSnapshot() at once, for a snapshot a save brings: saving has loaded the parser. */
function fromSaveSnapshot(s: Snapshot): Loaded {
  const loaded = loadFolderNow(s);
  if (!loaded) throw new Error("The roadmap parser isn’t loaded.");
  return { ...loaded, ...s, preview: false };
}

export function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  /** Bumped by Try again (and a token for a preview): load again. */
  const [attempt, setAttempt] = useState(0);
  const [lastSave, setLastSave] = useState<{ commit: string; url: string } | null>(null);
  const [remote, setRemote] = useState<RemoteUpdate | null>(null);
  /**
   * Every commit this tab has already shown or moved past. The deployed bundle
   * lags behind saves, so a bundle we've seen is old news, never an update.
   */
  const [seen] = useState(() => new Set<string>());
  /** Where what's on screen came from, and its files (blob SHAs, and the folder's other files). */
  const onScreen = useRef<Pick<Snapshot, "source" | "blobs" | "ignored"> | null>(null);
  /** Why newer saves on GitHub aren't on screen (newerProblem), until the tab moves on. */
  const [behind, setBehind] = useState<string | null>(null);
  const saving = useRef(false);

  /** A newer BoxOps built the site: this tab is read-only until it reloads. */
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const outdated = useRef(false);
  /** The site's notices for everyone (security releases and the like), from the latest roadmap.json. */
  const [notices, setNotices] = useState<Notice[]>([]);
  /** Read what a fetched roadmap.json says beyond the roadmap: its notices, and whether a newer BoxOps built it (true). */
  const noteSite = useCallback((bundle: Bundle): boolean => {
    setNotices((cur) => (JSON.stringify(cur) === JSON.stringify(bundle.notices) ? cur : bundle.notices));
    if (!isNewerApp(bundle.app)) return false;
    if (!outdated.current) {
      outdated.current = true;
      // Going read-only: commit a field being typed in first, so the draft has it.
      if (document.activeElement instanceof HTMLElement && isTyping(document.activeElement)) document.activeElement.blur();
      setUpdate({ ...bundle.app, format: bundle.format });
    }
    return true;
  }, []);

  const show = useCallback(
    (loaded: Loaded) => {
      if (onScreen.current?.source.commit !== loaded.source.commit) setBehind(null);
      onScreen.current = { source: loaded.source, blobs: loaded.blobs, ignored: loaded.ignored };
      seen.add(loaded.source.commit);
      // A newer commit with the same roadmap files (a change to the app, say):
      // only where it came from moves on. The roadmap stays the same object, so
      // the draft isn't carried over and its undo history stays.
      setState((cur) =>
        cur.status === "ready" && cur.preview === loaded.preview && !changesScreen(loaded, cur)
          ? { ...cur, source: loaded.source }
          : { status: "ready", ...loaded },
      );
    },
    [seen],
  );
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let live = true;
    const deadline = new AbortController();
    void (async () => {
      let bundle: Bundle;
      try {
        bundle = await fetchBundle(SITE_MS);
      } catch (e) {
        if (live) setState(siteProblem(e));
        return;
      }
      let base: Snapshot;
      try {
        base = await snapshotOf(bundle);
        if (!live) return;
        noteSite(bundle);
        seen.add(base.source.commit);
        const ref = new URLSearchParams(window.location.search).get("ref");
        if (ref && ref !== base.source.branch) {
          const loaded = await loadPreview(base, ref);
          if (live) setState(loaded);
          return;
        }

        // Paint the deployed copy at once. The site is redeployed a minute or so
        // after each save, so then, in the background and for a few seconds at
        // most, ask GitHub whether anyone saved since this deploy, and bring
        // their saves in like any other. Never for a copy built from files on
        // disk (read-only), nor for a private repository without a token (a call
        // that could only fail: viewers see the deployed copy).
        const loaded = await fromSnapshot(base);
        if (!live) return;
        show(loaded);
      } catch (e) {
        // Never "Loading…" for good: a bug, or a browser without what the app
        // needs (WebCrypto, which an insecure origin lacks, for an old bundle).
        if (live) setState(openProblem(e));
        return;
      }
      if (base.source.local) return;
      const gh = new GitHubClient({ token: getToken(base.source.repo), signal: deadline.signal });
      if (!canRead(base.source, gh)) return;
      const timer = setTimeout(() => deadline.abort(), FRESHNESS_MS);
      try {
        const fresh = await readSnapshot(gh, base, { seen });
        // Not once the tab has moved on (a poll, a save) or while it's saving.
        const moved = () => !live || saving.current || onScreen.current?.source.commit !== base.source.commit;
        if (fresh === base || moved()) return;
        const loaded = await fromSnapshot(fresh);
        if (moved()) return;
        show(loaded);
        if (changesScreen(fresh, base)) setRemote({ author: fresh.source.author, subject: fresh.source.subject });
      } catch (e) {
        // The deployed copy stays. A token GitHub rejects is forgotten; the next save asks for one.
        if (e instanceof GitHubFailure && e.kind === "unauthorized") setToken(base.source.repo, null);
        // Newer saves it won't read past: say so (a save would stop the same way).
        const problem = newerProblem(e);
        if (problem && live && onScreen.current?.source.commit === base.source.commit) setBehind(problem);
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      live = false;
      deadline.abort();
    };
  }, [attempt, seen, show, noteSite]);

  // Look for other people's saves every couple of minutes while the tab is
  // visible, in the site's own roadmap.json: a 304 when nothing changed, and
  // no GitHub API calls. Only ever forward (movesForward). A failed check
  // waits longer each time (4, 8, then 15 minutes); two in a row (offline, or
  // signed out of a private site) say so, but never stop the tab from saving.
  const pollable = state.status === "ready" && !state.preview && !state.source.local;
  const [lost, setLost] = useState(false);
  useEffect(() => {
    if (!pollable) return;
    let stopped = false;
    let checking = false;
    let failures = 0;
    let lastCheck = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = () => (failures ? Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS) : POLL_MS);
    /** The next check, counted from when the last one started (or from now). */
    const schedule = (from = Date.now()) => {
      clearTimeout(timer);
      timer = setTimeout(() => void check(), Math.max(0, from + wait() - Date.now()));
    };
    const check = async () => {
      if (stopped || checking) return;
      if (document.hidden || saving.current) return schedule();
      checking = true;
      lastCheck = Date.now();
      try {
        const bundle = await fetchBundle(SITE_MS);
        failures = 0;
        if (stopped) return;
        setLost(false);
        noteSite(bundle);
        const current = onScreen.current;
        if (!current || !movesForward(bundle.source, current.source, seen) || saving.current) return;
        const next = await snapshotOf(bundle);
        const loaded = await fromSnapshot(next);
        // Not if a save showed its commit meanwhile.
        if (stopped || saving.current || onScreen.current !== current) return;
        show(loaded);
        if (changesScreen(next, current)) setRemote({ author: bundle.source.author, subject: bundle.source.subject });
      } catch {
        failures++;
        if (!stopped && failures >= LOST_AFTER) setLost(true);
      } finally {
        checking = false;
        if (!stopped) schedule(lastCheck);
      }
    };
    schedule();
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastCheck >= wait()) void check();
    };
    const onOnline = () => {
      if (failures) void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [pollable, seen, show, noteSite]);

  if (state.status === "loading") return <div className="splash">Loading roadmap…</div>;
  if (state.status === "error") {
    const { newToken } = state;
    return (
      <LoadProblem
        {...state}
        onRetry={retry}
        onNewToken={
          newToken &&
          (() => {
            setToken(newToken.repo, null);
            setState({ status: "needs-token", ...newToken, rejected: false });
          })
        }
      />
    );
  }
  if (state.status === "needs-token") {
    return (
      <PreviewToken
        {...state}
        onSubmit={(token) => {
          setToken(state.repo, token);
          retry();
        }}
      />
    );
  }
  return (
    <RoadmapView
      {...state}
      seen={seen}
      notices={notices}
      update={update}
      onSite={noteSite}
      connectionLost={lost}
      behind={behind}
      onDismissBehind={() => setBehind(null)}
      lastSave={lastSave}
      remote={remote}
      onDismissSave={() => setLastSave(null)}
      onDismissRemote={() => setRemote(null)}
      onSavingChange={(busy) => (saving.current = busy)}
      onReload={(snapshot) => show(fromSaveSnapshot(snapshot))}
      onSaved={(result, others) => {
        if (result.status === "saved") seen.add(result.parent);
        show(fromSaveSnapshot(result.snapshot));
        if (result.status !== "noop") setLastSave({ commit: result.commit, url: result.url });
        setRemote(others);
      }}
    />
  );
}

const STEP_TEXT: Record<SaveStep, string> = {
  checking: "Checking for newer saves…",
  writing: "Writing the commit…",
  verifying: "Checking whether it went through…",
  retrying: "Trying again…",
};

/**
 * What a save is doing, with the seconds so far once it's slow: a save can
 * wait on GitHub for a minute or two. Only the step is announced, not every
 * second.
 */
function SaveProgress({ step }: { step: SaveStep }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.floor((now - start) / 1000);
  return (
    <span className="hint save-progress">
      <span role="status">{STEP_TEXT[step]}</span>
      {seconds >= 5 ? ` ${seconds} s` : ""}
    </span>
  );
}

interface ViewProps extends Loaded {
  /** Commits the tab has already shown or moved past (see App). */
  seen: ReadonlySet<string>;
  /** Shown as plain text, never as HTML. */
  notices: Notice[];
  /** A newer BoxOps built the site (read-only until reloaded). */
  update: AppUpdate | null;
  /** A roadmap.json fetched before saving: true if a newer BoxOps built it. */
  onSite(bundle: Bundle): boolean;
  /** Checks for others' saves keep failing. */
  connectionLost: boolean;
  /** Why newer saves on GitHub aren't on screen, if the load-time check couldn't bring them in. */
  behind: string | null;
  onDismissBehind(): void;
  lastSave: { commit: string; url: string } | null;
  remote: RemoteUpdate | null;
  onDismissSave(): void;
  onDismissRemote(): void;
  onSavingChange(busy: boolean): void;
  /** Show this newer commit; the draft is carried over onto it. */
  onReload(snapshot: Snapshot): void;
  /** `others`: someone else's saves that came in with it (it went on top of them, or found them on top of it). */
  onSaved(result: SaveResult, others: RemoteUpdate | null): void;
}

/**
 * Someone else's saves a save of ours brought in: a racing save it went on
 * top of (or one already on top of an earlier attempt of ours). Roadmap files
 * it didn't write that differ from the copy it was made on are theirs. Named
 * by the newest of them when that's known.
 */
function othersIn(result: SaveResult, blobs: Record<string, string>, changes: FileChanges): RemoteUpdate | null {
  const after = result.snapshot.blobs;
  if (!Object.keys({ ...blobs, ...after }).some((p) => !(p in changes) && blobs[p] !== after[p])) return null;
  if (result.status === "saved") return { author: result.parentAuthor, subject: result.parentSubject };
  // The head is ours: whose saves are under it isn't known.
  if (result.status === "alreadySaved" && result.snapshot.source.commit === result.commit) return {};
  return { author: result.snapshot.source.author, subject: result.snapshot.source.subject };
}

/** "BoxOps was updated to 0.2.0 — Reload to keep editing." (no version when it's the same, or unknown) */
function updatedText(app: AppInfo): string {
  const mine = __BOXOPS_BUILD__.split("+")[0];
  return `BoxOps was updated${app.version && app.version !== mine ? ` to ${app.version}` : ""} — Reload to keep editing.`;
}

const two = (n: number) => String(n).padStart(2, "0");
/** An ISO time as "2026-10-02 16:05", in this browser's time zone. */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

const NO_LINES: ChangeLine[] = [];

/**
 * A stored draft this tab didn't make: one a tab that's gone left behind
 * (restore it, or discard it), or one only another version of BoxOps can open,
 * or none can (download it, or discard it). Never taken without asking.
 */
function OfferBanner({ offer, busy, onRestore, onDiscard }: { offer: DraftOffer; busy: boolean; onRestore(): void; onDiscard(): void }) {
  const changes = `${offer.count} change${offer.count === 1 ? "" : "s"}`;
  const when = offer.savedAt ? stamp(offer.savedAt) : "";
  const discard = () => {
    if (confirm(`Discard ${offer.restorable ? `these ${changes}` : "these unsaved edits"} for good? This can’t be undone.`)) onDiscard();
  };
  if (offer.restorable) {
    return (
      <div className="banner" role="status">
        <span>
          <strong>Restore unsaved changes from another tab?</strong> {changes}
          {when ? `, last changed ${when},` : ""} in a tab that’s no longer open.
        </span>
        <button className="primary" onClick={onRestore} disabled={busy}>
          Restore
        </button>
        <button onClick={discard} disabled={busy}>
          Discard…
        </button>
      </div>
    );
  }
  return (
    <div className="banner notice-warning" role="status">
      <span>
        <strong>{offer.unreadable ? "Unsaved edits kept in this browser can’t be read" : "Unsaved edits made with another version of BoxOps"}</strong>
        {when ? ` (last changed ${when})` : ""}
        {offer.unreadable ? ", so they can’t be opened." : " can’t be opened here."}
      </span>
      <button className="primary" onClick={() => downloadJson({ [offer.key]: offer.value })}>
        Download my unsaved edits (JSON)
      </button>
      <button onClick={discard}>Discard…</button>
    </div>
  );
}

/** A site notice's key, by what it says: the same notice twice is shown once. */
const noticeKey = (n: Notice) => `${n.level}:${n.text}`;

/** `roadmap/people.yaml, line 12: …` */
const issueText = (i: Issue) => `roadmap/${i.path}${i.line ? `, line ${i.line}` : ""}: ${i.message}`;

function RoadmapView(props: ViewProps) {
  const { roadmap: base, issues, files, source, lastSave, remote } = props;
  // Read-only, like a branch preview: a roadmap in another data format, a copy
  // built from files on disk (`npm run dev`, or a build with uncommitted
  // roadmap/ changes), a site built not to save, and a tab whose BoxOps is
  // older than the site's (its code could drop what the newer one writes).
  const preview = props.preview || props.formatStatus !== "current" || !!source.local || source.readonly || props.update !== null;
  // A private repository and no token: no call to GitHub is made, so this is the deployed copy.
  const deployedCopy = source.private && !preview && !getToken(source.repo);
  const { onDismissSave, onDismissRemote, onSavingChange, onReload, onSaved } = props;
  const initial = useMemo(readUrlState, []);
  const prefs = usePrefs();
  // A link's view and zoom win; then your preference; then the team default.
  const [view, setView] = useState<ViewMode>(initial.view ?? getPrefs().openOn);
  /** A view whose tab was clicked, shown as loading (`viewPending`) until its code is here. */
  const [nextView, setNextView] = useState<ViewMode>(view);
  const [viewPending, startView] = useTransition();
  const [zoom, setZoom] = useState<ZoomLevel>(initial.zoom ?? getPrefs().zoom ?? base.settings.default_zoom);
  const [modal, setModal] = useState<"key" | "shortcuts" | "team" | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => initial.collapsed ?? new Set(base.departments.filter((d) => d.collapsed).map((d) => d.id)),
  );
  const [jumpToToday, setJumpToToday] = useState(0);
  const [deptEditor, setDeptEditor] = useState<DepartmentEditorTarget | null>(null);
  const editDepartment = (id: string) => {
    select(null);
    draft.checkpoint();
    setDeptEditor({ kind: "edit", id });
  };
  const addDepartment = () => {
    select(null);
    draft.checkpoint();
    setDeptEditor({ kind: "new" });
  };
  const [busy, setBusyState] = useState(false);
  const [step, setStep] = useState<SaveStep>("checking");
  const setBusy = (b: boolean) => {
    setBusyState(b);
    if (b) setStep("checking");
    onSavingChange(b);
  };
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  /** Notices dismissed in this page view (by text). */
  const [dismissed, setDismissed] = useState<string[]>([]);
  /** A save found newer saves on GitHub; once the draft is carried over, ask about any clashes. */
  const askAfterRebase = useRef(false);
  /**
   * The next roadmap change is our own save coming back: the boxes it changed.
   * Any other box that changed is from someone else's save it went on top of.
   */
  const ownSave = useRef<Set<string> | null>(null);

  const draftBase = useMemo(
    () => ({ boxes: base.boxes, departments: base.departments, people: base.people, settings: base.settings }),
    [base],
  );
  const draft = useDraft(draftBase, { scope: `${source.repo}@${source.branch}`, commit: source.commit, build: __BOXOPS_BUILD__ });
  // Should anything below crash, the recovery screen offers this tab's draft (and no other's).
  noteDraft(draft.storageKey, draft.kept);
  // The department being edited is gone (undone, or deleted in someone else's save): its editor closes.
  const editedGone = deptEditor?.kind === "edit" && !draft.departments.some((d) => d.id === deptEditor.id);
  useEffect(() => {
    if (editedGone) setDeptEditor(null);
  }, [editedGone]);
  // Up and running a few seconds: a crash after this isn't "the same one again" (ErrorBoundary).
  useEffect(() => {
    const t = setTimeout(runningFine, 5000);
    return () => clearTimeout(t);
  }, []);
  // Fetch the editors once the roadmap is up, so the first one opened doesn't wait.
  useEffect(() => {
    if (preview) return;
    const t = setTimeout(() => [BoxEditor, PtoEditor, DepartmentEditor, TeamSettings].forEach((part) => part.preload()), EDITORS_AFTER_MS);
    return () => clearTimeout(t);
  }, [preview]);
  const draftState: DraftState = useMemo(
    () => ({ boxes: draft.boxes, departments: draft.departments, people: draft.people, settings: draft.settings }),
    [draft.boxes, draft.departments, draft.people, draft.settings],
  );
  const roadmap = useMemo(() => ({ ...base, ...draftState }), [base, draftState]);
  /** Today, moving on at midnight: every view and warning uses the same day. */
  const now = useToday();
  // What the views draw: finished boxes can be hidden (warnings still count them).
  const shown = useMemo(
    () => (prefs.hideFinished ? { ...roadmap, boxes: roadmap.boxes.filter((b) => b.end >= now) } : roadmap),
    [roadmap, prefs.hideFinished, now],
  );
  /** Box files the loader couldn't fully read: new boxes never take their codes or ids (saving over one is refused). */
  const reserved = useMemo(() => reservedBoxes(props.lossy, files), [props.lossy, files]);
  /** And department files: new departments and lanes never take the ids or codes in them, or a lane such a box is in. */
  const reservedDepts = useMemo(() => reservedDepartments(props.lossy, files, props.sources), [props.lossy, files, props.sources]);

  // `session` makes each opening of the editor its own run of undo steps.
  const [selected, setSelected] = useState<{ id: string; session: number } | null>(null);
  const selectedBox = selected ? draft.boxes.find((b) => b.id === selected.id) : undefined;

  const select = useCallback(
    (id: string | null) => {
      draft.checkpoint();
      setSelected((cur) => (id === null ? null : cur?.id === id ? cur : { id, session: Date.now() }));
      setSelectedPto(null);
    },
    [draft],
  );

  // PTO lives on the person; a block is picked out by its owner and position.
  const [selectedPto, setSelectedPto] = useState<(PtoRef & { session: number }) | null>(null);
  const ptoOf = (ref: PtoRef) => draft.people.find((p) => p.id === ref.personId)?.pto?.[ref.index];
  const selectPto = (ref: PtoRef | null) => {
    draft.checkpoint();
    setSelected(null);
    setSelectedPto((cur) =>
      ref === null ? null : cur && ptoKey(cur) === ptoKey(ref) ? cur : { ...ref, session: Date.now() },
    );
  };
  const setPtoList = (personId: string, change: (list: TimeOff[]) => TimeOff[], key?: string) => {
    const person = draft.people.find((p) => p.id === personId);
    if (person) draft.updatePerson(personId, { pto: change(person.pto ?? []) }, key);
  };
  const updatePto = (ref: PtoRef, patch: Partial<TimeOff>, key?: string) =>
    setPtoList(ref.personId, (list) => list.map((t, i) => (i === ref.index ? { ...t, ...patch } : t)), key);
  const removePto = (ref: PtoRef) => {
    setPtoList(ref.personId, (list) => list.filter((_, i) => i !== ref.index));
    setSelectedPto((cur) => (cur && ptoKey(cur) === ptoKey(ref) ? null : cur));
  };
  /** Add PTO for someone (by default the first engineer in the department); returns where it went. */
  const addPto = (dates: Pick<TimeOff, "start" | "end">, who: { personId?: string; departmentId?: string }): PtoRef | null => {
    const person =
      draft.people.find((p) => p.id === who.personId) ??
      [...draft.people].filter((p) => p.department === who.departmentId).sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!person) return null;
    setPtoList(person.id, (list) => [...list, { ...dates }]);
    draft.checkpoint();
    return { personId: person.id, index: person.pto?.length ?? 0 };
  };
  /** Give a PTO block to someone else; it keeps its dates and note. */
  const reassignPto = (ref: PtoRef, toId: string, key?: string) => {
    const pto = ptoOf(ref);
    const to = draft.people.find((p) => p.id === toId);
    if (!pto || !to || toId === ref.personId) return ref;
    setPtoList(ref.personId, (list) => list.filter((_, i) => i !== ref.index), key);
    draft.updatePerson(toId, { pto: [...(to.pto ?? []), pto] }, key);
    return { personId: toId, index: to.pto?.length ?? 0 };
  };

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (view === "timeline") q.delete("view");
    else q.set("view", view);
    q.set("zoom", zoom);
    q.set("collapsed", [...collapsed].join(","));
    history.replaceState(null, "", `?${q}${window.location.hash}`);
  }, [view, zoom, collapsed]);

  useEffect(() => {
    document.title = props.preview ? `${draft.settings.title} (${source.branch})` : draft.settings.title;
  }, [draft.settings.title, props.preview, source.branch]);

  const selectedPtoRef = useRef(selectedPto);
  selectedPtoRef.current = selectedPto;
  const removePtoRef = useRef(removePto);
  removePtoRef.current = removePto;

  /** The update banner's Reload: where ⌘S goes in a tab gone read-only for a newer BoxOps. */
  const updateReload = useRef<HTMLButtonElement>(null);

  // ⌘S, undo/redo and delete. Text fields keep their own native undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        // Like saving a file — and never the browser's "save page" dialog, read-only too.
        e.preventDefault();
        // Read-only: nothing to save; for a newer BoxOps, what to do is reload.
        if (preview) return updateReload.current?.focus();
        if (busy || problem) return;
        // A table or people cell keeps what's typed until it loses focus: commit
        // it, then save on the next tick, once the draft has it.
        if (isTyping(document.activeElement)) {
          (document.activeElement as HTMLElement).blur();
          setTimeout(() => saveRef.current(), 0);
        } else saveRef.current();
        return;
      }
      if (preview || isTyping(e.target) || busy) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) draft.redo();
        else draft.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        draft.redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        draft.removeBox(selected.id);
        setSelected(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedPtoRef.current) {
        e.preventDefault();
        removePtoRef.current(selectedPtoRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, selected, preview, busy, problem]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allCollapsed = draft.departments.every((d) => collapsed.has(d.id));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(draft.departments.map((d) => d.id)));

  const placeBox = useCallback((id: string, p: BoxPlacement) => draft.updateBox(id, p), [draft]);

  const createBox = useCallback(
    (p: BoxPlacement) => {
      const id = draft.addBox(
        {
          ...p,
          title: "New box",
          fte: 1,
          type: draft.settings.types[0].id,
        },
        reserved,
      );
      draft.checkpoint();
      setSelected({ id, session: Date.now() });
    },
    [draft, reserved],
  );

  const editBox = (patch: Partial<Box>, field: string) => {
    if (!selected) return;
    const id = draft.updateBox(selected.id, patch, `${selected.session}:${field}`);
    if (id !== selected.id) setSelected({ ...selected, id });
  };

  // Unsaved changes are counted as the save will list them: one per line.
  const lines = useMemo(
    () => (draft.changes.count ? describeChanges(draftBase, draftState, draft.changes) : NO_LINES),
    [draftBase, draftState, draft.changes],
  );
  const count = lines.length;
  // Notices about where unsaved changes are kept: other tabs' (until put away,
  // or until there are none), and this browser refusing to keep this tab's
  // (shown once).
  const [othersDismissed, setOthersDismissed] = useState(false);
  useEffect(() => {
    if (!draft.others) setOthersDismissed(false);
  }, [draft.others]);
  const [storageWarned, setStorageWarned] = useState(false);
  const unsaved = `${count} unsaved change${count === 1 ? "" : "s"}`;
  const them = count === 1 ? "it" : "them";
  // Unsaved changes in this data format, when the BoxOps an upgrade brings
  // reads another: it won't open them (draftStore's asRecord), only offer
  // them as a download.
  const stranded = count > 0 && ((!!props.update?.format && props.update.format !== FORMAT) || props.formatStatus === "newer");
  /** What reloading for an update does to the unsaved changes, if there are any. */
  const keptOnReload = !count
    ? ""
    : !draft.kept
      ? ` This browser isn’t keeping your ${unsaved}: download ${them} first, or reloading loses ${them}.`
      : stranded
        ? " Your unsaved changes can’t come along: the new BoxOps uses another data format, so after reloading it offers them only as a download (JSON)."
        : " Your unsaved changes are kept in this browser.";
  /** This tab's unsaved changes as a JSON file, as the crash screen and another version's offer give them. */
  const downloadDraft = () => downloadJson({ [draft.storageKey]: draft.record() });
  // Reloading loses unsaved changes this browser isn't keeping: every Reload
  // in the app (an update, a lost connection, a part that couldn't load) asks.
  useEffect(() => {
    if (!count || draft.kept) return;
    guardReload(() => confirm(`Reload and lose ${unsaved}? This browser isn’t keeping ${them}.`));
    return () => guardReload(null);
  }, [count, draft.kept, unsaved, them]);
  const discardAll = () => {
    if (confirm(`Discard ${count} change${count === 1 ? "" : "s"}? You can still undo this.`)) {
      setSelected(null);
      draft.discard();
    }
  };

  // Someone is editing: fetch what saving needs now, so a save doesn't wait for it.
  const editing = !preview && (count > 0 || !!selected || !!selectedPto || !!deptEditor || modal === "team");
  useEffect(() => {
    if (!editing) return;
    loadSaving().catch(() => {}); // a save tries again, and says if it can't
    SaveDialog.preload();
  }, [editing]);
  /** A save waiting for saving's code: another doesn't start meanwhile. */
  const fetchingSaving = useRef(false);

  /** A conflict key (`box:<id>`, `dept:<id>`, `person:<id>` or team settings) in words, for the conflict dialog. */
  const describeItem = (key: string) => {
    const id = key.slice(key.indexOf(":") + 1);
    if (key.startsWith("box:")) {
      const box = draft.boxes.find((b) => b.id === id) ?? base.boxes.find((b) => b.id === id);
      return `Box “${box?.title ?? id}”`;
    }
    if (key.startsWith("person:")) {
      const person = draft.people.find((p) => p.id === id) ?? base.people.find((p) => p.id === id);
      return `Engineer “${person?.name ?? id}”`;
    }
    if (key === SETTINGS_KEY) return "Team settings";
    return `Department “${draft.departments.find((d) => d.id === id)?.name ?? id}” (lanes)`;
  };

  /**
   * `keep`: the user chose whose version of clashing items to keep (so no
   * review first). `token`: just pasted. `reviewed`: the user saw the changes
   * restored from storage listed and chose to save them.
   */
  const save = async (opts: Resume & { token?: string; reviewed?: boolean } = {}): Promise<void> => {
    // A pasted token is kept straight away, before anything below can stop
    // the save (a clash that came in while the token form was open, say), so
    // retries and the re-save after a choice never ask for it again; only a
    // 401 forgets it.
    if (opts.token) setToken(source.repo, opts.token);
    // Read-only since the dialog that led here opened (a newer BoxOps was
    // deployed, say): this tab's code never writes.
    if (preview) return setProblem(null);
    // Items someone else changed while we were editing them: the user picks
    // first. A choice settles the clashes it was shown (the draft has it by
    // now); any left came in since, from a poll while the dialog was open.
    const clashes = draft.conflicts;
    if (clashes.length) return setProblem({ kind: "conflict", keys: clashes, items: clashes.map(describeItem) });
    const resume: Resume = opts.keep ? { keep: opts.keep } : {};
    const s = saving;
    if (!s) {
      // Saving's code isn't here yet (a save straight after the first edit): fetch
      // it, then start again with the draft as it is by then.
      if (fetchingSaving.current) return;
      fetchingSaving.current = true;
      try {
        await loadSaving();
      } catch (e) {
        const why = (e as Error).message;
        return setProblem(
          // Again: this browser may keep the failure until the page reloads (lazyPart.tsx).
          savingFailures > 1
            ? {
                kind: "error",
                message: `Part of BoxOps couldn’t load, so nothing was saved (${why}). Once you’re connected, reload the page, then save.`,
                reload: "instead",
              }
            : {
                kind: "error",
                message: `Part of BoxOps couldn’t load, so nothing was saved (${why}). Check your connection and try again; if the site was updated since this page opened, reload, then save.`,
                resume,
                reload: "also",
              },
        );
      } finally {
        fetchingSaving.current = false;
      }
      return saveRef.current(opts);
    }
    /** Problems these files have that the loaded roadmap didn't (pre-existing ones don't block saving). */
    const newProblems = (next: RoadmapFiles) => {
      const known = new Set(issues.map((i) => i.key));
      return s
        .loadRoadmap(next)
        .issues.filter((i) => !known.has(i.key))
        .map(issueText);
    };
    const target = draftState;
    let changes: FileChanges;
    try {
      changes = s.serializeChanges(files, draftBase, target, props);
      if (Object.keys(changes).length === 0) return;
      const invalid = newProblems(s.applyChanges(files, changes));
      if (invalid.length) return setProblem({ kind: "invalid", issues: invalid });
    } catch (e) {
      // A file the app couldn't fully read is never written: it would lose what was left out.
      if (e instanceof s.UnsafeWrite) return setProblem({ kind: "unwritable", files: e.files });
      return setProblem({ kind: "error", message: (e as Error).message });
    }
    // Changes this page view didn't make, restored from storage that any page
    // on this origin (every Pages site of the owner) can write: the first save
    // lists them, so nothing is committed in the user's name unseen. ⌘S too.
    if (draft.fromStorage && !opts.reviewed) return setProblem({ kind: "review", resume });
    const token = opts.token ?? getToken(source.repo);
    // The choice just made comes back with the token, so it isn't asked again.
    if (!token) return setProblem({ kind: "token", resume });
    const gh = new GitHubClient({ token });

    select(null);
    draft.flush();
    setBusy(true);
    try {
      // A new BoxOps deployed that the poll hasn't seen yet: this tab's code
      // mustn't write. A roadmap.json that can't be fetched (or stalls: a
      // captive portal, a flaky network) says nothing.
      const site = await fetchBundle(SITE_CHECK_MS).catch(() => null);
      if (site && props.onSite(site)) {
        setBusy(false);
        return;
      }
      // The pre-save check (unless the user already chose whose version to
      // keep): if anyone saved roadmap changes since this tab loaded, bring
      // them in and let the user review before anything is written. Either
      // way, newer saves our changes would be invalid on come in like that.
      const result = await s.saveRoadmap({
        gh,
        base: { source, files, blobs: props.blobs, ignored: props.ignored },
        changes,
        message: commitMessage(lines),
        review: !opts.keep,
        seen: props.seen,
        validate: newProblems,
        onProgress: setStep,
      });
      setBusy(false);
      const ours = diffBoxes(draftBase.boxes, target.boxes);
      ownSave.current = new Set([...ours.added, ...ours.modified, ...ours.removed].map((b) => b.id));
      setUpdatedIds(new Set());
      // The roadmap that comes back is rebased from what this save wrote, so an
      // edit (or undo) made while it ran is ours, not a clash with our own commit.
      draft.saved(target);
      onSaved(result, othersIn(result, props.blobs, changes));
    } catch (e) {
      if (e instanceof s.NewerSaves) {
        const head = e.head;
        const saves = await gh.compare(source.repo, source.commit, head.source.commit).catch(() => []);
        const { roadmap: latest } = s.loadRoadmap(head.files, head.ignored);
        const latestState = { boxes: latest.boxes, departments: latest.departments, people: latest.people, settings: latest.settings };
        const theirs = describeChanges(draftBase, latestState);
        const clashes = rebaseDraft(draftBase, draftState, latestState).conflicts;
        setBusy(false);
        onReload(head);
        setProblem({ kind: "updated", saves, changes: theirs, keys: clashes, clashes: clashes.map(describeItem) });
        return;
      }
      if (e instanceof s.NewerFormat) {
        setProblem({ kind: "upgrading", format: e.format });
      } else if (e instanceof s.SaveConflict) {
        // Someone saved the same items since we loaded: move onto their version,
        // then ask (see the effect below) once the clashes are known.
        askAfterRebase.current = true;
        onReload(e.head);
      } else if (e instanceof GitHubFailure && e.kind === "unauthorized") {
        setToken(source.repo, null);
        setProblem({ kind: "token", rejected: true, resume });
      } else if (e instanceof GitHubFailure) {
        setProblem({ kind: "github", failure: e, resume });
      } else if (e instanceof FolderProblems) {
        // Not this tab's to fix: trying again fails the same way until someone fixes the folder.
        setProblem({ kind: "folder", problems: e.lines });
      } else if (e instanceof TooManyChanges) {
        // The same read fails until this tab reloads onto a newer deploy.
        setProblem({ kind: "error", message: e.message, reload: "instead" });
      } else {
        setProblem({ kind: "error", message: (e as Error).message, resume });
      }
      setBusy(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  /** A save to go on with once the draft has the user's choice for the clashes they were shown. */
  const [resumeSave, setResumeSave] = useState<Resume | null>(null);
  useEffect(() => {
    if (!resumeSave) return;
    setResumeSave(null);
    void saveRef.current(resumeSave);
  }, [resumeSave]);

  // A read-only tab shows no save dialog: one left open when a newer BoxOps
  // arrived closes (once a save under way is done), as old code never writes.
  useEffect(() => {
    if (preview && !busy) setProblem(null);
  }, [preview, busy]);

  useEffect(() => {
    if (!askAfterRebase.current) return;
    askAfterRebase.current = false;
    if (draft.conflicts.length) setProblem({ kind: "conflict", keys: draft.conflicts, items: draft.conflicts.map(describeItem) });
    else void saveRef.current(); // their changes didn't actually clash with ours
    // Only when the rebased files arrive, with the conflicts as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [files]);

  // Boxes someone else added or changed since this tab loaded, highlighted for
  // review until clicked, until the notice is dismissed, or until we save.
  const [updatedIds, setUpdatedIds] = useState<Set<string>>(new Set());
  const prevBase = useRef(draftBase);
  useEffect(() => {
    const prev = prevBase.current;
    prevBase.current = draftBase;
    if (prev === draftBase) return;
    const ours = ownSave.current;
    ownSave.current = null;
    const d = diffBoxes(prev.boxes, draftBase.boxes);
    const ids = [...d.added, ...d.modified].map((b) => b.id).filter((id) => !ours?.has(id));
    if (ids.length) setUpdatedIds((cur) => new Set([...cur, ...ids]));
  }, [draftBase]);

  // Broken rules: shown on the boxes, listed in the toolbar, and announced when an edit breaks one.
  const violations = useMemo(() => findViolations(draft.boxes, draft.departments), [draft.boxes, draft.departments]);
  const ruleWarnings = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of violations) for (const b of [v.from, v.to]) m.set(b.id, [...(m.get(b.id) ?? []), v.message]);
    return m;
  }, [violations]);
  const [newlyBroken, setNewlyBroken] = useState<Violation[]>([]);
  const knownBroken = useRef<Set<string> | null>(null);
  const brokenBase = useRef(draftBase);
  useEffect(() => {
    const key = (v: Violation) => `${v.from.code}:${v.type}:${v.to.code}`;
    const now = new Set(violations.map(key));
    // Announced only for the user's own edits: not for a save merged in from
    // someone else (polling, the pre-save check) or our own coming back.
    const elsewhere = brokenBase.current !== draftBase;
    brokenBase.current = draftBase;
    if (knownBroken.current && !elsewhere) {
      const fresh = violations.filter((v) => !knownBroken.current!.has(key(v)));
      if (fresh.length) setNewlyBroken(fresh);
    }
    knownBroken.current = now;
  }, [violations, draftBase]);
  useEffect(() => {
    if (!newlyBroken.length) return;
    const t = setTimeout(() => setNewlyBroken([]), 10_000);
    return () => clearTimeout(t);
  }, [newlyBroken]);

  const conflictBoxIds = useMemo(
    () => new Set(draft.conflicts.filter((k) => k.startsWith("box:")).map((k) => k.slice(4))),
    [draft.conflicts],
  );
  /** Show a box on the timeline: expand its department, select it, scroll to it. */
  const goToBox = (id: string) => {
    const box = draft.boxes.find((b) => b.id === id);
    const dept = box && draft.departments.find((d) => d.lanes.some((l) => l.id === box.lane));
    setView("timeline");
    if (dept) setCollapsed((prev) => (prev.has(dept.id) ? new Set([...prev].filter((x) => x !== dept.id)) : prev));
    select(id);
    requestAnimationFrame(() =>
      document.querySelector(`[data-box-id="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }),
    );
  };
  const goToDepartment = (id: string) => {
    setView("timeline");
    setCollapsed((prev) => new Set([...prev].filter((x) => x !== id)));
    requestAnimationFrame(() => document.querySelector(`[data-dept-id="${id}"]`)?.scrollIntoView({ block: "nearest" }));
  };

  // Departments over capacity now or later (past overloads are history, not a
  // warning), by the worst stretch, as the timeline's department headings say.
  const overloaded = useMemo(
    () =>
      draft.departments.flatMap((d) => {
        const over = overCapacity(d, draft.boxes).filter((x) => x.to >= now);
        return over.length ? [{ id: d.id, text: `${d.name}: ${overloadText(over)}` }] : [];
      }),
    [draft.boxes, draft.departments, now],
  );

  // Engineers booked on a box while they're on PTO (from today on).
  const onPto = useMemo(
    () => ptoClashes(draft.boxes, draft.people).filter((c) => c.box.end >= now && c.pto.end >= now),
    [draft.boxes, draft.people, now],
  );

  /** Show a PTO block on the timeline and open it. */
  const goToPto = (ref: PtoRef) => {
    const dept = draft.people.find((p) => p.id === ref.personId)?.department;
    setView("timeline");
    if (dept) setCollapsed((prev) => (prev.has(dept) ? new Set([...prev].filter((x) => x !== dept)) : prev));
    selectPto(ref);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-pto-key="${CSS.escape(ptoKey(ref))}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }),
    );
  };

  const warningGroups: WarningGroup[] = [
    {
      title: "Clashes with someone else’s save",
      items: draft.conflicts.map((k) => ({
        text: `${describeItem(k)}: you’ll choose whose version to keep when you save`,
        onGo: k.startsWith("box:") ? () => goToBox(k.slice(4)) : undefined,
      })),
    },
    { title: "Broken rules", items: violations.map((v) => ({ text: v.message, onGo: () => goToBox(v.from.id) })) },
    { title: "Over capacity", items: overloaded.map((o) => ({ text: o.text, onGo: () => goToDepartment(o.id) })) },
    {
      title: "Booked during PTO",
      items: onPto.map((c) => ({
        text: `${c.person.name} is on PTO ${ptoRange(c.pto)} but on ${c.box.title} (${prettyDay(c.box.start)} – ${prettyDay(c.box.end)})`,
        onGo: () => goToBox(c.box.id),
      })),
    },
    { title: "Problems in the roadmap files", items: issues.map((i) => ({ text: issueText(i) })) },
  ];

  return (
    <div className={`app density-${prefs.density}`}>
      {/* An explicit tabindex: Safari's Tab otherwise skips links. */}
      <a
        className="skip-link"
        href="#main"
        tabIndex={0}
        onClick={(e) => {
          e.preventDefault(); // focus the roadmap without putting #main in the address
          document.getElementById("main")?.focus();
        }}
      >
        Skip to roadmap
      </a>
      <header className="toolbar">
        <div className="toolbar-zone start">
          <Logo />
          <h1>{draft.settings.title}</h1>
          <div className="segmented" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                aria-pressed={view === v.id}
                aria-busy={viewPending && nextView === v.id ? true : undefined}
                onPointerEnter={VIEW_PARTS[v.id]?.preload}
                onFocus={VIEW_PARTS[v.id]?.preload}
                onClick={() => {
                  if (v.id !== "timeline") select(null);
                  setNextView(v.id);
                  // The view on screen stays until the new one's code is here; its tab says it's coming.
                  startView(() => setView(v.id));
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="toolbar-zone middle">
          {view === "timeline" && (
            <>
              <div className="segmented" role="group" aria-label="Zoom">
                {ZOOM_LEVELS.map((z) => (
                  <button key={z} aria-pressed={z === zoom} onClick={() => setZoom(z)}>
                    {ZOOM_LABEL[z]}
                  </button>
                ))}
              </div>
              <button className="today-button" onClick={() => setJumpToToday((n) => n + 1)}>
                Today
              </button>
            </>
          )}
        </div>

        <div className="toolbar-zone end">
          {deployedCopy && (
            // A toggletip: a button that shows what it means, for the keyboard and touch too.
            <Popover className="site-copy" label="Deployed copy" buttonClass="hint" button="Deployed copy">
              {() => (
                <p className="menu-note">
                  {source.repo} is private, so without a GitHub token this tab shows the site’s copy
                  {source.date ? `, deployed from a commit of ${stamp(source.date)}` : ""}. Others’ saves appear a minute or
                  two after each one, once the site has redeployed. Saving asks for a token and checks for newer saves first.
                </p>
              )}
            </Popover>
          )}
          <WarningsMenu groups={warningGroups} />
          {!preview && (
            <div className="draft-status">
              <button className="icon-only" onClick={draft.undo} disabled={!draft.canUndo} title="Undo (⌘Z)" aria-label="Undo">
                <Icon name="undo" size={16} />
              </button>
              <button className="icon-only" onClick={draft.redo} disabled={!draft.canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">
                <Icon name="redo" size={16} />
              </button>
              {busy && <SaveProgress step={step} />}
              {count > 0 ? (
                <div className="split-button">
                  <button
                    className="primary"
                    onClick={() => save()}
                    disabled={busy}
                    title={
                      draft.kept
                        ? "Save to GitHub (⌘S). Until then, changes are kept in this browser."
                        : "Save to GitHub (⌘S). This browser isn’t keeping your changes, so save before closing the tab."
                    }
                  >
                    {busy ? "Saving…" : `Save · ${count} change${count === 1 ? "" : "s"}`}
                  </button>
                  <Popover label="More save options" buttonClass="primary split-more" button={<Icon name="chevron-down" size={14} />} className="save-more">
                    {(close) => (
                      <>
                        <button
                          className="menu-item danger-text"
                          disabled={busy}
                          onClick={() => {
                            close();
                            discardAll();
                          }}
                        >
                          Discard {count === 1 ? "this change" : `all ${count} changes`}…
                        </button>
                        <p className="menu-note">
                          {draft.kept
                            ? "Unsaved changes are kept in this browser, even if you close the tab."
                            : "This browser isn’t keeping unsaved changes right now: save before you close the tab."}
                        </p>
                      </>
                    )}
                  </Popover>
                </div>
              ) : (
                <span className="hint">No changes</span>
              )}
            </div>
          )}
          <SettingsMenu
            teamZoom={draft.settings.default_zoom}
            changes={count}
            onDiscard={discardAll}
            onZoom={setZoom}
            historyUrl={`https://github.com/${source.repo}/commits/${source.branch}/roadmap`}
            repo={source.repo}
            readOnly={preview}
            onOpenKey={() => setModal("key")}
            onOpenShortcuts={() => setModal("shortcuts")}
            onOpenTeam={() => {
              select(null);
              draft.checkpoint();
              setModal("team");
            }}
          />
        </div>
      </header>

      <main id="main" tabIndex={-1} aria-labelledby="view-heading">
        <h2 id="view-heading" className="sr-only">
          {VIEWS.find((v) => v.id === view)!.label}
        </h2>
        {props.notices
          .filter((n, i, all) => all.findIndex((m) => noticeKey(m) === noticeKey(n)) === i && !dismissed.includes(n.text))
          .map((n) => (
            <div key={noticeKey(n)} className={`banner notice-${n.level}`} role={n.level === "info" ? "status" : "alert"}>
              <span>{n.text}</span>
              <button className="icon-button" onClick={() => setDismissed((d) => [...d, n.text])} aria-label="Dismiss">
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
        {/* A banner is a flex row: its text goes in one <span>, or each run of text, <code> and link is spaced apart. */}
        {props.preview && (
          <div className="banner">
            <span>
              Previewing branch <code>{source.branch}</code> (read-only). <a href={liveUrl()}>Back to the live roadmap</a>
            </span>
          </div>
        )}
        {source.local && !props.preview && (
          <div className="banner">
            <span>
              Read-only: this copy was built from the files on disk (<code>npm run dev</code>, or a build with uncommitted
              changes in <code>roadmap/</code>), so it can’t save. Edit the YAML files, or save from the deployed site.
            </span>
          </div>
        )}
        {source.readonly && !source.local && !props.preview && <div className="banner">Read-only: this site doesn’t save.</div>}
        {/* A newer format with a newer BoxOps to reload onto: the update banner says what to do. */}
        {props.formatStatus !== "current" && !(props.formatStatus === "newer" && props.update) && (
          <div className="banner">
            <span>
              {props.formatStatus === "older" && files["settings.yaml"] === undefined ? (
                <>
                  Read-only: the roadmap has no <code>roadmap/settings.yaml</code>, which says which data format the files
                  use. Add one holding <code>format: {FORMAT}</code> to edit the roadmap here.
                </>
              ) : props.formatStatus === "older" ? (
                <>
                  Read-only: <code>roadmap/settings.yaml</code> doesn’t say which data format the files use. Add{" "}
                  <code>format: {FORMAT}</code> to it to edit the roadmap here.
                </>
              ) : props.formatStatus === "newer" && props.preview ? (
                <>
                  Read-only: this branch uses data format {base.format}, newer than this BoxOps reads ({FORMAT}).
                </>
              ) : props.formatStatus === "newer" ? (
                // Merged on GitHub before the site has redeployed with the BoxOps that reads it.
                <>
                  Read-only: the roadmap now uses data format {base.format}, newer than this BoxOps reads ({FORMAT}), so
                  BoxOps is probably being upgraded. Reload in a few minutes; if it stays like this, ask whoever looks after
                  the site.
                  {stranded && " Your unsaved changes were made in the old format: the upgraded BoxOps offers them only as a download (JSON)."}
                </>
              ) : (
                <>
                  Read-only: the data format in <code>roadmap/settings.yaml</code> can’t be read. Fix the file (see the
                  problems list) to edit the roadmap here.
                </>
              )}
            </span>
            {props.formatStatus === "newer" && !props.preview && stranded && <button onClick={downloadDraft}>Download unsaved changes</button>}
          </div>
        )}
        {lastSave && (
          <div className="banner success">
            <span>
              Saved to <code>{source.branch}</code> as commit{" "}
              <a href={lastSave.url} target="_blank" rel="noopener noreferrer">
                {lastSave.commit.slice(0, 7)}
              </a>
              . The site picks it up in about a minute.
            </span>
            <button className="icon-button" onClick={onDismissSave} aria-label="Dismiss">
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        {props.update && (
          <div className="banner" role="status">
            <span>
              <strong>{updatedText(props.update)}</strong>
              {keptOnReload}
            </span>
            {count > 0 && (!draft.kept || stranded) && <button onClick={downloadDraft}>Download unsaved changes</button>}
            <button className="primary" ref={updateReload} onClick={() => reloadApp(props.update!.build)}>
              Reload
            </button>
          </div>
        )}
        {props.behind && (
          <div className="banner notice-warning" role="status">
            <span>{props.behind}</span>
            <button className="icon-button" onClick={props.onDismissBehind} aria-label="Dismiss">
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        {props.connectionLost && (
          <div className="banner" role="status">
            {/* The poll keeps trying, and coming back online checks at once: reloading offline would lose the page. */}
            <span>
              Can’t reach the site, so others’ saves aren’t coming in. BoxOps keeps trying; if this goes on, reload (a
              private site may want you to sign in again).
              {count > 0 && draft.kept ? " Your unsaved changes are kept in this browser." : ""}
            </span>
            <button onClick={() => reloadApp("")}>Reload</button>
          </div>
        )}
        {/* While the update banner shows, it says this of any unsaved changes. */}
        {!draft.kept && !storageWarned && !(props.update && count > 0) && (
          <div className="banner notice-warning" role="alert">
            <span>
              This browser isn’t keeping your unsaved changes (its storage is full, or turned off for this site), so they’d
              be lost if this tab closed. {preview ? "This tab can’t save them: download them to keep them." : "Save soon."}
            </span>
            {preview && count > 0 && <button onClick={downloadDraft}>Download unsaved changes</button>}
            <button className="icon-button" onClick={() => setStorageWarned(true)} aria-label="Dismiss">
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        {!preview && draft.offers.length > 0 && (
          <OfferBanner
            offer={draft.offers[0]}
            busy={busy}
            onRestore={() => draft.restoreOffer(draft.offers[0].key)}
            onDiscard={() => draft.discardOffer(draft.offers[0].key)}
          />
        )}
        {draft.others > 0 && !othersDismissed && (
          <div className="banner" role="status">
            <span>This roadmap has unsaved changes in another tab. Each tab keeps and saves its own.</span>
            <button className="icon-button" onClick={() => setOthersDismissed(true)} aria-label="Dismiss">
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        {remote && (
          <div className="banner">
            <span>
              {remote.author ? <strong>{remote.author}</strong> : "Someone"} saved
              {remote.subject ? <> “{remote.subject}”</> : " changes"}. The roadmap has been updated
              {count > 0 ? "; your unsaved changes were kept" : ""}.
              {draft.conflicts.length > 0 && (
                <span className="warn-text">
                  {" "}
                  They also changed {draft.conflicts.length === 1 ? "an item" : `${draft.conflicts.length} items`} you’re
                  editing; you’ll choose whose version to keep when you save.
                </span>
              )}
            </span>
            <button
              className="icon-button"
              onClick={() => {
                onDismissRemote();
                setUpdatedIds(new Set());
              }}
              aria-label="Dismiss"
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        <Suspense fallback={<div className="splash">Loading…</div>}>
          {view === "people" ? (
            <PeopleView
              roadmap={roadmap}
              readOnly={preview || busy}
              collapsed={collapsed}
              allCollapsed={allCollapsed}
              onToggleAll={toggleAll}
              onToggleDepartment={toggle}
              onEditDepartment={editDepartment}
              onAddDepartment={addDepartment}
              onShowPto={goToPto}
              onAdd={(department) => {
                const id = draft.addPerson("New engineer", department);
                draft.checkpoint();
                return id;
              }}
              onUpdate={(id, patch) => draft.updatePerson(id, patch)}
              onRemove={(id) => draft.removePerson(id)}
              onCheckpoint={draft.checkpoint}
            />
          ) : view === "table" ? (
            <TableView
              roadmap={roadmap}
              showPto={prefs.showPto}
              hideFinished={prefs.hideFinished}
              onHideFinished={(hideFinished) => setPrefs({ hideFinished })}
              readOnly={preview || busy}
              conflictIds={conflictBoxIds}
              updatedIds={updatedIds}
              onUpdate={(id, patch, key) => draft.updateBox(id, patch, key)}
              collapsed={collapsed}
              allCollapsed={allCollapsed}
              onToggleAll={toggleAll}
              onToggleDepartment={toggle}
              onAdd={(departmentId) => {
                const dept =
                  draft.departments.find((d) => d.id === departmentId && d.lanes.length) ??
                  draft.departments.find((d) => d.lanes.length);
                // No lane anywhere (the table says to add a department first): a box would show nowhere.
                if (!dept) return null;
                const start = startOfWeek(now);
                const id = draft.addBox(
                  {
                    lane: dept.lanes[0].id,
                    start,
                    end: addWorkdays(start, 9), // two working weeks
                    title: "New box",
                    fte: 1,
                    type: draft.settings.types[0].id,
                  },
                  reserved,
                );
                draft.checkpoint();
                return id;
              }}
              onDelete={(id) => draft.removeBox(id)}
              onAddPerson={(name, department) => draft.addPerson(name, department)}
              onCheckpoint={draft.checkpoint}
              onReviewed={(id) => setUpdatedIds((cur) => new Set([...cur].filter((x) => x !== id)))}
              onEditDepartment={editDepartment}
              onAddDepartment={addDepartment}
              onMoveDepartment={draft.placeDepartment}
              ruleWarnings={ruleWarnings}
              onUpdatePto={updatePto}
              onReassignPto={(ref, toId) => {
                reassignPto(ref, toId);
                draft.checkpoint();
              }}
              onRemovePto={removePto}
              onAddPto={(departmentId) => {
                const start = startOfWeek(now);
                addPto({ start, end: addWorkdays(start, 4) }, { departmentId });
              }}
            />
          ) : (
            <Timeline
              roadmap={shown}
              allBoxes={roadmap.boxes}
              display={prefs}
              zoom={zoom}
              collapsed={collapsed}
              allCollapsed={allCollapsed}
              onToggleAll={toggleAll}
              onToggleDepartment={toggle}
              jumpToToday={jumpToToday}
              selectedId={selectedBox ? selectedBox.id : null}
              onSelect={(id) => {
                if (id) setUpdatedIds((cur) => (cur.has(id) ? new Set([...cur].filter((x) => x !== id)) : cur));
                select(id);
              }}
              onPlaceBox={placeBox}
              onCreateBox={createBox}
              onRenameLane={(laneId, name) => draft.updateLane(laneId, { name })}
              readOnly={preview || busy}
              readOnlyLabel={props.preview ? "Read-only preview" : preview ? "Read-only" : undefined}
              conflictIds={conflictBoxIds}
              updatedIds={updatedIds}
              ruleWarnings={ruleWarnings}
              onEditDepartment={editDepartment}
              onAddDepartment={addDepartment}
              onMoveDepartment={draft.placeDepartment}
              selectedPto={selectedPto && ptoOf(selectedPto) ? ptoKey(selectedPto) : null}
              onSelectPto={selectPto}
              onPlacePto={(ref, dates) => updatePto(ref, dates)}
              onCreatePto={(departmentId, dates) => {
                const ref = addPto(dates, { departmentId });
                if (ref) selectPto(ref);
              }}
            />
          )}
        </Suspense>
        {newlyBroken.length > 0 && (
          <div className="toast" role="status">
            <strong><Icon name="alert" size={14} /> That breaks {newlyBroken.length === 1 ? "a rule" : `${newlyBroken.length} rules`}</strong>
            <ul>
              {newlyBroken.map((v, i) => (
                <li key={i}>{v.message}</li>
              ))}
            </ul>
            <span className="hint">Nothing is blocked; it's a heads-up.</span>
            <button className="icon-button" onClick={() => setNewlyBroken([])} aria-label="Dismiss">
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
      </main>
      {view === "timeline" && !preview && selectedPto && ptoOf(selectedPto) && (
        <Suspense fallback={null}>
          <PtoEditor
            key={selectedPto.session}
            target={selectedPto}
            pto={ptoOf(selectedPto)!}
            people={draft.people}
            departments={draft.departments}
            onChange={(patch, field) => updatePto(selectedPto, patch, `pto:${selectedPto.session}:${field}`)}
            onReassign={(toId) => {
              const ref = reassignPto(selectedPto, toId, `pto:${selectedPto.session}:person`);
              setSelectedPto({ ...ref, session: selectedPto.session });
            }}
            onDelete={() => removePto(selectedPto)}
            onClose={() => selectPto(null)}
          />
        </Suspense>
      )}
      {view === "timeline" && !preview && selected && selectedBox && (
        <Suspense fallback={null}>
          <BoxEditor
            key={selected.session}
            box={selectedBox}
            settings={draft.settings}
            departments={draft.departments}
            people={draft.people}
            boxes={draft.boxes}
            violations={violations.filter((v) => v.from.id === selectedBox.id || v.to.id === selectedBox.id)}
            onRemoveIncoming={(fromId, type) => {
              const from = draft.boxes.find((b) => b.id === fromId);
              if (from) {
                draft.updateBox(fromId, {
                  relations: (from.relations ?? []).filter((r) => !(r.type === type && r.box === selectedBox.code)),
                });
              }
            }}
            onAddPerson={(name, department) => draft.addPerson(name, department)}
            onChange={editBox}
            onDelete={() => {
              draft.removeBox(selectedBox.id);
              setSelected(null);
            }}
            onClose={() => select(null)}
          />
        </Suspense>
      )}
      {deptEditor && !preview && (
        <Suspense fallback={null}>
          <DepartmentEditor
            key={deptEditor.kind === "edit" ? deptEditor.id : "new"}
            target={deptEditor}
            departments={draft.departments}
            boxes={draft.boxes}
            people={draft.people}
            reservedCodes={reservedDepts.codes}
            onCreate={(name, color, code) => {
              const id = draft.addDepartment(name, color, code, reservedDepts);
              setCollapsed((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
              return id;
            }}
            onUpdate={draft.updateDepartment}
            onMove={draft.moveDepartment}
            onRemove={draft.removeDepartment}
            onAddLane={(id) => draft.addLane(id, 1, reservedDepts.lanes)}
            onUpdateLane={draft.updateLane}
            onMoveLane={draft.moveLane}
            onRemoveLane={draft.removeLane}
            onClose={() => {
              draft.checkpoint();
              setDeptEditor(null);
            }}
          />
        </Suspense>
      )}
      {problem && (
        <Suspense fallback={null}>
          <SaveDialog
            problem={problem}
            source={source}
            lines={lines}
            busy={busy}
            kept={draft.kept}
            onSubmitToken={(token) => {
              setProblem(null);
              void save({ ...(problem.kind === "token" ? problem.resume : {}), token });
            }}
            onResolve={(keep, keys) => {
              setProblem(null);
              // Only the clashes the dialog listed; then save, once the draft has the choice.
              draft.resolve(keys, keep);
              setResumeSave({ keep });
            }}
            onSaveNow={() => {
              setProblem(null);
              void save();
            }}
            onReviewed={() => {
              setProblem(null);
              draft.reviewed();
              void save({ ...(problem.kind === "review" ? problem.resume : {}), reviewed: true });
            }}
            onReloadApp={() => reloadApp("")}
            onDownload={downloadDraft}
            onRetry={() => {
              setProblem(null);
              void save(problem.kind === "github" || problem.kind === "error" ? problem.resume : {});
            }}
            onNewToken={() => setProblem({ kind: "token", resume: problem.kind === "github" ? problem.resume : undefined })}
            onClose={() => setProblem(null)}
          />
        </Suspense>
      )}
      {modal === "key" && (
        <Modal title="Key" className="key-modal" onClose={() => setModal(null)}>
          <KeyContent settings={draft.settings} />
        </Modal>
      )}
      {modal === "shortcuts" && (
        <Modal title="Keyboard shortcuts" className="shortcuts-modal" onClose={() => setModal(null)}>
          <Suspense fallback={null}>
            <ShortcutsContent />
          </Suspense>
        </Modal>
      )}
      {modal === "team" && !preview && (
        <Suspense fallback={null}>
          <TeamSettings
            settings={draft.settings}
            saved={base.settings}
            boxes={draft.boxes}
            onChange={(patch, key) => draft.updateSettings(patch, `settings:${key}`)}
            onClose={() => {
              draft.checkpoint();
              setModal(null);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

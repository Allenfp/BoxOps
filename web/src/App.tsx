import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoxEditor } from "./components/BoxEditor";
import { DepartmentEditor, type DepartmentEditorTarget } from "./components/DepartmentEditor";
import { type Resume, type SaveProblem, SaveDialog } from "./components/SaveDialog";
import { PeopleView } from "./components/PeopleView";
import { PtoEditor } from "./components/PtoEditor";
import { type PtoRef, ptoClashes, ptoKey, ptoRange } from "./model/pto";
import { TableView } from "./components/TableView";
import { type BoxPlacement, Timeline } from "./components/Timeline";
import { GitHubClient, GitHubFailure, isBranchName } from "./github/api";
import { TOKEN_KINDS, failureMessage } from "./github/messages";
import { type Snapshot, canRead, fromBundle, readSnapshot, remember, sameBlobs } from "./github/read";
import { NewerFormat, NewerSaves, SaveConflict, type SaveResult, type SaveStep, saveRoadmap } from "./github/save";
import { getToken, setToken } from "./github/token";
import { KeyContent } from "./components/KeyMenu";
import { Modal } from "./components/Modal";
import { SettingsMenu, ShortcutsContent } from "./components/SettingsMenu";
import { TeamSettings } from "./components/TeamSettings";
import { getPrefs, setPrefs, usePrefs, type ViewMode } from "./prefs";
import { Logo } from "./components/Logo";
import { Popover } from "./components/Popover";
import { type WarningGroup, WarningsMenu } from "./components/WarningsMenu";
import { capacityStretches } from "./model/report";
import { type DraftState, diffBoxes, draftKey, hashText, rebaseDraft, revertItems, SETTINGS_KEY, useDraft } from "./model/draft";
import { addWorkdays, prettyDay, startOfWeek, today } from "./model/dates";
import type { AppInfo, Bundle, Notice } from "./model/bundle";
import { FORMAT } from "./model/format";
import { type LoadResult, loadRoadmap } from "./model/load";
import { type FileChanges, UnsafeWrite, applyChanges, serializeChanges } from "./model/serialize";
import { type Violation, findViolations } from "./model/relations";
import { type ChangeLine, commitMessage, describeChanges } from "./model/summary";
import type { Box, Issue, RoadmapFiles, TimeOff, ZoomLevel } from "./model/types";
import { ZOOM_LEVELS } from "./model/types";
import { Icon } from "./components/Icon";
import { noteDraft, runningFine } from "./components/ErrorBoundary";
import { LoadProblem, PreviewToken, liveUrl } from "./components/LoadScreen";
import { SiteError, fetchBundle, isNewerApp, movesForward, reloadApp } from "./site";

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
  if (!(e instanceof SiteError) || e.status === 0) {
    return { status: "error", title, message: "This browser couldn’t reach the site. Check your connection, then try again.", detail };
  }
  if (e.status === 404) return { status: "error", title, message: "The site has no roadmap yet: it may be in the middle of a deploy. Try again in a minute.", detail };
  if (e.status >= 400) return { status: "error", title, message: `The site answered with an error (HTTP ${e.status}). Try again in a minute.`, detail };
  return { status: "error", title, message: "The site’s roadmap.json couldn’t be read.", detail };
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
    return { status: "ready", ...fromSnapshot(await readSnapshot(gh, base, { branch }), true) };
  } catch (e) {
    if (e instanceof GitHubFailure && e.kind === "unauthorized") {
      setToken(repo, null);
      return base.source.private ? { status: "needs-token", repo, branch, rejected: true } : loadPreview(base, branch);
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

/** The ignored files (a snapshot lists them) are reported as unexpected. */
function fromSnapshot(s: Snapshot, preview = false): Loaded {
  return { ...loadRoadmap(s.files, s.ignored), ...s, preview };
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
  const saving = useRef(false);

  /** A newer BoxOps built the site: this tab is read-only until it reloads. */
  const [update, setUpdate] = useState<AppInfo | null>(null);
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
      setUpdate(bundle.app);
    }
    return true;
  }, []);

  const show = useCallback(
    (loaded: Loaded) => {
      onScreen.current = { source: loaded.source, blobs: loaded.blobs, ignored: loaded.ignored };
      seen.add(loaded.source.commit);
      setState({ status: "ready", ...loaded });
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
        bundle = await fetchBundle();
      } catch (e) {
        if (live) setState(siteProblem(e));
        return;
      }
      let base: Snapshot;
      try {
        base = remember(await fromBundle(bundle));
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
        show(fromSnapshot(base));
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
        if (!live || fresh === base || saving.current || onScreen.current?.source.commit !== base.source.commit) return;
        show(fromSnapshot(fresh));
        if (changesScreen(fresh, base)) setRemote({ author: fresh.source.author, subject: fresh.source.subject });
      } catch (e) {
        // The deployed copy stays. A token GitHub rejects is forgotten; the next save asks for one.
        if (e instanceof GitHubFailure && e.kind === "unauthorized") setToken(base.source.repo, null);
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
        const bundle = await fetchBundle();
        failures = 0;
        if (stopped) return;
        setLost(false);
        noteSite(bundle);
        const current = onScreen.current;
        if (!current || !movesForward(bundle.source, current.source, seen) || saving.current) return;
        const next = remember(await fromBundle(bundle));
        show(fromSnapshot(next));
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
      lastSave={lastSave}
      remote={remote}
      onDismissSave={() => setLastSave(null)}
      onDismissRemote={() => setRemote(null)}
      onSavingChange={(busy) => (saving.current = busy)}
      onReload={(snapshot) => show(fromSnapshot(snapshot))}
      onSaved={(result: SaveResult) => {
        if (result.status === "saved") seen.add(result.parent);
        show(fromSnapshot(result.snapshot));
        if (result.status !== "noop") setLastSave({ commit: result.commit, url: result.url });
        setRemote(null);
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

/** What a save is doing, with the seconds so far once it's slow: a save can wait on GitHub for a minute or two. */
function SaveProgress({ step }: { step: SaveStep }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.floor((now - start) / 1000);
  return (
    <span className="hint save-progress" role="status">
      {STEP_TEXT[step]}
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
  update: AppInfo | null;
  /** A roadmap.json fetched before saving: true if a newer BoxOps built it. */
  onSite(bundle: Bundle): boolean;
  /** Checks for others' saves keep failing. */
  connectionLost: boolean;
  lastSave: { commit: string; url: string } | null;
  remote: RemoteUpdate | null;
  onDismissSave(): void;
  onDismissRemote(): void;
  onSavingChange(busy: boolean): void;
  /** Show this newer commit; the draft is carried over onto it. */
  onReload(snapshot: Snapshot): void;
  onSaved(result: SaveResult): void;
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
  /** The next roadmap change is our own save, not someone else's. */
  const ownSave = useRef(false);

  const baseHash = useMemo(() => hashText(JSON.stringify(files)), [files]);
  const draftBase = useMemo(
    () => ({ boxes: base.boxes, departments: base.departments, people: base.people, settings: base.settings }),
    [base],
  );
  const scope = `${source.repo}@${source.branch}`;
  // Should anything below crash, the recovery screen offers this draft (and no other roadmap's).
  noteDraft(draftKey(scope));
  const draft = useDraft(draftBase, scope, baseHash);
  // Up and running a few seconds: a crash after this isn't "the same one again" (ErrorBoundary).
  useEffect(() => {
    const t = setTimeout(runningFine, 5000);
    return () => clearTimeout(t);
  }, []);
  const draftState: DraftState = useMemo(
    () => ({ boxes: draft.boxes, departments: draft.departments, people: draft.people, settings: draft.settings }),
    [draft.boxes, draft.departments, draft.people, draft.settings],
  );
  const roadmap = useMemo(() => ({ ...base, ...draftState }), [base, draftState]);
  // What the views draw: finished boxes can be hidden (warnings still count them).
  const shown = useMemo(
    () => (prefs.hideFinished ? { ...roadmap, boxes: roadmap.boxes.filter((b) => b.end >= today()) } : roadmap),
    [roadmap, prefs.hideFinished],
  );

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

  // Undo/redo and delete. Text fields keep their own native undo.
  useEffect(() => {
    if (preview) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        // Like saving a file — and never the browser's "save page" dialog.
        e.preventDefault();
        if (busy || problem) return;
        // A table or people cell keeps what's typed until it loses focus: commit
        // it, then save on the next tick, once the draft has it.
        if (isTyping(document.activeElement)) {
          (document.activeElement as HTMLElement).blur();
          setTimeout(() => saveRef.current(), 0);
        } else saveRef.current();
        return;
      }
      if (isTyping(e.target) || busy) return;
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
      const id = draft.addBox({
        ...p,
        title: "New box",
        fte: 1,
        type: draft.settings.types[0].id,
      });
      draft.checkpoint();
      setSelected({ id, session: Date.now() });
    },
    [draft],
  );

  const editBox = (patch: Partial<Box>, field: string) => {
    if (!selected) return;
    const id = draft.updateBox(selected.id, patch, `${selected.session}:${field}`);
    if (id !== selected.id) setSelected({ ...selected, id });
  };

  const { count } = draft.changes;
  const discardAll = () => {
    if (confirm(`Discard ${count} change${count === 1 ? "" : "s"}? You can still undo this.`)) {
      setSelected(null);
      draft.discard();
    }
  };
  // The changes listed in the token form: worked out only while it's open, not on every edit.
  const lines = useMemo(
    () => (problem?.kind === "token" ? describeChanges(draftBase, draftState, draft.changes) : NO_LINES),
    [problem, draftBase, draftState, draft.changes],
  );

  /** Problems these files have that the loaded roadmap didn't (pre-existing ones don't block saving). */
  const newProblems = useCallback(
    (next: RoadmapFiles) => {
      const known = new Set(issues.map((i) => i.key));
      return loadRoadmap(next)
        .issues.filter((i) => !known.has(i.key))
        .map(issueText);
    },
    [issues],
  );

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

  /** `keep`: whose version of clashing items to keep, once chosen. `token`: just pasted. */
  const save = async (opts: Resume & { token?: string } = {}) => {
    // A pasted token is kept straight away, before anything below can stop
    // the save (a clash that came in while the token form was open, say), so
    // retries and the re-save after a choice never ask for it again; only a
    // 401 forgets it.
    if (opts.token) setToken(source.repo, opts.token);
    // Read-only since the dialog that led here opened (a newer BoxOps was
    // deployed, say): this tab's code never writes.
    if (preview) return setProblem(null);
    // Items someone else changed while we were editing them: the user picks first.
    const clashes = draft.conflicts;
    if (clashes.length && !opts.keep) return setProblem({ kind: "conflict", items: clashes.map(describeItem) });
    const resume: Resume = opts.keep ? { keep: opts.keep } : {};
    const keepTheirs = opts.keep === "theirs" && clashes.length > 0;
    let target = draftState;
    let changes: FileChanges;
    try {
      if (keepTheirs) target = revertItems(draftState, draftBase, clashes);
      changes = serializeChanges(files, draftBase, target, props);
      if (Object.keys(changes).length === 0) {
        if (keepTheirs) draft.takeTheirs(clashes);
        return;
      }
      const invalid = newProblems(applyChanges(files, changes));
      if (invalid.length) return setProblem({ kind: "invalid", issues: invalid });
    } catch (e) {
      // A file the app couldn't fully read is never written: it would lose what was left out.
      if (e instanceof UnsafeWrite) return setProblem({ kind: "unwritable", files: e.files });
      return setProblem({ kind: "error", message: (e as Error).message });
    }
    const token = opts.token ?? getToken(source.repo);
    // The choice just made comes back with the token, so it isn't asked again.
    if (!token) return setProblem({ kind: "token", resume });
    if (keepTheirs) draft.takeTheirs(clashes);
    const gh = new GitHubClient({ token });

    select(null);
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
      // them in and let the user review before anything is written.
      const result = await saveRoadmap({
        gh,
        base: { source, files, blobs: props.blobs, ignored: props.ignored },
        changes,
        message: commitMessage(describeChanges(draftBase, target, target === draftState ? draft.changes : undefined)),
        review: !opts.keep,
        seen: props.seen,
        validate: newProblems,
        onProgress: setStep,
      });
      setBusy(false);
      ownSave.current = true;
      setUpdatedIds(new Set());
      onSaved(result);
    } catch (e) {
      if (e instanceof NewerSaves) {
        const head = e.head;
        const saves = await gh.compare(source.repo, source.commit, head.source.commit).catch(() => []);
        const { roadmap: latest } = loadRoadmap(head.files, head.ignored);
        const latestState = { boxes: latest.boxes, departments: latest.departments, people: latest.people, settings: latest.settings };
        const theirs = describeChanges(draftBase, latestState);
        const clashes = rebaseDraft(draftBase, draftState, latestState).conflicts;
        setBusy(false);
        onReload(head);
        setProblem({ kind: "updated", saves, changes: theirs, clashes: clashes.map(describeItem) });
        return;
      }
      if (e instanceof NewerFormat) {
        setProblem({ kind: "upgrading", format: e.format });
      } else if (e instanceof SaveConflict) {
        // Someone saved the same items since we loaded: move onto their version,
        // then ask (see the effect below) once the clashes are known.
        askAfterRebase.current = true;
        onReload(e.head);
      } else if (e instanceof GitHubFailure && e.kind === "unauthorized") {
        setToken(source.repo, null);
        setProblem({ kind: "token", rejected: true, resume });
      } else if (e instanceof GitHubFailure) {
        setProblem({ kind: "github", failure: e, resume });
      } else {
        setProblem({ kind: "error", message: (e as Error).message, resume });
      }
      setBusy(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // A read-only tab shows no save dialog: one left open when a newer BoxOps
  // arrived closes (once a save under way is done), as old code never writes.
  useEffect(() => {
    if (preview && !busy) setProblem(null);
  }, [preview, busy]);

  useEffect(() => {
    if (!askAfterRebase.current) return;
    askAfterRebase.current = false;
    if (draft.conflicts.length) setProblem({ kind: "conflict", items: draft.conflicts.map(describeItem) });
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
    if (ownSave.current) {
      ownSave.current = false;
      return;
    }
    const d = diffBoxes(prev.boxes, draftBase.boxes);
    const ids = [...d.added, ...d.modified].map((b) => b.id);
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

  // Departments over capacity now or later (past overloads are history, not a warning).
  const overCapacity = useMemo(() => {
    const now = today();
    return draft.departments.flatMap((d) => {
      const laneIds = new Set(d.lanes.map((l) => l.id));
      const over = capacityStretches(
        draft.boxes.filter((b) => laneIds.has(b.lane)),
        d.lanes,
        (load, cap) => load > cap,
      ).filter((x) => x.to >= now);
      if (!over.length) return [];
      // The worst stretch (most FTE over what the lanes open then hold).
      const worst = over.reduce((a, b) => (b.fte - b.capacity > a.fte - a.capacity ? b : a));
      const more = over.length > 1 ? `, and ${over.length - 1} more stretch${over.length > 2 ? "es" : ""}` : "";
      return [
        {
          id: d.id,
          text: `${d.name}: ${worst.fte} FTE planned against ${worst.capacity}, ${prettyDay(worst.from)} – ${prettyDay(worst.to)}${more}`,
        },
      ];
    });
  }, [draft.boxes, draft.departments]);

  // Engineers booked on a box while they're on PTO (from today on).
  const onPto = useMemo(() => {
    const now = today();
    return ptoClashes(draft.boxes, draft.people).filter((c) => c.box.end >= now && c.pto.end >= now);
  }, [draft.boxes, draft.people]);

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
    { title: "Over capacity", items: overCapacity.map((o) => ({ text: o.text, onGo: () => goToDepartment(o.id) })) },
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
      <header className="toolbar">
        <div className="toolbar-zone start">
          <Logo />
          <h1>{draft.settings.title}</h1>
          <div className="segmented" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                aria-pressed={view === v.id}
                onClick={() => {
                  if (v.id !== "timeline") select(null);
                  setView(v.id);
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
            <span
              className="hint site-copy"
              tabIndex={0}
              title={
                `${source.repo} is private, so without a GitHub token this tab shows the site’s copy` +
                `${source.date ? `, deployed from a commit of ${stamp(source.date)}` : ""}. Others’ saves appear a minute or ` +
                "two after each one, once the site has redeployed. Saving asks for a token and checks for newer saves first."
              }
            >
              Deployed copy
            </span>
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
                    title="Save to GitHub (⌘S). Until then, changes are kept in this browser."
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
                        <p className="menu-note">Unsaved changes are kept in this browser, even if you close the tab.</p>
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

      {props.notices
        .filter((n) => !dismissed.includes(n.text))
        .map((n) => (
          <div key={n.text} className={`banner notice-${n.level}`} role={n.level === "info" ? "status" : "alert"}>
            <span>{n.text}</span>
            <button className="icon-button" onClick={() => setDismissed((d) => [...d, n.text])} aria-label="Dismiss">
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      {props.preview && (
        <div className="banner">
          Previewing branch <code>{source.branch}</code> (read-only). <a href={liveUrl()}>Back to the live roadmap</a>
        </div>
      )}
      {source.local && !props.preview && (
        <div className="banner">
          Read-only: this copy was built from the files on disk (<code>npm run dev</code>, or a build with uncommitted
          changes in <code>roadmap/</code>), so it can’t save. Edit the YAML files, or save from the deployed site.
        </div>
      )}
      {source.readonly && !source.local && !props.preview && <div className="banner">Read-only: this site doesn’t save.</div>}
      {props.formatStatus !== "current" && (
        <div className="banner">
          {props.formatStatus === "older" ? (
            <>
              Read-only: <code>roadmap/settings.yaml</code> doesn’t say which data format the files use. Add{" "}
              <code>format: {FORMAT}</code> to it to edit the roadmap here.
            </>
          ) : props.formatStatus === "newer" ? (
            <>
              Read-only: this roadmap uses data format {base.format}, and this version of BoxOps reads format {FORMAT}.
              Upgrade BoxOps to edit it here.
            </>
          ) : (
            <>
              Read-only: the data format in <code>roadmap/settings.yaml</code> can’t be read. Fix the file (see the
              problems list) to edit the roadmap here.
            </>
          )}
        </div>
      )}
      {lastSave && (
        <div className="banner success">
          Saved to <code>{source.branch}</code> as commit{" "}
          <a href={lastSave.url} target="_blank" rel="noopener noreferrer">
            {lastSave.commit.slice(0, 7)}
          </a>
          . The site picks it up in about a minute.
          <button className="icon-button" onClick={onDismissSave} aria-label="Dismiss">
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
      {props.update && (
        <div className="banner" role="status">
          <span>
            <strong>{updatedText(props.update)}</strong>
            {count > 0 ? " Your unsaved changes are kept in this browser." : ""}
          </span>
          <button className="primary" onClick={() => reloadApp(props.update!.build)}>
            Reload
          </button>
        </div>
      )}
      {props.connectionLost && (
        <div className="banner" role="status">
          <span>
            Lost the connection to the site, so others’ saves aren’t coming in. Reload to reconnect
            {count > 0 ? "; your unsaved changes are kept in this browser" : ""}.
          </span>
          <button onClick={() => reloadApp("")}>Reload</button>
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
            const firstLane = dept?.lanes[0];
            const start = startOfWeek(today());
            const id = draft.addBox({
              lane: firstLane?.id ?? "",
              start,
              end: addWorkdays(start, 9), // two working weeks
              title: "New box",
              fte: 1,
              type: draft.settings.types[0].id,
            });
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
            const start = startOfWeek(today());
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
      {view === "timeline" && !preview && selectedPto && ptoOf(selectedPto) && (
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
      )}
      {view === "timeline" && !preview && selected && selectedBox && (
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
      )}
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
      {deptEditor && !preview && (
        <DepartmentEditor
          target={deptEditor}
          departments={draft.departments}
          boxes={draft.boxes}
          people={draft.people}
          onCreate={(name, color, code) => {
            // Not the id of a department file the app couldn't read: saving it would be refused.
            const skipped = [...props.lossy.keys()].flatMap((p) => /^departments\/([^/]+)\.ya?ml$/.exec(p)?.[1] ?? []);
            const id = draft.addDepartment(name, color, code, skipped);
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
          onAddLane={(id) => draft.addLane(id)}
          onUpdateLane={draft.updateLane}
          onMoveLane={draft.moveLane}
          onRemoveLane={draft.removeLane}
          onClose={() => {
            draft.checkpoint();
            setDeptEditor(null);
          }}
        />
      )}
      {problem && (
        <SaveDialog
          problem={problem}
          source={source}
          lines={lines}
          busy={busy}
          onSubmitToken={(token) => {
            setProblem(null);
            void save({ ...(problem.kind === "token" ? problem.resume : {}), token });
          }}
          onResolve={(keep) => {
            setProblem(null);
            void save({ keep });
          }}
          onSaveNow={() => {
            setProblem(null);
            void save();
          }}
          onReloadApp={() => reloadApp("")}
          onRetry={() => {
            setProblem(null);
            void save(problem.kind === "github" || problem.kind === "error" ? problem.resume : {});
          }}
          onNewToken={() => setProblem({ kind: "token", resume: problem.kind === "github" ? problem.resume : undefined })}
          onClose={() => setProblem(null)}
        />
      )}
      {modal === "key" && (
        <Modal title="Key" className="key-modal" onClose={() => setModal(null)}>
          <KeyContent settings={draft.settings} />
        </Modal>
      )}
      {modal === "shortcuts" && (
        <Modal title="Keyboard shortcuts" className="shortcuts-modal" onClose={() => setModal(null)}>
          <ShortcutsContent />
        </Modal>
      )}
      {modal === "team" && !preview && (
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
      )}
    </div>
  );
}

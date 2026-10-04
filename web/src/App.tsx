import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoxEditor } from "./components/BoxEditor";
import { DepartmentEditor, type DepartmentEditorTarget } from "./components/DepartmentEditor";
import { type SaveProblem, SaveDialog } from "./components/SaveDialog";
import { PeopleView } from "./components/PeopleView";
import { PtoEditor } from "./components/PtoEditor";
import { type PtoRef, ptoClashes, ptoKey, ptoRange } from "./model/pto";
import { TableView } from "./components/TableView";
import { type BoxPlacement, Timeline } from "./components/Timeline";
import { GitHub, GitHubError } from "./github/api";
import {
  SaveConflict,
  type SaveResult,
  type Source,
  latestCommit,
  loadCommit,
  loadFromGitHub,
  parseRepo,
  saveToBranch,
} from "./github/save";
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
import { type DraftState, diffBoxes, hashText, rebaseDraft, revertItems, SETTINGS_KEY, useDraft } from "./model/draft";
import { addWorkdays, prettyDay, startOfWeek, today } from "./model/dates";
import { loadRoadmap } from "./model/load";
import { type FileChanges, applyChanges, serializeChanges } from "./model/serialize";
import { type Violation, findViolations } from "./model/relations";
import { commitMessage, describeChanges } from "./model/summary";
import type { Box, Issue, Roadmap, RoadmapFiles, TimeOff, ZoomLevel } from "./model/types";
import { ZOOM_LEVELS } from "./model/types";
import { Icon } from "./components/Icon";

interface Loaded {
  roadmap: Roadmap;
  issues: Issue[];
  files: RoadmapFiles;
  source: Source;
  /** Showing a branch other than the one this site was built from (`?ref=`). */
  preview: boolean;
}

type LoadState = { status: "loading" } | { status: "error"; message: string } | ({ status: "ready" } & Loaded);

const ZOOM_LABEL: Record<ZoomLevel, string> = { weeks: "Weeks", months: "Months", quarters: "Quarters" };

/** How often open tabs look for other people's saves. */
const POLL_MS = 2 * 60_000;

interface Bundle {
  files: RoadmapFiles;
  source: Source;
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

/** The site's own copy of the roadmap; rewritten by every deploy. `no-cache` revalidates, so an unchanged file costs a 304. */
async function fetchBundle(): Promise<Bundle> {
  const res = await fetch("roadmap.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`roadmap.json: HTTP ${res.status}`);
  return (await res.json()) as Bundle;
}

async function load(bundle: Bundle): Promise<Loaded> {
  const gh = new GitHub(getToken());
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (ref && ref !== bundle.source.branch) {
    const { files, source } = await loadFromGitHub(gh, bundle.source.repo, ref);
    return { ...loadRoadmap(files), files, source, preview: true };
  }

  // The site is rebuilt a minute or so after each save. If someone saved since
  // this build, read the newer roadmap from GitHub so nobody edits a stale copy.
  // (Skipped when running locally with uncommitted roadmap/ edits.)
  if (!bundle.source.dirty) {
    const head = await latestCommit(gh, bundle.source);
    if (head && head !== bundle.source.commit) {
      try {
        const files = await loadCommit(gh, bundle.source.repo, head);
        return { ...loadRoadmap(files), files, source: { ...bundle.source, commit: head }, preview: false };
      } catch {
        // Fall back to the bundled copy.
      }
    }
  }
  return { ...loadRoadmap(bundle.files), files: bundle.files, source: bundle.source, preview: false };
}

function fromFiles(files: RoadmapFiles, source: Source): Loaded {
  return { ...loadRoadmap(files), files, source, preview: false };
}

export function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [lastSave, setLastSave] = useState<{ commit: string; url: string } | null>(null);
  const [remote, setRemote] = useState<RemoteUpdate | null>(null);
  /**
   * Every commit this tab has already shown or moved past. The deployed bundle
   * lags behind saves, so a bundle we've seen is old news, never an update.
   */
  const seen = useRef(new Set<string>());
  const saving = useRef(false);

  useEffect(() => {
    fetchBundle()
      .then(async (bundle) => {
        seen.current.add(bundle.source.commit);
        const loaded = await load(bundle);
        seen.current.add(loaded.source.commit);
        setState({ status: "ready", ...loaded });
      })
      .catch((e: Error) => setState({ status: "error", message: e.message }));
  }, []);

  // Look for other people's saves every couple of minutes while the tab is visible.
  const pollable = state.status === "ready" && !state.preview && !state.source.dirty;
  useEffect(() => {
    if (!pollable) return;
    let lastCheck = Date.now();
    const check = async () => {
      if (document.hidden || saving.current) return;
      lastCheck = Date.now();
      try {
        const bundle = await fetchBundle();
        const commit = bundle.source.commit;
        if (seen.current.has(commit) || saving.current) return;
        seen.current.add(commit);
        setState({ status: "ready", ...fromFiles(bundle.files, bundle.source) });
        setRemote({ author: bundle.source.author, subject: bundle.source.subject });
      } catch {
        // Offline or mid-deploy: try again next time.
      }
    };
    const timer = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastCheck >= POLL_MS) void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollable]);

  if (state.status === "loading") return <div className="splash">Loading roadmap…</div>;
  if (state.status === "error") return <div className="splash error">Couldn’t load the roadmap: {state.message}</div>;
  const source = state.source;
  return (
    <RoadmapView
      {...state}
      lastSave={lastSave}
      remote={remote}
      onDismissSave={() => setLastSave(null)}
      onDismissRemote={() => setRemote(null)}
      onSavingChange={(busy) => (saving.current = busy)}
      onReload={(files, commit) => {
        seen.current.add(commit);
        setState({ status: "ready", ...fromFiles(files, { repo: source.repo, branch: source.branch, commit }) });
      }}
      onSaved={(result: SaveResult) => {
        seen.current.add(result.parent);
        seen.current.add(result.commit);
        setState({ status: "ready", ...fromFiles(result.files, { repo: source.repo, branch: source.branch, commit: result.commit }) });
        setLastSave({ commit: result.commit, url: result.url });
        setRemote(null);
      }}
    />
  );
}

interface ViewProps extends Loaded {
  lastSave: { commit: string; url: string } | null;
  remote: RemoteUpdate | null;
  onDismissSave(): void;
  onDismissRemote(): void;
  onSavingChange(busy: boolean): void;
  /** Show this newer commit; the draft is carried over onto it. */
  onReload(files: RoadmapFiles, commit: string): void;
  onSaved(result: SaveResult): void;
}

function RoadmapView(props: ViewProps) {
  const { roadmap: base, issues, files, source, preview, lastSave, remote } = props;
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
  const setBusy = (b: boolean) => {
    setBusyState(b);
    onSavingChange(b);
  };
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  /** A save found newer saves on GitHub; once the draft is carried over, ask about any clashes. */
  const askAfterRebase = useRef(false);
  /** The next roadmap change is our own save, not someone else's. */
  const ownSave = useRef(false);

  const baseHash = useMemo(() => hashText(JSON.stringify(files)), [files]);
  const draftBase = useMemo(
    () => ({ boxes: base.boxes, departments: base.departments, people: base.people, settings: base.settings }),
    [base],
  );
  const draft = useDraft(draftBase, `${source.repo}@${source.branch}`, baseHash);
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
    history.replaceState(null, "", `?${q}`);
  }, [view, zoom, collapsed]);

  useEffect(() => {
    document.title = preview ? `${draft.settings.title} (${source.branch})` : draft.settings.title;
  }, [draft.settings.title, preview, source.branch]);

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
        if (!busy && !problem) saveRef.current();
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
    [draft, draft.settings],
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
  const lines = useMemo(
    () => describeChanges(draftBase, draftState),
    [draftBase, draftState],
  );

  /** Problems these files have that the loaded roadmap didn't (pre-existing ones don't block saving). */
  const newProblems = useCallback(
    (next: RoadmapFiles) => {
      const known = new Set(issues.map((i) => `${i.path}|${i.message}`));
      return loadRoadmap(next)
        .issues.filter((i) => !known.has(`${i.path}|${i.message}`))
        .map((i) => `${i.path}: ${i.message}`);
    },
    [issues],
  );

  /** A conflict key (`box:<id>` / `dept:<id>`) in words, for the conflict dialog. */
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

  const save = async (opts: { token?: string; keep?: "mine" | "theirs" } = {}) => {
    // Items someone else changed while we were editing them: the user picks first.
    const clashes = draft.conflicts;
    if (clashes.length && !opts.keep) return setProblem({ kind: "conflict", items: clashes.map(describeItem) });
    let target = draftState;
    if (opts.keep === "theirs" && clashes.length) {
      target = revertItems(draftState, draftBase, clashes);
      draft.takeTheirs(clashes);
    }

    const changes: FileChanges = serializeChanges(files, draftBase, target);
    if (Object.keys(changes).length === 0) return;
    const invalid = newProblems(applyChanges(files, changes));
    if (invalid.length) return setProblem({ kind: "invalid", issues: invalid });
    const token = opts.token ?? getToken();
    if (!token) return setProblem({ kind: "token" });
    const gh = new GitHub(token);

    select(null);
    setBusy(true);
    try {
      // Pre-save check: if anyone saved since this tab loaded, bring their
      // changes in and let the user review before anything is written.
      if (!opts.keep) {
        const head = await gh.branchSha(parseRepo(source.repo), source.branch);
        if (head !== source.commit) {
          const headFiles = await loadCommit(gh, source.repo, head);
          const saves = await gh.compare(parseRepo(source.repo), source.commit, head).catch(() => []);
          const { roadmap: latest } = loadRoadmap(headFiles);
          const latestState = { boxes: latest.boxes, departments: latest.departments, people: latest.people, settings: latest.settings };
          const theirs = describeChanges(draftBase, latestState);
          const clashes = rebaseDraft(draftBase, draftState, latestState).conflicts;
          setToken(token);
          setBusy(false);
          onReload(headFiles, head);
          setProblem({ kind: "updated", saves, changes: theirs, clashes: clashes.map(describeItem) });
          return;
        }
      }

      const result = await saveToBranch({
        gh,
        source,
        baseFiles: files,
        changes,
        message: commitMessage(describeChanges(draftBase, target)),
        validate: newProblems,
      });
      setToken(token);
      setBusy(false);
      ownSave.current = true;
      setUpdatedIds(new Set());
      onSaved(result);
    } catch (e) {
      if (e instanceof SaveConflict) {
        // Someone saved the same items since we loaded: move onto their version,
        // then ask (see the effect below) once the clashes are known.
        askAfterRebase.current = true;
        onReload(e.headFiles, e.headCommit);
      } else if (e instanceof GitHubError && e.status === 401) {
        setToken(null);
        setProblem({ kind: "token", rejected: true });
      } else {
        setProblem({ kind: "error", message: (e as Error).message });
      }
      setBusy(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!askAfterRebase.current) return;
    askAfterRebase.current = false;
    if (draft.conflicts.length) setProblem({ kind: "conflict", items: draft.conflicts.map(describeItem) });
    else void saveRef.current(); // their changes didn't actually clash with ours
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  useEffect(() => {
    const key = (v: Violation) => `${v.from.code}:${v.type}:${v.to.code}`;
    const now = new Set(violations.map(key));
    if (knownBroken.current) {
      const fresh = violations.filter((v) => !knownBroken.current!.has(key(v)));
      if (fresh.length) setNewlyBroken(fresh);
    }
    knownBroken.current = now;
  }, [violations]);
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
    { title: "Problems in the roadmap files", items: issues.map((i) => ({ text: `roadmap/${i.path}: ${i.message}` })) },
  ];

  const mainUrl = () => {
    const q = new URLSearchParams(window.location.search);
    q.delete("ref");
    return `?${q}`;
  };

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
          <WarningsMenu groups={warningGroups} />
          {!preview && (
            <div className="draft-status">
              <button className="icon-only" onClick={draft.undo} disabled={!draft.canUndo} title="Undo (⌘Z)" aria-label="Undo">
                <Icon name="undo" size={16} />
              </button>
              <button className="icon-only" onClick={draft.redo} disabled={!draft.canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">
                <Icon name="redo" size={16} />
              </button>
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

      {preview && (
        <div className="banner">
          Previewing branch <code>{source.branch}</code> (read-only). <a href={mainUrl()}>Back to the live roadmap</a>
        </div>
      )}
      {lastSave && (
        <div className="banner success">
          Saved to <code>{source.branch}</code> as commit{" "}
          <a href={lastSave.url} target="_blank" rel="noopener noreferrer">
            {lastSave.commit.slice(0, 7)}
          </a>
          . The public site picks it up in about a minute.
          <button className="icon-button" onClick={onDismissSave} aria-label="Dismiss">
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
            const id = draft.addDepartment(name, color, code);
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
            void save({ token });
          }}
          onResolve={(keep) => {
            setProblem(null);
            void save({ keep });
          }}
          onSaveNow={() => {
            setProblem(null);
            void save();
          }}
          onRetry={() => {
            setProblem(null);
            void save();
          }}
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

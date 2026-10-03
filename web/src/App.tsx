import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoxEditor } from "./components/BoxEditor";
import { type SaveProblem, SaveDialog } from "./components/SaveDialog";
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
import { type DraftState, diffBoxes, hashText, rebaseDraft, revertItems, useDraft } from "./model/draft";
import { loadRoadmap } from "./model/load";
import { type FileChanges, applyChanges, serializeChanges } from "./model/serialize";
import { commitMessage, describeChanges } from "./model/summary";
import type { Box, Issue, Roadmap, RoadmapFiles, ZoomLevel } from "./model/types";
import { ZOOM_LEVELS } from "./model/types";

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

/** View state lives in the URL so a link reproduces what you see. */
function readUrlState(): { zoom?: ZoomLevel; collapsed?: Set<string> } {
  const q = new URLSearchParams(window.location.search);
  const zoom = q.get("zoom") as ZoomLevel | null;
  const collapsed = q.get("collapsed");
  return {
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
  const [zoom, setZoom] = useState<ZoomLevel>(initial.zoom ?? base.settings.default_zoom);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => initial.collapsed ?? new Set(base.departments.filter((d) => d.collapsed).map((d) => d.id)),
  );
  const [jumpToToday, setJumpToToday] = useState(0);
  const [showIssues, setShowIssues] = useState(false);
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
  const draftBase = useMemo(() => ({ boxes: base.boxes, departments: base.departments }), [base]);
  const draft = useDraft(draftBase, `${source.repo}@${source.branch}`, baseHash);
  const draftState: DraftState = useMemo(
    () => ({ boxes: draft.boxes, departments: draft.departments }),
    [draft.boxes, draft.departments],
  );
  const roadmap = useMemo(() => ({ ...base, ...draftState }), [base, draftState]);

  // `session` makes each opening of the editor its own run of undo steps.
  const [selected, setSelected] = useState<{ id: string; session: number } | null>(null);
  const selectedBox = selected ? draft.boxes.find((b) => b.id === selected.id) : undefined;

  const select = useCallback(
    (id: string | null) => {
      draft.checkpoint();
      setSelected((cur) => (id === null ? null : cur?.id === id ? cur : { id, session: Date.now() }));
    },
    [draft],
  );

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    q.set("zoom", zoom);
    q.set("collapsed", [...collapsed].join(","));
    history.replaceState(null, "", `?${q}`);
  }, [zoom, collapsed]);

  useEffect(() => {
    document.title = preview ? `${base.settings.title} (${source.branch})` : base.settings.title;
  }, [base.settings.title, preview, source.branch]);

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
  const allCollapsed = base.departments.every((d) => collapsed.has(d.id));

  const placeBox = useCallback((id: string, p: BoxPlacement) => draft.updateBox(id, p), [draft]);

  const createBox = useCallback(
    (p: BoxPlacement) => {
      const id = draft.addBox({
        ...p,
        title: "New box",
        type: base.settings.types[0].id,
        status: base.settings.statuses[0].id,
      });
      draft.checkpoint();
      setSelected({ id, session: Date.now() });
    },
    [draft, base.settings],
  );

  const editBox = (patch: Partial<Box>, field: string) => {
    if (!selected) return;
    const id = draft.updateBox(selected.id, patch, `${selected.session}:${field}`);
    if (id !== selected.id) setSelected({ ...selected, id });
  };

  const { count } = draft.changes;
  const lines = useMemo(
    () => describeChanges(draftBase, draftState, base.settings),
    [draftBase, draftState, base.settings],
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
          const latestState = { boxes: latest.boxes, departments: latest.departments };
          const theirs = describeChanges(draftBase, latestState, base.settings);
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
        message: commitMessage(describeChanges(draftBase, target, base.settings)),
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

  const conflictBoxIds = useMemo(
    () => new Set(draft.conflicts.filter((k) => k.startsWith("box:")).map((k) => k.slice(4))),
    [draft.conflicts],
  );
  const mainUrl = () => {
    const q = new URLSearchParams(window.location.search);
    q.delete("ref");
    return `?${q}`;
  };

  return (
    <div className="app">
      <header className="toolbar">
        <h1>{base.settings.title}</h1>
        <div className="segmented" role="group" aria-label="Zoom">
          {ZOOM_LEVELS.map((z) => (
            <button key={z} aria-pressed={z === zoom} onClick={() => setZoom(z)}>
              {ZOOM_LABEL[z]}
            </button>
          ))}
        </div>
        <button onClick={() => setJumpToToday((n) => n + 1)}>Today</button>
        <button
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(base.departments.map((d) => d.id)))}
        >
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>

        {!preview && (
          <div className="draft-status">
            <button onClick={draft.undo} disabled={!draft.canUndo} title="Undo (⌘Z)">
              Undo
            </button>
            <button onClick={draft.redo} disabled={!draft.canRedo} title="Redo (⇧⌘Z)">
              Redo
            </button>
            {count > 0 ? (
              <>
                <span className="changes-badge" title="Kept in this browser until you save.">
                  {count} unsaved change{count === 1 ? "" : "s"}
                </span>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Discard ${count} change${count === 1 ? "" : "s"}? You can still undo this.`)) {
                      setSelected(null);
                      draft.discard();
                    }
                  }}
                >
                  Discard
                </button>
                <button className="primary" onClick={() => save()} disabled={busy} title="Save to GitHub (⌘S)">
                  {busy ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <span className="hint">No changes</span>
            )}
            {draft.conflicts.length > 0 && (
              <span
                className="pill warn"
                title="Someone else saved changes to items you're also editing. You'll choose whose version to keep when you save."
              >
                ⚠ {draft.conflicts.length} clash{draft.conflicts.length === 1 ? "" : "es"}
              </span>
            )}
          </div>
        )}

        <ul className="legend">
          {base.settings.types.map((t) => (
            <li key={t.id}>
              <span className="swatch" style={{ background: t.color }} />
              {t.name}
            </li>
          ))}
        </ul>
        {issues.length > 0 && (
          <button className="issues-button" onClick={() => setShowIssues((s) => !s)}>
            ⚠ {issues.length} data issue{issues.length === 1 ? "" : "s"}
          </button>
        )}
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
            ×
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
            ×
          </button>
        </div>
      )}
      {showIssues && (
        <ul className="issues">
          {issues.map((i, n) => (
            <li key={n}>
              <code>roadmap/{i.path}</code> {i.message}
            </li>
          ))}
        </ul>
      )}

      <Timeline
        roadmap={roadmap}
        zoom={zoom}
        collapsed={collapsed}
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
      />
      {!preview && selected && selectedBox && (
        <BoxEditor
          key={selected.session}
          box={selectedBox}
          settings={base.settings}
          departments={draft.departments}
          onChange={editBox}
          onDelete={() => {
            draft.removeBox(selectedBox.id);
            setSelected(null);
          }}
          onClose={() => select(null)}
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
    </div>
  );
}

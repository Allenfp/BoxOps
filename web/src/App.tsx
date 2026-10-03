import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoxEditor } from "./components/BoxEditor";
import { type SaveProblem, SaveDialog } from "./components/SaveDialog";
import { type BoxPlacement, Timeline } from "./components/Timeline";
import { GitHub, GitHubError } from "./github/api";
import { SaveConflict, type SaveResult, type Source, latestCommit, loadCommit, loadFromGitHub, saveToBranch } from "./github/save";
import { getToken, setToken } from "./github/token";
import { type DraftState, hashText, useDraft } from "./model/draft";
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

async function load(): Promise<Loaded> {
  const res = await fetch("roadmap.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`roadmap.json: HTTP ${res.status}`);
  const bundle = (await res.json()) as { files: RoadmapFiles; source: Source };

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

  useEffect(() => {
    load()
      .then((loaded) => setState({ status: "ready", ...loaded }))
      .catch((e: Error) => setState({ status: "error", message: e.message }));
  }, []);

  if (state.status === "loading") return <div className="splash">Loading roadmap…</div>;
  if (state.status === "error") return <div className="splash error">Couldn’t load the roadmap: {state.message}</div>;
  const source = state.source;
  return (
    <RoadmapView
      // A new commit is a new starting point: fresh draft, fresh undo history.
      key={source.commit}
      {...state}
      lastSave={lastSave}
      onDismissSave={() => setLastSave(null)}
      onReload={(files, commit) => setState({ status: "ready", ...fromFiles(files, { ...source, commit, dirty: false }) })}
      onSaved={(result: SaveResult) => {
        setState({ status: "ready", ...fromFiles(result.files, { ...source, commit: result.commit, dirty: false }) });
        setLastSave({ commit: result.commit, url: result.url });
      }}
    />
  );
}

interface ViewProps extends Loaded {
  lastSave: { commit: string; url: string } | null;
  onDismissSave(): void;
  /** Replace what's on screen with this commit's files (draft is dropped). */
  onReload(files: RoadmapFiles, commit: string): void;
  onSaved(result: SaveResult): void;
}

function RoadmapView(props: ViewProps) {
  const { roadmap: base, issues, files, source, preview, lastSave, onDismissSave, onReload, onSaved } = props;
  const initial = useMemo(readUrlState, []);
  const [zoom, setZoom] = useState<ZoomLevel>(initial.zoom ?? base.settings.default_zoom);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => initial.collapsed ?? new Set(base.departments.filter((d) => d.collapsed).map((d) => d.id)),
  );
  const [jumpToToday, setJumpToToday] = useState(0);
  const [showIssues, setShowIssues] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  const conflict = useRef<SaveConflict | null>(null);

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

  /** What a file path is, in words, for the conflict dialog. */
  const describePath = (path: string) => {
    const id = path.replace(/^.*\//, "").replace(/\.ya?ml$/, "");
    if (path.startsWith("boxes/")) {
      const box = draft.boxes.find((b) => b.id === id) ?? base.boxes.find((b) => b.id === id);
      return `Box “${box?.title ?? id}”`;
    }
    if (path.startsWith("departments/")) {
      return `Department “${draft.departments.find((d) => d.id === id)?.name ?? id}” (lanes)`;
    }
    return path;
  };

  const save = async (opts: { token?: string; keep?: "mine" | "theirs" } = {}) => {
    let changes: FileChanges = serializeChanges(files, draftBase, draftState);
    if (Object.keys(changes).length === 0) return;
    const invalid = newProblems(applyChanges(files, changes));
    if (invalid.length) return setProblem({ kind: "invalid", issues: invalid });
    const token = opts.token ?? getToken();
    if (!token) return setProblem({ kind: "token" });

    let overwrite: string[] = [];
    const c = conflict.current;
    if (opts.keep && c) {
      if (opts.keep === "mine") overwrite = c.paths;
      else changes = Object.fromEntries(Object.entries(changes).filter(([p]) => !c.paths.includes(p)));
      if (Object.keys(changes).length === 0) return onReload(c.headFiles, c.headCommit);
    }

    select(null);
    setBusy(true);
    try {
      const result = await saveToBranch({
        gh: new GitHub(token),
        source,
        baseFiles: files,
        changes,
        message: commitMessage(lines),
        overwrite,
        validate: newProblems,
      });
      setToken(token);
      onSaved(result);
    } catch (e) {
      if (e instanceof SaveConflict) {
        conflict.current = e;
        setProblem({ kind: "conflict", items: e.paths.map(describePath) });
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
        onSelect={select}
        onPlaceBox={placeBox}
        onCreateBox={createBox}
        onRenameLane={(laneId, name) => draft.updateLane(laneId, { name })}
        readOnly={preview || busy}
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { BoxEditor } from "./components/BoxEditor";
import { SaveDialog } from "./components/SaveDialog";
import { type BoxPlacement, Timeline } from "./components/Timeline";
import { GitHub } from "./github/api";
import { type Source, loadFromGitHub } from "./github/save";
import { getToken } from "./github/token";
import { hashText, useDraft } from "./model/draft";
import { loadRoadmap } from "./model/load";
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

  const ref = new URLSearchParams(window.location.search).get("ref");
  if (ref && ref !== bundle.source.branch) {
    const { files, source } = await loadFromGitHub(new GitHub(getToken()), bundle.source.repo, ref);
    return { ...loadRoadmap(files), files, source, preview: true };
  }
  return { ...loadRoadmap(bundle.files), files: bundle.files, source: bundle.source, preview: false };
}

export function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    load()
      .then((loaded) => setState({ status: "ready", ...loaded }))
      .catch((e: Error) => setState({ status: "error", message: e.message }));
  }, []);

  if (state.status === "loading") return <div className="splash">Loading roadmap…</div>;
  if (state.status === "error") return <div className="splash error">Couldn’t load the roadmap: {state.message}</div>;
  return <RoadmapView {...state} />;
}

function RoadmapView({ roadmap: base, issues, files, source, preview }: Loaded) {
  const initial = useMemo(readUrlState, []);
  const [zoom, setZoom] = useState<ZoomLevel>(initial.zoom ?? base.settings.default_zoom);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => initial.collapsed ?? new Set(base.departments.filter((d) => d.collapsed).map((d) => d.id)),
  );
  const [jumpToToday, setJumpToToday] = useState(0);
  const [showIssues, setShowIssues] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedPr, setSavedPr] = useState<{ number: number; url: string; branch: string } | null>(null);

  const baseHash = useMemo(() => hashText(JSON.stringify(files)), [files]);
  const draftBase = useMemo(() => ({ boxes: base.boxes, departments: base.departments }), [base]);
  const draft = useDraft(draftBase, `${source.repo}@${source.branch}`, baseHash);
  const draftState = useMemo(() => ({ boxes: draft.boxes, departments: draft.departments }), [draft.boxes, draft.departments]);
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
      if (isTyping(e.target) || saving) return;
      const mod = e.metaKey || e.ctrlKey;
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
  }, [draft, selected, preview, saving]);

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
  const previewUrl = (branch: string) => {
    const q = new URLSearchParams(window.location.search);
    q.set("ref", branch);
    return `?${q}`;
  };
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
                <span className="changes-badge" title="Kept in this browser until you save them as a pull request.">
                  {count} change{count === 1 ? "" : "s"} not committed
                </span>
                <button
                  onClick={() => {
                    if (confirm(`Discard ${count} change${count === 1 ? "" : "s"}? You can still undo this.`)) {
                      setSelected(null);
                      draft.discard();
                    }
                  }}
                >
                  Discard
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    select(null);
                    setSaving(true);
                  }}
                >
                  Save…
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
      {savedPr && (
        <div className="banner success">
          Pull request{" "}
          <a href={savedPr.url} target="_blank" rel="noopener noreferrer">
            #{savedPr.number}
          </a>{" "}
          opened. Your changes will appear here once it’s merged.{" "}
          <a href={previewUrl(savedPr.branch)} target="_blank" rel="noopener noreferrer">
            Preview it
          </a>
          <button className="icon-button" onClick={() => setSavedPr(null)} aria-label="Dismiss">
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
        readOnly={preview}
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
      {saving && (
        <SaveDialog
          source={source}
          baseFiles={files}
          baseIssues={issues}
          base={draftBase}
          draft={draftState}
          settings={base.settings}
          onClose={() => setSaving(false)}
          onSaved={(pr) => {
            setSaving(false);
            setSavedPr(pr);
            draft.discard();
          }}
        />
      )}
    </div>
  );
}

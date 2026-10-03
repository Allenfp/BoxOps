# BoxOps Roadmap — Plan

A swim-lane roadmap that runs as a static GitHub Pages app and uses YAML files in
this repo as its database. Viewers just open the site; editors change the roadmap
in the browser and the app commits the change to a new branch and opens a PR.

## Decisions (2026-10-03)

| Topic | Decision |
|---|---|
| Repo visibility | Public during development. Data is baked into the Pages build. Revisit if it goes private (Pages from a private repo needs a paid plan and is still public outside Enterprise). |
| Auth | Pasted fine-grained personal access token, scoped to this repo with **Contents: write**. Kept in `sessionStorage`. An OAuth proxy (Cloudflare Worker) is a possible later add-on. |
| Saving (changed 2026-10-03) | **Save commits straight to `main`**, like saving a file. No branches or PRs. Concurrent saves to different items merge automatically; the same item edited by two people asks "keep mine / keep theirs". |
| Multi-person work | One box = one lane. Work needing two FTEs is two boxes (optionally sharing an `initiative` tag). |
| Lanes | A lane is anonymous **FTE capacity** (`fte: 1` or `0.5`), not a person. No link to `config/people.yaml`. |
| Stack | Vite + TypeScript + React in `web/`. Vitest for logic tests. GitHub Actions for deploy and validation. |

## Architecture

```
GitHub Pages (static app)                 GitHub repo
┌─────────────────────────┐   read    ┌──────────────────────────────┐
│ load roadmap/** → state │◄──────────│ main: roadmap/*.yaml         │
│ edit locally (draft)    │           │                              │
│ diff draft vs base      │  write    │ one commit on main per save  │
│ Save (⌘S)               │──────────►│ → Pages redeploys (~1 min)   │
└─────────────────────────┘ (API+PAT) └──────────────────────────────┘
```

- **Read path.** The Pages build bundles `roadmap/**` into `roadmap.json`, so
  anonymous viewers need no token and spend no API quota. Signed-in editors load
  the live tree from the API (`?ref=<branch>` previews any branch or PR).
- **Write path.** One atomic commit through the Git Data API onto the tip of
  `main`: read head → create tree (`base_tree` = head) → create commit →
  fast-forward `main`. If someone saves between our read and write, GitHub
  refuses the update and the save retries once.
- **Freshness.** On load the app compares the bundled commit with the head of
  `main` (one API call) and reads newer files from GitHub, so the minute
  between a save and the redeploy never shows a stale roadmap.
- **Conflicts.** Saves only conflict per file (one file per box/department):
  if someone else changed a file you also changed since you loaded, you choose
  keep mine / keep theirs. Everything else from both sides is kept.
- **Validation.** The app checks the roadmap as it will be after the save
  (including anyone else's saves) and refuses invalid saves. The deploy runs
  the same validator; hand-made PRs are checked by `validate.yml`.

## Data model

```
roadmap/
  settings.yaml            # title, fiscal_year_start_month, default_zoom, types, statuses
  departments/<id>.yaml    # id, name, color, order, collapsed, lanes: [{id, name?, fte}]
  boxes/<id>.yaml          # id, title, lane, start, end, type, status, epic, description, tags, links
```

- IDs are stable and never derived from the display name at runtime. Lane ids are
  unique across all departments, so a box references just `lane: <id>`.
- Dates are `YYYY-MM-DD` strings, start and end **inclusive**, handled as integer
  day numbers internally. Never round-tripped through local-time `Date`.
- The writer emits keys in a fixed order so a change only touches its own lines,
  and uses the `yaml` Document API so hand-written comments survive.

## Features

**Timeline.** Zoom levels *weeks* (day ticks), *months* (week ticks), *quarters*
(month ticks), with fiscal quarters from settings. A today line and a "jump to today"
button. The time header and lane labels stay fixed while scrolling. Drag snaps to the zoom
unit.

**Boxes.** Drag in empty lane space to create; drag to move (across lanes and
departments); drag edges to resize; side panel to edit; multi-select, duplicate,
delete, keyboard shortcuts. Overlapping boxes in one lane stack into sub-rows and
the lane is flagged over-allocated. Later: milestones, dependency arrows.

**Lanes and departments.** Add, rename, reorder and remove lanes on the fly (removing
a lane that has boxes prompts to reassign them). Departments are collapsible,
reorderable lane groups. A collapsed department shows a summary strip with its
boxes and FTE total.

**Draft and save.** All edits go into a local draft saved in `localStorage`, with
undo and redo. Save (⌘S) commits the draft to `main` with a readable commit
message ("Dagster 2.x upgrade: rescheduled to Sep 24 – Nov 2"). Later: a Changes
panel listing each edit with per-item discard.

**Viewing.** Filter by type, status, tag and department; search; view state in the
URL; PNG/PDF export. Later: compare against a past commit to show schedule slip.

## Phases

Status (2026-10-03): phases 0 and 1 done. Phase 2 mostly done: drag to move
(across lanes too), drag edges to resize, the box editor, double-click to
create, lane renaming, undo/redo, and a draft saved in the browser. Still to do:
adding, removing and reordering lanes and departments. Phase 3 done as direct
saves to `main` (replacing the original branch + PR design): Save / ⌘S, token
prompt on first save, conflict resolution, a freshness check on load, and
`?ref=<branch>` read-only previews. Tested against a stateful fake GitHub; not
yet against GitHub itself.

0. **Scaffold.** Schema and validator, sample data, Vite app, Pages deploy and PR
   validation Actions.
1. **Read-only viewer.** Departments, lanes, boxes, zoom levels, today line,
   collapsing, overlap stacking.
2. **Local editing.** Box create/move/resize/edit, lane and department management,
   draft persistence, undo and redo, Changes panel.
3. **Write-back.** Token sign-in, direct save to `main`, conflict handling,
   freshness check, branch preview.
4. **Polish.** Milestones, dependencies, capacity view, filters, export, optional
   OAuth Worker.

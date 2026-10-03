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
| Multi-person work (changed 2026-10-03) | A box has an FTE of 0.5, 1, 1.5 or 2 (default 1) and is that tall: a 2-FTE box covers its lane and the one below; two 0.5 boxes share a lane. Anything that doesn't fit goes in a department's "over capacity" area. |
| Engineers (2026-10-03) | Boxes name the engineers expected to work on them (one or more), picked from `roadmap/people.yaml`, which the app can add to. Lanes stay anonymous capacity. |
| Working days (2026-10-03) | Weekends are never drawn or counted: the time axis, durations, dragging and date pickers all work in weekdays. |
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
- **Live updates (polling).** Every 2 minutes, while the tab is visible, the app
  revalidates the site's own `roadmap.json` (a 304 when unchanged; no GitHub
  API calls, so no rate limit). A newer commit is merged into the screen in
  place: others' changes come in, unsaved edits are kept, and items both sides
  changed are flagged and resolved at save time. Others see a save roughly
  1–3 minutes later (deploy time plus the poll interval). Commits the tab has
  already shown or saved on top of are ignored, so the lagging deploy never
  rolls a tab back. Anonymous GitHub API requests count against a 60/hour
  per-IP limit even when they return 304, which is why polling doesn't use it.
- **Conflicts.** Saves only conflict per file (one file per box/department):
  if someone else changed a file you also changed since you loaded, you choose
  keep mine / keep theirs. Everything else from both sides is kept.
- **Tests.** Unit tests (Vitest, `web/src/**/*.test.ts`) and browser tests
  (Playwright + WebKit, `web/e2e/`). Browser tests run against the production
  build with a fake GitHub and a fixed copy of the roadmap
  (`web/e2e/fixtures/roadmap/`) and a clock pinned to 2026-10-03, so they never
  depend on live data or the network. CI: every branch push/PR runs everything;
  pushes to `main` run browser tests before deploying only if something outside
  `roadmap/` changed, so app saves still go live in about a minute.
- **Validation.** The app checks the roadmap as it will be after the save
  (including anyone else's saves) and refuses invalid saves. The deploy runs
  the same validator; hand-made PRs are checked by `validate.yml`.

## Data model

```
roadmap/
  settings.yaml            # title, fiscal_year_start_month, default_zoom, types, statuses
  departments/<id>.yaml    # id, name, color, order, collapsed, lanes: [{id, name?, fte}]
  boxes/<id>.yaml          # id, title, lane, start, end, type, status, fte, engineers, epic, description, tags, links
  people.yaml              # people: [{id, name, department?, role?, email?, manager?, notes?}] — the engineer roster (People tab)
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

**Table view.** A Timeline / Table switch (`?view=table`). The table lists
every box with editable cells (title, lane, dates, type, status, epic link,
tags, description), sortable columns, search, add and delete, all through the
same draft, undo and Save. Text cells save on Enter or leaving the cell; Esc
cancels.

**Pre-save check.** Save first asks GitHub for the latest commit. If others
saved since the tab loaded, their changes are merged onto the screen and the
save pauses on a dialog listing who saved what, with Review / Save now (or
keep mine / keep theirs for items both sides edited). Boxes changed by others
are outlined in teal until reviewed.

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
   freshness check, 2-minute polling for others' saves, branch preview.
4. **Polish.** Milestones, dependencies, capacity view, filters, export, optional
   OAuth Worker.

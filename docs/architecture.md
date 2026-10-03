# How the roadmap app works

The roadmap is a static site on GitHub Pages with no server of its own. GitHub
is the database: the data is YAML in this repo, and saving is a commit to
`main` made from the browser through the GitHub API.

```
Browser (static app on GitHub Pages)            GitHub (this repo)
┌──────────────────────────────────┐   read    ┌────────────────────────────┐
│ roadmap.json (built from main)   │◄──────────│ main: roadmap/*.yaml       │
│  + newer commits via the API     │           │                            │
│ edits → local draft (undo, kept  │  write    │ one commit per save        │
│   in localStorage)               │──────────►│ → Actions validates and    │
│ Save (⌘S) → pre-save check →     │ (API +    │   redeploys (~30 s)        │
│   commit to main                 │  token)   │                            │
└──────────────────────────────────┘           └────────────────────────────┘
```

## Code layout

```
web/
  src/
    App.tsx                 loading, polling, saving, toolbar, views
    components/             Timeline, TableView, PeopleView, BoxEditor,
                            DepartmentEditor, EngineerPicker, SaveDialog, TextCell
    model/                  data: dates, load (validator), draft, structure
                            (departments and lanes), relations (codes and
                            rules), serialize, summary (change descriptions),
                            report
    timeline/               scale (time ↔ pixels), layout (lanes, capacity)
    github/                 api (REST client), save (commit, conflicts, loading)
  scripts/                  validate.ts, report.ts (command-line checks)
  e2e/                      browser tests, fake GitHub, fixture roadmap
  vite.config.ts            bundles roadmap/ into roadmap.json at build time
```

## Reading

- **At build time** the Vite plugin reads `roadmap/` into `roadmap.json`,
  together with the repo, branch, commit, and that commit's author and subject.
  Viewers need no token and use no API quota.
- **On load** the app asks GitHub for the head of `main` (one API call). If it's
  newer than the bundled commit (someone saved and the redeploy hasn't
  finished), it reads the newer files from `raw.githubusercontent.com`.
- **Polling.** Every 2 minutes, while the tab is visible, the app re-fetches the
  site's own `roadmap.json`. That's a cheap 304 when nothing changed, and it
  doesn't touch the GitHub API, whose anonymous limit (60 requests an hour per
  IP) counts 304s too. A newer commit is merged into the screen in place, and a
  notice says who saved what. The tab remembers which commits it has already
  shown or saved on top of, so the lagging deploy never rolls it back.
- **Previews.** `?ref=<branch>` shows another branch read-only.

## Editing

All edits go into a **draft**: the boxes, departments and people as changed,
with undo and redo. Department and lane changes (`model/structure.ts`) are plain
functions over the draft. Removing a lane or department that still has boxes
requires a lane to move them to, so work is never dropped. The draft is kept in
`localStorage` together with the version it was made from, so a refresh doesn't
lose work, even if someone saved in between. When a newer version arrives, the
draft is **rebased** onto it item by item. Items only someone else changed take
their version, items only you changed keep yours, and items both changed keep
yours but are flagged as clashes.

## Saving

1. **Validate.** The roadmap as it would be after the save is checked with the
   same validator CI uses; new problems block the save.
2. **Token.** The first save asks for a fine-grained token (Contents: write on
   this repo). It's kept in `sessionStorage`, so it's forgotten when the tab
   closes, and it's sent only to GitHub.
3. **Pre-save check.** The app asks for the head of `main`. If someone saved
   since the tab loaded, their changes are merged onto the screen, outlined in
   teal, and the save pauses on a dialog listing who saved what. The user can
   review, then save, or choose whose version to keep for clashing items.
4. **Commit.** The changed files are written with the `yaml` Document API, so
   only the edited lines change and comments survive. The app makes one tree
   (based on the head), one commit, then a fast-forward-only update of `main`.
   If someone saved in the split second in between, GitHub refuses, and the app
   retries once on top of their commit. A same-file clash at that point shows
   the keep-mine / keep-theirs choice.
5. **Deploy.** The push triggers the Pages workflow; the site updates in about
   30 seconds.

## Timeline layout

- **Working days only.** The x axis counts Monday–Friday (`workIndex` in
  `model/dates.ts`). Weekends take no space, durations count working days, and
  date fields move weekend picks to the nearest weekday.
- **Lanes and FTE.** A department is a stack of half-FTE slots (a 1-FTE lane is
  two). A box is as tall as its FTE. It goes in its own lane when there's room,
  else in the nearest free space in the department. Several placement orders
  are tried and the tidiest kept. If a box is still left out although the FTE
  fits (a fully booked department), a bounded backtracking search finds an
  arrangement (`timeline/layout.ts`).
- **Rules between boxes** (`model/relations.ts`) are checked on every change.
  A broken rule outlines both boxes in red and is listed in the toolbar. An
  edit that breaks a rule shows a popup with the dates. Nothing is blocked.
- **Over capacity** is arithmetic, not geometry: a sweep over the boxes finds
  any day where the FTE running exceeds the department's lanes. Boxes that
  don't fit are drawn in an area under the lanes.

## Tests and CI

- **Unit tests** (Vitest, `web/src/**/*.test.ts`) cover dates, loading and
  validation, the draft and rebasing, YAML writing, change descriptions,
  layout and capacity, the report, and the save logic against a fake API.
- **Browser tests** (Playwright with WebKit, `web/e2e/`) run the production
  build. GitHub is faked by a stateful stand-in (real commits and branch
  state) and the roadmap is a fixed copy in `web/e2e/fixtures/roadmap/`. The
  clock is pinned to 2026-10-03, so tests never depend on live data, the date
  or the network.
- **CI.** `checks` (`validate.yml`) runs validation, unit tests, the build and
  the browser tests on every branch push and pull request. The Pages deploy
  (`pages.yml`) runs validation, unit tests and the build on every push to
  `main`. It runs the browser tests too, before deploying, unless the push
  only changed `roadmap/`, so saves from the app go live quickly.

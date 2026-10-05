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
    model/                  data: dates, format (data format version), load
                            (validator), draft, structure (departments and
                            lanes), relations (codes and rules), serialize,
                            summary (change descriptions), report
    timeline/               scale (time ↔ pixels), layout (lanes, capacity)
    github/                 api (REST client), save (commit, conflicts,
                            loading), git-objects (git blob and tree SHAs)
  cli/                      Node-only: git.ts (reads a roadmap folder from git
                            objects or from disk), site.ts (builds roadmap.json)
  scripts/                  validate.ts, report.ts (command-line checks; an
                            optional argument names another roadmap folder)
  e2e/                      browser tests, fake GitHub, fixture roadmap
  vite.config.ts            build id, and roadmap.json at build time and in dev
```

`model/` also holds `paths.ts` (which files are roadmap files) and `bundle.ts`
(the `roadmap.json` fields).

## Reading

- **At build time** the Vite plugin writes `roadmap.json` (`cli/site.ts`;
  fields in `model/bundle.ts`), so viewers need no token and use no API quota.
  It reads `roadmap/` from git objects at the commit being built (`GITHUB_SHA`
  in Actions, else HEAD), never from the checkout, with git hardened and
  plumbing only (`cli/git.ts`). Only plain files are allowed: a symlink or
  submodule anywhere under `roadmap/` (outside hidden paths) stops the build,
  as does text that isn't UTF-8 or more than 20,000 files, 1 MiB in one
  roadmap file or 64 MiB in all. Each blob is checked against its SHA, and a
  BOM is kept. The bundle holds:
  - `files` (the roadmap files, `model/paths.ts`), their git `blobs`, and
    `ignored` (other files there, which the validator reports as unexpected);
  - `source`: repo, branch, commit, `dir`, the folder's `tree` SHA, the
    commit's author, subject and date, `history` (its last 50 first-parent
    commits), and in Actions the run's link. `visibility` and `private` come
    from the Actions event; when unknown the site counts as private;
  - `app`: version, build id and time. The build id is the version plus
    `web/`'s tree at HEAD, so roadmap-only saves keep it (`.dirty` with
    uncommitted app changes). It's also compiled into the JS
    (`__BOXOPS_BUILD__`) and put in `<meta name="boxops-build">`;
  - `schema` (1), `format` and `notices`.

  A local build whose `roadmap/` has uncommitted changes reads the files on
  disk instead: `tree` is null and the bundle is marked `local`. The dev server
  always reads files on disk (`$BOXOPS_ROADMAP`, else `../roadmap`) and marks
  its bundle `local`, so the app neither compares it with GitHub nor polls (for
  now; local bundles are to become read-only). `npm run validate` and
  `report` read files on disk under the same rules: symlinks are errors, never
  followed. The app still opens a `roadmap.json` from before schema 1, treating
  what it lacks as unknown.
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
- **Data format.** `format` in `settings.yaml` must be the one this build reads
  (`model/format.ts`); a roadmap in any other format opens read-only, with a
  banner saying why.
- **Problems.** Loading is lenient: a bad entry or value is reported (with its
  line) and left out, and the file is marked lossy. Problems are compared by
  a key without list positions or line numbers, so one that was already there
  never counts as new.

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
   same validator CI uses; new problems block the save. So does a change to a
   lossy file (one the loader left part of out): writing it would delete what
   was left out, so the user is asked to fix the file first.
2. **Token.** The first save asks for a fine-grained token (Contents: write on
   this repo). It's kept in `sessionStorage`, so it's forgotten when the tab
   closes, and it's sent only to GitHub.
3. **Pre-save check.** The app asks for the head of `main`. If someone saved
   since the tab loaded, their changes are merged onto the screen, outlined in
   teal, and the save pauses on a dialog listing who saved what. The user can
   review, then save, or choose whose version to keep for clashing items.
4. **Commit.** The changed files are written with the `yaml` Document API, so
   only the edited lines change and comments survive: only fields that differ
   from what was loaded are touched, list entries (lanes, people, PTO, rules)
   are matched up one by one, and a file keeps its BOM and line endings. Each
   department and box goes to the file it was loaded from. The app makes one tree
   (based on the head), one commit, then a fast-forward-only update of `main`.
   If someone saved in the split second in between, GitHub refuses, and the app
   retries once on top of their commit. A same-file clash at that point shows
   the keep-mine / keep-theirs choice.
5. **Deploy.** The push triggers the Pages workflow; the site usually updates
   within a minute (deploys queue, so longer if one is already running).

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

- **Unit tests** (Vitest, `web/src/**/*.test.ts` and `web/cli/**/*.test.ts`)
  cover dates, loading and validation, the draft and rebasing, YAML writing,
  change descriptions, layout and capacity, the report, the save logic against
  a fake API, and the roadmap readers, git SHAs and `roadmap.json` against
  real git repositories made in the temp folder.
- **Browser tests** (Playwright with WebKit, `web/e2e/`) run the production
  build. GitHub is faked by a stateful stand-in (real commits and branch
  state) and the roadmap is a fixed copy in `web/e2e/fixtures/roadmap/`. The
  stand-in makes each deploy's `roadmap.json` with the build's own code, so
  its blob and tree SHAs are real. The clock is pinned to 2026-10-03, so tests
  never depend on live data, the date or the network.
- **Lint** (oxlint, `web/.oxlintrc.json`): oxlint's correctness rules plus
  the React hooks rules; any warning fails `npm run lint`. (typescript-eslint
  doesn't support TypeScript 7 yet.) A deliberate exception is a
  `// eslint-disable-next-line <rule> -- <reason>` comment, which oxlint
  honours; one that no longer hides anything is an error.
- **CI.** `CI` (`ci.yml`) runs lint, the type check, the unit tests (again
  with `TZ=America/Los_Angeles` and with `TZ=Pacific/Kiritimati`, UTC−8/−7
  and UTC+14, so nothing depends on the runner's time zone), validation, the
  build and the browser tests on every pull request and every push to a branch
  other than `main`, whatever it changes. A pull request from a branch of this
  repo is covered by that branch's push run, so only pull requests from forks
  run it again.
- **Deploy.** The Pages deploy (`pages.yml`) runs lint, the type check,
  validation, unit tests and the build on every push to `main`. It runs the
  browser tests too, before deploying, unless nothing outside `roadmap/` has
  changed since the commit the live site was built from (its `roadmap.json` says
  which), so saves from the app go live quickly and an app change whose run
  failed or was cancelled is still tested before it goes out. If that commit
  can't be read, the browser tests run. Deploys run one at a time and are never
  cancelled midway; a burst of saves deploys at most twice. Jobs get only the
  permissions they need, and actions are pinned to commits.
- **Upgrades.** Dependabot (`.github/dependabot.yml`) opens pull requests
  weekly for the actions' pinned commits and for the npm packages in `web/`
  (minor and patch upgrades together), once a release is 3 days old.

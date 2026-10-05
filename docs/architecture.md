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
    site.ts                 the site's roadmap.json, app updates, reloading
    saving.ts               what saving needs, fetched once editing starts
    components/             Timeline, TableView, PeopleView, BoxEditor,
                            DepartmentEditor, EngineerPicker, SaveDialog,
                            TokenForm, TextCell, LoadScreen (load failures),
                            ErrorBoundary
    model/                  data: dates, format (data format version), parse
                            and load (the validator: each file on its own,
                            then across files), draft, structure (departments
                            and lanes), relations (codes and rules), serialize,
                            summary (change descriptions), report
    timeline/               scale (time ↔ pixels), layout (lanes, capacity)
    github/                 api (REST and GraphQL client, timeouts, errors),
                            read (newer commits by SHA diff), save (commit,
                            conflicts, retries), messages (errors in words),
                            git-objects (git blob and tree SHAs, base64)
  cli/                      Node-only: git.ts (reads a roadmap folder from git
                            objects or from disk), site.ts (builds roadmap.json)
  scripts/                  validate.ts, report.ts (command-line checks; an
                            optional argument names another roadmap folder),
                            gen-roadmap.ts (synthetic roadmaps of any size)
  e2e/                      browser tests, fake GitHub, fixture roadmap
  index.html                early theme, boot watchdog (inline scripts)
  vite.config.ts            build id, CSP, and roadmap.json at build time
                            and in dev
```

`model/` also holds `paths.ts` (which files are roadmap files), `bundle.ts`
(the `roadmap.json` fields) and `draftStore.ts` (unsaved drafts in
`localStorage`). Browser code (`src/`) is type-checked without
Node's types (`tsconfig.app.json`); `cli/`, `scripts/`, `e2e/`, the unit tests
and the configs have them (`tsconfig.node.json`). `npm run typecheck` checks
both.

## Reading

- **At build time** the Vite plugin writes `roadmap.json` (`cli/site.ts`;
  fields in `model/bundle.ts`), so viewers need no token.
  It reads `roadmap/` from git objects at the commit being built (`GITHUB_SHA`
  in Actions, else HEAD), never from the checkout, with git hardened and
  plumbing only (`cli/git.ts`). Only plain files are allowed: a symlink or
  submodule anywhere under `roadmap/` (outside hidden paths) stops the build,
  as does text that isn't UTF-8 or more than 20,000 files, 1 MiB in one
  roadmap file or 64 MiB in all. Each blob is checked against its SHA, and a
  BOM is kept. The bundle holds:
  - `files` (the roadmap files, `model/paths.ts`), their git `blobs`, and
    `ignored` (other files there, which the validator and the app report as
    unexpected);
  - `source`: repo, branch, commit, `dir`, the folder's `tree` SHA, the
    commit's author, subject and date, `history` (its last 50 first-parent
    commits), and in Actions the run's link. `visibility` and `private` come
    from the Actions event; when unknown the site counts as private;
  - `app`: version, build id and time. The build id is the version plus
    `web/`'s tree at HEAD, so roadmap-only saves keep it (`.dirty` with
    uncommitted app changes). Both are put in `index.html`
    (`<meta name="boxops-build">` and `"boxops-build-time"`), and the id is
    defined for the app as `__BOXOPS_BUILD__`; the app compares them with
    every `roadmap.json` it fetches (see [Tabs left
    open](#tabs-left-open)). The time, HEAD's committer date, is kept out of
    the JavaScript, so roadmap-only saves leave every app file as it was and
    a tab left open can still fetch the parts it loads on first use;
  - `schema` (1), `format` and `notices`;
  - `parsed` (optional): each roadmap file as the build's parser makes of it
    (`model/parse.ts`), by blob SHA, stamped with the build id. The app takes
    them only from its own build, so showing a deploy needs no YAML parsing;
    files from GitHub, and bundles from another build or from the dev server
    (which leaves them out, as its app changes under one build id), are
    parsed in the browser. They about double the file: at 2,000 boxes, 180 KB
    gzipped becomes 361 KB.

  A local build whose `roadmap/` has uncommitted changes reads the files on
  disk instead: `tree` is null and the bundle is marked `local`. The dev server
  always reads files on disk (`$BOXOPS_ROADMAP`, else `../roadmap`) and marks
  its bundle `local`. The app shows a local bundle read-only, with a banner,
  and never calls GitHub or polls for it. `npm run validate` and
  `report` read files on disk under the same rules: symlinks are errors, never
  followed. The app still opens a `roadmap.json` from before schema 1, treating
  what it lacks as unknown.
- **On load** the app paints the bundle as soon as `roadmap.json` arrives.
  Then, in the background and for 4 seconds at most (an abort signal on the
  GitHub client stops every call of the read), it asks GitHub for the head
  of `main`, from a URL the browser hasn't cached (GitHub lets browsers keep
  a branch head for 60 s; no cache header is sent, since Safari may add one
  GitHub's CORS check refuses). If it's newer than the bundled commit
  (someone saved and the redeploy hasn't finished), the app reads the newer
  roadmap by SHA diff (`github/read.ts`): the commit and root tree, the
  folder's listing if its tree SHA changed, then only blobs whose SHA the
  tab doesn't hold, 4 at a time, from a cache kept for the session and at
  most 300 per read. Whether roadmap files changed is decided from their
  blob SHAs, never from the tree SHA alone. A head older than what the tab
  has (its commit's parent, a commit in its history, or one it has seen:
  GitHub's answer lagging) is asked for once more; still older, the read
  stops rather than step back. The folder is held to the build's rules
  (plain files, the same limits, UTF-8 with any BOM kept). The newer roadmap
  comes in like a poll's, through the draft's rebase, with the usual notice
  of who saved what; not if the tab has moved on or is saving meanwhile. If
  the check fails or runs out of time, the bundled copy stays (the pre-save
  check catches up anyway), and a token GitHub rejects (401) is forgotten.
  Newer saves it won't read past (more than 300 changed files, or a folder
  that breaks the build's rules, which also stops saving) keep the bundled
  copy too, with a notice saying why, until the tab moves on.
  With a token every call goes through the API, which is how a private
  repository is read. Without one the app reads only a repository the build
  says is public, taking file contents from `raw.githubusercontent.com` to
  spare the anonymous allowance (60 API calls an hour per IP address): one
  call when nothing changed. A private repository and no token cost no
  calls; the tab shows the deployed copy and says so, quietly ("Deployed
  copy" in the toolbar, a button that says what that means). A
  `roadmap.json` that can't be fetched or read, or doesn't come within
  20 s, gets a plain message with Try again (also tried again when the
  browser comes back online), never a blank page or "Loading…" for good.
- **Polling.** Every 2 minutes (counted from the start of the last check),
  while the tab is visible, the app re-fetches the site's own `roadmap.json`.
  That's a cheap 304 when nothing changed, and it doesn't touch the GitHub
  API, whose anonymous limit (60 requests an hour per IP) counts 304s too.
  It only ever moves forward (`movesForward` in `site.ts`): a bundle is
  taken only if its `history` holds the commit on screen; otherwise it's
  ignored if the tab has seen it, if the history on screen holds it (two
  commits can share a second), or if it's older by commit time. So a deploy
  that finishes late (deploys aren't cancelled, and the tab may have read a
  newer head from GitHub) never rolls the tab back. A newer commit is merged
  into the screen in place, and a notice says who saved what (none when
  nothing in the roadmap folder changed, as for an app commit: then only the
  commit on screen moves on, and undo history is kept). A failed check
  (offline, mid-deploy, a private site whose sign-in expired: the
  same-origin request is then redirected to github.com and fails, or no
  answer within 20 s) waits longer each time, 4, 8, then 15 minutes; two in
  a row show a calm notice, "Lost the connection to the site", with Reload,
  until a check succeeds. Coming back online checks at once. A failed check
  never counts as an app update. Every `roadmap.json` fetched also brings
  the site's `notices`, shown as plain-text banners (never HTML; the same
  one once) that can be put away.
- **Previews.** `?ref=<branch>` shows another branch read-only, read the same
  way (only files that differ from `main`'s are fetched). The name is checked
  against git's rules before any call. A private repository without a token
  shows a token form instead (read access is enough, and its new-token link
  asks for Contents: read). A branch that isn't there, or any other failure,
  gets a plain message with Try again and a link back to the live roadmap;
  when the token kept can't see the repository (its resource owner, single
  sign-on, the organization's token policy), also Use a different token.
- **Data format.** `format` in `settings.yaml` must be the one this build reads
  (`model/format.ts`); a roadmap in any other format opens read-only, with a
  banner saying why.
- **Problems.** Loading is lenient: a bad entry or value is reported (with its
  line) and left out, and the file is marked lossy. Problems are compared by
  a key without list positions or line numbers, so one that was already there
  never counts as new.
- **Parsing.** Each roadmap file is parsed on its own (`model/parse.ts`), then
  the files are checked together (`model/load.ts`). The app keeps what each
  file parsed to for the session, by blob SHA, so a poll or a save that brings
  one changed file parses just that file. The parser and the `yaml` library
  are a file of their own, fetched only when a file must be parsed in the
  browser (one the build didn't parse) or once someone starts editing (an
  edit, or an editor opened), with the rest of what saving needs
  (`saving.ts`): so viewers of a deploy never download them, and a save
  doesn't wait for them.

## Editing

All edits go into a **draft**: the boxes, departments and people as changed,
with undo and redo. Department and lane changes (`model/structure.ts`) are plain
functions over the draft. Removing a lane or department that still has boxes
requires a lane to move them to, so work is never dropped. When a newer version
arrives, the draft is **rebased** onto it item by item. Items only someone else
changed take their version, items only you changed keep yours, and items both
changed keep yours but are flagged as clashes. A clash lasts until the item
matches the saved version (you took theirs, put it back by hand, discarded, or
saved it), and the save dialog's Keep mine / Keep theirs settles only the
clashes it lists: one that came in while it was open is asked about next. Keep
theirs is an edit like any other (undo brings back yours, and the clash) and
leaves the item where it was in its list. When one of your own saves comes
back, the draft is rebased from what that save wrote, so anything edited (or
undone) while it ran stays an unsaved change of yours, never a clash with your
own commit. A merge can leave something pointing at what one side deleted:
an engineer no longer on the roster comes off their boxes, a rule about a box
that's gone is dropped, a box whose lane is gone moves to where that lane's
other boxes went (else its department's first lane) and is flagged as a
clash, and a box you added with the same code as one someone else added takes
a fresh code (your rules follow it). Keep theirs is put right the same way,
without a new clash: their box in a lane you removed moves to a lane there is.
The clash bookkeeping is a pure reducer over the draft and its undo history
(`reduceHistory` in `model/draft.ts`).
Adding or removing a department leaves the others' `order` alone; only a
reorder renumbers them, and only a change in their order is a change.

**Unsaved drafts are kept per tab** in `localStorage` (`model/draftStore.ts`),
so a reload or a crash doesn't lose work, even if someone saved in between:

- **Where.** Each tab writes, and removes, only its own key,
  `boxops-draft:<owner>/<repo>@<branch>:<tab id>`. The tab id is kept in
  `sessionStorage`, so a reload of the tab finds its own draft. A duplicated
  tab copies `sessionStorage`, id and all. If the original's draft is alive,
  the copy takes a new id at once. If the original has none yet, they start
  with one key, so each page (one load of a tab) stamps what it writes with
  an id of its own: a tab that finds another page's draft under its key
  (writing, on a heartbeat, or told by a `storage` event) takes a new id and
  leaves that draft alone. Another tab polling, saving or discarding never
  touches this one's draft. A tab shows "This roadmap has unsaved changes in
  another tab" while another open tab has some (`storage` events keep it
  current).
- **What.** Only the changed items, each with the version it was changed from
  (`{ old, now }` by item key), and the clashes, stamped with the data
  `format`, the `build`, the `baseCommit` it was made against and `savedAt`.
  One edit at 2,000 boxes is a few hundred bytes, not the whole roadmap. It's
  rebuilt on whatever roadmap is loaded and rebased like a newer save, so
  items nobody touched are read fresh, whichever build stored the draft.
- **When.** Once editing pauses for 0.4 s (at least every 2 s while it goes
  on), never on every keystroke; at once when nothing is left to keep, and
  before a save starts, when the tab is hidden or closed. A write the browser
  refuses (full storage, or site data blocked) shows a warning once, and the
  save menu says changes aren't being kept until a write goes through: the
  heartbeat tries again rather than marking the older copy alive.
- **Tabs that are gone.** A draft also carries a heartbeat: marked alive every
  minute while its tab is open, and closed when the tab closes (`pagehide`).
  A page that crashed never marked its draft closed, so a reload (navigation
  timing says which page is one) keeps the tab's id and finds the draft even
  though it looks alive. When a tab opens the roadmap, and on each heartbeat
  while it's in view, drafts left by tabs that are gone (closed, or not alive
  for 5 minutes: browsers slow down hidden tabs' timers) are offered, newest
  first: "Restore unsaved changes from another tab?" with Restore (its items
  over this tab's, one undo step; the one left behind is removed once this
  tab's draft, with them in, is written) or Discard. Never taken silently. The count of changes follows others' saves as
  they come in; one whose changes have all been saved since is no longer
  offered (and is removed when a tab next opens the roadmap). A tab that was
  only asleep keeps its changes: when it wakes it writes its draft again, and
  whichever tab saves first makes the other's the same as the saved roadmap.
  The single key every tab shared before 0.1.0 moves over once, and is
  offered like one left by a tab that's gone (a tab still running the older
  BoxOps may have it open), with no time: it never said when it was written.
- **Other versions.** A draft in another data format, or one that can't be
  read (said so: not JSON, or broken), is never opened: "Download my unsaved
  edits (JSON)" or Discard.
- **Limits.** Safari deletes a site's storage after 7 days of use without a
  visit to it, drafts included; and project sites on `<owner>.github.io`
  share one origin, so one storage quota.

## Saving

1. **Validate.** The roadmap as it would be after the save is checked with the
   same validator CI uses; new problems block the save. So does a change to a
   lossy file (one the loader left part of out): writing it would delete what
   was left out, so the user is asked to fix the file first.
2. **Token.** The first save asks for a token. The form links to GitHub's
   new-token page filled in for this repository (`target_name` = its owner,
   Contents: write) and lists what to check there: Resource owner shows the
   owner, Only select repositories → this one, Contents: Read and write, the
   org's approval if it requires one, and an expiration within the org's
   maximum token lifetime if it sets one. A classic token (or one from the
   GitHub CLI) is accepted, with a note that a fine-grained one is safer;
   outside collaborators need one. The token is kept as soon as it's
   submitted, in `sessionStorage` under `boxops-github-token:<owner>/<repo>`
   (the old tab-wide key moves over once) and in memory, and it's forgotten
   only on a 401 or Forget token, so Try again and the automatic re-save
   after a clash never ask again. A choice already made (keep mine or keep
   theirs) is carried through the token form. The key names the repository
   because every project site on `<owner>.github.io` shares one origin;
   scripts of those other sites, opened in the same tab, could read it, which
   private Pages (a subdomain of its own) or a custom domain avoid. It's sent
   only to GitHub.
3. **Pre-save check.** First the app re-fetches `roadmap.json`: if a newer
   BoxOps was deployed that the poll hasn't seen, the tab goes read-only
   instead of saving (see [Tabs left open](#tabs-left-open)). It waits 5 s
   at most; one that can't be had says nothing. Then it reads the head of
   `main` as on load; one still older than the tab's copy stops the save,
   "GitHub's answer is behind; try again in a few seconds", rather than be
   taken for newer saves. If the head's `settings.yaml` states a newer data
   format than this BoxOps writes (an upgrade was merged and is deploying),
   nothing is written: "BoxOps is being upgraded; reload in a minute". If someone
   saved roadmap changes since the tab loaded (by blob SHA: a commit to other
   files doesn't count), their changes are merged onto the screen, outlined in
   teal, and the save pauses on a dialog listing who saved what. The user can
   review, then save, or choose whose version to keep for clashing items.
4. **Commit.** The changed files are written with the `yaml` Document API, so
   only the edited lines change and comments survive: only fields that differ
   from what was loaded are touched, list entries (lanes, people, PTO, rules,
   and plain values like tags and engineers) are matched up one by one, and a
   file keeps its BOM and line endings. Each
   department and box goes to the file it was loaded from. The save is one
   GraphQL `createCommitOnBranch` call (`github/save.ts`): GitHub makes the
   commit and moves `main` in one step, only if `main` is still at the head
   the save was checked against. The commit is authored by the token's owner
   and committed by GitHub, which signs it "if supported", in GitHub's words;
   whether that satisfies a *Require signed commits* rule with a fine-grained
   token is still to be checked live. Only files whose blob SHA differs from
   the head's are sent, and an empty change never is. CI skip markers such as
   `[skip ci]` in titles are neutralised, so every save deploys. If someone
   saved in between, GitHub refuses (`STALE_DATA`): the app re-reads only what
   changed, checks clashes and validates again, then retries on top of their
   commit, at most twice. A same-file clash at that point shows the keep-mine
   / keep-theirs choice; a re-read that fails (too many changes, the folder's
   problems, a rate limit) stops the save with its own reason. After a
   failure that leaves unclear whether the
   commit was made (a timeout, a dropped connection, a 5xx, an error in a
   field of the commit GitHub sends back), the app reads the head again: if
   every changed file there is ours, the save landed and is reported as
   saved; otherwise retrying is safe, since each attempt names the head it
   goes on. Every call has a timeout that also covers reading the answer
   (15 s for reads, 30 s for the save). There's no permission check first:
   GitHub's refusals are sorted into kinds (`github/api.ts`, for REST and
   GraphQL alike: what the error says first, a spent hourly allowance last)
   and worded in `github/messages.ts`; the save dialog is titled for the kind
   and says what to do (the token's resource owner, repository and approval;
   Contents: Read and write, or any Contents access when even reading is
   refused; whether the account may write at all; single sign-on, with
   GitHub's authorize link; an organization's token policy; an IP allow
   list; when a rate limit lifts, and whether it's the token's or, without
   one, the network's; being offline; a ruleset, whose bypass list takes
   teams, roles and apps, never people). Failures a different
   token fixes offer one; GitHub's own answer and request id are under
   Details. While a save runs, the toolbar says which step it's on, with the
   seconds once it's slow (a screen reader hears each step, not the seconds).
5. **Deploy.** The push triggers the Pages workflow; the site usually updates
   within a minute (deploys queue, so longer if one is already running). The
   saved banner says so: "The site picks it up in about a minute."

⌘S while typing in a table or people cell commits the cell first, then saves.

## Tabs left open

A tab can stay open across a deploy of BoxOps itself, running old code
against data the new code wrote.

- **App updates.** Every `roadmap.json` the app fetches (on load, when
  polling, and just before a save) carries `app.build` and `app.time`. If
  the build differs from `__BOXOPS_BUILD__` and was made later than the
  page's `boxops-build-time` (one direction only, so a CDN briefly serving an
  older `roadmap.json` with newer JavaScript flags nothing, and nor does an
  unknown build), the tab goes read-only with the banner "BoxOps was updated
  — Reload to keep editing". The draft is kept in `localStorage` (a field
  being typed in is committed first). Old code never saves: a save dialog
  left open closes (once a save under way is done), and none of its buttons
  would write.
- **Reload** goes to `./?boxops-reload=<build>`, keeping the other parameters
  and the hash: a URL the browser has never cached, since Pages sends
  `index.html` with `max-age=600`. The app removes the parameter with
  `history.replaceState` once it starts.
- **Boot watchdog.** An inline script in `index.html` reloads once from such
  a URL if the app's script fails to load (a cached `index.html` naming
  files the latest deploy replaced) or the app hasn't started within 8 s
  (`main.tsx` calls `__boxopsBoot()`); if that fails too, the page says so
  instead of staying blank. The page shows "Loading…" until the app replaces
  it.
- **An upgrade still deploying.** The pre-save check refuses to write to a
  head in a newer data format (see Saving, step 3).

## The page

- **Theme.** A second inline script in `index.html` applies the stored theme
  (or the system's) before the first paint, so dark-mode visitors never see
  a light flash; `<meta name="color-scheme">` says `light dark`.
- **Content-Security-Policy.** The build adds a CSP meta tag (Pages can't send
  headers), straight after `<meta charset>` and before anything it governs:
  `default-src 'none'`; scripts and styles only from the site,
  plus the two inline scripts by their SHA-256 hashes (computed by
  `vite.config.ts` from the built page); `connect-src` the site,
  `api.github.com` and `raw.githubusercontent.com`; images from the site and
  `data:`; no base URL, forms or plugins. React's style props go through the
  CSSOM, which the policy doesn't govern. The dev server has no CSP.
- **App files.** The first paint loads one JavaScript file (about 350 kB,
  115 kB gzipped): React, the timeline and the loader. The rest is fetched
  on first use (`components/lazyPart.tsx`, `React.lazy`): Table and People
  when the pointer or focus reaches their tab (the view on screen stays until
  the new one is ready); the box, PTO and department editors and team
  settings a second after the roadmap shows, unless it's read-only; the
  settings menu's contents when the pointer reaches the gear; the save
  dialog, saving's code and the YAML parser once someone starts editing.
  File names change only with the app's code (the build time is in
  `index.html`), so a tab left open across roadmap saves can still fetch
  them. After an app deploy, a part that can't be fetched says so, with
  Reload, and so does a save.
- **Title.** `document.title` follows the team title in `settings.yaml`
  (plus the branch for a preview); `index.html` says "BoxOps" until then.
- **Errors.** An error boundary around the app shows a recovery screen with
  Reload instead of a blank page, saying unsaved changes are kept only when
  this tab's are. A second crash in a row (a stored draft can
  make every reload crash) also offers to download the unsaved changes as
  JSON and discard them: only this tab's draft of the roadmap on screen, since
  project sites on `<owner>.github.io` share one `localStorage`. A crash
  counts as the same one again within 5 minutes, unless the app ran for a few
  seconds in between.

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
  edit that breaks a rule shows a popup with the dates (only the user's own
  edits, not someone else's save merged in). Nothing is blocked.
- **Over capacity** is arithmetic, not geometry: a sweep over the boxes finds
  any day where the FTE running exceeds the department's lanes. Boxes that
  don't fit are drawn in an area under the lanes, which says over capacity
  only when that sweep finds an overload. A department heading and
  the warnings say the same (`overCapacity` in `model/report.ts`): the worst
  stretch from today on, against the lanes open on those days; past overloads
  are history. "Today" moves on at midnight in a tab left open.

## Tests and CI

- **Unit tests** (Vitest, `web/src/**/*.test.ts` and `web/cli/**/*.test.ts`)
  cover dates, loading and validation, the draft and rebasing, YAML writing,
  change descriptions, layout and capacity, the report, the GitHub client,
  reader and save logic against the browser tests' fake GitHub, and the
  roadmap readers, git SHAs and `roadmap.json` against real git repositories
  made in the temp folder.
- **Browser tests** (Playwright with WebKit, `web/e2e/`) run the production
  build. GitHub is faked by a stateful stand-in (`web/e2e/fake-github.ts`:
  commits with real git trees and blobs, GraphQL saves that check the
  expected head, a private mode, injected failures) and the roadmap is a
  fixed copy in `web/e2e/fixtures/roadmap/`. The save and polling tests run
  on a public and on a private repository, and every test checks the
  stand-in saw no call a correct app never makes. It makes each deploy's
  `roadmap.json` with the build's own code, so its blob and tree SHAs are
  real. The clock is pinned to 09:00 on 2026-10-03 in the browser's time
  zone, so tests never depend on live data, the date or the network. The
  browser runs in UTC (`timezoneId`; WebKit ignores `TZ`), and the specs about
  dates (timeline, table, PTO, saving) run again in America/Los_Angeles and
  Pacific/Kiritimati, where the day starts 7 hours after UTC's and 14 hours
  before it. Tests of unsaved drafts open a second tab in the same browser
  context (so the same `localStorage`), with a clock of its own. Any
  Content-Security-Policy violation fails a test.
- **Performance** (`npm run perf`, `web/e2e/perf.spec.ts`, its own Playwright
  config) serves the production build with a generated 2,000-box roadmap
  (`scripts/gen-roadmap.ts`; and a 500-box one) as its `roadmap.json`,
  gzipped, and opens it in WebKit without a token. It checks exactly that the
  main JavaScript file stays under 400 kB and that no file with the `yaml`
  library is fetched before the timeline shows, and prints the time from
  navigation to the timeline painted (median of 3), failing only above
  2,500 ms; the same roadmap without the build's parsing is timed for
  comparison. CI runs it after the browser tests.
- **Lint** (oxlint, `web/.oxlintrc.json`): oxlint's correctness rules plus
  the React hooks rules; any warning fails `npm run lint`. (typescript-eslint
  doesn't support TypeScript 7 yet.) A deliberate exception is a
  `// eslint-disable-next-line <rule> -- <reason>` comment, which oxlint
  honours; one that no longer hides anything is an error.
- **CI.** `CI` (`ci.yml`) runs lint, the type check, the unit tests (again
  with `TZ=America/Los_Angeles` and with `TZ=Pacific/Kiritimati`, UTC−8/−7
  and UTC+14, so nothing depends on the runner's time zone), validation, the
  build, the browser tests and the performance checks on every pull request
  and every push to a branch other than `main`, whatever it changes. A pull
  request from a branch of this repo is covered by that branch's push run, so
  only pull requests from forks run it again.
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

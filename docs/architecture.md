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
│ Save (⌘S) → pre-save check →     │ (API +    │   redeploys (~1 min)       │
│   commit to main                 │  token)   │                            │
└──────────────────────────────────┘           └────────────────────────────┘
```

## Code layout

```
web/
  src/
    App.tsx                 loading, polling, saving, toolbar, views
    a11y/                   announce (live regions), focus (putting focus
                            back, Tab inside editors), keys (shortcut labels,
                            letters in any keyboard layout), motion (smooth
                            scrolling unless less motion is asked for)
    site.ts                 the site's roadmap.json, app updates, reloading
    saving.ts               what saving needs, fetched once editing starts
    styles.css              imports styles/ in cascade order: tokens (colours,
                            shadows, stacking, fonts, both themes), base,
                            toolbar, timeline, table, editors, dialogs, print
    components/             Timeline, TableView, PeopleView, BoxEditor,
                            DepartmentEditor, EngineerPicker, SaveDialog,
                            TokenForm, TextCell, LoadScreen (load failures),
                            ErrorBoundary; useGridFocus (the timeline's
                            keyboard focus), followPointer (drags)
    model/                  data: dates, format (data format version), parse
                            and load (the validator: each file on its own,
                            then across files), draft, structure (departments
                            and lanes), relations (codes and rules), serialize,
                            summary (change descriptions), report
    timeline/               scale (time ↔ pixels), layout (lanes, capacity),
                            drag (moves in working days, where a dragged box
                            lands), keyboard (where the arrow keys go, names),
                            consequences (what a keyboard move would do),
                            rows (a department's rows and cells as data, and
                            what's near enough the screen to draw)
    table/                  the table's and People's rows: tableModel (rows
                            as data), rowKeys (React keys that stay with a
                            row), windowMath and useWindowedRows (drawing only
                            what's near the screen), KeepFocus and
                            useActiveRow (focus in rows that move),
                            TableRows and PeopleRows (the memoized rows),
                            PrintTable (every row, on paper)
    github/                 api (REST and GraphQL client, timeouts, errors),
                            read (newer commits by SHA diff), save (commit,
                            conflicts, retries), messages (errors in words),
                            git-objects (git blob and tree SHAs, base64)
  cli/                      Node-only: git.ts (reads a roadmap folder from git
                            objects or from disk), site.ts (builds roadmap.json),
                            csp.ts (the built page's Content-Security-Policy)
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
    from the Actions event; when unknown the site counts as private. The
    repo is `GITHUB_REPOSITORY` in Actions, else the origin remote's, and
    only on github.com, the one GitHub the app talks to: a build in Actions
    elsewhere (GitHub Enterprise Server, GHE.com) stops, and another
    remote's host leaves the repo empty;
  - `app`: version, build id and time. The build id is the version plus
    `web/`'s tree at HEAD, so roadmap-only saves keep it (`.dirty` with
    uncommitted app changes, `+unknown` outside a git checkout). Both are put
    in `index.html` (`<meta name="boxops-build">` and `"boxops-build-time"`),
    and the id is defined for the app as `__BOXOPS_BUILD__`; the app compares
    them with every `roadmap.json` it fetches (see [Tabs left
    open](#tabs-left-open)). The time, HEAD's committer date, is kept out of
    the JavaScript, so roadmap-only saves leave every app file as it was and
    a tab left open can still fetch the parts it loads on first use;
  - `schema` (1), `format` and `notices`;
  - `parsed` (optional): each roadmap file as the build's parser makes of it
    (`model/parse.ts`), by path (each without its path), stamped with the
    build id. The app takes them only from its own build, each as what the
    blob `blobs` gives its path parses to, so showing a deploy needs no YAML
    parsing; files from GitHub and bundles from another build are parsed in
    the browser. The dev server and `.dirty` or `+unknown` builds leave them
    out, as their app can change under one build id. They make the file
    about 1.7 times the size: at 2,000 boxes, 184 KB gzipped becomes 310 KB
    (370 KB when they were kept by blob SHA, whose 40 hex digits don't
    compress; such a `parsed`, from an earlier build, is left out).

  A local build whose `roadmap/` has uncommitted changes reads the files on
  disk instead: `tree` is null and the bundle is marked `local`. The dev server
  always reads files on disk (`$BOXOPS_ROADMAP`, else `../roadmap`) and marks
  its bundle `local`. The app shows a local bundle read-only, with a banner,
  and never calls GitHub or polls for it. `npm run validate` and
  `report` read files on disk under the same rules: symlinks are errors, never
  followed. A submodule, though, is just a folder on disk, so only a build
  from git objects stops on one. The app still opens a `roadmap.json` from before schema 1, treating
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
  copy too, with a notice saying why, until the tab moves on. A save they
  stop says so as well: the folder's problems, one per line, to fix on
  GitHub (Close only), or too many changes, with Reload rather than Try
  again.
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
  It only ever moves forward (`movesForward` in `site.ts`): a bundle whose
  `history` holds the commit on screen is taken; otherwise it's ignored if
  the tab has seen it, if the history on screen holds it (two commits can
  share a second), or if it's older by commit time, and taken in any other
  case (a newer commit beyond the 50-commit history, or a bundle from before
  schema 1 with no usable date). So a deploy that finishes late (deploys
  aren't cancelled, and the tab may have read a newer head from GitHub)
  never rolls the tab back. A newer commit is merged into the screen in
  place, and a notice says who saved what (none when nothing in the
  roadmap folder changed, as for an app commit: then only the commit on
  screen moves on, and undo history is kept). A failed check
  (offline, mid-deploy, a private site whose sign-in expired: the
  same-origin request is then redirected to github.com and fails, or no
  answer within 20 s) waits longer each time, 4, 8, then 15 minutes; two in
  a row show a calm notice, "Can't reach the site", saying the tab keeps
  trying and to reload if it goes on (a private site may want a new
  sign-in), until a check succeeds. Coming back online checks at once. A failed check
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
  sign-on, the organization's token policy), also Use a different token. A
  branch that differs from the deployed roadmap in more than 300 files says
  to check it out instead.
- **Data format.** `format` in `settings.yaml` must be the one this build reads
  (`model/format.ts`); a roadmap in any other format opens read-only, with a
  banner saying why.
- **Problems.** Loading is lenient: every problem is reported (with its
  line). A bad entry or value the app can't use is left out and its file is
  marked lossy, as is a file with a YAML alias, so the app won't write that
  file (the rules starred in [What the validator
  checks](data-format.md#what-the-validator-checks)); the rest, such as
  weekend dates, an unknown type, flag or engineer, or a code two files
  share, are only flagged. Problems are compared by a key without list
  positions or line numbers, so one that was already there never counts as
  new.
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
  refuses (full storage, or site data blocked) shows a warning once (in a
  read-only tab, with a download instead of "Save soon"), and the save menu,
  and any save dialog, says changes aren't being kept until a write goes
  through: the heartbeat tries again rather than marking the older copy
  alive.
- **Tabs that are gone.** A draft also carries a heartbeat: marked alive every
  minute while its tab is open, and closed when the tab closes (`pagehide`).
  A page that crashed never marked its draft closed, so a reload (navigation
  timing says which page is one) keeps the tab's id and finds the draft even
  though it looks alive. When a tab opens the roadmap, and on each heartbeat
  while it's in view, drafts left by tabs that are gone (closed, or not alive
  for 5 minutes: browsers slow down hidden tabs' timers) are offered, newest
  first: "Restore unsaved changes from another tab?" with Restore (its items
  over this tab's, one undo step; the one left behind is removed once this
  tab's draft, with them in, is written) or Discard. A draft marked closed is
  offered 5 seconds after its `storage` event (a reload of its tab marks it
  alive again sooner), not at the next heartbeat. Never taken silently, and
  never once its tab is back. The count of changes follows others' saves as
  they come in; one whose changes have all been saved since is no longer
  offered (and is removed when a tab next opens the roadmap). A tab that was
  only asleep keeps its changes: when it wakes it writes its draft again, and
  whichever tab saves first makes the other's the same as the saved roadmap.
  The single key every tab shared before 0.1.0 moves over once, and is
  offered like one left by a tab that's gone (a tab still running the older
  BoxOps may have it open), with no time: it never said when it was written.
- **Restored changes are listed before they're saved.** Changes this page
  view didn't make, restored from storage (this tab's draft after a reload,
  or a gone tab's through Restore), are listed on the first save, ⌘S
  included: every project site on `<owner>.github.io` shares one origin, so
  another site's script could have written them. Back to editing saves
  nothing; Save (with the count) saves them, and later saves go straight
  through. Edits, undo and others' saves don't end it; only that choice does.
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
   was left out, so the user is asked to fix the file first. Deleting a box
   or department is blocked the same way while a skipped copy of its file
   (`x.yml` beside `x.yaml`) would load in its place. Changes restored from
   storage are then listed for the user to confirm, once (see above).
2. **Token.** The first save asks for a token. The form links to GitHub's
   new-token page filled in for this repository (`target_name` = its owner,
   Contents: write) and lists what to check there: Resource owner shows the
   owner, Only select repositories → this one, Contents: Read and write, the
   org's approval if it requires one, and an expiration within the org's
   maximum token lifetime if it sets one. A classic token (or one from the
   GitHub CLI) is accepted, with a note that a fine-grained one is safer;
   outside collaborators need one. Spaces, invisible characters and quotes
   pasted with a token are dropped, and text that can't be a token (letters,
   digits and underscores) isn't taken. The token is kept as soon as it's
   submitted, in `sessionStorage` under `boxops-github-token:<owner>/<repo>`
   (the old tab-wide key moves over once) and in memory, and it's forgotten
   only on a 401 or Forget token (in the gear menu whenever one is kept,
   read-only tabs too, such as a private branch's preview, which asks for
   one), so Try again and the automatic re-save after a clash never ask
   again. A kept token holding a character no HTTP
   header can carry (a curly quote, say), which the browser won't send,
   counts as a 401, never as being offline. A choice already made (keep mine
   or keep theirs) is carried through the token form. The key names the
   repository because every project site on `<owner>.github.io` shares one
   origin; scripts of those other sites, opened in the same tab, could read
   it, which private Pages (a subdomain of its own) or a custom domain avoid.
   It's sent only to GitHub.
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
   A save with that choice made isn't stopped for newer saves, unless they
   would leave its changes invalid (a lane gone that a box of ours moved
   into): then they come in for review the same way, with the box moved
   where the lane's other boxes went and flagged.
4. **Commit.** The changed files are written with the `yaml` Document API, so
   only the edited lines change and comments survive: only fields that differ
   from what was loaded are touched, list entries (lanes, people, PTO, rules,
   and plain values like tags and engineers) are matched up one by one, and a
   file keeps its BOM and line endings. Each department and box goes to the
   file it was loaded from. The save is one GraphQL `createCommitOnBranch`
   call (`github/save.ts`): GitHub makes the commit and moves `main` in one
   step, only if `main` is still at the head the save was checked against. The
   commit is authored by the token's owner and committed by GitHub, which
   signs it "if supported", in GitHub's words; whether that satisfies a
   *Require signed commits* rule with a fine-grained token is still to be
   checked live. The app can't choose either name: the committer is GitHub,
   and the author's email follows the user's email-privacy setting (their
   `noreply` address when it's private). A ruleset that restricts author or
   committer emails, or the commit message, by pattern rejects saves unless it
   allows these. Only files whose blob SHA differs from the head's are sent,
   and an empty change never is. CI skip markers such as `[skip ci]` in titles
   are neutralised, so every save deploys. If someone saved in between, GitHub
   refuses (`STALE_DATA`): the app re-reads only what changed, checks clashes
   and validates again, then retries on top of their commit, at most twice
   (their changes then come in with the usual notice, outlined in teal). A
   same-file clash at that point shows the keep-mine / keep-theirs choice,
   and changes of theirs that leave ours invalid come in for review; a
   re-read that fails (too many changes, the folder's problems, a rate limit)
   stops the save with its own reason. After a failure that leaves unclear
   whether the commit was made (a timeout, a dropped connection, a 5xx, an
   error in a field of the commit GitHub sends back), the app reads the head
   again: if every changed file there is ours, the save landed and is reported
   as saved; otherwise retrying is safe, since each attempt names the head it
   goes on. Every call has a timeout that also covers reading the answer (15 s
   for reads, 20 s for a file's contents, 30 s for the save). There's no
   permission check first: GitHub's refusals are sorted into kinds
   (`github/api.ts`, for REST and GraphQL alike: what the error says first, a
   spent hourly allowance last) and worded in `github/messages.ts`; the save
   dialog is titled for the kind and says what to do (the token's resource
   owner, repository and approval; Contents: Read and write, or any Contents
   access when even reading is refused; whether the account may write at all;
   single sign-on, with GitHub's authorize link; an organization's token
   policy; an IP allow list; when a rate limit lifts, and whether it's the
   token's or, without one, the network's; being offline; a ruleset, whose
   bypass list takes teams, roles and apps, never people). Failures a
   different token fixes offer one, unless the account itself lacks Write
   access (then it's titled for the account, and Close comes first); GitHub's
   own answer and request id are under Details. While a save runs, the toolbar says which step it's on, with
   the seconds once it's slow (a screen reader hears each step, not the
   seconds).
5. **Deploy.** The push triggers the Pages workflow; the site usually updates
   within a minute (deploys queue, so longer if one is already running). The
   saved banner says so: "The site picks it up in about a minute."

⌘S while typing in a table or people cell commits the cell first, then saves.
In a read-only tab ⌘S saves nothing, and never opens the browser's Save Page
dialog; in one gone read-only for a newer BoxOps it moves to the banner's
Reload.

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
  would write. If this browser isn't keeping the draft (storage full or
  blocked), the banner says so and offers it as a download (JSON, as the
  crash screen does), and every Reload in the app asks before losing it.
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
  head in a newer data format (see Saving, step 3), and a tab that reads such
  a head says BoxOps is probably being upgraded. Unsaved changes in the old
  format come back after the reload only as a download, as the upgrade
  dialog and banners say, each with Download unsaved changes.

## The page

- **Theme.** A second inline script in `index.html` applies the stored theme
  (or the system's) before the first paint, so dark-mode visitors never see
  a light flash; `<meta name="color-scheme">` says `light dark`. The dark
  theme is for screens: printing is always in the light one, on white.
- **Content-Security-Policy.** The build adds a CSP meta tag (Pages can't send
  headers), straight after `<meta charset>` and before anything it governs:
  `default-src 'none'`; scripts and styles only from the site,
  plus the two inline scripts by their SHA-256 hashes (computed by
  `cli/csp.ts` from the built page, over the text as a browser hashes it,
  CRLF line ends read as LF); `connect-src` the site,
  `api.github.com` and `raw.githubusercontent.com`; images from the site and
  `data:`; no base URL, forms or plugins. React's style props go through the
  CSSOM, which the policy doesn't govern. The dev server has no CSP.
- **App files.** The first paint loads one JavaScript file (about 350 kB,
  115 kB gzipped): React, the timeline and the loader. The rest is fetched
  on first use (`components/lazyPart.tsx`, `React.lazy`): Table and People
  when the pointer or focus reaches their tab (the view on screen stays until
  the new one is ready, its tab marked busy); the box, PTO and department
  editors and team settings a second after the roadmap shows, unless it's
  read-only; the settings menu's contents when the pointer reaches the gear;
  the save dialog, saving's code and the YAML parser once someone starts
  editing.
  File names change only with the app's code (the build time is in
  `index.html`), so a tab left open across roadmap saves can still fetch
  them. A part that can't be fetched (the connection dropped, or an app
  deploy replaced its file) says so, with Try again and Reload, and so does
  a save. The app keeps no failure, but WebKit and Chromium keep a module
  file that failed to load until the page reloads, so a second failure
  offers Reload only.
- **Screens.** The app is as tall as the window as it is (`100dvh`: a
  phone's browser bars shown or not). Short of room, the toolbar's title
  gives way first, cut short with … (whole in its tooltip), so Save and the
  gear stay on screen; below 1220 px the zoom takes a row of its own, and
  below 720 px (a phone, or a window zoomed to 400%) each part of the
  toolbar has a row and wraps. The box and PTO editors are as wide as the
  window when it's narrower than they are, and menus are moved and cut
  short to stay inside it (WCAG 1.4.10; the timeline and the tables are
  two-dimensional, and scroll both ways). Only they scroll, never the page
  around them (the tables' scroller is positioned, so what's hidden in its
  cells for screen readers is placed inside it).
- **Title.** `document.title` follows the team title in `settings.yaml`
  (plus the branch for a preview); `index.html` says "BoxOps" until then.
- **Errors.** An error boundary around the app shows a recovery screen with
  Reload instead of a blank page, saying unsaved changes are kept only when
  this tab's are (an older copy, if storage refused the latest edits). A
  second crash in a row (a stored draft can make every reload crash) also
  offers to download the unsaved changes as JSON and discard them: only
  this tab's draft of the roadmap on screen, since project sites on
  `<owner>.github.io` share one `localStorage`. A crash
  counts as the same one again within 5 minutes, unless the app ran for a few
  seconds in between.

## Accessibility

The aim is WCAG 2.2 AA. Safari (WebKit) sets the terms: it doesn't focus a
button that's clicked, its Tab skips buttons and links unless "Press Tab to
highlight each item" is on (which a page can't tell), and it fires no `blur`
when a focused element is removed.

- **Structure.** The toolbar is the `<header>` (banner) with the roadmap's
  title as `h1`. "Skip to roadmap", the first Tab stop, focuses `<main>`,
  which holds the banners and the view and is named by a visually hidden
  `h2` saying which view it is. Each department's name is an `h3` (its
  toggle inside) on the timeline, in the table and in People; the box
  editor's sections are `h3`s too. `<main>` takes a tabindex only while it
  has focus: with one for good, a click anywhere in it would focus it.
- **Announcements** (`a11y/announce.tsx`). A polite and an assertive live
  region are on the page from the first paint (`main.tsx`); `announce()`
  empties the region, then writes the message 150 ms later, so the same
  message twice is read twice, and messages asked for together are read
  together. VoiceOver reads no live region outside a modal dialog, so each
  dialog and editor has a pair of its own, and a message goes to the
  innermost one open when it's written. Announced: each step of a save and
  where it went (the saved banner), others' saves coming in, an app update
  and the tab going read-only, other banners that appear once the roadmap
  is up, search results in the table (boxes, and PTO when only PTO
  matches) and People once typing pauses, a rule
  an edit breaks and a rising warning count, deletions (with how to undo
  them), undo and redo, an engineer added from the Engineers list, a
  department or lane moved in the department editor (its new place), and
  field problems (a pasted token that isn't one, too) and date corrections
  as they appear (each correction, the same one twice too; not a problem
  already there when its field shows, nor one put right before it's
  read). Nothing
  uses `role="status"` or `role="alert"` on an element added already
  filled, but the crash and load-problem screens, which take focus.
- **Focus** is never left on `<body>`, nor on something hidden (Firefox
  leaves it on a part React hides while what replaces it loads, until the
  part goes). Each dialog and editor notes what had focus when it opened;
  when it goes, if focus was in it (or lost), it goes back there, or to
  the nearest thing still on the page: the box or PTO block, the
  department's ✎, the gear (for what its menu opened), the Save button,
  else the roadmap (`useReturnFocus` in `a11y/focus.ts`); an editor whose
  box or PTO block went too (someone else's save deleted it, or an undo)
  hands it to the one beside it, as its Delete button does. On the
  timeline, focus a re-render took (a box moved to another row, a
  department moved, undo) goes back to the same cell, else the one beside
  it; a cell moved along its row (dropped past another) React focuses
  again itself. A banner (a part that couldn't load, too, after Try
  again) or the broken-rule popup going with focus in it hands focus to
  the roadmap (focus elsewhere stays put; the popup doesn't go by itself
  while focus is in it). A deleted box or PTO block hands focus to its
  neighbour (a PTO block's too when its owner's next one takes its place
  on the page), a deleted table row to the next
  row's Delete (and focus a change takes from a table row that moves goes
  back to it: see [The table and People](#the-table-and-people)), a
  removed rule or lane to the next one's ✕ (else the one before's, else
  Add), a cleared lane date to its +, the table's Clear dates to From; the
  department editor's Move buttons and lane arrows keep it (never
  disabled: at the end they say so), and Delete department… or a lane's
  ✕ with boxes puts it in its question (the question its description),
  whose Cancel gives it back; a save gives it back where it was (a table
  row's button it disabled or took away too), or to the saved banner;
  Enter and Esc in a table cell and a
  lane renamed in place keep it there, and a date field's calendar gives it
  back to what opened it (its button, or the field).
  Save stays focusable while saving, and Undo and Redo with nothing left
  to undo or redo (`aria-disabled`, not `disabled`); discarding all
  changes puts focus on Undo, as does an undo or redo that takes Save (or
  Warnings) away from under focus.
- **Dialogs** are named by their titles (the save dialog is also described
  by what went wrong) and start on what's safe to press next, their first
  field, or themselves, never the Close button. The native ones
  (`showModal()`) make the rest of the page inert. The box and PTO editors
  are `aria-modal` and keep Tab, Shift+Tab and Alt+Tab going round their own
  controls, buttons included; a click outside still closes them. Menus
  opened from the keyboard start on their first control, and Esc puts focus
  back on their button; focus leaving a menu (Tab) closes it, and Esc with
  focus elsewhere (in an editor) closes it and goes on to that. The
  Engineers list is a small dialog of checkboxes
  (↑ and ↓ move between them) whose button is named by who's assigned;
  like the calendar, it's fixed on the screen below its button (above it
  without room there), so the box editor's scrolling fields and the table
  don't cut it off. Both move with what opened them as the editor's fields
  or the table scroll (Chrome, Edge and Firefox focus a clicked button,
  and the table scrolls it clear of its header and title column as it
  opens), and close once that's scrolled out of sight. A resize closes
  them, but not the Engineers list while a new name is typed (a phone's
  keyboard opening shrinks the window): it moves with its button.
- **Date fields** (`components/DateInput.tsx`) are YYYY-MM-DD text. Text
  that more typing can't make a date says why just under the field (over
  what's below, so nothing moves when focus leaves and the field goes back
  to its date); deleting an `optional` date's text clears it. The calendar
  is the APG date-picker dialog, opened by **Choose date** (described by
  the field's label and its date; a Tab stop as buttons are, so in Safari
  as its Tab setting says outside the box and PTO editors, and never in
  table rows) or Option/Alt+↓ in the field, which drops half a date typed
  there, quietly. It's named "Choose date", `aria-modal`, its grid a
  `<table role="grid">` labelled by the month heading (a live region) with
  one Tab stop, the day the keys move (`calendarMove` in
  `model/dates.ts`), which follows focus put on a day another way
  (VoiceOver's cursor). Weekends are shown but `aria-disabled` and
  skipped, as they can't be picked; a day's name is its date and weekday,
  with "today" and "selected" where they apply. Tab goes round its
  controls, Today and Clear too; Esc closes it and nothing else (it's
  `preventDefault`ed, so a native dialog around it isn't cancelled); focus
  has the ring when a key put it there. A press outside closes it, and
  focus the press put nowhere goes back to what opened it; a field made
  read-only closes it.
- **Keys.** ⌘ and Ctrl both work everywhere; labels say ⌘ on Apple's
  platforms and Ctrl elsewhere (`a11y/keys.ts`). A letter is matched by
  `key`, or by its place (`code`) when the layout doesn't type Latin
  letters. No shortcut takes Alt: Windows reports AltGr as Ctrl+Alt, and
  AltGr+S types Polish ś, not a save. Undo, redo and ⌘S never act behind
  the save dialog, the key or the shortcuts list, nor with a menu open
  (with focus in it, on its button or nowhere); in the editors they do, as
  the editing happens there. In a text field ⌘Z is the field's own (a
  select, checkbox or switch has none: there it's the app's), but in a
  table cell left with Enter or Esc, until
  something's typed, it's the app's (`data-settled`), as it was once focus
  had left. Delete and Backspace delete only the box or PTO block that has
  focus on the timeline, once however long they're held, and nothing from
  anywhere else (a stray Backspace in an editor used to delete what it
  edited); the editors' Delete button deletes too. Outside a text field,
  Backspace is never the browser's Back. N and ? are the only single-letter
  keys, and only on the timeline (WCAG 2.1.4).
- **The timeline** is an APG layout grid (`components/useGridFocus.ts`,
  `timeline/keyboard.ts`): rows are a department's heading, each lane, its
  extra area and its PTO, each with a short name of its own ("Data
  Engineering / FTE 2"); a row's cells are its controls (the lane's name,
  whose row header also says its dates and size, and its **+**) and then
  its boxes or PTO blocks in time order. The whole grid is one Tab stop,
  the cell that last had focus (React renders every cell with tabindex −1;
  the active one's is set on the DOM, so moving focus renders nothing). The
  arrow keys go between cells, up and down to the cell nearest in time to
  the day being looked at; Home, End, Page Up and Page Down jump. A box's
  name says its title, code, dates, FTE, engineers, flag, broken rules and
  clashes; the focused box's lane, scale and progress are its description,
  one hidden element written before focus moves. The timeline scrolls a
  focused cell clear of the sticky header and label column, and of the
  broken-rule popup (which leaves room to scroll for that), as WCAG 2.4.11
  asks. On a big roadmap, which draws only what's near the screen (see
  [Timeline layout](#timeline-layout)), the keys go by the grid's rows and
  cells as data (`timeline/rows.ts`), drawn or not, and the cell focus goes
  to is drawn first; the grid's `aria-rowcount` counts every row and each
  row drawn says which it is (`aria-rowindex`). A screen reader's browse
  mode, and the browser's Find, reach only what's drawn. Enter, a click or
  a screen reader's press opens a box or PTO block; Delete deletes it,
  focus going to the cell beside it (or, alone in its row, the nearest in
  the row above: never out of its department).
  Space picks one up: the arrow keys then move what's drawn, as a pointer
  drag does (nothing laid out again, nothing else moving), and Enter or
  Space drops it as one change; Escape or ⌘Z puts it back; Tab, a click,
  ⌘S (which saves it dropped), another view or going read-only drop it;
  any other key (⌘← and ⌘→, Back and Forward in Chrome and Firefox on
  a Mac, Home, Delete…) does nothing then but say Enter drops it.
  Each step is said, with what it would change (`timeline/consequences.ts`:
  a department over capacity or back within it, a rule broken or kept, an
  engineer on PTO then), only the last of a key held down; others' saves
  wait meanwhile, and Alt+← and Alt+→ are never the browser's Back and
  Forward, on any cell (on a box not picked up, they say to pick it up
  first). While the timeline is read-only (a preview, or saving), its cells
  stay, as text or `aria-disabled` buttons, and keys that would change
  something say why they don't. The dates along the top, grid lines,
  hatching and drag labels are hidden from screen readers. The popup is
  drawn under the editors, menus and dialogs, so it never hides what has
  focus in them either. A box's scale card shows on hover and while the
  box has keyboard focus; the pointer can move onto it and Escape puts it
  away (WCAG 1.4.13). It covers the lane (or table rows) below, so it lets
  the pointer through, and where the pointer is is watched instead: a
  press or the wheel over it reaches what's under it, and puts it away. Pressing a box or PTO block (to drag it, say)
  focuses it without the keyboard's ring or the card, and so does putting
  focus back on it after a drop: browsers draw a ring whenever a script
  moves focus, so it's told by whether a key or a press came last
  (`focusByPress`). An editor closed with a click on ✕, or its box or
  block deleted with one, gives focus back the same way, scrolling
  nothing (`BY_CLICK`, `markPressed`): the view stays where the pointer
  left it. From the keyboard (Esc, or Enter on ✕ or Delete) the cell
  focus goes to is scrolled into view. Focus from a press shows a thin
  edge all the same, as Delete, Space and N act on it.
- **Contrast.** Text meets 4.5:1, and 3:1 what shows a control or its
  state (a field's edge, a switch, the chosen segment, a box's progress
  mark and resize grips, a collapsed department's boxes) or is all there
  is to see of something (a collapsed department's capacity line or bars),
  in both themes. A box's text sits on a light tint of its type's colour
  (a dark one in the dark theme), so one text colour per theme reads on
  any colour a team picks; what's drawn in the type's colour (the progress
  mark, the grips, the collapsed boxes) or the department's (the capacity
  chart, solid) is mixed half-way to the text's, which is 3:1 whatever the
  colour. `src/styles/contrast.test.ts` reads the colours from the
  stylesheet itself (`tokens.css` and the rules that mix them) and checks
  each pair, and what's drawn in a type's or a department's colour against
  an even sweep of every colour; axe checks the pages too
  (`e2e/a11y.spec.ts`).
- **High contrast and motion.** In Windows' contrast themes (forced
  colours) the browser paints with the theme's few colours and drops
  shadows and background images, so each part of the stylesheet draws in
  system colours what only they showed: the chosen option of a segmented
  control, a switch's state, a box's progress mark, the Today line and
  flag, the picked day, the selected box, a team's colours (shown as they
  are), the changed-by-someone-else dot and a lane's closed dates. Only
  Chromium can emulate this, so `e2e/styles.spec.ts` checks it there. With
  less motion asked for (`prefers-reduced-motion`), transitions take no
  time (`--motion`) and Today, going to a box and going to PTO jump rather
  than scroll smoothly (`a11y/motion.ts`).
- **Not colour alone.** The table marks rows someone else changed, and
  clashes, with a mark and words for screen readers as well as their tint;
  a cell, team-settings name or editor field that won't do says why next to
  it, tied to the field with `aria-describedby`.
- **Small targets, by design.** A box's resize handles (7 px) and the
  compact boxes of a collapsed department are smaller than WCAG 2.5.8's
  24 px: their size is the information (time and FTE), and the editor's
  date fields, the keyboard move and expanding the department do the same
  with full-size targets. The **+** buttons are 24 px; they show on hover
  and focus, and always on a touch screen, which has no hover to find them
  (so do the ✎ pencils, a table row's Delete, a table date's calendar
  button and a department's grip). Every other control is 24 px or has
  room round it, as 2.5.8 allows (`e2e/styles.spec.ts` checks each view,
  editor, dialog and menu).
- **Not yet checked by a person.** What a test can't hear needs a person
  with VoiceOver and Safari, NVDA with Firefox or Chrome, and JAWS with
  Edge: how the timeline grid's rows and cells are spoken (a box is
  "expanded" while its editor is open), a move's announcements (↑ ↓ say
  "Busy then" from the layout as it is; once dropped, the box may be drawn
  in other free space than that suggests), the calendar's days (whether
  "today" and "selected" are said twice, by name and state, and that keys
  go on from a day VoiceOver's cursor moved to) and its month heading as
  it changes, Alt+← and Alt+→ on Windows, and
  ⌘← and ⌘→ (Home and End on the grid) never going Back or Forward in a Mac
  browser with history, and a big roadmap's timeline (over 300 boxes and PTO
  blocks): that the row count and each row's place are said, and what
  browse mode makes of the departments it doesn't draw; the same for a big
  table and People (over 200 rows), the note in a row being edited that no
  longer matches the search, and People's "+N more" PTO. Printing from a
  real print dialog (the tests emulate print media). Windows' contrast themes
  themselves, in Edge, Chrome and Firefox (the tests emulate them in
  Chromium), descriptions and notes among them (the field shows its own
  two lines there, without the …). And a finger dragging a box on a real
  touch screen (iPad Safari, Android Chrome): the tests send touches to
  Chromium alone; and there, the Engineers list staying open, by its
  button, as the keyboard comes up for a new name (the tests shrink the
  window instead).

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
- **Dragging** (`timeline/drag.ts`, `components/followPointer.ts`). Only the
  pointer that pressed moves a box, PTO block or department heading; once
  dragging it's captured by the scroller it's in (a touch or pen press,
  which the browser captured to what it pressed, moves over: that isn't
  the drag lost), and a release the page never hears (no button held, the
  window left) cancels the drag, as Escape does, which cancels nothing
  else. The click a release makes after a drag, or after a cancelled one,
  does nothing. A box's lane is the one under its top, and
  changes only once it's dragged half a slot up or down: a sideways drag
  keeps it, whichever part of a tall box was held. The layout stays as it
  was until the drop (nothing moves under the pointer, no department
  changes height); the box is drawn where it's going, inside its
  department. Near the timeline's edges a drag scrolls it, and scrolling
  mid-drag carries the box along. An edge scrolls only once the pointer has
  been clear of it during the drag, or has gone on towards it: a box
  pressed just under the header or beside the labels and dragged along
  that edge, or away from it, doesn't scroll (and so keeps its lane).
- **Drawing** (`components/Timeline.tsx`). Each department is drawn by a
  memoized component given only what's its own (its boxes, layout, PTO and
  what's selected or moving in it, as the same arrays and objects while
  nothing in them changes), and each box by another: a drag's step, a
  keyboard move's, or a keystroke in the box editor draws again just the
  departments it's in, and in them just the boxes that changed. A drag draws
  again only when where it would land changes, not at every pixel (so does a
  department heading's drop line). A roadmap with more than 300 boxes and
  PTO blocks draws only what's near the screen (`timeline/rows.ts`): the
  departments within half a screen or more of it, as blank space as tall as
  they'd be otherwise, and in those the boxes and PTO blocks running within
  half a screen of the days on screen, measured as the timeline scrolls or
  changes size, in steps of half a screen, and drawn before the frame is
  painted. What has focus, what's open in an editor, what's being dragged or
  moved and a cell the app asks for (to focus it, as a closing editor does its
  box or PTO block, or to scroll to it; until the timeline next scrolls) are
  drawn wherever they are. At 2,000 boxes the timeline first shows about 70
  of them.
- **Over capacity** is arithmetic, not geometry: a sweep over the boxes finds
  any day where the FTE running exceeds the department's lanes. Boxes that
  don't fit are drawn in an area under the lanes, which says over capacity
  only when that sweep finds an overload. A department heading and
  the warnings say the same (`overCapacity` in `model/report.ts`): the worst
  stretch from today on, against the lanes open on those days; past overloads
  are history. "Today" moves on at midnight in a tab left open.

## The table and People

- **Rows** (`table/TableRows.tsx`, `table/PeopleRows.tsx`) are memoized
  components given only what's their own (the box or person, its lane, its
  warnings as text, flags) and one object of functions that never changes, so
  an edit draws again only the rows it changed. The rows are worked out as
  data first (`table/tableModel.ts`): each department's heading, then its
  boxes (or that it has none), PTO and Add PTO; in People, its engineers. A
  search looks in text worked out once a box or person: in the table, the
  text of every column but the numbers (a box's type and flag names, its
  dates and epic link too; PTO's engineer, note and dates); in People, every
  column's, with PTO's dates and notes. Hide finished boxes
  hides finished PTO in the table too, but not PTO added in this session,
  in any view (a week off added on a weekend has already ended): the app
  keeps track of it through edits, a new engineer, undo and saves, and
  while another view is shown (`table/addedPto.ts`).
- **Keys** (`table/rowKeys.ts`). A box's row is keyed by its code, which
  never changes (an unsaved box's id follows its title); a PTO entry's by the
  entry, through edits, a move up its owner's list or to someone else, and
  undo; an engineer's by a key that follows renames of an unsaved person's
  id but is never given to two rows at once.
- **Drawing only what's near the screen** (`table/useWindowedRows.ts`,
  `table/windowMath.ts`). Over 200 rows (headings, boxes, PTO, engineers),
  only the rows within 400 px of the screen are drawn, worked out in steps of
  200 px as the table scrolls and drawn before the frame is painted; the
  rest are spacer rows (hidden from screen readers) as tall as the rows they
  stand for, one `<tbody>` per department as before, so the sticky header
  and title column and dragging departments work as ever. A row is measured
  as it's drawn (a ResizeObserver); one not drawn is as tall as the rows of
  its kind drawn now. Rows of a kind are one height: descriptions and notes
  show two lines until focused (sized by CSS, a copy of the text in the same
  grid cell: no script measures them; left by a press, as when another
  row's button is clicked, a cell stays as it was until the press is over,
  or the rows below would move under the pointer and its click land
  elsewhere, and a calendar or the Engineers list that click opened moves
  with its button as the row then moves up), and People shows at most two PTO
  entries before "+N more" (pressed, it stays open for that row, scrolled
  away and back: People keeps it by the row's key). Safari has no CSS
  scroll anchoring, so the table keeps the row at the top of the view in
  place itself when rows above it change (measured, added, removed), in
  every browser (`overflow-anchor: none`), unless the change itself
  scrolled the table (a calendar or the Engineers list open in it moves
  with its button). A new sort isn't kept in
  place that way: the table stays scrolled as far as it was, showing what's
  sorted there now, in every browser. A new search or new dates show their
  rows from the top, drawn whole or not (on a big table the search stands
  in for the browser's Find, so its first match is never out of sight
  above the view); Hide finished, like someone else's save, keeps the row
  at the top in place (or the first after it that's still shown). The
  table counts every row (`aria-rowcount`) and each row drawn says which
  it is (`aria-rowindex`).
  Drawn whole, a table costs about 1 ms a row to open in WebKit on an M1
  (250 ms at 250 rows); drawing only what's near the screen, about 50 ms at
  any size: at 2,000 boxes, 26 rows with data.
- **Long selects** (`components/LazySelect.tsx`). A select with more than 30
  options (the Lane, with every lane of every department; a PTO row's
  Engineer; People's Department) holds only its chosen option until a
  press, focus or a key reaches it, which fill it before its list opens.
  The Engineers list sorts the roster only while it's open.
- **Focus.** The row focus is in (or a press is in: Safari doesn't focus a
  button that's clicked) is drawn wherever it is, with a row either side, so
  Tab and Shift+Tab always have somewhere to go (`table/useActiveRow.ts`).
  While it has focus, it keeps its place and stays shown though an edit
  would sort it elsewhere or the search or dates leave it out (a note in it
  says so, and is announced once); a new sort, search or filter puts it
  where it goes, and so does focus leaving it, once a press has finished (a
  row moving as a press began would leave another under the pointer). Focus
  on the header's sort buttons has left it. The window losing focus (⌘Tab,
  the address bar) hasn't: its blur goes nowhere, as one to the page's
  background does, so where focus is is looked at once the blur is over; and
  the window getting focus back doesn't scroll the table. A change that
  moves a focused row (to another department, re-sorted) or deletes it loses
  focus without a blur in WebKit and Firefox, so `table/KeepFocus.tsx` sees
  where focus was just before each change and, if it's lost, puts it back on
  the same control in the same row, else the same column in the next row of
  the department (or the one before, or its heading); put elsewhere in its
  row for want of the control itself (one a save disables, or a row's
  Delete, gone while saving), it goes back once that's back. What has
  focus in a row is scrolled clear of the sticky header and title column
  (People's names, which stay put the same way), and of the broken-rule
  popup (the table leaves room to scroll for that), by hand
  (`table/focusRow.ts`: WebKit doesn't when Tab moves focus); the header's
  own sort buttons are always on screen, and the scroller has no
  `scroll-padding`, which would have them scroll the table whenever one is
  focused or clicked. Add box, Add PTO and Add engineer clear the search
  (and dates), open the department, and scroll to the new row, which takes
  focus.
- **Printing** (`table/PrintTable.tsx`, `table/usePrinting.ts`). On paper the
  table and People are a plain table of every row as shown (search, dates,
  sort, collapsed departments), drawn as printing starts, its dates never
  broken across lines (at a hyphen, in a narrow column); the interactive
  one is clipped away to a pixel, so focus stays where it was, as a block
  rather than a table (a table keeps its size whatever it's given, and the
  pages would be shrunk to its width, with blank ones after the rows).
  Everywhere, the toolbar's controls, banners and the table's own toolbar
  are left out and colours print, in the light theme on white (the dark
  theme's colours apply on screen only); the timeline prints what's on
  screen. A view that loaded just as printing began (`usePrinting` reads
  the print media query once it's listening) prints its rows too.
- **Limits.** On a big roadmap the browser's Find and a screen reader's
  browse mode reach only the rows drawn; the table's search covers every row
  and every column's text but the numbers.
  In Safari, whose Tab skips buttons, Tab from the toolbar goes to the
  first field drawn, which can be in a row drawn just above the view, so
  the table scrolls up a little to it.

## Tests and CI

- **Unit tests** (Vitest, `web/src/**/*.test.ts` and `web/cli/**/*.test.ts`)
  cover dates, loading and validation, the draft and rebasing, YAML writing,
  change descriptions, layout and capacity, the report, the GitHub client,
  reader and save logic against the browser tests' fake GitHub, and the
  roadmap readers, git SHAs and `roadmap.json` against real git repositories
  made in the temp folder. Those that read a whole roadmap read fixed copies
  (the browser tests' fixture, and `roadmap/` as shipped, in
  `web/src/model/fixtures/shipped-roadmap/`), never the live `roadmap/`,
  which saves may write any valid way.
- **Browser tests** (Playwright, `web/e2e/`) run the production build in
  WebKit, Safari's engine, and all of them again in Chromium (Chrome, Edge)
  and Firefox. GitHub is faked by a stateful stand-in
  (`web/e2e/fake-github.ts`: commits with real git trees and blobs, GraphQL
  saves that check the expected head, a private mode, injected failures) and
  the roadmap is a fixed copy in `web/e2e/fixtures/roadmap/`. The save and
  polling tests run on a public and on a private repository, and every test
  checks the stand-in saw no call a correct app never makes. It makes each
  deploy's `roadmap.json` with the build's own code, so its blob and tree
  SHAs are real. The clock is pinned to 09:00 on 2026-10-03 in the browser's
  time zone, so tests never depend on live data, the date or the network.
  Two draft tests keep the browser's own clock, since Playwright's fake one
  hides the navigation timing that tells a reload from a page opened anew
  (and nothing they check depends on the date).
  The browser runs in UTC (`timezoneId`; WebKit ignores `TZ`), and in WebKit
  the specs about dates (timeline, table, PTO, saving) run again in
  America/Los_Angeles and Pacific/Kiritimati, where the day starts 7 hours
  after UTC's and 14 hours before it. Tests of unsaved drafts open a second
  tab in the same browser context (so the same `localStorage`), with a clock
  of its own. An uncaught error or a Content-Security-Policy violation in
  any tab a test opens fails it. `e2e/a11y.spec.ts` runs axe-core
  (`@axe-core/playwright`, a test-only dependency) over each view, the
  editors, the menus and the save dialog against WCAG 2.2 A and AA, in the
  light and the dark theme, and checks the page's structure, names and
  what's announced (an init script records every message the live regions
  are given); `e2e/styles.spec.ts` checks the stylesheet from computed
  styles and layout rather than screenshots (fields and lists styled as
  their own class says, not as a broader rule would; Windows' contrast
  themes, emulated in Chromium; less motion; a long title at 1280 px,
  everything at 320 px, and the page itself never scrolling, in any view;
  touch screens; target sizes), and the unit test
  `src/styles/contrast.test.ts` every colour pair; `e2e/keyboard.spec.ts`
  checks where focus goes and what keys do, `e2e/timeline-keys.spec.ts`
  and `e2e/move.spec.ts` the timeline's keyboard grid and moves, and
  `e2e/drag.spec.ts` dragging. The timeline's specs (those three,
  `timeline`, `departments` and `pto`) run again in WebKit with the
  timeline drawing only what's near the screen whatever the roadmap's size
  (`cull`, a test option), skipping only the checks that count every box;
  `e2e/timeline-big.spec.ts` checks a 600-box roadmap against itself drawn
  whole: nothing on screen missing at any scroll or zoom, focus and moves
  kept drawn, what the app focuses or shows (from the warnings, from
  People, after an editor's Delete) drawn, the grid's rows counted. The
  table's and People's specs (`table`, `people`, `pto`, `keyboard`, and
  `departments` for headings dragged and moved in the table) run again in
  WebKit with only the rows near the screen drawn (`virtualize`, a test
  option), and `e2e/table-big.spec.ts` checks a big table (300 boxes)
  against itself drawn whole in another window (every row counted, nothing
  on screen missing however it's scrolled) and a 600-box one for the rest:
  rows being edited kept (and their place, the window losing focus too),
  focus going with a row that moves (a PTO entry given to someone else
  too) or is deleted, Tab across what's drawn, the view kept in place as
  rows above it get shorter or are hidden but not across a new sort, a new
  search or dates shown from the top, the header's buttons never scrolling
  it and letting go of the row being edited, finished PTO hidden (but not
  PTO added, after another view too), new rows scrolled to and focused,
  printing every row on pages no bigger than the rows, dates unbroken. Its
  clock is fixed (`page.clock.setFixedTime`), as nothing it checks moves
  it on. WebKit's Tab skips buttons, as Safari's does by default, so those
  tests focus a control and check where focus lands.
- **Performance** (`npm run perf`, `web/e2e/perf.spec.ts`, its own Playwright
  config) serves the production build with a generated 2,000-box roadmap
  (`scripts/gen-roadmap.ts`; and a 500-box one) as its `roadmap.json`,
  gzipped, and opens it in WebKit without a token. It checks exactly that the
  main JavaScript file stays under 400 kB, that no file with the `yaml`
  library is fetched before the timeline shows, that the timeline then draws
  at most 200 boxes, and that a keyboard move's step, a drag's and a
  keystroke in the box editor draw again only the departments they're in
  (the timeline counts its departments' renders for tests, in
  `window.__boxopsTest`). It prints the time from navigation to the
  timeline painted (median of 3), failing only above 2,500 ms, and a
  keyboard move's step; the same roadmap without the build's parsing is
  timed for comparison. On a 2,000-box roadmap generated around a fixed day
  (the page's clock fixed there too), it times opening the table and People
  (targets 300 ms, failing above 600), an edit committed there with
  Enter and Tab from one table row into the next, which sorts and filters
  the rows again for the row being edited (50 ms each, failing above 100),
  the median of 5 after 2, and checks
  exactly that each draws at most 70 rows with data and 1,500 options, and
  that no textarea's height is read. CI runs it after the browser tests.
- **Lint** (oxlint, `web/.oxlintrc.json`): oxlint's correctness rules plus
  the React hooks rules; any warning fails `npm run lint`. (typescript-eslint
  doesn't support TypeScript 7 yet.) A deliberate exception is a
  `// eslint-disable-next-line <rule> -- <reason>` comment, which oxlint
  honours; one that no longer hides anything is an error.
- **CI.** `CI` (`ci.yml`) runs lint, the type check, the unit tests (again
  with `TZ=America/Los_Angeles` and with `TZ=Pacific/Kiritimati`, UTC−8/−7
  and UTC+14, so nothing depends on the runner's time zone), validation, the
  build, the browser tests (WebKit first, then Chromium, then Firefox) and
  the performance checks on every pull request and every push to a branch
  other than `main`, whatever it changes. A pull request from a branch of
  this repo is covered by that branch's push run, so only pull requests from
  forks run it again.
- **Deploy.** The Pages deploy (`pages.yml`) runs lint, the type check,
  validation and the build on every push to `main`. It runs the unit tests
  and the browser tests too, the latter in WebKit alone (CI has run them in
  all three), before deploying, unless nothing outside `roadmap/` has changed
  since the commit the live site was built from (that of the newest
  successful `github-pages` deployment, else what its `roadmap.json` says,
  which a private Pages site doesn't serve the workflow), so saves from the
  app go live quickly and an app change whose run failed or was cancelled is
  still tested before it goes out. If that commit can't be read, the tests
  run. Deploys run one at a time and are never
  cancelled midway; a burst of saves deploys at most twice. Jobs get only the
  permissions they need, and actions are pinned to commits.
- **Upgrades.** Dependabot (`.github/dependabot.yml`) opens pull requests
  weekly for the actions' pinned commits and for the npm packages in `web/`
  (minor and patch upgrades together), once a release is 3 days old.

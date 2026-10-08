# Roadmap data format

The roadmap's file format (every file and field, what the validator checks,
and data format versions) is described in
[templates/guide/format.md](../templates/guide/format.md), the guide BoxOps
carries for roadmap repositories: `node .boxops/boxops.mjs guide format`
prints it there, as the release that runs has it. This page adds what's
different in this repository, BoxOps' rules for what a release may change
(the data format among them), how `migrate` brings a roadmap from one data
format to the next, and how to change the format.

## In this repository

- Where the guide says `node .boxops/boxops.mjs validate` and `report`, run
  `cd web && npm run validate` and `npm run report`: the same commands of the
  command-line tool, on `../roadmap`, the live demo's roadmap.
  `npm run validate -- <folder>` (and `npm run report -- <folder>`) checks a
  roadmap folder other than `../roadmap`; a relative `<folder>` is relative to
  where you run `npm`.
- The demo deploys (`pages.yml`) only when `npm run validate` passes. A
  roadmap repository made from the starter publishes a roadmap with problems
  without the broken entries and turns its run red; the demo keeps its last
  site until they're fixed.

## Versions and what may change

BoxOps numbers several things, each for its own reason:

- **The release**, `X.Y.Z` (tags `vX.Y.Z`; release candidates
  `vX.Y.Z-rc.N`, published as prereleases). Roadmap repositories pin a
  release by its commit, and there are no moving tags (`v0`, `v0.1`).
- **The data format**, the whole number `format` in `roadmap/settings.yaml`:
  the shape of the files. Each release reads and writes one format.
- **Contract numbers**, in a release's `BUILD.json`, for what a roadmap
  repository holds a copy of or reads: `bundle` (the site's `roadmap.json`
  schema), `launcher` (`.boxops/boxops.mjs`), `guard` (the "Check the
  GitHub Pages settings" step of `deploy.yml`), `agentsBlock` (the block
  BoxOps manages in `AGENTS.md`), and `migratesFrom` (the oldest data format
  `migrate` brings up). A release that changes one raises its number; the
  action, `doctor` and the launcher then say which copy is old.
- **The build id**, `X.Y.Z+<12 hex digits of the commit's web/ tree>`, in
  the app, `BUILD.json` and every `roadmap.json`: when it changes, open tabs
  reload.

What a release may change, by kind (0.x):

| Change | Patch (0.1.1) | Minor (0.2.0) |
|---|---|---|
| The data format | never | up by one, with a migration |
| A new field or value an older BoxOps would drop or mangle | never | only with a new data format |
| Stricter validation | never | only with a new data format (warned of in an earlier minor first) |
| The action's inputs | optional ones added | added, renamed or removed, with exact notes (renamed or removed after a minor of warnings, where that can be done) |
| The action's outputs | unchanged | may change, with notes |
| The workflows' shape, permissions, the Pages guard | never | may change; `doctor` shows the change |
| The `AGENTS.md` block, the launcher | corrections (their numbers go up) | any; the launcher stays compatible across 0.x |
| `validate`'s last line, `report`'s text | unchanged | may change, with notes |
| The Node.js the command-line tool needs | unchanged | may go up |
| `roadmap.json`'s `schema` and where it keeps `app.build`; the launcher's call, `main(argv, ctx) → Promise<number>` | never | never |

The rule behind the first three rows: anything an older BoxOps would read
wrongly or damage needs a new data format, and so a minor release. The last
row is what open tabs and old launchers rely on to learn that BoxOps
changed, so it stays put across 0.x.

**Format 1**, frozen as of BoxOps 0.1.0, is the format the guide describes,
with these rules among them: colours are `#rrggbb` only; links are `http:`
or `https:` only; the app leaves out values it can't use (and won't write a
file it couldn't read whole); and a roadmap without `format` is format 0,
which `migrate` brings to 1.

**Support.** The latest minor release gets patches. A security fix also goes
to the minor before it when the latest one raised the data format, so no one
has to migrate to get it. The action runs on GitHub's `node24` (a release on
a newer Node.js comes before Node.js 24's end of life, 2028-04-30), tested
on `ubuntu-24.04`, `ubuntu-24.04-arm` and `ubuntu-26.04`; macOS runners are
best effort; Windows runners, container jobs, GitHub Enterprise Server and
GHE.com aren't supported. The command-line tool needs Node.js 22.12 or
later. The app is made for Safari 16.4 or later, and works in Chrome and
Edge 111 and Firefox 115 or later.

## Migrations and `migrate`

A roadmap in another data format than the release's isn't read as if it
were in it:

- **The app** opens it read-only, with a banner saying why. An open tab
  won't save to a repository whose `settings.yaml` has moved to a newer
  format ("BoxOps is being upgraded; reload in a minute").
- **The action** stops the deploy, and the site stays as it was: an older
  format with "This roadmap is in data format 0; BoxOps 0.1.0 reads format
  1. Run `node .boxops/boxops.mjs migrate`, commit and push", a newer one
  with "upgrade the pin". A roadmap with no `settings.yaml` is told to add
  one, and one whose `settings.yaml` can't be read for its format (a YAML
  syntax error, say) what's wrong with it, on its line.
- **`node .boxops/boxops.mjs validate`** fails with exit code 3.

`node .boxops/boxops.mjs migrate` brings the roadmap to the release's
format:

- It runs every migration from the roadmap's format to the release's, in
  order (each release keeps the whole chain, so a roadmap two formats behind
  goes through both), then validates the result.
- Each migration edits text in place, at the spots the `yaml` library's
  document model finds, so comments, the order of keys, quoting and line
  ends stay as they were; only files that change are written.
- It's idempotent: run again, it changes nothing. `format` is set last,
  once every step has run, so a file is never stamped with a format it
  isn't in.
- `migrate --check` writes nothing, and exits 1 when a migration is needed
  (0 when not). A roadmap in a newer format than the release's is refused
  ("upgrade BoxOps rather than migrating"), exit 3. One whose
  `settings.yaml` can't be read for its format (a YAML syntax error, say)
  is told what's wrong, and exits 1, as `validate` does for it.
- Nothing migrates data by itself: the action can't write to the
  repository, and the app opens other formats read-only. A migration is a
  commit someone reviews, made on the upgrade's pull request
  ([upgrading.md](upgrading.md#migrations)).

0.1.0's only migration, 0 → 1, stamps `format: 1` in `settings.yaml` (and
writes a `settings.yaml` holding just that when there's none): format 1 is
what roadmaps were before formats had numbers.

Unsaved edits in a browser are stored with the format and the build that
made them. After an upgrade to the same format, a reload restores them; to
a newer one, a migration may say how to bring them along (its optional
`draft` step), and otherwise the app offers them only as a download (JSON),
to make again by hand.

## Changing the format

`FORMAT` in `web/src/model/format.ts` is the data format this BoxOps reads
and writes; format 1 is frozen as of 0.1.0. Anything an older BoxOps would
read wrongly or damage (a new field or value it would drop or mangle, a
stricter validation rule) needs the next number, in a minor release only
(0.2.0, not 0.1.1), and with it:

- a migration from the format before, `web/src/model/migrations/NNN.ts`,
  added to `MIGRATIONS` (`migrations/index.ts` has the rules: it edits text
  in place, it's idempotent, and the chain sets `format` last), so
  `node .boxops/boxops.mjs migrate` brings a roadmap up to it;
- `FORMAT` raised, and the guide's file format
  (`templates/guide/format.md`) and the validator's tests
  (`web/src/model/load.test.ts`) saying what changed;
- release notes that say to run `migrate` on the upgrade's pull request.

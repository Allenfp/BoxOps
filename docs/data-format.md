# Roadmap data format

The roadmap's file format (every file and field, what the validator checks,
and data format versions) is described in
[templates/guide/format.md](../templates/guide/format.md), the guide BoxOps
carries for roadmap repositories: `node .boxops/boxops.mjs guide format`
prints it there, as the release that runs has it. This page adds what's
different in this repository, and how the format may change.

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

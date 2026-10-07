# Working on BoxOps (for AI assistants)

This repository is BoxOps itself, not a team's roadmap:

- `web/`: the app (Vite, React, TypeScript), and in `web/cli/` its
  command-line tool and GitHub Action, bundled into `dist/boxops.mjs`.
- `starter/`: the files of the starter repository, a roadmap repository
  that runs a BoxOps release pinned by commit and holds no app.
- `templates/`: what the tool gives roadmap repositories: the managed block
  of their `AGENTS.md`, the guide (`guide/*.md`) and Path B's workflows.
- `release/action.yml`: the root of every release commit.
- `roadmap/`: the live demo's roadmap, until the cutover (`cutover/`) moves
  it to `Allenfp/boxops-demo`. To edit it, see the last section.

How it all works is in [docs/architecture.md](docs/architecture.md), and why
in [docs/decisions.md](docs/decisions.md). The data format is
[templates/guide/format.md](templates/guide/format.md), and how it may change
[docs/data-format.md](docs/data-format.md).

## Branches and commits

- Work on a branch, never on `main`: every push to `main` deploys the demo
  (`pages.yml`). Merge, push or open a pull request only when the user says
  to.
- Never force-push, and never rewrite commits that are pushed.
- Never create a tag, a commit on `releases` or a GitHub release, and never
  change the repository's settings, rulesets or deploy keys: releases are
  made by the release workflow, with its deploy key, once the maintainer
  approves. (A tag ruleset whose only bypass is that deploy key refused the
  owner's own tag push over SSH when tried on 2026-10-06; whether it also
  stops a tag made through the REST API isn't checked yet. Were it not to
  hold, releases would move to a repository of their own, such as
  `Allenfp/boxops-action`.)
- Commit in small, logical steps, each leaving the unit tests passing. The
  subject is a plain sentence of at most 72 characters, saying what is now
  true (`git log` shows the style; `Docs: …` and `Tests: …` for those
  alone). If you add a trailer such as `Co-Authored-By:`, put it after a
  blank line at the end.

## Checks

From `web/` (`npm ci` once, and `npx playwright install webkit chromium
firefox` for the browser tests):

| After changing | Run |
|---|---|
| anything | `npm run lint`, `npm run typecheck`, `npm test` |
| the app (`src/`, `index.html`, styles) | `npm run build`, `npm run e2e` (WebKit first, then Chromium and Firefox; about 11 minutes) and `npm run perf` |
| the command-line tool or the action (`cli/`), `starter/`, `templates/` or `release/` | `npm run build`, `npm run build:cli`, and `npm run dry-run:starter` (a roadmap repository made from the starter, end to end, offline, in WebKit too) |
| a workflow (`.github/workflows/`, `starter/.github/workflows/`, `templates/path-b/`) | actionlint, with shellcheck installed (CI's `workflows` job runs both) |
| `roadmap/` | `npm run validate` |

Before `npm run e2e` or `npm run perf`, make sure nothing listens on port
4173 (`lsof -nP -iTCP:4173 -sTCP:LISTEN`): outside CI, Playwright uses a
server it finds there, which would serve an old build.

## Files that change together

Tests catch most of these; change the files together anyway.

- `templates/agents-block.md` (the block, its number in its front matter),
  `AGENTS_BLOCK` in `web/cli/release.ts` and `starter/AGENTS.md` (that
  block, a heading and the team's notes: what `sync` writes).
- `starter/.boxops/boxops.mjs` (the launcher) and `LAUNCHER`; how it finds
  the pin and `web/cli/pins.ts`; its cache (where, in what order, what it
  refuses, what a release's folder holds) and `web/cli/cache.ts`,
  `upgrade.ts` and `preview.ts`. What it passes the tool,
  `main(argv, ctx) → Promise<number>`, is fixed across 0.x: add to `ctx`,
  never change what's there.
- The Pages guard step in `starter/.github/workflows/deploy.yml`
  (`# boxops-guard: N`), `GUARD`, and its copy in
  `templates/path-b/deploy.yml`.
- `templates/path-b/*.yml` and the starter's two workflows: only the BoxOps
  step differs, and the starter's `README.md` shows that step.
- The placeholders in `starter/` (`<RELEASE_COMMIT_SHA>` on pin lines,
  `<SOURCE_COMMIT_SHA>` in links to the docs) and `web/cli/starter.ts`,
  which fills them in for `init` and `npm run publish-starter`.
- `release/action.yml`'s inputs and outputs, and `web/cli/action.ts`.
- `web/src/model/summary.ts` (commit messages) and
  `templates/guide/commits.md`.
- The validator (`web/src/model/parse.ts`, `load.ts`),
  `templates/guide/format.md` ("What the validator checks") and
  `web/src/model/load.test.ts`.
- `FORMAT`, the migrations (`web/src/model/migrations/`) and
  `docs/data-format.md` ("Changing the format").
- An action used in several workflows: the same commit and `# vX.Y.Z`
  comment everywhere (check a new one with `git ls-remote`).
- A file staged in `cutover/` and the live file it replaces
  (`web/scripts/cutover.test.ts`).
- `README.md`, `docs/` and `templates/` describe what the code does: change
  them with it.

## Releases

- Versions are `X.Y.Z`, release candidates `X.Y.Z-rc.N`; roadmap
  repositories pin a release by commit, so there are no floating tags.
- A patch release never changes the data format, the workflows' shape,
  permissions or Pages guard, or the action's outputs; it may add optional
  inputs. The data format goes up only in a minor release, by one, with a
  migration.
- The contract numbers in `BUILD.json` (`bundle`, `launcher`, `guard`,
  `agentsBlock`) count released versions: raise one when what it numbers
  changes after a release has shipped it (before that, edit freely). The
  action, `doctor` and the launcher tell roadmap repositories whose copy
  differs.
- Every page of this repository that `starter/README.md` links to is
  there before a release: `TO_WRITE` in `web/cli/starter.test.ts`, the
  pages not written yet, is empty. (The release's `init` writes those links
  unchecked; `npm run publish-starter` refuses them.)
- After a release, `npm run publish-starter` writes the starter repository
  for it; it pushes nothing.

## House rules

- Dates are `YYYY-MM-DD` everywhere: the app, the tools, messages and docs.
- Safari (WebKit) first; Chrome, Edge and Firefox must work too.
- No new runtime dependency for the app; anything the tool or the action
  needs is bundled into `dist/boxops.mjs`, so roadmap repositories install
  nothing. A new devDependency needs a reason.
- Match the code and the prose around you. Text BoxOps shows has curly
  quotes and apostrophes (“ ” ’).

## Editing the demo's roadmap (until the cutover)

`roadmap/` is the live demo's data (https://allenfp.github.io/BoxOps/),
saved from the app like any roadmap. To change it by hand, follow the guide
BoxOps gives roadmap repositories,
[templates/guide/overview.md](templates/guide/overview.md) and the
[recipes](templates/guide/recipes.md), [commit messages](templates/guide/commits.md)
and [file format](templates/guide/format.md) it points to, with two
differences:

- Where it says `node .boxops/boxops.mjs validate` or `report`, run
  `npm run validate` or `npm run report --silent` from `web/`.
- Roadmap edits go straight to `main` as the app's saves do, `roadmap/`
  alone (`git add roadmap/`): no branch or pull request unless the user
  asks. App changes never ride along.

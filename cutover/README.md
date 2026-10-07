# Cutover

What the cutover commit changes when the live demo leaves this repository for
`Allenfp/boxops-demo` (the distribution design's §14, step 7). Until then
`allenfp.github.io/BoxOps/` keeps deploying from `roadmap/` here, as it always
has: `pages.yml` builds the app, then writes the site with the command-line
tool (`node dist/boxops.mjs build`: the app, and `roadmap.json` from
`roadmap/` at the commit). Files staged for the cutover go in this folder,
named after the file they replace; the steps below say what to do with each.

## Before the cutover commit

1. `Allenfp/boxops-demo` exists, made with `init` from a release candidate,
   with the demo's history (`git filter-repo --path roadmap/`), migrated,
   deploying, and saving with its own token. Demo edits here are frozen.
2. Close the demo's open tabs (their code writes to `roadmap/` here and has
   no build-id check).

## The cutover commit

1. Delete `roadmap/`.
2. Replace `.github/workflows/pages.yml` with the redirect and `/next/`
   canary (the design's §2.8; it needs `npm run release:build`). That drops
   the interim "Assemble the site (the app, and roadmap.json from roadmap/)"
   step and its `build:cli` step.
3. `.github/workflows/ci.yml`, step "The tool on the starter, and the demo's
   site": its `build --out "$RUNNER_TEMP/site"` reads `roadmap/`. Give it
   `--roadmap starter/roadmap` (git objects of this repository at
   `starter/roadmap`), or drop it once ci.yml becomes the design's.
4. `web/vite.config.ts`: `DEV_ROADMAP`, the dev server's default when
   `$BOXOPS_ROADMAP` isn't set, becomes `web/e2e/fixtures/roadmap` (it's
   `../roadmap` now), and its doc comment with it.
5. `web/scripts/roadmap-dir.ts`: the default folder of `npm run validate` and
   `npm run report` (`../roadmap` now) becomes `e2e/fixtures/roadmap`; its
   usage line, the scripts' comments and `docs/data-format.md` with it.
6. Split `AGENTS.md`: this repository's becomes the guide for working on
   BoxOps itself (branches, `npm test`, `npm run e2e`). Its roadmap-editing
   guide already lives in `templates/` (`agents-block.md` and `guide/*.md`),
   which the tool carries for roadmap repositories; drop it here.
7. Docs: README's "Open it" link and its "Editing without the app" section
   (to the demo and the starter), `docs/architecture.md` (this repository's
   `roadmap/` and the Deploy bullet), and `docs/decisions.md` (rows for the
   starter and prebuilt action, the demo repository, the release identity
   and versioning).

## After merging

1. Revoke the old token scoped to `Allenfp/BoxOps`: that's what makes the
   pinned repository unwritable from a browser.
2. Check the redirect keeps its query and hash: `/BoxOps/?view=table#x`.

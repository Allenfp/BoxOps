# Cutover

What the cutover commit changes when the live demo leaves this repository for
`Allenfp/boxops-demo` (the distribution design's §14, step 7). Until then
`allenfp.github.io/BoxOps/` keeps deploying from `roadmap/` here, as it always
has: `pages.yml` builds the app, then writes the site with the command-line
tool (`node dist/boxops.mjs build`: the app, and `roadmap.json` from
`roadmap/` at the commit).

The files staged here sit at the path of the file each replaces
(`cutover/web/vite.config.ts` replaces `web/vite.config.ts`). Each is the live
file with the cutover's changes made and nothing else:
`web/scripts/cutover.test.ts` fails when a live file changes and its staged
copy doesn't, so copying them over undoes no later change. (A file the
cutover replaces whole, as it will `pages.yml`, is listed in that test
without changes to check.)

## Staged

| File | What the cutover changes |
|---|---|
| `web/vite.config.ts` | `DEV_ROADMAP`, what `npm run dev` shows when `$BOXOPS_ROADMAP` isn't set, becomes the browser tests' roadmap, `web/e2e/fixtures/roadmap` (it's `../roadmap` now), and its doc comment with it. |
| `web/scripts/roadmap-dir.ts` | The default folder of `npm run validate` and `npm run report` becomes `e2e/fixtures/roadmap` (it's `../roadmap` now), in its usage line and comment too. |

## Not staged yet

- `.github/workflows/pages.yml`: the redirect and the `/next/` canary (the
  design's §2.8). It needs the release-tree build (`npm run release:build`,
  whose action it runs on the demo's data) and `pages/redirect.html`, neither
  of which exists yet. Stage it here once they do.
- `.github/workflows/ci.yml`: it's to become the design's (the release tree,
  smoke runs on three runners). Until it does, its step "The tool on the
  starter, and the demo's site" writes a site from `roadmap/` with
  `build --out "$RUNNER_TEMP/site"`; at the cutover, give that
  `--roadmap starter/roadmap` (git objects of this repository at
  `starter/roadmap`), or drop it if ci.yml no longer has it.
- `AGENTS.md`, `README.md` and `docs/`: they change with the rest of the work
  until then, so the cutover commit makes their changes itself (below).

## Before the cutover commit

1. `Allenfp/boxops-demo` exists, made with `init` from a release candidate,
   with the demo's history (`git filter-repo --path roadmap/`), migrated,
   deploying, and saving with its own token. Demo edits here are frozen.
2. Close the demo's open tabs (their code writes to `roadmap/` here and has
   no build-id check).

## The cutover commit

1. Delete `roadmap/`.
2. Copy the staged files (all of this folder but this README) over the live
   ones, then delete this folder and the test that checks it:
   `rsync -a --exclude=/README.md cutover/ ./ && git rm -rq cutover
   web/scripts/cutover.test.ts`.
3. Replace `.github/workflows/pages.yml` with the redirect and `/next/`
   canary (step 2 does, once it's staged here). That drops the interim
   "Assemble the site (the app, and roadmap.json from roadmap/)" step and its
   `build:cli` step.
4. `.github/workflows/ci.yml`, as above.
5. `docs/data-format.md`'s "In this repository": `npm run validate` checks
   `e2e/fixtures/roadmap` unless given another folder (it says `../roadmap`,
   the live demo's roadmap), and the bullet on how the demo deploys goes.
6. `AGENTS.md` is already the guide for working on BoxOps itself (the
   roadmap-editing guide is `templates/`'s, which the demo's repository
   gets): drop its `roadmap/` bullet and its last section, "Editing the
   demo's roadmap".
7. Docs: README's "Open it" link, its `npm run dev` line and its "Editing
   without the app" section (to the demo and the starter),
   `docs/architecture.md` (this repository's `roadmap/`, the dev server's
   default and the Deploy bullet), and `docs/decisions.md` (rows for the
   starter and prebuilt action, the demo repository and versioning).

## After merging

1. Revoke the old token scoped to `Allenfp/BoxOps`: that's what makes the
   pinned repository unwritable from a browser.
2. Check the redirect keeps its query and hash: `/BoxOps/?view=table#x`.

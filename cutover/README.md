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
cutover replaces whole, or adds, is listed in that test without changes to
check.)

## Staged

| File | What the cutover changes |
|---|---|
| `.github/workflows/pages.yml` | Replaced whole. `allenfp.github.io/BoxOps/` becomes a redirect to `allenfp.github.io/boxops-demo/` (the next file), and `/next/` a read-only canary of `main`: this commit's release tree (`npm run release:build`, version `X.Y.Z-next`), its action assembling `Allenfp/boxops-demo`'s roadmap, as a release would. On every push to `main`, daily and by hand. |
| `pages/redirect.html` | New: the redirect, published as the site's `index.html`. It goes on to `/boxops-demo/` with the address's query and hash (`?view=table`, a box's `#…`) on the same origin, so a tab's session storage goes along; its Content-Security-Policy allows its one script by hash. Without script, it links to the demo and the starter. |
| `.github/workflows/ci.yml` | It runs on every pull request, from this repository's branches too (not only forks'), and on pushes to `main` alone: `pages.yml` no longer tests what it deploys, and the `main` ruleset's required checks are the pull request's own runs. It writes no site from `roadmap/`, and lints no workflows in `cutover/`. A run on `main` is never cancelled by a newer one: it may be the only test of what a merge made. |
| `web/vite.config.ts` | `DEV_ROADMAP`, what `npm run dev` shows when `$BOXOPS_ROADMAP` isn't set, becomes the browser tests' roadmap, `web/e2e/fixtures/roadmap` (it's `../roadmap` now), and its doc comment with it. |
| `web/scripts/roadmap-dir.ts` | The default folder of `npm run validate` and `npm run report` becomes `e2e/fixtures/roadmap` (it's `../roadmap` now), in its usage line and comment too. |
| `web/scripts/workflows.test.ts` | It stops looking for workflows in `cutover/`, which the cutover commit deletes (it requires this folder's `pages.yml` until then), and its first comment and first test's name stop naming them. |

`AGENTS.md`, `README.md` and `docs/` aren't staged: they change with the rest
of the work until then, so the cutover commit makes their changes itself
(below).

## Before the cutover commit

1. A release candidate, `v0.1.0-rc.1`, is out (`docs/releasing.md`), and the
   starter repository, `Allenfp/boxops-starter`, published for it.
2. Demo edits here stop, before its roadmap is copied (step 3), so that the
   copy has every save: close the demo's open tabs (their code writes to
   `roadmap/` here and has no build-id check), then revoke the old token
   scoped to `Allenfp/BoxOps` (Settings → Developer settings → Personal
   access tokens), and edit nothing in `roadmap/` by hand. The demo saves
   again once its own repository has a token of its own (step 3). That old
   token is also what makes the repository roadmap repositories pin
   writable from a browser: revoking it, not the cutover commit, is what
   ends that.
3. `Allenfp/boxops-demo` holds the demo's roadmap with its history, its
   authors' and committers' personal addresses replaced. From a fresh clone
   (`git filter-repo` rewrites the clone it runs in, and needs
   [git-filter-repo](https://github.com/newren/git-filter-repo)):

   ```sh
   git clone --no-local https://github.com/Allenfp/BoxOps.git boxops-demo && cd boxops-demo &&
     git log --format='%ae%n%ce' -- roadmap/ | sort -u | grep -iE '@(gmail\.com|veryboringdata\.co)$' |
       sed 's/.*/<29790605+Allenfp@users.noreply.github.com> <&>/' > ../demo-mailmap &&
     cat ../demo-mailmap &&
     git filter-repo --path roadmap/ --mailmap ../demo-mailmap &&
     git log --format='%ae%n%ce' | sort -u |
       awk '!/@users\.noreply\.github\.com$/ && $0 != "noreply@github.com" { print "still in the history: " $0; left = 1 } END { exit left }'
   ```

   The mailmap maps each Gmail or veryboringdata.co address that authored or
   committed a change to `roadmap/` to
   `29790605+Allenfp@users.noreply.github.com`. Today that's the maintainer's
   Gmail address, written two ways (its first letter in either case), which
   git counts as two addresses; the veryboringdata.co one is only on commits
   outside `roadmap/`, which `--path roadmap/` drops. The last command fails,
   naming the address, if any is left but a GitHub no-reply one
   (`…@users.noreply.github.com`, or `noreply@github.com`, the committer
   GitHub writes on what's made on its site): then stop, and run it again in
   a fresh clone once the `grep` takes that address in. Then, in that clone,
   the starter's files as the release candidate's `init` writes them (its
   pins on rc.1's commit), but for the starter's sample roadmap; the demo's
   data stamped `format: 1`; a commit of those, as the no-reply address (a
   fresh clone commits as your global git identity); the same check, which
   now takes in that commit; and the demo's own repository (pushing workflow
   files takes SSH, or a token with the workflow scope):

   ```sh
   curl -fsSLo ../boxops.mjs https://github.com/Allenfp/BoxOps/releases/download/v0.1.0-rc.1/boxops.mjs &&
     gh attestation verify ../boxops.mjs -R Allenfp/BoxOps --signer-workflow Allenfp/BoxOps/.github/workflows/release.yml &&
     node ../boxops.mjs init ../demo-starter &&
     rsync -a --exclude=/roadmap/ ../demo-starter/ ./ &&
     node .boxops/boxops.mjs migrate && node .boxops/boxops.mjs validate &&
     git config user.email 29790605+Allenfp@users.noreply.github.com &&
     git add -A && git commit -m "Run the demo from the BoxOps starter, pinned to v0.1.0-rc.1" &&
     git log --format='%ae%n%ce' | sort -u |
       awk '!/@users\.noreply\.github\.com$/ && $0 != "noreply@github.com" { print "still in the history: " $0; left = 1 } END { exit left }' &&
     gh repo create Allenfp/boxops-demo --public --source . --push
   ```

   In its settings, Pages' source is GitHub Actions; its first deploy must
   pass. Make a fine-grained token for `Allenfp/boxops-demo` alone
   (Contents: read and write), and check a save from
   `allenfp.github.io/boxops-demo/`.

## The cutover commit

On a branch, merged by pull request:

1. Delete `roadmap/`: `git rm -rq roadmap`.
2. Copy the staged files (all of this folder but this README) over the live
   ones, then delete this folder and the test that checks it:
   `rsync -a --exclude=/README.md cutover/ ./ && git rm -rq cutover
   web/scripts/cutover.test.ts`. That swaps the workflows: `pages.yml`
   becomes the redirect and `/next/`, and `ci.yml` checks every pull request
   and `main`.
3. `docs/data-format.md`'s "In this repository": `npm run validate` checks
   `e2e/fixtures/roadmap` unless given another folder (it says `../roadmap`,
   the live demo's roadmap), and the bullet on how the demo deploys goes.
4. `AGENTS.md` is already the guide for working on BoxOps itself (the
   roadmap-editing guide is `templates/`'s, which the demo's repository
   gets): drop its `roadmap/` bullet, its last section ("Editing the demo's
   roadmap"), the `roadmap/` row of its checks, `cutover/.github/workflows/`
   in the workflows' row, and the bullet on the files staged in `cutover/`
   ("Files that change together"); and its first rule's reason becomes that
   `main` takes merged pull requests only (its ruleset), each deploying
   `/next/`, not the demo.
5. Docs:
   - `README.md`: its opening (the demo's roadmap is `Allenfp/boxops-demo`'s
     now) and "Open it" link, its `npm run dev` and
     `node dist/boxops.mjs build` lines and its "Editing without the app"
     section (to the demo and the starter), and its CI paragraph (CI runs
     on every pull request and on `main`, and lints this repository's, the
     starter's and Path B's workflows; the deploy is the redirect and
     `/next/`).
   - `docs/architecture.md`: this repository's `roadmap/`, the dev server's
     default, the Deploy bullet and CI on `main`; and `cutover/` in the
     layout (the folder, and `cutover.test.ts` in `scripts/`), in the unit
     tests (the files staged there) and in CI's workflows job (the
     workflows it lints).
   - `docs/releasing.md`: "At the cutover" (its pointer to this README, and
     "the cutover's `ci.yml`", now just `ci.yml`), "before the cutover" in
     "One-off settings", and "(before the cutover, the demo)" in the release
     pull request's step.
   - `docs/decisions.md`: the demo's row (the demo has moved, and nothing
     is staged), the app-build row's last sentence (how `pages.yml` writes
     this repository's site) and the default-branch row's "once the cutover
     has CI run there".

   Then `git grep -n -i cutover` lists what's left to reword: nothing may
   send a reader to `cutover/`, or speak of the cutover as still to come.
6. `npm run lint`, `npm run typecheck`, `npm test`, `npm run e2e` and
   actionlint, as for any change.

## After merging

1. Add the `main` ruleset (`docs/releasing.md`, "At the cutover"): nothing
   writes to `main` here now but merged pull requests.
2. The redirect keeps the query and hash: `allenfp.github.io/BoxOps/?view=table#x`
   opens `allenfp.github.io/boxops-demo/?view=table#x`, in the table.
3. `allenfp.github.io/BoxOps/next/` shows the demo's roadmap, read-only, with
   this commit's build (`0.1.0-next+…`).

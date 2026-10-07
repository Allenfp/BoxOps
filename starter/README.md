# Our roadmap

This repository is a team roadmap: small YAML files in `roadmap/`, shown as a
swim-lane timeline, a table and a roster by [BoxOps](https://github.com/Allenfp/BoxOps)
on this repository's GitHub Pages site. Editors change it in the browser, and
each **Save** is a commit on `main` that goes live in about a minute. The
site's address is in **Settings → Pages**.

## Setting it up

The full guide, with what each step is for, is BoxOps'
[docs/adopting.md](https://github.com/Allenfp/BoxOps/blob/<SOURCE_COMMIT_SHA>/docs/adopting.md),
as of the release this repository was made with. In short:

1. **Organization owner, once:** allow private Pages sites (Settings → Member
   privileges), allow the actions this repository uses (`Allenfp/BoxOps@*`
   plus GitHub's own `actions/*`), and allow fine-grained personal access
   tokens.
2. **Create this repository** from the template, as **Private**. Its first
   run stops at "GitHub Pages isn't set up": expected, nothing is published.
3. **Settings → Pages:** Source **GitHub Actions**, Visibility **Private**.
   Then Actions → Deploy roadmap → **Re-run all jobs**.
4. **Settings → Rules:** a branch ruleset on `main` that restricts deletions
   and blocks force pushes (no required pull requests or checks: saves go
   straight to `main`), and a push ruleset that restricts `.github/**`,
   `.boxops/**`, `AGENTS.md` and `CLAUDE.md`, with **Repository admin** and
   **Dependabot** allowed to bypass it.
5. **Make it yours:** set `title` in `roadmap/settings.yaml` and replace the
   example department, people and boxes, here or in the app.

## People

- **Viewers** need read access to this repository.
- **Editors** need write access and, at their first Save, a fine-grained
  personal access token: resource owner the organization, only this
  repository, **Contents: Read and write** and nothing else. The app's link
  fills that in. If the organization approves tokens, an owner approves it
  first. The token stays in that browser tab only.

## Editing without the app

The files can be edited by hand or by an AI assistant (see `AGENTS.md`) and
pushed to `main`. With Node.js 22.12 or later:

```sh
node .boxops/boxops.mjs validate   # must end in "— OK"
node .boxops/boxops.mjs report     # capacity, overloads, PTO clashes, everyone's bookings
node .boxops/boxops.mjs preview    # this working copy's roadmap at http://127.0.0.1:4173 (read-only)
node .boxops/boxops.mjs guide      # the full guide: recipes, commit messages, the file format
```

The launcher runs the BoxOps release that `.github/workflows/deploy.yml` pins
(downloaded once, then cached outside the repository).

## Upgrading

Dependabot opens a pull request for each new BoxOps release. Its check runs
the new release against this roadmap; read the release notes in it, and merge
when it's green. Some upgrades ask you to run `node .boxops/boxops.mjs
migrate` (a new data format) or `sync` (a new `AGENTS.md` block or launcher)
on the pull request's branch first. `node .boxops/boxops.mjs guide upgrading`
has the details; `node .boxops/boxops.mjs upgrade` does it by hand, and
`node .boxops/boxops.mjs doctor` checks the setup.

Every deploy also looks up BoxOps' releases: when one fixes a security
problem, the run warns and the site shows a notice until you upgrade.

## Enterprise notes

- **Actions allow lists:** BoxOps is one entry, `Allenfp/BoxOps@*` (or your
  mirror). Allow lists of exact commits also need the commit
  `actions/upload-pages-artifact` runs inside:
  `actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f`.
- **Mirrors:** mirror BoxOps' `releases` branch and `v*` tags into your
  organization (the commits stay the same), keep "boxops" in the mirror's
  name, and change `Allenfp/BoxOps` on the `uses:` lines and in
  `BOXOPS_UPSTREAM`.
- **IP allow lists:** GitHub's standard runners can't be allow-listed. Use
  larger runners with static addresses or self-hosted runners (`runs-on` in
  both workflows); editors' browsers need allowed networks too.
- **GitHub's own actions only (Path B):** replace the BoxOps step in both
  workflows with this one (in `check.yml`, add `--mode check`):

  ```yaml
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
      - id: boxops
        name: BoxOps (Path B, no third-party action)
        env:
          BOXOPS_ACTION: Allenfp/BoxOps@<the commit from the uses: line> # vX.Y.Z
        run: |
          set -euo pipefail
          repo=${BOXOPS_ACTION%@*}; sha=${BOXOPS_ACTION#*@}
          dir="$RUNNER_TEMP/boxops-action"
          git init -q "$dir"
          git -C "$dir" fetch -q --depth 1 --no-tags "https://github.com/$repo" "$sha"
          git -C "$dir" -c core.hooksPath=/dev/null checkout -q --detach FETCH_HEAD
          [ "$(git -C "$dir" rev-parse HEAD)" = "$sha" ]
          node "$dir/dist/boxops.mjs" action --releases-file "$RUNNER_TEMP/boxops-releases.json"
  ```

  Dependabot can't move that line; `node .boxops/boxops.mjs upgrade` does.
- GitHub Enterprise Server, GHE.com and Windows runners aren't supported.

The starter files in this repository are MIT-0: use them as you like, no
attribution needed.

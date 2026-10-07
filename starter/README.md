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
node .boxops/boxops.mjs guide      # the guide: workflow, recipes, commit messages, upgrading
node .boxops/boxops.mjs guide format   # every file and field, and what validate checks
```

The launcher runs the BoxOps release that `.github/workflows/deploy.yml` pins:
downloaded once, checked against that release's `BUILD.json`, and kept in a
cache outside the repository; `preview` downloads the app on its first run.
A sandbox that has the network only while it's set up can fill the cache
then with `node .boxops/boxops.mjs version`. Offline, set `BOXOPS_CLI` to
that release's `dist/boxops.mjs`, downloaded beforehand. Behind a proxy, set
`HTTPS_PROXY` (Node.js 22.21+ or 24+ uses it); a proxy that re-signs TLS also
needs `node --use-system-ca .boxops/boxops.mjs …`, or `NODE_EXTRA_CA_CERTS`
set to its certificate.

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
  name, and change `Allenfp/BoxOps` on the `uses:` lines. Keep
  `BOXOPS_UPSTREAM` on `Allenfp/BoxOps` if the deploy can read it: the
  update and security notices come from its GitHub releases, which a mirror
  doesn't have. The launcher reads a private mirror with `GH_TOKEN`, or
  `gh auth token`.
- **IP allow lists:** GitHub's standard runners can't be allow-listed. Use
  larger runners with static addresses or self-hosted runners (`runs-on` in
  both workflows); editors' browsers need allowed networks too.
- **GitHub's own actions only (Path B):** in both workflows, replace the
  BoxOps step with these two, which fetch the same release with git, check
  it is that commit, and run it with Node.js. In `check.yml` the last line is
  `node "$dir/dist/action.mjs" --mode check`. BoxOps'
  [templates/path-b/](https://github.com/Allenfp/BoxOps/tree/<SOURCE_COMMIT_SHA>/templates/path-b)
  has both workflows whole.

  ```yaml
        - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
          env:
            YARN_IGNORE_PATH: "1" # setup-node runs `yarn --version`: no yarnPath set in this repository may run
          with:
            node-version: 24
            package-manager-cache: false # no package.json read here, and no cache kept
        - id: boxops
          name: BoxOps (Path B, no third-party action)
          env:
            BOXOPS_ACTION: Allenfp/BoxOps@<RELEASE_COMMIT_SHA> # v0.1.0
          run: |
            set -euo pipefail
            repo=${BOXOPS_ACTION%@*}
            sha=${BOXOPS_ACTION#*@}
            if ! [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && "$sha" =~ ^[0-9a-f]{40}$ ]]; then
              echo "::error title=BoxOps::BOXOPS_ACTION is '$BOXOPS_ACTION': it must be <owner>/<repository>@<40-character commit SHA>"
              exit 1
            fi
            dir="$RUNNER_TEMP/boxops-action"
            git init -q "$dir"
            git -C "$dir" fetch -q --depth 1 --no-tags "https://github.com/$repo" "$sha"
            git -C "$dir" -c core.hooksPath=/dev/null checkout -q --detach FETCH_HEAD
            if [ "$(git -C "$dir" rev-parse HEAD)" != "$sha" ]; then
              echo "::error title=BoxOps::git fetched another commit than $sha"
              exit 1
            fi
            node "$dir/dist/action.mjs" --releases-file "$RUNNER_TEMP/boxops-releases.json"
  ```

  This copy names the release this repository was made with, and neither
  Dependabot nor `upgrade` changes this README: so set `BOXOPS_ACTION` to
  the commit and tag of the `uses:` line it replaces. Dependabot can't move
  it after that; `node .boxops/boxops.mjs upgrade` does, and the launcher
  and `doctor` read it as they read `uses:`. git fetches it from github.com
  without a token, so it must name a public repository: BoxOps itself, or a
  public mirror. For a private mirror, name `Allenfp/BoxOps` there instead
  (the commit is the same).
- GitHub Enterprise Server, GHE.com and Windows runners aren't supported.

The starter files in this repository are MIT-0: use them as you like, no
attribution needed.

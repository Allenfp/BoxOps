# BoxOps guide: upgrading

## How a roadmap repository runs BoxOps

BoxOps isn't copied into this repository. Two workflows use one release of
it, pinned by commit on a line like this (in both
`.github/workflows/deploy.yml` and `check.yml`):

```yaml
      - uses: Allenfp/BoxOps@<40-character commit SHA> # v0.1.0
```

`.boxops/boxops.mjs`, the launcher, reads that line and runs the same
release's command-line tool (downloaded once, then cached outside the
repository). So the site, the pull-request check and every
`node .boxops/boxops.mjs` command run the same code, and a branch runs the
release its own `deploy.yml` pins.

Commands for upgrades (a repository admin's, or an assistant's when asked):

- `node .boxops/boxops.mjs version`: the release that runs, its build and the
  data format it reads.
- `node .boxops/boxops.mjs doctor`: checks Node.js, that every pin names the
  same commit, that it's a tagged release of the pinned repository (and,
  with the GitHub CLI installed, that the tool was signed by BoxOps' release
  workflow), the launcher, the Pages guard and the AGENTS.md block, the
  workflows' permissions and their runners.
- `node .boxops/boxops.mjs upgrade [vX.Y.Z]`: moves every pin (and its
  `# vX.Y.Z` comment) to that release, or the latest, then runs the new
  release's `migrate --check`, `sync` and `validate`. It commits nothing.
- `node .boxops/boxops.mjs migrate [--check]`: brings `roadmap/` to the data
  format this release reads.
- `node .boxops/boxops.mjs sync [--check]`: rewrites the managed block in
  `AGENTS.md` and the launcher to this release's text (team notes outside the
  block stay), and adds `CLAUDE.md` if it's missing. It never changes the
  workflows.

## The usual way: Dependabot

A few days after a release, Dependabot opens a pull request that moves both
pins. Its description has the release notes, whose fixed lines say what else
the upgrade needs: a new data format (run `migrate`), a new AGENTS.md block
or launcher (run `sync`), workflow changes, new action inputs.

The pull request's check runs the new release against this roadmap:

- **Green:** merge it; the next deploy runs the new release. A warning such
  as "AGENTS.md’s BoxOps block is 1; this BoxOps writes 2" means: run `sync`
  on the branch too.
- **Red, data format:** "This roadmap is in data format 1; BoxOps 0.2.0 reads
  format 2". On the pull request's branch:

  ```sh
  gh pr checkout <number>                  # the launcher now runs the new release
  node .boxops/boxops.mjs migrate
  node .boxops/boxops.mjs sync             # if the notes say the block or launcher changed
  node .boxops/boxops.mjs validate
  git add roadmap AGENTS.md CLAUDE.md .boxops
  git commit -m "Upgrade BoxOps to 0.2.0: data format 2"
  git push
  ```

If a migration is forgotten, the deploy's data format check fails, the old
site stays live, and the run says what to do. Saves made in the app while a
migration's pull request is open: if they conflict, update the branch and run
`migrate` again (it changes only what still needs it).

## Security releases

Dependabot raises no alerts for actions pinned by commit, so each deploy looks
up BoxOps' releases itself. When a newer release's title starts with
"Security:", the deploy warns, and the site shows everyone a notice until it's
upgraded. Upgrade straight away: merge Dependabot's pull request, or run
`node .boxops/boxops.mjs upgrade` and push the result. A release titled
"Withdrawn: …" shouldn't be used; the deploy says so too.

## Going back

Revert the upgrade's merge: the pin and any migration together. Reverting
only the pin leaves data in a format the older release refuses, so its
deploy stops (and the site stays as it was) rather than misreading it.
There are no downgrade migrations.

## Path B: without third-party actions

An organization that allows only GitHub's own actions runs the release with
git and Node.js instead of `uses:`: in both workflows, `actions/setup-node`
and a step that fetches the pinned commit with git, checks it's that
commit, and runs its `dist/action.mjs` (with `--mode check` in `check.yml`).
The starter's README shows the step; BoxOps' `templates/path-b/` has both
workflows whole. Its pin is a line like
`BOXOPS_ACTION: Allenfp/BoxOps@<sha> # vX.Y.Z`, which the launcher, `doctor`
and the deploy's checks read as they read `uses:`. Dependabot can't move it,
so upgrade with `node .boxops/boxops.mjs upgrade`, which rewrites it like
any pin (Dependabot still proposes upgrades of GitHub's own actions).

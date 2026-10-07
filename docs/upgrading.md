# Upgrading BoxOps

A roadmap repository runs one BoxOps release: the commit named on the
`uses: Allenfp/BoxOps@<commit SHA> # vX.Y.Z` lines of its two workflows,
`.github/workflows/deploy.yml` and `check.yml` (**the pin**). The site, the
pull-request check and `node .boxops/boxops.mjs` (the launcher, which reads
the pin in `deploy.yml`) all run that release, so upgrading is moving the
pin, and sometimes doing what the new release asks: migrating the data or
refreshing two files BoxOps manages. A repository admin does it, since the
push ruleset ([adopting.md](adopting.md#4-rulesets)) keeps `.github/`,
`.boxops/` and `AGENTS.md` to admins and Dependabot; an AI assistant can do
the steps when asked.

What's in a release, and how one is made and checked: [security.md](security.md).

## Versions

- Releases are `vX.Y.Z`. A **patch** release (0.1.1) fixes things and never
  changes the data format, the workflows, the Pages guard or the action's
  outputs (it may add an optional input). A **minor** release (0.2.0) may
  change those, the data format by one step with a migration. The rules in
  full: [data-format.md](data-format.md#versions-and-what-may-change).
- Release candidates, `vX.Y.Z-rc.N`, are GitHub prereleases: Dependabot
  never offers one to a repository on a release.
- There are no moving tags such as `v0` or `v0.1`: a pin is always a
  commit, and each release is published once and never changed.

Every release's notes (on its GitHub release, and in Dependabot's pull
request) open with the same lines, saying what upgrading to it asks:

| Line | What to do |
|---|---|
| `Security:` | `none`, or what it fixes: then upgrade straight away ([Security releases](#security-releases)). |
| `Data format:` | Unchanged, or the new number: then run `migrate` on the upgrade's branch ([Migrations](#migrations)). |
| `Workflow changes:` | `none`, or what to change in your workflows by hand (Dependabot changes only the pins). |
| `Action inputs and outputs:` | New, renamed or removed inputs of the BoxOps step. |
| `AGENTS.md block:`, `Launcher:` and `Guard:` | Unchanged, or new: then run `sync` (the block and the launcher), or replace the "Check the GitHub Pages settings" step with the new starter's (the guard). |
| `Node and runner:` | The Node.js the command-line tool needs, and the runners the release was tested on. |
| `Open tabs:` | Whether open tabs reload ([Tabs left open](#tabs-left-open)). |

## The usual way: Dependabot's pull request

`.github/dependabot.yml` has Dependabot check every day for a newer BoxOps
release, and propose one once it's been out 3 days (its cooldown):

1. Dependabot opens a pull request titled like this one:
   `Upgrade: bump Allenfp/BoxOps from 0.1.0 to 0.2.0`. It moves the pin,
   the commit and its `# vX.Y.Z` comment, in both workflows, and its
   description has the release notes. (Upgrades of GitHub's own actions come
   in a pull request of their own.)
2. **Check roadmap** (`check.yml`) runs the new release on the pull
   request's branch, against your roadmap:
   - **Green:** merge it. A warning on the check, such as "AGENTS.md's
     BoxOps block is 1; this BoxOps writes 2: run
     `node .boxops/boxops.mjs sync`", asks for `sync` on the branch first.
   - **Red, data format:** "This roadmap is in data format 1; BoxOps 0.2.0
     reads format 2. Run `node .boxops/boxops.mjs migrate`, commit and
     push." In a clone, with the GitHub CLI and Node.js 22.12 or later:

     ```sh
     gh pr checkout <number>
     git fetch origin && git merge --no-edit origin/main
     node .boxops/boxops.mjs migrate
     node .boxops/boxops.mjs sync
     node .boxops/boxops.mjs validate
     git add roadmap AGENTS.md CLAUDE.md .boxops
     git commit -m "Upgrade BoxOps to 0.2.0: data format 2"
     git push
     ```

     On the pull request's branch the launcher runs the new release (it
     reads that branch's pin, and downloads the release the first time).
     The merge brings in the saves made since the pull request was opened,
     so the migration takes them in too. `sync` changes nothing unless the
     notes say the block or launcher changed. The workflows need no edit:
     Dependabot's commit has them.
3. Merging changes `deploy.yml`, so the deploy runs the new release, and the
   site has it about a minute later. If a migration was forgotten, the
   deploy's data format check stops it, says what to run, and the site stays
   as it was.

## By hand: `upgrade`

`node .boxops/boxops.mjs upgrade [vX.Y.Z]` moves every pin (and its
comment) to that release, or to the latest when none is given; downloads
the new release's tool, checked against its `BUILD.json`; then runs the new
release's `migrate --check`, `sync` and `validate`, which warns of what
`sync` doesn't change, such as a new Pages guard (`doctor` shows the
change). It commits nothing. On a branch:

```sh
git switch -c upgrade-boxops
node .boxops/boxops.mjs upgrade v0.2.0
node .boxops/boxops.mjs migrate
git diff
git add .github .boxops AGENTS.md CLAUDE.md roadmap
git commit -m "Upgrade BoxOps to 0.2.0"
git push -u origin upgrade-boxops
```

(`migrate` only if `upgrade` said the data format changes.) Then open a pull
request, let **Check roadmap** pass, and merge. Use it:

- to take a security release now, rather than after Dependabot's 3 days;
- with **Path B** ([enterprise.md](enterprise.md#path-b-githubs-own-actions-only)),
  whose `BOXOPS_ACTION:` pin Dependabot can't move;
- for a release candidate (`upgrade v0.2.0-rc.1`), or a patch of an older
  minor (`upgrade v0.1.2`, say, to take a security fix without the newer
  minor's data format).

Pushing a change to `.github/workflows/` takes SSH, GitHub's web page, or a
token with the `workflow` scope (`gh auth refresh --scopes workflow` gives
the GitHub CLI's), and an admin, with the push ruleset. An organization that
allows actions by exact commit adds the new one first
([adopting.md](adopting.md#3-allow-the-actions)).

**Mirrors.** Copy the new release into your mirror first
([enterprise.md](enterprise.md#a-mirror-of-boxops)); Dependabot, given
access to it, then proposes it, or `upgrade` takes it.

`node .boxops/boxops.mjs version` says which release runs, and
`node .boxops/boxops.mjs doctor` checks the setup: Node.js, that every pin
names the same commit and that it's a tagged release of the pinned
repository, that the tool was signed by BoxOps' release workflow (with the
GitHub CLI installed), the launcher, guard and block numbers, the workflows'
permissions against the starter's, and retired runner labels.

## Security releases

Dependabot raises no security alerts for actions pinned by commit (GitHub
makes them only for actions pinned by version tag), so BoxOps tells you
itself:

- **Every deploy looks up BoxOps' releases.** The step "Look up BoxOps
  releases" (`gh api`, read-only, with the run's own token) lists them, and
  the BoxOps action compares them with its own version. A newer release
  whose title starts "Security:" gives the run a warning,
  "BoxOps v0.1.1 fixes a security problem (…); this run used v0.1.0: merge
  the BoxOps upgrade pull request, or run
  `node .boxops/boxops.mjs upgrade v0.1.1`", and the site shows everyone a
  notice, "BoxOps v0.1.1 fixes a security problem; this site runs v0.1.0.
  Ask a repository admin to merge the upgrade pull request." Any other newer
  release gives a quieter note: "BoxOps v0.2.0 is available; this site runs
  v0.1.0." If the lookup fails, the deploy goes on without notices.
- **Dependabot's pull request**, after its 3 days.
- **The release notes and advisories**, for those watching
  `Allenfp/BoxOps`'s releases ([adopting.md](adopting.md#7-make-it-yours))
  or its security advisories
  (https://github.com/Allenfp/BoxOps/security/advisories).

Take a security release at once: merge Dependabot's pull request if it's
there, or run `upgrade` as above. When the latest minor release raised the
data format, the fix also comes as a patch of the minor before it, so you
can take it without migrating (`upgrade v0.1.2`, say).

A release found to be bad is **withdrawn**, not deleted (a published release
can't change, and your pin names its commit): its title starts "Withdrawn:",
each deploy still running it warns, and the site says "This site runs
BoxOps v0.1.0, which was withdrawn. Ask a repository admin to upgrade it."
Upgrade to the release that fixes it.

With a mirror, keep `BOXOPS_UPSTREAM` (in `deploy.yml`'s lookup step) on
`Allenfp/BoxOps` if your runners can reach github.com: the notices come
from its GitHub releases, which a mirror of its commits doesn't have.

## Migrations

The data format is the whole number `format` in `roadmap/settings.yaml`
([data-format.md](data-format.md)). A minor release may raise it by one;
the release that does carries the migration, and every later release keeps
the whole chain, so a roadmap two formats behind is brought through both.

- `node .boxops/boxops.mjs migrate --check` says whether one is needed
  (exit 1 if so) and changes nothing. `migrate` edits the files in place,
  keeping comments, the order of keys and line ends, sets `format` last, and
  validates. Running it again changes nothing.
- Only `migrate` changes the data format, and only in a commit someone
  reviews: the deploy can't write to the repository, and the app opens a
  roadmap in any other format read-only.
- Saves made in the app while a migration's pull request is open are in the
  old format, and `migrate` runs only from the format `settings.yaml` states,
  which on the migrated branch is already the new one. So right before
  merging, if anyone has saved since the branch was migrated, take
  `roadmap/` from `main` again, saves and all, and migrate that:

  ```sh
  git fetch origin && git merge --no-edit origin/main
  git rm -rqf roadmap && git checkout origin/main -- roadmap
  node .boxops/boxops.mjs migrate
  git add roadmap && git commit -m "Migrate the saves made meanwhile"
  git push
  ```

  The second line also settles any conflict in `roadmap/` the merge
  stopped at (`main`'s side, which `migrate` then brings up). If `git
  commit` finds nothing to commit, nothing needed it. A save made in the
  minute before the merge stays in the old format: the deploy's annotations
  show any problem it causes, to fix by hand.

## Tabs left open

A browser tab can stay open across an upgrade, running the old release's app
against data the new one wrote. An outdated tab never saves:

| When | What an open tab does |
|---|---|
| The upgrade's merged, its deploy still running | If the data format changed, a save reads the newer `settings.yaml` from GitHub first and refuses to write: "BoxOps is being upgraded; reload in a minute". |
| Its next look at the site (every 2 minutes, and before each save) | It sees the new build and goes read-only: "BoxOps was updated to 0.2.0 — Reload to keep editing". Unsaved edits are kept. |
| Reload | It loads the new release (from an address the browser hasn't cached), and gets the unsaved edits back if the data format is the same. |
| Unsaved edits in an older data format | The new release can't open them: it offers them as a download (JSON), to make again by hand. |

A patch release changes nothing here but the build: the same banner, the
same reload.

## Going back

To undo an upgrade, revert its merge, the pin and any migration together,
and merge that (or push it, as an admin):

```sh
git switch -c undo-upgrade origin/main
git revert -m 1 <the upgrade's merge commit>
git push -u origin undo-upgrade
```

`-m 1` keeps `main`'s side of the merge (a squash merge is one plain
commit: `git revert <commit>`). There are no downgrade migrations:
reverting only the pin leaves data in a format the older release refuses,
so its deploy stops and the site stays as it was, rather than misread it.
Saves made since the upgrade may use what only the newer format allows: on
the revert's branch, `node .boxops/boxops.mjs validate` runs the older
release and says so. A release with a problem is usually better left for
the release that fixes it ([Security releases](#security-releases)).

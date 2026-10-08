# Releasing BoxOps

A BoxOps release is a commit on the `releases` branch of `Allenfp/BoxOps`,
tagged `vX.Y.Z`, that roadmap repositories pin by its SHA
(`uses: Allenfp/BoxOps@<sha> # vX.Y.Z`). Only the release workflow
(`.github/workflows/release.yml`) makes one, with a deploy key the
maintainer's approval unlocks. This page is how to set that up once, how to
release, and what to do when a release goes wrong.

## What a release is

- **The release commit.** Its tree is the release tree that
  `npm run release:build` builds (`web/scripts/release-tree.ts`) and nothing
  else: `action.yml`, `README.md`, `LICENSE`, `THIRD_PARTY_LICENSES.txt`,
  `BUILD.json`, `dist/action.mjs`, `dist/boxops.mjs` and `dist/app/**`. Every
  file is in `BUILD.json` with its SHA-256; there's no source, no
  `node_modules` and no workflow, and `action.yml` uses no other action
  (`npm run check:release-tree` checks all of this). Its message carries
  `Source-Commit:` (the commit of `main` it was built from) and `Run:` (the
  workflow run). `releases` is linear: the first release's commit has no
  parent, and each later one's parent is the release before.
- **The tag**, `vX.Y.Z`, or `vX.Y.Z-rc.N` for a release candidate, on that
  commit. No floating tags (`v0`, `v0.1`): roadmap repositories pin commits,
  and Dependabot proposes exact versions.
- **The GitHub release**, immutable once published (its tag and files; its
  title and notes stay editable), with notes from `CHANGELOG.md` and four
  files: `boxops-X.Y.Z.tar.gz` (the tree), `boxops.mjs` (the command-line
  tool, for setting up without the template), `SHA256SUMS` (every file of
  the tree) and `sbom.spdx.json`, the SBOM (SPDX) of the packages the app
  and the tool bundle, each at its version, and of BoxOps itself at the
  release's: npm's, cut down to the production packages `npm ls --omit dev`
  lists (`npm sbom --omit dev` alone leaves out `yaml`, which a dev
  dependency names too), and checked against the release's licence files,
  which must name the same packages. It isn't in the tree, since an SPDX
  document carries a time and a random id. A release candidate is a
  prerelease.
- **Attestations**, signed by the release workflow: provenance for every
  file of the tree and for the tarball, and the SBOM's, for the tarball.
  Check a file with
  `gh attestation verify <file> -R Allenfp/BoxOps --signer-workflow Allenfp/BoxOps/.github/workflows/release.yml`.
  The signer workflow is what matters: a tag's existence, or
  `gh release verify` alone, says nothing about who published it.
- **That the tree is the commit's:** extract the tarball into an empty
  folder, run
  `git init -q && git -c core.autocrlf=false add --all --force . && git write-tree`
  there, and compare with `git rev-parse <release commit>^{tree}`.

How it's built so that a release ships what was tested: CI (`ci.yml`) builds
the release tree, checks it, and runs the browser tests on its app and its
tool, the smoke tests on its action (three runners) and the starter's dry
run on all of it, each test job checking the tree it downloads against the
release tree job's outputs first. The release workflow runs all of CI on the
commit it releases, builds the tree a second time in a job of its own (a
fresh install, no cache), and publishes only if git's tree id of what CI
tested, of the second build, and of the files it's about to commit are one.
Two builds of a commit are the same byte for byte, which a unit test checks
on every change (`web/scripts/release-tree.test.ts`).

## The release workflow

Actions → Release → Run workflow, from `main`, with the version and, to be
sure it releases what was reviewed, `commit`: the commit of `main` the
release pull request made (or its first 7 hex digits or more). A run
releases `main` as it is when it starts, whatever was merged since the
review. Its jobs:

1. **preflight**: the run is on `main`, at `commit` when it's given (it
   stops if `main` has moved on); the version is `X.Y.Z` or
   `X.Y.Z-rc.N`; `web/package.json` says `X.Y.Z`; `CHANGELOG.md` is in form
   and its top section is `X.Y.Z`'s, with no Unreleased section above it
   (`web/scripts/check-changelog.mjs --release`): that section becomes the
   notes, so they cover all the release ships; the tag isn't there yet;
   and, for `X.Y.Z` (a release candidate may go without), `SECURITY.md` and
   `docs/security.md` name the security contact, not its placeholder
   ([one-off step 7](#before-the-first-release)).
2. **verify**: all of `ci.yml` on this commit, the release tree built as
   this version, and the numbers in `X.Y.Z`'s section (data format,
   AGENTS.md block, launcher, guard) checked against its `BUILD.json`.
3. **reproduce**: the release tree built again, apart.
4. **publish**, in the `release` environment, so it waits for the
   maintainer's approval (the run's page: Review deployments → `release` →
   Approve and deploy). Before approving, check the run is for the commit
   reviewed: its page names the commit, and so does preflight's log
   ("Releasing BoxOps X.Y.Z from main@…"); without `commit`, anything merged
   since the review would ship too. It runs nothing from this repository,
   only git, jq, tar, gh and GitHub's own actions: it downloads the
   tested tree, checks its tree id and its `SHA256SUMS` against what CI's
   release tree job and the rebuild gave as their jobs' outputs (no later
   job can change those, while any job of the run could replace an
   artifact), the SBOM against CI's, and every file against `SHA256SUMS`; it
   attests the files, then commits the tree to `releases` and tags it in one
   atomic push with the deploy key (so no tag is ever out without its
   attestations), and publishes the GitHub release with preflight's notes (a
   draft until its files are on it, then published, titled `BoxOps X.Y.Z`,
   or `Security: BoxOps X.Y.Z` when the changelog's `Security:` line isn't
   `none`; GitHub's latest release only if no published release, but a
   withdrawn one, is of a later version).

A run takes about as long as CI, most of it the browser tests, and then
waits for the approval, for 30 days at most (GitHub's limit: then the run
fails, and nothing is out). What publish downloads, the tested tree and the
notes, is kept 35 days, the longest a run can last, so it's there whenever
the approval comes.

If publish fails before its push (attesting, say), nothing is out: run it
again, or the whole workflow. If it fails after (making the GitHub
release), the tag is there and preflight would refuse a new run: run
publish again instead, within 30 days of the run's start (GitHub's limit
for re-running a job; its artifacts last 35), from the run's page, Re-run
jobs → Re-run failed jobs (not all jobs), and approve it again. It attests
the files again (which does no harm), finds the tag on this run's commit of
the tested tree and goes on from there; a draft release the failed attempt
left is deleted and made again. A published release of the tag is taken as
done only if it's this run's: the workflow's (`github-actions[bot]`),
naming this run, with this run's files and no other. Anyone who can push
here can make a release of a tag that's there, and a published release
can't be replaced, so any other fails the run: withdraw it and release the
next version ([A bad release](#a-bad-release)).

## One-off settings

The release workflow can't publish until these exist. All but the last can
be set before the cutover: they don't touch `main`, so the demo keeps
saving there. `gh` needs a token with admin rights on the repository for
them; use it for this and nothing else.

### Before the first release

1. **Immutable releases.** Settings → General → Releases: Enable release
   immutability. Or `gh api -X PUT repos/Allenfp/BoxOps/immutable-releases`;
   `gh api repos/Allenfp/BoxOps/immutable-releases` answers 200 when it's on.
   A published release's tag can't then move, its files are locked, and
   GitHub adds a release attestation.
2. **The release deploy key**, with write access: the only deploy key on
   the repository, since the rulesets' bypass entry is "Deploy keys", every
   one of them. Make it on a machine you trust, and keep the private half
   only until it's the environment's secret (step 3) and the bypass is
   checked (below):

   ```sh
   ssh-keygen -t ed25519 -N "" -C boxops-release -f boxops-release
   gh repo deploy-key add boxops-release.pub -R Allenfp/BoxOps --title boxops-release --allow-write
   gh repo deploy-key list -R Allenfp/BoxOps    # just the one
   ```

   (Settings → Deploy keys → Add deploy key, with "Allow write access".)
3. **The `release` environment**: Settings → Environments → New environment,
   `release`.
   - Deployment protection rules: Required reviewers, Allenfp. Leave
     "Prevent self-review" off (the one maintainer approves their own run),
     and turn "Allow administrators to bypass configured protection rules"
     off.
   - Deployment branches and tags: Selected branches and tags, and add the
     branch `main`.
   - Environment secrets: `RELEASE_DEPLOY_KEY`, the private key file's whole
     text.

   Or, but for the administrators' bypass, which only the page sets:

   ```sh
   gh api -X PUT repos/Allenfp/BoxOps/environments/release --input - <<'EOF'
   {"prevent_self_review": false,
    "reviewers": [{"type": "User", "id": 29790605}],
    "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
   EOF
   gh api -X POST repos/Allenfp/BoxOps/environments/release/deployment-branch-policies -f name=main -f type=branch
   gh secret set RELEASE_DEPLOY_KEY --env release -R Allenfp/BoxOps < boxops-release
   ```

   (29790605 is Allenfp's user id: `gh api users/Allenfp --jq .id`.)
4. **The rulesets `releases` and `tags`**, whose only bypass is "Deploy
   keys", and no admin bypass. Settings → Rulesets (Rules → Rulesets in
   GitHub's older layout):
   - New branch ruleset `releases`: Enforcement Active; Bypass list: Add
     bypass → Deploy keys; Target branches: Include by pattern, `releases`;
     Restrict creations, Restrict updates, Restrict deletions, Require
     linear history, Block force pushes.
   - New tag ruleset `tags`: Enforcement Active; Bypass list: Deploy keys;
     Target tags: Include all tags (Dependabot offers any version-like tag,
     not only `v*`); Restrict creations, Restrict updates, Restrict
     deletions.

   Or:

   ```sh
   gh api -X POST repos/Allenfp/BoxOps/rulesets --input - <<'EOF'
   {"name": "releases", "target": "branch", "enforcement": "active",
    "bypass_actors": [{"actor_id": null, "actor_type": "DeployKey", "bypass_mode": "always"}],
    "conditions": {"ref_name": {"include": ["refs/heads/releases"], "exclude": []}},
    "rules": [{"type": "creation"},
              {"type": "update"},
              {"type": "deletion"}, {"type": "required_linear_history"}, {"type": "non_fast_forward"}]}
   EOF
   gh api -X POST repos/Allenfp/BoxOps/rulesets --input - <<'EOF'
   {"name": "tags", "target": "tag", "enforcement": "active",
    "bypass_actors": [{"actor_id": null, "actor_type": "DeployKey", "bypass_mode": "always"}],
    "conditions": {"ref_name": {"include": ["~ALL"], "exclude": []}},
    "rules": [{"type": "creation"},
              {"type": "update"},
              {"type": "deletion"}]}
   EOF
   ```

5. **Private vulnerability reporting, secret scanning (with push
   protection) and Dependabot alerts.** Settings → Advanced Security: turn
   each on. Or:

   ```sh
   gh api -X PUT repos/Allenfp/BoxOps/private-vulnerability-reporting
   gh api -X PATCH repos/Allenfp/BoxOps --input - <<'EOF'
   {"security_and_analysis": {"secret_scanning": {"status": "enabled"},
                              "secret_scanning_push_protection": {"status": "enabled"}}}
   EOF
   gh api -X PUT repos/Allenfp/BoxOps/vulnerability-alerts
   ```

6. **Check the deploy key's bypass** (below), then delete the private key's
   file: `rm boxops-release boxops-release.pub`. The environment's secret is
   the only copy; a lost key is replaced by making a new one (steps 2 and 3)
   and deleting the old.
7. **The security contact address**, which 0.1.0 waits for: not a setting,
   but `SECURITY.md` and `docs/security.md` hold a placeholder,
   `<SECURITY_CONTACT>`, where those who can't report through GitHub (a
   managed user with no personal account, say) are told where to write.
   Choose the address, and put it in both in the release pull request:
   `git grep -n SECURITY_CONTACT -- SECURITY.md docs/security.md` must then
   find nothing. Until then, the release workflow's preflight refuses
   `X.Y.Z`, though not a release candidate.

### At the cutover

Once the demo saves to `Allenfp/boxops-demo` (`cutover/README.md`), nothing
writes to `main` here but merged pull requests, so it gets its ruleset too:

8. **The ruleset `main`**: New branch ruleset `main`; Enforcement Active;
   no bypass at all; Target branches: Include default branch; Restrict
   deletions, Block force pushes, Require a pull request before merging (0
   approvals), Require status checks to pass: CI's jobs `test`,
   `release tree`, `browser tests`, `smoke (ubuntu-24.04)`,
   `smoke (ubuntu-24.04-arm)`, `smoke (ubuntu-26.04)` and `workflows`, each
   with GitHub Actions as its source, so that no commit status or other
   app's check of the same name stands in for CI's (setting a status takes
   only push access). Or:

   ```sh
   gh api -X POST repos/Allenfp/BoxOps/rulesets --input - <<'EOF'
   {"name": "main", "target": "branch", "enforcement": "active", "bypass_actors": [],
    "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
    "rules": [{"type": "deletion"}, {"type": "non_fast_forward"},
              {"type": "pull_request", "parameters": {"required_approving_review_count": 0,
                "dismiss_stale_reviews_on_push": false, "require_code_owner_review": false,
                "require_last_push_approval": false, "required_review_thread_resolution": false}},
              {"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": false,
                "required_status_checks": [
                  {"context": "test", "integration_id": 15368},
                  {"context": "release tree", "integration_id": 15368},
                  {"context": "browser tests", "integration_id": 15368},
                  {"context": "smoke (ubuntu-24.04)", "integration_id": 15368},
                  {"context": "smoke (ubuntu-24.04-arm)", "integration_id": 15368},
                  {"context": "smoke (ubuntu-26.04)", "integration_id": 15368},
                  {"context": "workflows", "integration_id": 15368}]}}]}
   EOF
   ```

   (15368 is GitHub Actions' app id: `gh api apps/github-actions --jq .id`.)

   The cutover's `ci.yml` checks every pull request, so these are the pull
   request's own runs.

### Checking the deploy key's bypass

The design rests on this: only the deploy key, never the maintainer's
session or tokens, can make a release commit or a tag, so neither can a
token pasted into a browser or a stolen one.

- **Tried on 2026-10-06**, on a scratch repository owned by Allenfp: a tag
  ruleset (all tags; creations, updates and deletions restricted) with only
  "Deploy keys" on its bypass list refused the owner's own tag push over SSH
  (`GH013: Repository rule violations found`), and let a deploy key with
  write access create a tag and delete it.
- **Still to check**, on `Allenfp/BoxOps` once its rulesets are on, before
  the first release (from a clone, with the key's file from step 2):

  ```sh
  sha=$(git rev-parse origin/main)
  git push origin "$sha:refs/tags/bypass-check"                  # refused: GH013
  git push origin "$sha:refs/heads/releases"                     # refused: GH013
  gh api -X POST repos/Allenfp/BoxOps/git/refs -f ref=refs/tags/bypass-check -f sha="$sha"   # refused?
  GIT_SSH_COMMAND="ssh -i boxops-release -o IdentitiesOnly=yes" git push git@github.com:Allenfp/BoxOps.git "$sha:refs/tags/bypass-check"
  GIT_SSH_COMMAND="ssh -i boxops-release -o IdentitiesOnly=yes" git push git@github.com:Allenfp/BoxOps.git :refs/tags/bypass-check
  ```

  The first two must be refused, and the last two (the key) must work. The
  third is the one not yet tried anywhere: the owner making a tag through
  the REST API. Try making a release with a new tag on the web page too
  (Releases → Draft a new release → a new tag, `bypass-check-web`, never a
  version, "Create new tag on publish"): it must be refused when published.
  Delete the draft. If it's published instead, delete that release at once
  (`gh release delete bypass-check-web -R Allenfp/BoxOps --yes`): until
  then it's GitHub's latest release, which CI's weekly run tests (and
  fails on, since its commit is `main`'s, not a release's). Leave its tag:
  as for any immutable release's, the name can't be used again even once
  the tag is gone, and a tag that isn't a version breaks nothing
  (Dependabot, `upgrade` and the deploys' lookup look only at versions).

  Whatever one of these makes, though it shouldn't, delete at once:
  `git push origin :refs/heads/releases` and
  `git push origin :refs/tags/bypass-check`. The `releases` branch above
  all: publish makes the first release's commit a child of whatever
  `releases` is on, which would put `main`'s history into every release (it
  stops instead when that isn't a release commit, until the branch is
  deleted).
- **If the owner can make a tag** any of these ways, the rulesets don't hold
  for the owner, and releases move before 0.1.0 (the repository a roadmap
  pins can't change after): to a repository of their own, such as
  `Allenfp/boxops-action`, public, written to only by the release workflow
  with its deploy key, its own `releases` and `tags` rulesets, and no other
  work there, so no day-to-day token needs access to it. `release.yml` then
  pushes there (`remote` and `gh release create -R`), adopters pin
  `Allenfp/boxops-action@<sha>`, and `UPSTREAM` in `web/cli/release.ts`, the
  starter's pins and the docs follow. An organization, where a GitHub App
  can be the bypass actor and the maintainer's account need not be an
  owner, is the other way out. (`docs/decisions.md`, release identity.)

## Each release

About 30 to 45 minutes of attention, most of it waiting for CI.

1. **The release pull request.** `web/package.json`'s version becomes
   `X.Y.Z` (a release candidate has its version's: `0.2.0` for
   `0.2.0-rc.1`). `CHANGELOG.md`'s Unreleased section becomes
   `## X.Y.Z — YYYY-MM-DD` with its fixed lines filled in (below; its date
   moves to the final release's day in that release's own pull request).
   What's merged after it, until `X.Y.Z` is out (between a release
   candidate and the release, say), goes in that section, not in a new
   Unreleased one: the release workflow won't release `X.Y.Z` with an
   Unreleased section above it. CI must be green, the browser tests and
   the smoke runs included. Click through `allenfp.github.io/BoxOps/next/`
   in Safari (before the cutover, the demo). Merge.
2. **A data format change (a minor release) goes out as a release candidate
   first**: Actions → Release → Run workflow, from `main`, version
   `X.Y.Z-rc.1`, `commit` the release pull request's commit on `main`. When
   preflight, verify and reproduce have passed, and the run is for that
   commit, approve the `release` environment; publish makes a prerelease.
3. **The canary.** In the private GHEC canary repository,
   `node .boxops/boxops.mjs upgrade vX.Y.Z-rc.1` (Dependabot never offers a
   prerelease to a repository on a release), push a branch, open a pull
   request, and work through the canary checklist (below).
4. **The release**: Run workflow with `X.Y.Z` and, as `commit`, the commit
   of `main` reviewed for it; check the run is for it, and approve.
5. **Dogfood it, without waiting for Dependabot's cooldown:**
   - `Allenfp/boxops-demo`: `node .boxops/boxops.mjs upgrade vX.Y.Z` on a
     branch, a pull request, green, merge; then check the deploy and a save.
   - `Allenfp/boxops-starter`: `npm run publish-starter -- --tag vX.Y.Z
     --commit <release commit> --out <folder>` (from `web/`, after
     `git fetch origin main releases --tags`) writes it and prints the
     commands that publish it, which commit as Allenfp's GitHub no-reply
     address and push nothing made as another (a public repository's
     history is public); its own deploy runs.
   - The GHEC canary: upgrade to the release.

Patch releases skip the release candidate unless they change something the
canary checks.

## The changelog

`CHANGELOG.md` holds one section per version, newest first, under
`# Changelog` (and an `## Unreleased` section on top while there are
unreleased changes, but not above a version about to be released). A
version's section is its GitHub release's notes, as a roadmap repository's
admin sees them in Dependabot's upgrade pull request, so it opens with the
same lines, in this order, each saying something
(`web/scripts/check-changelog.mjs` checks the form; CI runs it):

```
## 0.2.0 — 2026-11-02

- Security: none
- Data format: 2 (was 1): run `node .boxops/boxops.mjs migrate` on the upgrade pull request's branch
- Workflow changes: none
- Action inputs and outputs: added `summary-limit` (optional)
- AGENTS.md block: 2 (was 1): run `node .boxops/boxops.mjs sync`
- Launcher: 1 (unchanged) · Guard: 1 (unchanged)
- Node and runner: Node.js 22.12 or later locally; tested on ubuntu-24.04, ubuntu-24.04-arm and ubuntu-26.04
- Open tabs: will reload

### Changes

- …
```

- `Security:` is `none`, or one line saying what the release fixes; then the
  release's title starts `Security:`, and every deploy still on an older
  release warns, in its run and in the app.
- The data format, AGENTS.md block, launcher and guard lines start with the
  release's number (`BUILD.json`'s `format`, `agentsBlock`, `launcher`,
  `guard`), then say whether it changed and what to do if it did;
  `check-changelog.mjs --build-json` compares them with a build's, and CI
  runs it on the release tree it builds (in a release's run, with
  `--release`: the released version's own section), so a release's notes
  give its numbers.
- The heading's dash is an em dash with a space each side, and the date is
  `YYYY-MM-DD`.

## Security releases

1. Fix it on a branch and in a private fork from the advisory
   (Security → Advisories → New draft advisory → Start a temporary private
   fork) when the problem isn't public yet.
2. The changelog's `Security:` line says what it fixes, in one line; the
   release's title becomes `Security: BoxOps X.Y.Z`.
3. Release it as above; publish the advisory (GHSA) on `Allenfp/BoxOps`,
   naming the fixed version.
4. If the latest minor release raised the data format, release a patch on
   the previous minor too, so nobody has to migrate to get the fix: from a
   `release/0.N` branch made from that minor's source commit, with the same
   workflow. The `release` environment then allows `release/*` branches as
   well as `main` (add the pattern, and remove it after), and preflight's
   check that the run is on `main` is relaxed for that run's branch in the
   same change. The patch isn't GitHub's latest release: the workflow marks
   a release so only if no published release (but a withdrawn one) is of a
   later version.

   Release the patch after the latest minor's fix, never before. A deploy
   compares the dates the releases lookup lists: it takes a newer minor's
   security release published before the release it runs to be one that
   release carries, and doesn't warn of it; one published after, it warns
   of. In the patch, also add the latest minor's fixed tag to
   `FIXES_INCLUDED` in `web/cli/notices.ts`, which tells a deploy the same
   when its lookup gives no dates (a workflow edited by hand, say) or the
   patch went out first. Every later patch of that minor must carry those
   fixes too, and keep the list: by its date, a deploy takes it to.

Roadmap repositories learn of it four ways: every deploy's annotations, the
banner in their app, Dependabot's pull request (after its 3-day cooldown),
and the advisory and release notes for those watching the repository.

## A bad release

A published release's tag and files can't change, and deleting the release
would only hide it: roadmap repositories pin its commit, its tag name can't
be used again (GitHub keeps it for immutable releases), and the title below
needs the release. Instead:

1. Edit its title to `Withdrawn: BoxOps X.Y.Z` (titles stay editable).
   Every deploy still running it then warns, in its run and in the app; no
   deploy offers it any more, and `upgrade` won't move to it.
2. Mark the good release before it as the latest (its **Edit** page, "Set
   as the latest release"; `gh release edit vX.Y.W --latest`), so GitHub's
   "latest" (the releases page, and CI's weekly test of the latest release)
   isn't the withdrawn one until the fix is out.
3. Release `X.Y.Z+1` with the fix, its notes saying what was wrong; it
   becomes the latest.
4. If it's a security problem, as above.

Never delete a tag or force `releases` back: the rulesets refuse it, and
roadmap repositories pin the commit.

## Checked live

What has been tried on GitHub itself rather than against the tests'
stand-ins. On 2026-10-06, by the maintainer, in a private scratch
repository, saving from the app with a fine-grained token (one
`createCommitOnBranch` call):

- **Saves are signed.** GraphQL gave the commit's signature as valid and
  GitHub's own (`isValid`, `wasSignedByGitHub`), and the REST API its
  verification as `valid`; its committer is `GitHub <noreply@github.com>`.
  GitHub shows such a commit as Verified.
- **The author's email follows the saver's setting.** With Settings →
  Emails → "Keep my email addresses private" off, saves were authored with
  the account's primary email; once it was on, with
  `<id>+<login>@users.noreply.github.com`. So editors turn it on before
  their first save ([adopting.md](adopting.md#editors)).
- **A save on a head that has moved on is refused** with HTTP 200 and these
  `errors`, two spaces before "Pull" and all, which the app and
  `web/e2e/fake-github.ts` expect:

  ```json
  [{"type": "STALE_DATA", "message": "Expected branch to point to \"<sha>\" but it did not.  Pull and try again."}]
  ```

- **What's written is what was sent:** the message exactly, curly quotes
  and dashes included; deleting a folder's last file removed the folder;
  and the branch, read right after the save, showed the new commit.
- **A tag ruleset whose only bypass is "Deploy keys"** refused the owner's
  own tag push over SSH (`GH013`), and let a deploy key create and delete
  tags ([Checking the deploy key's bypass](#checking-the-deploy-keys-bypass)).

Not tried yet: whether a *Require signed commits* ruleset lets the app's
saves through (it should, as GitHub verifies them), and whether a push
ruleset's `*` matches a name that starts with `.` (the canary checklist
below has both); and whether the owner can still make a tag through the
REST API or the web page's release form (the deploy key's bypass check,
before the first release).

## The canary checklist

For each release candidate, in a private repository made from the starter in
a GitHub Enterprise Cloud organization with private Pages:

- The first run's guard message ("GitHub Pages isn't set up"), then Pages
  set to GitHub Actions and Private, and the re-run publishing.
- What the `github-pages` environment holds once Pages is set up, before
  anyone changes it: whether GitHub has already added a `main` rule under
  Deployment branches and tags
  ([adopting.md](adopting.md#3-let-only-main-deploy-then-deploy)'s step 3
  allows for either; say there which it is).
- With the site's visibility Public, the deploy refuses.
- The guard's other messages: 403 (no access), and 404 and 5xx where they
  can be had.
- `GET /pages` works with the deploy job's token.
- A fine-grained token's approval by the organization, and a save with it.
- A signed-commit ruleset, and a save from the app.
- The push ruleset ([adopting.md](adopting.md#4-rulesets): every path
  but the files a save writes, hidden ones too) refuses an editor's edits
  to a workflow, the launcher and `README.md`, and a new `.envrc`,
  `.claude/settings.json`, `.devcontainer/.env` or `roadmap/AGENTS.md`;
  and lets through the app's saves (settings, people, a department, a box,
  and a box deleted) and Dependabot.
- Once, a push ruleset that restricts `**/*` alone: whether it refuses a
  new `.envrc` and `.devcontainer/.env`. If it does, GitHub's `*` matches
  names that start with `.`, and adopting.md can say `**/*` is enough.
- Once, with the push ruleset off for it: whether an editor's fine-grained
  token (Contents alone) can commit a workflow file that's the same, path
  and contents, as one on another branch. GitHub documents that for the
  classic `workflow` scope; [security.md](security.md#the-chain-of-trust)
  takes it to hold for fine-grained tokens too.
- Reading newer saves by blob SHA, and `?ref=` previews, on the private
  repository.
- An open tab reloading across the upgrade.
- `node .boxops/boxops.mjs migrate` on an upgrade branch.
- The releases lookup step working from a private organization repository.
- Optional: `ubuntu-slim` as the runner.

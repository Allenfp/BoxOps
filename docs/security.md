# Security

How BoxOps keeps the code your site runs to the code BoxOps released, what
can still change it, how to check a release, and the risks that remain.
Setting a roadmap up is [adopting.md](adopting.md); policies and mirrors,
[enterprise.md](enterprise.md); how releases are made,
[releasing.md](releasing.md).

## Reporting a security problem

Privately, please, not in a public issue: on https://github.com/Allenfp/BoxOps,
the **Security** tab → **Advisories** → **Report a vulnerability** (GitHub's
private vulnerability reporting). A fix comes as a release whose title
starts "Security:", announced as [upgrading.md](upgrading.md#security-releases)
says, with an advisory on the repository once it's out.

## The chain of trust

What a roadmap repository's site runs, and what each link rests on:

1. **Its workflows**, `.github/workflows/deploy.yml` and `check.yml`. An
   editor's token can't change them (it has no Workflows permission), and
   the push ruleset keeps them, the launcher and `AGENTS.md` to repository
   admins and Dependabot ([adopting.md](adopting.md#4-rulesets)).
2. **The pin**: the commit SHA on their `uses: Allenfp/BoxOps@<commit SHA>`
   lines. A commit SHA names its whole tree, so a pin can't be moved the way
   a tag or branch can.
3. **The release commit** on the `releases` branch of `Allenfp/BoxOps`.
   Only BoxOps' release workflow makes one: after every test has passed on
   exactly the files it ships, and once the maintainer approves, it commits
   and tags them with a deploy key that no one else holds (below).
4. **Its files**: the built app (`dist/app/`), the engine and command-line
   tool (`dist/boxops.mjs`, not minified, so it can be read), the action's
   entry (`dist/action.mjs`) and `BUILD.json`, which gives every other
   file's SHA-256. No source, no `node_modules`, no workflow, no other
   action.
5. **GitHub runs `dist/action.mjs`** on the runner's Node.js 24, in a job
   that can only read the repository.

### Who can change the code your site runs

| Who | Can change the data? | Can change the code the site runs? | What stops it |
|---|---|---|---|
| A viewer | No | No | A private site opens only for people with read access. |
| An editor's token (Contents: write, this repository) | Yes | No | No Workflows permission; the push ruleset keeps `.boxops/` and `AGENTS.md` to admins; the action reads the roadmap from git's objects and refuses symlinks and submodules. |
| A writer as themselves (web page, git) | Yes | Only without the push ruleset | The push ruleset (its bypass: repository admins and Dependabot). |
| A repository admin, Dependabot | Through a pull request | Admins merge pin changes | Dependabot proposes released tags only, 3 days after they're out; the release notes are in its pull request; **Check roadmap** runs the new release first. |
| BoxOps' maintainer | No | Only for repositories that merge an upgrade | The `release` environment's approval, rulesets that let only the deploy key make release commits and tags, immutable releases, attestations. |
| Someone with the maintainer's admin session or a token with admin rights | No | They could lift the rulesets and the environment's rules | Lifting them leaves an entry in the audit log; roadmap repositories review upgrades and can check the signer ([Checking a release](#checking-a-release)). |
| A commit from a fork of BoxOps, seen through `Allenfp/BoxOps` | No | Only if someone pins it by hand | Dependabot proposes tags only, and only the deploy key makes tags; `doctor` checks that the pin is a tag of the pinned repository. |

**The release identity, as tried.** On 2026-10-06, on a scratch
repository owned by the same account, a tag ruleset (all tags; creations,
updates and deletions restricted) with only "Deploy keys" on its bypass list
refused the owner's own tag push over SSH (`GH013`), and let a deploy key
with write access create and delete tags. Not checked yet: whether it also
stops the owner making a tag through GitHub's REST API, or with the web
page's "Create new tag on publish". [releasing.md](releasing.md#checking-the-deploy-keys-bypass)
has the checks to make on `Allenfp/BoxOps` before its first release. If the
owner can make a tag any of these ways, releases move to a repository of
their own, written to only by the release workflow (such as
`Allenfp/boxops-action`), before 0.1.0, since the repository a roadmap pins
can't change after.

## How a release is made

- **Built where nothing can write.** CI builds the release's files in jobs
  that can only read the repository, checks them, and tests exactly those
  files: the browser tests on the app, the starter end to end, and the
  action on three runners (Ubuntu 24.04, its Arm build, and 26.04),
  including a workspace whose files try to run code, and with the network
  cut off.
- **Built twice, the same.** The release workflow runs all of CI on the
  commit, builds the files again in a job of its own (a fresh install, no
  cache), and publishes only if git's id for the tree is the same all three
  ways: CI's, the rebuild's, and the files it's about to commit.
- **Published by a job that runs none of BoxOps' code.** The publish job
  holds the deploy key and runs only git, curl, jq, tar, the GitHub CLI and
  GitHub's own actions. It waits for the maintainer's approval, then pushes
  the commit and its tag in one step.
- **Signed and fixed.** Every file of the release, and its tarball, get a
  provenance attestation (a signed statement of which workflow run built
  them, from which commit); the tarball an SBOM attestation (the packages
  inside, `sbom.spdx.json`) too. The GitHub release is immutable: its tag
  can't move and its files can't change.

### Checking a release

**Who built a file.** With the GitHub CLI:

```sh
gh attestation verify <file> -R Allenfp/BoxOps --signer-workflow Allenfp/BoxOps/.github/workflows/release.yml
```

`--signer-workflow` is what makes it mean something: it checks that BoxOps'
release workflow signed it. That a tag exists, that a commit is on a branch,
or that `gh release verify` passes, says nothing about who published it.
The `<file>` can be any file of the release: `boxops.mjs` or the tarball
from the release's page, or a file of the release commit, such as the tool
the launcher keeps in its cache (`node .boxops/boxops.mjs doctor` checks
that one when the GitHub CLI is installed). The SBOM's attestation is on the
tarball: add `--predicate-type https://spdx.dev/Document/v2.3`.

**That your pin is that release.** The tarball holds the release commit's
files; git's id for them must be the tree of the commit your workflows pin.
In an empty folder (for v0.1.0, and the commit on your `uses:` lines):

```sh
gh release download v0.1.0 -R Allenfp/BoxOps --pattern 'boxops-0.1.0.tar.gz'
gh attestation verify boxops-0.1.0.tar.gz -R Allenfp/BoxOps --signer-workflow Allenfp/BoxOps/.github/workflows/release.yml
mkdir tree && tar -xzf boxops-0.1.0.tar.gz -C tree
git -C tree init -q && git -C tree -c core.autocrlf=false add --all --force . && git -C tree write-tree
git init -q pin && git -C pin fetch -q --depth 1 https://github.com/Allenfp/BoxOps.git <pin> && git -C pin rev-parse 'FETCH_HEAD^{tree}'
```

The last two lines must print the same id. Then check that the pin is the
release's tag, not a commit of a fork (which GitHub also serves through
`Allenfp/BoxOps`): this must print your pin. (`doctor` checks that too.)

```sh
git ls-remote https://github.com/Allenfp/BoxOps.git refs/tags/v0.1.0
```

**Build it yourself.** Two builds of a commit are the same, byte for byte,
so anyone can rebuild a release and compare. The commit of `main` a release
was built from is its `BUILD.json`'s `source` (and the `Source-Commit:` line
of the release commit's message). With git, and the Node.js that commit's
`.nvmrc` names:

```sh
git clone -q https://github.com/Allenfp/BoxOps.git boxops-source && cd boxops-source
git checkout -q <source commit> && cd web
npm ci --ignore-scripts && npm run release:build -- --version 0.1.0
cat ../build/TREE
```

`../build/TREE` must be the pinned commit's tree, as above.

## Least privilege in a roadmap repository

Every workflow sets no permissions for the whole run, and each job asks for
what it needs:

| Workflow and job | Permissions | What runs |
|---|---|---|
| `deploy.yml`, Check and assemble | `contents: read` | `actions/checkout` (keeping no credentials), the releases lookup (`gh api`, read-only), BoxOps, `actions/upload-pages-artifact` |
| `deploy.yml`, Publish | `pages: write`, `id-token: write` | The Pages check (`bash`, `gh`, `jq`), `actions/deploy-pages` |
| `deploy.yml`, Roadmap problems | none | `echo` |
| `check.yml`, Check roadmap | `contents: read` | `actions/checkout`, BoxOps |

What that bounds, and what it doesn't: only a job's permissions limit an
action, since any step can read what its job holds (the job's token, and the
artifact service's token GitHub gives a JavaScript action). So BoxOps never
shares a job with a token that can publish the site or prove an identity
(`pages: write`, `id-token: write`), or with any secret. A release gone bad
could still publish whatever site it liked, and could poison caches that
other workflows in the same repository restore: keep the roadmap repository
free of workflows that restore caches. The starter's use none.

## The workspace and the data

- **The action starts no program but git**, hardened: plumbing commands
  only (`rev-parse`, `cat-file`, `ls-tree`), with the system's and user's
  configuration, hooks, filters, textconv, fsmonitor and pager off, and
  `GIT_*` variables dropped. It makes no network call and takes no token.
  Nothing in the workspace runs or counts as configuration:
  `package.json`, `.npmrc`, `vite.config.*`, `tsconfig.json`, `.env`. CI
  checks this on every change, with a workspace whose files would each leave
  a mark if they ran, and with the network cut off.
- **The roadmap is read from git's objects** at the commit being built, not
  from the checked-out files: plain files only (a symlink or submodule stops
  the build), within limits (20,000 files, 1 MiB each, 64 MiB in all), each
  checked against its blob SHA and read as strict UTF-8.
- **Data is untrusted, whichever way it comes.** The deploy validates the
  roadmap, but the app also reads newer saves straight from GitHub, so the
  app itself drops values it can't use, makes links only of `http:` and
  `https:` addresses, takes colours only as `#rrggbb`, shows every name and
  the title as text, and takes its icons and styles from its own files,
  never HTML, CSS or SVG from the data.
- **The Content-Security-Policy** lets the page run only its own scripts
  (and its two small inline ones, by hash), load only its own styles and
  images, and connect only to its own site, `api.github.com` and
  `raw.githubusercontent.com`. That bounds what roadmap data could do even
  if it got past the app; it can't bound a bad release's code, which brings
  its own policy.
- **Private repositories**: the site knows the repository is private and
  makes no calls to GitHub without a token.
- **The token** is kept in the browser tab's session storage, under a key
  for its repository, and sent only to `api.github.com`. It's forgotten when
  GitHub rejects it or the editor chooses **Forget token**, and never written
  into the repository or an address.
- **The launcher** keeps the tool it downloads in a cache outside the
  repository (a file committed into the repository can't become code that
  teammates' laptops run), and checks it against its release's `BUILD.json`
  at every run.

## Risks that remain

1. **A bad release that got through.** If a malicious release were
   approved and adopted, it would run on every adopting repository's site,
   where editors' tokens are. Pins by commit, Dependabot's 3-day wait, the
   notes in each upgrade's pull request, attestations, reproducible builds
   and an unminified tool make that harder to do and easier to catch; none
   of them prevents it.
2. **The action reads the private roadmap**, by design, on a runner that
   can reach the internet. The no-network test catches a release that
   starts calling out by mistake, not one that means to.
3. **The maintainer's account.** Their admin session, or a token with admin
   rights, could lift the rulesets that keep releases to the deploy key. No
   one is exempt from those rulesets, so lifting one shows in the audit log,
   and BoxOps' release instructions keep a token with admin rights for
   those settings alone ([releasing.md](releasing.md#one-off-settings)).
4. **The launcher is code in your repository.** Only the push ruleset keeps
   editors from changing it; without that ruleset, an editor could change
   what teammates' laptops run when they use `node .boxops/boxops.mjs` (not
   what the site runs). `node .boxops/boxops.mjs sync --check` and `doctor`
   compare it with the release's.
5. **Sites that share an origin.** Every public Pages site of one account,
   `<owner>.github.io/<repository>/`, is on the same origin, so their pages
   share browser storage: the scripts of any of them can read another's
   `localStorage` (BoxOps keeps preferences and unsaved drafts there) and,
   in the same tab, `sessionStorage`. BoxOps keeps each repository's token
   under a key of its own, but another site of the same owner, opened in the
   same tab afterwards, could still read it. A private site has a host of
   its own (`<random name>.pages.github.io`), and a custom domain is an
   origin of its own. On a public site: open the roadmap in a tab of its
   own, choose **Forget token** when you're done, and publish no site you
   don't trust under the same account. BoxOps' own demo is a public site
   like that, on `allenfp.github.io`: a token pasted there should reach the
   demo's repository alone.

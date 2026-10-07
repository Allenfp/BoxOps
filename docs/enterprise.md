# BoxOps in an enterprise

What BoxOps needs from an organization's policies on GitHub Enterprise
Cloud, and what to do under the strict ones: a reference for organization
owners and security reviewers. Setting up a roadmap step by step is
[adopting.md](adopting.md); what BoxOps' code can and can't do is
[security.md](security.md).

A roadmap repository runs BoxOps from a release pinned by commit
(`uses: Allenfp/BoxOps@<commit SHA> # vX.Y.Z`), a JavaScript action on the
runner's own Node.js 24 (`runs.using: node24`) that uses no other action,
starts no program but `git`, makes no network call and takes no token.
Nothing in the roadmap repository is built or installed.

## At a glance

| Policy or limit | What holds, or what to do |
|---|---|
| Allow list of actions | One entry for BoxOps, `Allenfp/BoxOps@*`, besides GitHub's own actions. A list of exact commits needs the nested `actions/upload-artifact` too ([Allow lists](#allow-lists-of-actions)). |
| Require actions pinned to a full-length commit SHA | Passes unchanged: every `uses:` in the starter's workflows is a commit, BoxOps' action has no nested `uses:`, and `actions/upload-pages-artifact` pins its nested action by commit. |
| Enterprise actions only | Mirror GitHub's actions and BoxOps into the enterprise; `actions/upload-pages-artifact`'s mirror needs one line changed ([Enterprise actions only](#enterprise-actions-only)). |
| A mirror of BoxOps | Its `releases` branch and `v*` tags, pushed to a repository of yours: the commits stay the same, so only `owner/repo` changes on the `uses:` lines ([A mirror of BoxOps](#a-mirror-of-boxops)). |
| GitHub's own actions only | Path B: BoxOps fetched by commit with git and run with Node.js ([Path B](#path-b-githubs-own-actions-only)). |
| npm, package proxies | Not involved: roadmap repositories have no `package.json`, and nothing installs packages, in CI or on laptops. |
| IP allow list | GitHub's standard runners can't be allow-listed: larger runners with static addresses, or self-hosted runners. Editors save from allowed networks ([IP allow lists](#ip-allow-lists)). |
| Self-hosted runners | Linux or macOS, runner v2.327.1 or later, git 2.18 or later, `bash`, `gh`, `jq`, and GNU tar (`gtar` on macOS) ([Self-hosted runners](#self-hosted-runners)). |
| Enterprise Managed Users | Sites are always private. `init` if a template outside the enterprise can't be used ([Enterprise Managed Users](#enterprise-managed-users)). |
| Rulesets | Rules a browser save can't meet need editors on the bypass list, or the repository excluded ([Rulesets](#rulesets)). |
| Token policies | Fine-grained tokens with Contents: Read and write; approval and lifetime limits work as GitHub documents ([Tokens](#tokens)). |
| Billing | About 2 minutes of GitHub-hosted runner time per save on a private repository ([Billing](#billing)). |
| Not supported | GitHub Enterprise Server, GHE.com, Windows runners ([Not supported](#not-supported)). |

## Allow lists of actions

Settings → Actions → General → **Policies** (an organization's; an
enterprise's are under Policies → Actions). With **Allow enterprise, and
select non-enterprise, actions and reusable workflows**:

- tick **Allow actions created by GitHub**, and add `Allenfp/BoxOps@*` (or
  your mirror, such as `acme/boxops@*`) under **Allow or block specified
  actions and reusable workflows**; or
- list every action by its commit. For the starter of BoxOps 0.1.0:

  ```
  actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
  actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9
  actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f
  actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346
  Allenfp/BoxOps@<the release commit your workflows pin>
  ```

  `actions/upload-pages-artifact` v5.0.0 is a composite action that runs
  `actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f`
  (v7.0.0) inside it, so that commit is on the list too. Path B adds
  `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (v7.0.0)
  and drops BoxOps. Each upgrade a Dependabot pull request proposes needs
  its new commits on the list before its check can run.

## Enterprise actions only

**Allow enterprise actions and reusable workflows** allows only actions in
the enterprise's own repositories: not even `actions/checkout`. Mirror each
action into a repository of the enterprise, keeping its commits, and point
the workflows' `uses:` lines at the mirrors (commit SHAs unchanged). With
`acme` for your organization, from a machine that can reach github.com and
push to it:

```sh
for a in checkout upload-artifact deploy-pages setup-node; do
  git clone -q --bare "https://github.com/actions/$a.git" "$a.git" &&
    git -C "$a.git" push --mirror "https://github.com/acme/$a.git"
done
```

(Create the empty, internal or private repositories `acme/checkout` and so
on first. `setup-node` is for Path B only.) For each private mirror,
Settings → Actions → General → **Access**: **Accessible from repositories
in the 'acme' organization** → **Save**; an internal one can be shared with
the whole enterprise the same way.

`actions/upload-pages-artifact` can't be mirrored unchanged: it names
`actions/upload-artifact` inside it, by commit, and the policy refuses that
nested action. Mirror it with that one line pointed at your mirror, which
makes a commit of your own:

```sh
git clone -q https://github.com/actions/upload-pages-artifact.git && cd upload-pages-artifact &&
  git switch -q -c acme-v5.0.0 v5.0.0 &&
  sed -i.orig 's#uses: actions/upload-artifact@#uses: acme/upload-artifact@#' action.yml && rm action.yml.orig &&
  git diff --stat && git commit -q -am "Use acme/upload-artifact, our mirror" &&
  git push "https://github.com/acme/upload-pages-artifact.git" acme-v5.0.0 &&
  git rev-parse HEAD
```

`git rev-parse HEAD` prints the commit to pin:
`uses: acme/upload-pages-artifact@<that commit> # v5.0.0`. Every other
mirror keeps GitHub's commits, so only the owner changes:
`uses: acme/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`.
This is GitHub's limitation for any composite action under this policy,
not BoxOps'. Dependabot can propose new versions of the mirrors once an
organization owner gives it access to them (Settings → Advanced Security →
Global settings → **Grant Dependabot access to private repositories**,
which takes internal ones too); the edited one, you remake by hand for
each version.

BoxOps itself: [a mirror](#a-mirror-of-boxops), or [Path B](#path-b-githubs-own-actions-only).

## A mirror of BoxOps

A mirror holds BoxOps' `releases` branch and its `v*` tags: the release
commits, byte for byte, so a pin's commit SHA is the same in it as in
`Allenfp/BoxOps`. Make it once, in an empty repository of yours whose name
has "boxops" in it (the launcher finds the pin by that), such as
`acme/boxops`:

```sh
git clone -q --bare --single-branch --branch releases https://github.com/Allenfp/BoxOps.git boxops-mirror.git &&
  git -C boxops-mirror.git push https://github.com/acme/boxops.git 'refs/heads/releases:refs/heads/releases' 'refs/tags/v*:refs/tags/v*'
```

Then, for each new release, from the same folder:

```sh
git -C boxops-mirror.git fetch -q https://github.com/Allenfp/BoxOps.git 'refs/heads/releases:refs/heads/releases' 'refs/tags/v*:refs/tags/v*' &&
  git -C boxops-mirror.git push https://github.com/acme/boxops.git 'refs/heads/releases:refs/heads/releases' 'refs/tags/v*:refs/tags/v*'
```

Neither forces anything: `releases` only ever moves forward, and a tag that
changed upstream (which a published release can't) would be refused, not
copied. Then:

- On the `uses:` lines, `Allenfp/BoxOps` becomes `acme/boxops`, with the
  same commit. `node .boxops/boxops.mjs upgrade` keeps the repository it
  finds there; give it the version (`upgrade v0.2.0`), since "the latest"
  is a GitHub release, which a mirror doesn't have.
- A private or internal mirror: Settings → Actions → General → **Access**,
  as above. The launcher on laptops downloads the tool from a private
  mirror through the API, with `GH_TOKEN`, `GITHUB_TOKEN` or the GitHub
  CLI's sign-in to github.com (`gh auth login`; it never takes gh's token
  for another host, such as your GitHub Enterprise Server).
- Dependabot follows the mirror's tags once it has access to it (above).
- Update and security notices come from `Allenfp/BoxOps`'s GitHub releases,
  which a mirror of its commits doesn't have: keep `BOXOPS_UPSTREAM` in
  `deploy.yml`'s lookup step on `Allenfp/BoxOps` if the runners can reach
  github.com's API. If they can't, the lookup fails quietly and there are no
  notices: watch the releases yourself
  (https://github.com/Allenfp/BoxOps/releases.atom).
- Check a mirrored release as any other ([security.md](security.md#checking-a-release)):
  its tree is the commit's, whichever repository holds it.

Don't copy BoxOps into the roadmap repository itself (into
`.github/actions/`, say): then anyone who can write to the repository could
change the code that builds its site.

## Path B: GitHub's own actions only

For an organization that allows GitHub's actions but no others, the
starter's workflows have a variant, Path B, in
[templates/path-b/](../templates/path-b/): the BoxOps step becomes
`actions/setup-node` and a step that fetches the pinned release with git
and runs its `dist/action.mjs` (the same file `uses:` runs) with Node.js:

```yaml
        env:
          BOXOPS_ACTION: Allenfp/BoxOps@<release commit SHA> # v0.1.0
```

- git checks every object it fetches against the commit, as `uses:` does,
  so the code is that release's, byte for byte.
- It fetches from github.com without a token, so `BOXOPS_ACTION` must name
  a public repository: `Allenfp/BoxOps`, or a public mirror.
- `actions/setup-node` is told to read nothing in the workspace:
  `package-manager-cache: false`, and `YARN_IGNORE_PATH=1` for the
  `yarn --version` it runs.
- Dependabot can't move the `BOXOPS_ACTION:` line; upgrade with
  `node .boxops/boxops.mjs upgrade` ([upgrading.md](upgrading.md)). The
  launcher, `doctor` and the action's own checks read the line as a pin.

The starter's `README.md` shows the step in full.

## IP allow lists

With an IP allow list (Settings → Authentication security → **IP allow
list**), or Enterprise Managed Users with a Conditional Access policy on
Entra ID, GitHub refuses every token, the workflows' `GITHUB_TOKEN`
included, from an address not on the list:

- **Runners.** GitHub's standard hosted runners can't be allow-listed:
  `actions/checkout` can't fetch the repository, and the deploy's "Check the
  GitHub Pages settings" step fails with "Couldn't read the Pages settings
  (HTTP 403)". Use larger runners with static IP address ranges, or Azure
  private networking (both always billed, even within included minutes), or
  [self-hosted runners](#self-hosted-runners); add their addresses to the
  list; and set `runs-on` to them in every job: `build`, `deploy` and
  `problems` in `deploy.yml`, `check` in `check.yml`.
- **Browsers.** The app sends an editor's token from their browser, to save
  and to check for newer saves, so editors work from allowed networks: the
  office, or a VPN. The app says "only allows GitHub access from approved
  networks" when it's refused.

## Self-hosted runners

- **Linux or macOS.** The action refuses Windows ("BoxOps 0.1 runs on Linux
  and macOS runners"); BoxOps is tested on `ubuntu-24.04`,
  `ubuntu-24.04-arm` and `ubuntu-26.04` (macOS is best effort). Container
  jobs (`container:`) aren't tested.
- **Runner v2.327.1 or later**, which runs `node24` actions: BoxOps' and
  GitHub's own. No Node.js needs installing for `uses:`; Path B's
  `actions/setup-node` downloads Node.js 24 (or finds it in the runner's
  tool cache).
- **git 2.18 or later**: without it, `actions/checkout` downloads a
  tarball without `.git`, and BoxOps, which reads the roadmap from git's
  objects, stops ("has no .git folder").
- **`bash`, `gh` (the GitHub CLI) and `jq`**: the deploy job's "Check the
  GitHub Pages settings" step uses them, and the releases lookup uses
  `gh` (without it, that optional step fails and there are no notices).
- **GNU tar**: `actions/upload-pages-artifact` packs the site with
  `tar --dereference --hard-dereference` on Linux, options BusyBox's tar
  (as on Alpine) and bsdtar don't have, and with `gtar` on macOS, which a
  Mac of your own has only once GNU tar is installed as `gtar` (Homebrew's
  `gnu-tar`). Without it, the deploy fails at that step, after the BoxOps
  step has passed, and nothing is published.
- **Network**: what GitHub lists for self-hosted runners in "Self-hosted
  runners reference": `github.com`, `api.github.com`,
  `*.actions.githubusercontent.com`, `codeload.github.com` (to download
  actions), and `results-receiver.actions.githubusercontent.com` with
  `*.blob.core.windows.net` (artifacts: the site travels from one job to the
  next as one). The BoxOps step itself makes no network call.
- Like any runner that runs a repository's workflows, keep it for trusted
  repositories: a self-hosted runner isn't wiped between jobs unless you
  make it ephemeral.

## Enterprise Managed Users

- **Pages sites are always private**, readable by enterprise members with
  read access to the repository; there's no visibility to set, and the
  deploy's check passes.
- **The starter as a template**: managed users can't interact with
  repositories outside the enterprise in most ways (push, fork, open issues,
  watch); if "Use this template" on `Allenfp/boxops-starter` doesn't work
  for them, a repository admin makes the same files with BoxOps' `init`
  ([adopting.md](adopting.md#1-create-the-repository)).
- **Watching BoxOps' releases**: a managed user can't watch
  `Allenfp/BoxOps`; its releases feed
  (https://github.com/Allenfp/BoxOps/releases.atom) works without an
  account, and each deploy warns of a security release anyway.
- **Repository collaborators** (managed users who aren't members of the
  roadmap's organization) can't use fine-grained tokens on it: they need a
  classic token with the `repo` scope, which needs no single sign-on
  authorization for that organization.
- With Entra ID and Conditional Access, every token use is checked against
  the policy's networks, as with an IP allow list.

## Rulesets

BoxOps saves straight to `main`, each save one commit made through GitHub's
API, authored by the editor (with the email their privacy setting gives),
committed by GitHub (`noreply@github.com`), and not a pull request. A ruleset
on `main`, the repository's or an organization's or enterprise's, refuses
every save if it:

- requires a pull request, status checks, a merge queue or successful
  deployments, or restricts updates;
- restricts commit metadata (message, author or committer email) to
  patterns those saves don't match (a committer email pattern must allow
  `noreply@github.com`);
- requires signed commits: GitHub signs a save's commit where it can, but
  that hasn't been checked live with a fine-grained token yet, so don't rely
  on it until it has;
- restricts file paths, extensions or sizes that roadmap files hit.

Exclude the roadmap repository from such a ruleset, or put a team all
editors are in (or the Write role) on its bypass list as **Always allow**
(or Exempt), not "For pull requests only". An organization's or
enterprise's ruleset takes teams, roles and apps on its bypass list, not
individual people. Dependabot needs to push its upgrade branch, which
changes `.github/workflows/`: put it on the bypass list of any push ruleset
that restricts those paths (the starter's own push ruleset does:
[adopting.md](adopting.md#4-rulesets)). Workflow execution protections
(Settings → Actions → Policies) must let editors trigger `push`, admins
`workflow_dispatch`, and `dependabot[bot]` `pull_request`.

## Tokens

Editors save with a fine-grained personal access token whose resource
owner is the organization, for the roadmap repository alone, with Contents:
Read and write (and the Metadata: Read GitHub adds). BoxOps never asks for
Workflows or Administration, and keeps the token in the browser tab's
session only. Under the organization's (or enterprise's) policies, Settings
→ Personal access tokens:

- **Approval** (the default): an owner approves each token under **Pending
  requests**; until then it reads public resources only, and the app says
  the token can't see the repository.
- **Maximum lifetime** (366 days by default): a token over it is refused;
  the app's link to make one leaves GitHub's default expiry, 30 days.
- **Classic tokens**: only outside and repository collaborators need them
  (with the `repo` scope; GitHub doesn't ask either kind to authorize a
  token for single sign-on with an organization they're only a
  collaborator in); restricting them keeps those people from saving.
- **Fine-grained tokens restricted**: editors need classic tokens (members
  authorize theirs for SAML single sign-on, if the organization uses it),
  which the app takes, saying they reach every repository their owner can
  write to.

## Billing

On a private repository, GitHub-hosted runner time counts against the
plan's included minutes (50,000 a month on GitHub Enterprise Cloud), each
job rounded up to a whole minute:

- **A save** deploys with two jobs, **Check and assemble** and **Publish**:
  about **2 minutes**, and a third, **Roadmap problems**, when the roadmap
  has problems. A burst of saves deploys at most twice (the run under way,
  then the newest).
- **A pull request's check**: about 1 minute.
- 1,000 saves a month is about 2,000 minutes: 4% of 50,000.

Public repositories are free on GitHub's standard runners; larger runners
are always billed; self-hosted runners use no Actions minutes. GitHub says
standard runners are free "for GitHub Pages" without saying whether a
workflow of your own like this one counts, so count it as billed. The site
travels between the jobs as an artifact, about 0.25 MB compressed for the
starter's sample roadmap (`roadmap.json` grows with the roadmap: about
310 KB compressed at 2,000 boxes), kept for 1 day.

## Not supported

- **GitHub Enterprise Server** and **GHE.com** (GitHub Enterprise Cloud
  with data residency): wherever the BoxOps step runs, it stops at once,
  saying "GitHub Enterprise Server and GHE.com aren't supported in BoxOps
  0.1 (this runs on …): use github.com", and the app talks only to
  `api.github.com`. On GHE.com, that's what a deploy says. On an Enterprise
  Server the step may never run: the starter's jobs ask for `ubuntu-24.04`,
  one of GitHub's hosted runners, which an Enterprise Server doesn't have,
  so they wait for a runner; and the actions they use come from github.com,
  which an Enterprise Server reaches only through GitHub Connect.
- **Windows runners**: refused. **Container jobs**: untested.

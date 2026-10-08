# Setting up BoxOps for your team

BoxOps is a team roadmap kept in a GitHub repository: small YAML files in a
`roadmap/` folder, shown as a swim-lane timeline, a table and a roster by a
web app on that repository's GitHub Pages site. Editors change the plan in
the browser and press **Save**: the change becomes a commit on the
repository's `main` branch, and the site shows it about a minute later.

This page sets BoxOps up for a team on **GitHub Enterprise Cloud** with a
**private** site, which only people who can read the repository can open.
Three people take part, in this order:

1. [The organization owner](#organization-owner), once for the organization.
2. [A repository admin](#repository-admin), once for each roadmap.
3. [Each editor](#editors), once, before their first save.

Elsewhere:

- A public repository, on any GitHub plan, makes a public site:
  [Public repositories](#public-repositories).
- Allow lists of actions, internal mirrors, IP allow lists, self-hosted
  runners and Enterprise Managed Users: [enterprise.md](enterprise.md).
- Keeping BoxOps up to date: [upgrading.md](upgrading.md). What can change
  the code your site runs, and how to check a release:
  [security.md](security.md).
- GitHub Enterprise Server and GHE.com (GitHub Enterprise Cloud with data
  residency, on `*.ghe.com`) aren't supported. On GHE.com the deploy stops
  with "GitHub Enterprise Server and GHE.com aren’t supported in BoxOps
  0.1". On GitHub Enterprise Server the starter's jobs usually never get
  that far: they ask for `ubuntu-24.04`, one of GitHub's hosted runners,
  which an Enterprise Server doesn't have, so they wait for a runner; and
  the actions they use come from github.com, which an Enterprise Server
  reaches only through GitHub Connect. Where they do run, on runners of
  your own, they stop with the same message.

## Words used here

- **Roadmap repository**: your team's repository. It holds the data
  (`roadmap/`), two workflows, a Dependabot file, a small launcher script
  (`.boxops/boxops.mjs`) and notes for AI assistants (`AGENTS.md`), but no
  app code. You make it from **the starter**, `Allenfp/boxops-starter`, a
  template repository.
- **Workflow**, **job**, **runner**, **action**: GitHub Actions runs a
  workflow (a YAML file in `.github/workflows/`) as jobs, each on a runner
  (a virtual machine GitHub provides, or one of yours); an action is a
  ready-made step a workflow uses.
- **BoxOps release**: a commit of `Allenfp/BoxOps` that holds the built
  app, BoxOps' command-line tool and its GitHub Action. Your two workflows
  name one release by its commit SHA (its 40-character id), on a line like
  `uses: Allenfp/BoxOps@<commit SHA> # v0.1.0`: **the pin**. Nothing else
  in your repository names a version but its `README.md`, whose copy of
  Path B's step, like its links to BoxOps' docs, is as of the release the
  repository was made with (no upgrade changes `README.md`).
- **GitHub Pages**: GitHub's hosting for static websites. A **private**
  Pages site, which GitHub Enterprise Cloud alone offers, opens only for
  people with read access to its repository, at an address of its own:
  `https://<random name>.pages.github.io/`.
- **GitHub Enterprise Cloud (GHEC)**: GitHub's enterprise plan on
  github.com. **Enterprise Managed Users (EMU)**: a way of running it in
  which your company's identity provider creates and manages the GitHub
  accounts (their usernames end in an underscore and a short code, like
  `sam_acme`).
- **Fine-grained personal access token**: a key a person makes on GitHub,
  limited to one owner's repositories and to the permissions it's given.
  BoxOps saves with one.
- **Ruleset**: rules GitHub enforces on a repository's branches, tags or
  pushes, such as "no force pushes". Its **bypass list** names who may skip
  them.
- **Dependabot**: GitHub's bot that opens pull requests to move what a
  repository uses to newer versions: here, the BoxOps pin.

## Before you add real people: privacy

> [!IMPORTANT]
> - **Everything in `roadmap/` is in the site.** Each deploy copies every
>   roadmap file into the site's `roadmap.json`: people's names, email
>   addresses, managers and notes, and every PTO entry with its note. Anyone
>   who can open the site can read all of it. A public site is open to
>   anyone on the internet; only a private site, on GitHub Enterprise Cloud,
>   limits it to people with read access to the repository. That's every
>   member of the organization when its base permission (Settings → Member
>   privileges → Base permissions) is Read or higher, and everyone in the
>   enterprise when the repository is internal.
> - **Each save is a commit by the person who saved, with their email
>   address.** Its author is their GitHub account: their name and their
>   primary email address, unless they've turned on **Keep my email
>   addresses private** (profile picture → Settings → Emails), which makes
>   it `<id>+<username>@users.noreply.github.com`. History keeps it, and
>   everyone who can read the repository can read its history (for a public
>   repository, everyone): have each editor turn that setting on before
>   their first save ([Editors](#editors)).
> - **PTO notes end up in commit messages, and history keeps them.** The
>   app writes each save's message from what changed. Booking PTO with a
>   note writes a line like this one:
>
>   ```
>   PTO for Sam Lee: 2026-11-02 – 2026-11-06 (medical appointment)
>   ```
>
>   Editing or deleting the note later leaves that commit as it was (taking
>   it out means rewriting the repository's history), and the site's
>   `roadmap.json` carries the latest commit's author and first line too.
>   Keep private reasons out of PTO notes.

## Organization owner

Once for the organization: its plan, and what it allows. Settings below are
the organization's (profile picture → Organizations → the organization →
Settings); an enterprise owner may have set some of them for every
organization in the enterprise (your enterprise → Policies), and then the
organization can't change them.

### 1. Check the plan and the accounts

- **Private Pages needs GitHub Enterprise Cloud.** On GitHub Team (and
  Pro), a private repository's site is public, and the deploy refuses to
  publish to it; on GitHub Free, a private repository can't have a Pages
  site at all. Use a public repository
  ([Public repositories](#public-repositories)), or GitHub Enterprise Cloud.
- **Enterprise Managed Users:** sites are always private (there's no
  visibility to choose), and making a repository from a template outside the
  enterprise may not be allowed: the repository admin then uses `init`
  instead ([step 1 below](#1-create-the-repository)).
- **GHE.com and GitHub Enterprise Server** aren't supported.
- **Seats:** every viewer needs read access to the repository, so each is an
  organization member or an outside collaborator, with a seat either way.

### 2. Allow private Pages sites

Settings → Member privileges → **Pages creation**: tick **Private** (and
untick **Public** if no site in the organization should be public), then
**Save**. Sites already published stay as they are.

### 3. Allow the actions

Settings → Actions → General → **Policies**. GitHub Actions must be on for
the roadmap repository (all repositories, or that one among those
selected). Then, whichever policy is set:

- **Allow all actions and reusable workflows**: nothing more to do.
- **Allow enterprise, and select non-enterprise, actions and reusable
  workflows**: tick **Allow actions created by GitHub**, add
  `Allenfp/BoxOps@*` to **Allow or block specified actions and reusable
  workflows** (or your mirror of it: [enterprise.md](enterprise.md)), and
  **Save**.
- **That policy, with exact commits instead of "Allow actions created by
  GitHub"**: list each action the starter's workflows run, at the commit
  they pin. For the starter as of BoxOps 0.1.0:

  ```
  actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
  actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9
  actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f
  actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346
  Allenfp/BoxOps@<the commit on the uses: lines>
  ```

  `actions/upload-artifact` is the step `actions/upload-pages-artifact`
  runs inside (v7.0.0, pinned there by commit). Each upgrade a Dependabot
  pull request proposes needs its new commits added: BoxOps' on every
  upgrade, GitHub's when their pins move.
- **Allow enterprise actions and reusable workflows** alone blocks even
  `actions/checkout`: mirror the actions into the enterprise, or allow
  GitHub's own and use Path B for BoxOps ([enterprise.md](enterprise.md)).

**Require actions to be pinned to a full-length commit SHA** needs nothing
from you: every `uses:` in the starter's workflows is a commit, BoxOps' action
uses no other action, and `actions/upload-pages-artifact` pins the one it
uses. A read-only default `GITHUB_TOKEN` (Settings → Actions → General →
Workflow permissions) is fine too: each job of BoxOps' workflows asks for
the permissions it needs, no more.

If the organization uses **workflow execution protections** (Settings →
Actions → Policies), they must let editors trigger `push` on `main` (a save
is a push by the editor who saved), repository admins `workflow_dispatch`,
and `dependabot[bot]` `pull_request` (its upgrade pull requests are checked
by `check.yml`).

### 4. Allow fine-grained personal access tokens

Settings → Personal access tokens → Settings → **Fine-grained tokens** tab:

- **Fine-grained personal access tokens**: allow access (the default).
- **Require approval of fine-grained personal access tokens**: **Require
  administrator approval** is the default. Keep it if you like; then an
  owner approves each editor's token under Settings → Personal access tokens
  → **Pending requests** (owners get a daily email of those waiting), and
  until then the token can't save.
- **Set maximum lifetimes for personal access tokens**: 366 days by default.
  Whatever you choose, tell editors the number: a token whose lifetime is
  over it is blocked.

On the **Tokens (classic)** tab: outside collaborators can't use
fine-grained tokens on an organization's repositories, only classic ones
(with the `repo` scope, which reaches every repository they can write to;
single sign-on doesn't apply to outside collaborators, so their tokens need
no authorizing for it). If you restrict classic tokens, outside
collaborators can view but not save; make editors members instead.

### 5. IP allow lists and runners

Only if Settings → Authentication security → **IP allow list** is enabled
(or, with Enterprise Managed Users on Entra ID, a Conditional Access policy
checks addresses):

- GitHub's standard hosted runners can't reach the organization's
  repositories, so the workflows fail at their first step:
  `actions/checkout` can't fetch the repository ("… has an IP allow list
  enabled, and your IP address is not permitted to access this resource"),
  and nothing after it runs. Use larger runners with static IP address
  ranges (always billed, even within your included minutes) or self-hosted
  runners, add their addresses to the allow list, and change `runs-on` in
  every job of both workflows: [enterprise.md](enterprise.md#ip-allow-lists).
  A job left on a standard runner still fails: **Publish**, say, at "Check
  the GitHub Pages settings", with HTTP 403.
- Every save, and the app's check for newer saves, sends the editor's token
  from their browser, so editors save from allowed networks only (the
  office, or a VPN).

### 6. Network access

Browsers that view or edit the roadmap need:

- the site: a private site's own host, `https://<random name>.pages.github.io/`
  (Settings → Pages shows it), or a public one's
  `https://<owner>.github.io/<repository>/`, so `*.github.io`; and its
  custom domain, if you give it one (Settings → Pages → Custom domain);
- `github.com`, where a private site's viewers sign in and editors make
  tokens, with what its pages load: `*.githubassets.com` (their scripts,
  styles and fonts) and `*.githubusercontent.com` (pictures, such as
  avatars);
- `api.github.com`, which the app calls (with an editor's token, or none on
  a public repository), and `raw.githubusercontent.com`, from which it reads
  a public repository's files without a token. Its Content-Security-Policy
  (the rules a page gives the browser on what it may load and connect to)
  allows no other host.

People who run BoxOps' command-line tool in a clone
([Make it yours](#7-make-it-yours)) also need `raw.githubusercontent.com`,
`api.github.com` and `github.com`. Self-hosted runners need what GitHub's
"Self-hosted runners reference" lists for them (`github.com`,
`api.github.com`, `*.actions.githubusercontent.com`, `codeload.github.com`,
`results-receiver.actions.githubusercontent.com`, `*.blob.core.windows.net`
and more); the BoxOps action itself makes no network calls. With Path B
([enterprise.md](enterprise.md#self-hosted-runners)), `actions/setup-node`
downloads Node.js 24 unless the runner's tool cache has it: from GitHub's
`actions/node-versions` releases (`github.com`, which sends the download on
to `release-assets.githubusercontent.com`), or, failing that, `nodejs.org`.

### 7. Organization rulesets

Settings → Repository → **Rulesets**. A ruleset aimed at the roadmap
repository's `main` that a save from the browser can't meet refuses every
save: requiring a pull request, status checks, a merge queue or successful
deployments, restricting updates, or restricting commit metadata (message,
author or committer email) to patterns. The app then says "GitHub’s rules
for main blocked this save" and quotes the rule. For each such ruleset,
either:

- exclude the roadmap repository from its targets, or
- add a team all editors are in, or the Write role, to its bypass list as
  **Always allow** (or Exempt): not "For pull requests only". An
  organization's or enterprise's ruleset takes teams, roles and apps on its
  bypass list, not individual people.

A save's commit is authored by the editor and committed by GitHub (as
`noreply@github.com`), so a committer email pattern must allow that address.
**Require signed commits** should let saves through: GitHub signs each
save's commit and shows it as Verified (tried on 2026-10-06 with a
fine-grained token), though a save under this rule hasn't been tried yet.
Once it's on, save once from the app; if the app says GitHub's rules
blocked the save, do as for the rules above. A push ruleset that restricts
file paths must let Dependabot through (it changes `.github/workflows/`).

## Repository admin

Once for each roadmap. Repository settings are under the repository's
**Settings** tab; you need its Admin role.

### 1. Create the repository

Open https://github.com/Allenfp/boxops-starter → **Use this template** →
**Create a new repository**:

- **Owner**: your organization. A name, such as `roadmap`.
- Visibility **Private** (or **Internal**, if everyone in the enterprise may
  read the roadmap).
- Leave **Include all branches** unticked. **Create repository from
  template**.

Or with the GitHub CLI:
`gh repo create <org>/<name> --template Allenfp/boxops-starter --private`.

Creating it starts its first run of **Deploy roadmap** (Actions tab), which
**fails at "Check the GitHub Pages settings"** with "GitHub Pages isn't set
up": expected, and nothing is published. Leave it until step 3.

**Without the template** (Enterprise Managed Users who can't use a template
outside the enterprise, or an organization that blocks it), make the same
files with BoxOps' `init`, which pins the release it comes from. With
Node.js 22.12 or later and the GitHub CLI:

```sh
curl -fsSLO https://github.com/Allenfp/BoxOps/releases/download/v0.1.0/boxops.mjs
gh attestation verify boxops.mjs -R Allenfp/BoxOps --signer-workflow Allenfp/BoxOps/.github/workflows/release.yml
node boxops.mjs init acme-roadmap
```

`gh attestation verify` checks that the file is the one BoxOps' release
workflow built ([security.md](security.md)). `init` writes the starter's 13
files into `acme-roadmap/`, pinned to that release, and prints the next
command: with your organization and the new repository's name for
`<org>/<name>`, it commits them and creates the repository, stopping at the
first step that fails.

```sh
cd 'acme-roadmap' && git init -b main && git add -A && \
  git commit -m "Start roadmap from BoxOps v0.1.0" && \
  gh repo create <org>/<name> --private --source . --push
```

Pushing files in `.github/workflows/` takes SSH or a token with the
`workflow` scope: if GitHub refuses the push for that reason, run
`gh auth refresh --scopes workflow`, then `git push -u origin main`. The
push starts the same first run, failing the same way.

### 2. Turn on Pages, private, before the first deploy that passes

Settings → Pages:

1. **Build and deployment** → **Source**: **GitHub Actions**.
2. **GitHub Pages visibility**: **Private**. (With Enterprise Managed Users
   there's no such menu: sites are always private.)

Do both before any deploy passes: outside Enterprise Managed Users, a new
site is public, even for a private repository. BoxOps' deploy refuses to
publish a repository that isn't public to a public site ("Refusing to
publish to a public site"), but set Private first all the same.

The same with the GitHub CLI:

```sh
gh api -X POST repos/<org>/<name>/pages -f build_type=workflow
gh api -X PUT repos/<org>/<name>/pages -F public=false
```

### 3. Let only `main` deploy, then deploy

Settings → Environments → **github-pages** (the first run made it) →
**Deployment branches and tags**. GitHub may have set it already: if it's
**Selected branches and tags** with one rule, `main`, leave it. If not,
choose **Selected branches and tags** → **Add deployment branch or tag
rule** → Ref type **Branch**, name `main` → **Add rule**, and remove any
other rule. Then only runs on `main` can publish the site (BoxOps' action
also refuses to build it from any other branch).

Then deploy: Actions → **Deploy roadmap** → **Run workflow** (branch `main`)
→ **Run workflow**; or open the failed run and choose **Re-run jobs** →
**Re-run all jobs**. When it passes, the site's address is in Settings →
Pages (**Visit site**) and on the run's page, under **Publish**.

### 4. Rulesets

Settings → **Rulesets** (under "Code, planning, and automation"; in
GitHub's older layout, Rules → Rulesets) → **New ruleset**. A new ruleset
starts **Disabled**: set **Enforcement status** to **Active** in each.

1. **New branch ruleset**, named `main`: **Target branches** → **Add
   target** → **Include default branch**; keep **Restrict deletions** and
   **Block force pushes**, which come ticked. **Create.** Add no rule a
   save can't meet (requiring a pull request, status checks, deployments
   or a merge queue, restricting updates, commit metadata patterns): saves
   go straight to `main`. Such a rule goes in a ruleset of its own, with a
   team all editors are in on its bypass list as **Always allow**, if at
   all: a bypass covers every rule of its ruleset.
2. **New push ruleset** (private and internal repositories), named
   `roadmap-only`: **Bypass list** → **Add bypass** → **Repository admin**
   and **Dependabot**; under **Push protections**, tick **Restrict file
   paths** and add five paths, `**/*`, `**/.*`, `**/.*/**/*`, `**/.*/**/.*`
   and `**/.*/**/.*/**/*`, then, under its **Allowed exceptions**,
   `roadmap/**/*`. **Create.** Only repository admins and Dependabot can
   then change anything outside `roadmap/`; editors change `roadmap/`
   freely.
   - Why: an editor's token can change any file, and many decide what
     runs. The workflows pin the release that builds your site; the
     launcher runs on teammates' laptops; `AGENTS.md` and `CLAUDE.md`
     instruct their AI assistants. And other tools on a teammate's laptop
     act on files a repository holds: Claude Code's `.claude/` (its
     settings' hooks run commands) and `.mcp.json`, Cursor's `.cursor/`,
     VS Code's `.vscode/` (a task in `tasks.json` can run when the folder
     opens), JetBrains' `.idea/`, `.devcontainer/`, `.gitattributes` and
     `.gitmodules`, git hook managers' files (`.husky/`, `lefthook.yml`,
     `.pre-commit-config.yaml`), direnv's `.envrc`, `.npmrc`,
     `package.json` and more. Allowing only `roadmap/` covers them all,
     and whatever a new tool reads next, as far as the five paths reach
     (below).
   - Why five: GitHub matches paths with Ruby's `fnmatch` and its
     `FNM_PATHNAME` flag, where `*` and `**/` don't match a name that
     starts with `.` (unless `FNM_DOTMATCH` is set too, which GitHub's docs
     don't say). So each path covers paths with a given number of such
     names: `**/*` none (`README.md`); `**/.*` and `**/.*/**/*` one, a
     file's (`.envrc`) or a folder's (`.claude/settings.json`);
     `**/.*/**/.*` and `**/.*/**/.*/**/*` two (`.devcontainer/.env`,
     `.config/.husky/pre-commit`). A path with three or more, such as
     `.a/.b/.c`, still gets through: if a tool your team uses reads one,
     add a pair of paths for each name more, for three
     `**/.*/**/.*/**/.*` and `**/.*/**/.*/**/.*/**/*` (the rule takes 200).
     If GitHub does match such names, `**/*` alone covers every path, and
     the other four do no harm.
   - Dependabot must be on the bypass list, or it can't push the branch of
     its upgrade pull request (which changes the workflows). Push rulesets
     also apply to the repository's forks.
   - Check it: someone with Write but not Admin, on GitHub's web page,
     edits `README.md`, then adds each of `.envrc`,
     `.claude/settings.json` and `.devcontainer/.env` as a new file: all
     four commits must be refused. A save from the app must still go
     through.
   - Allowed exceptions are in public preview (since 2026-08-25). Without
     them, restrict the paths themselves instead: `.github/**/*`,
     `.boxops/**/*`, `AGENTS.md` and `CLAUDE.md`, and those of the files
     above that your teammates' tools read, such as `.claude/**/*`,
     `.mcp.json` and `.vscode/**/*` (in `fnmatch`, `**/` is any number of
     folders: `.github/**` alone would cover `.github/dependabot.yml` but
     not `.github/workflows/deploy.yml`; and, as above, names starting
     with `.` inside a folder need paths of their own, such as
     `.claude/**/.*`). A list covers only the tools it names.
3. **Require signed commits** (optional): saves from the app should pass
   it, since GitHub signs each one and shows it as Verified (tried on
   2026-10-06 with a fine-grained token), but a save under this rule hasn't
   been tried yet. Tick it in the `main` ruleset, then save once from the
   app. If the app says GitHub's rules blocked the save, move the rule to a
   ruleset of its own with a team all editors are in on its bypass list: a
   bypass covers every rule of its ruleset, deletions and force pushes too.
   With it on, commits pushed by hand must be signed too.

### 5. Dependabot

BoxOps upgrades come as Dependabot pull requests, which
`.github/dependabot.yml` turns on (it checks daily, and proposes a release
3 days after it's published): keep that file. Dependabot's checks are listed
under Insights → Dependency graph → **Dependabot**; if no upgrade ever
comes, look there, and ask an owner whether an enterprise policy turns
Dependabot off. With a private mirror of BoxOps, an organization owner gives
Dependabot access to it ([enterprise.md](enterprise.md)). Upgrading is
[upgrading.md](upgrading.md).

### 6. People

Settings → **Collaborators & teams** → **Add teams** (or **Add people**),
then the role:

- **Read** for everyone who views the roadmap. A team is easiest. The first
  time they open a private site, GitHub has them sign in (and complete
  single sign-on, if the organization uses it).
- **Write** for editors: a token can't do more than its owner can, so each
  editor needs Write as well as a token ([Editors](#editors)).
- **Admin** for whoever changes these settings, merges the upgrade pull
  requests (they change `.github/workflows/`) or changes any other file
  outside `roadmap/` (the push ruleset lets admins through).

Remember the organization's base permission and an internal repository's
reach ([privacy](#before-you-add-real-people-privacy)).

### 7. Make it yours

- In `roadmap/settings.yaml`, set `title`. Then replace the example
  department, people and boxes (their titles end in "(delete me)"), in the
  app or by hand. Each save deploys.
- `AGENTS.md`: your team's rules for AI assistants go under **Team notes**,
  below the block BoxOps manages.
- Editing by hand: with Node.js 22.12 or later, in a clone,
  `node .boxops/boxops.mjs validate` checks the files (it must end in
  "— OK"), `report` lists over-capacity departments and overbooked people,
  `preview` shows the working copy in the app at http://127.0.0.1:4173,
  `guide` prints the guide (workflow, recipes, commit messages, upgrading)
  and `guide format` every file and field. The launcher downloads the
  pinned release's tool the first time; the starter's `README.md` has the
  rest.
- To hear of new releases (a security fix's title starts "Security:"): on
  https://github.com/Allenfp/BoxOps, **Watch** → **Custom** → **Releases**
  → **Apply**. Managed users can't watch a repository outside their
  enterprise; the feed https://github.com/Allenfp/BoxOps/releases.atom
  works for anyone. Each deploy also warns of a security release, and the
  site shows a notice ([upgrading.md](upgrading.md)).

## Editors

Each editor needs Write access to the repository and, at their first save,
a fine-grained personal access token. Viewing needs neither.

### 1. Keep your email address private

Each save is a commit authored by your GitHub account, and the
repository's history, which everyone who can read the repository can read,
keeps it. Before your first save: profile picture → Settings → **Emails** →
tick **Keep my email addresses private**. Your saves are then authored with
`<id>+<username>@users.noreply.github.com`, not your primary email address.

### 2. Create your token

At your first **Save**, the app asks for a token, and its link, **Create a
fine-grained token for `<org>/<repo>`**, opens GitHub's form filled in for
the repository. (Or: profile picture → Settings → Developer settings →
Personal access tokens → **Fine-grained tokens** → **Generate new token**.
GitHub asks you to verify your email address first if you haven't.) On
GitHub's form:

- **Token name**: as filled in, `BoxOps <org>/<repo>`, or any name.
- **Resource owner**: the organization, not your own account. Complete
  single sign-on if GitHub asks. If the organization isn't listed, it
  doesn't allow fine-grained tokens: ask an owner.
- **Expiration**: within the organization's maximum lifetime (ask, if you
  don't know it; 366 days by default). The app's link leaves GitHub's
  default, 30 days.
- If the organization approves tokens, a box under Resource owner asks why
  you need it: say it's for saving the team roadmap.
- **Repository access**: **Only select repositories** → the roadmap
  repository.
- **Permissions**: **Contents**, set to **Read and write**. GitHub adds
  Metadata (read-only) by itself. Nothing else: not Workflows.

**Generate token**, and copy it: GitHub shows it once.

### 3. Wait for approval, if asked

If the organization requires approval, the token is pending until an owner
approves it (GitHub emails you either way). A pending token reads only
public repositories, so the app says "This token can’t see `<org>/<repo>`".

### 4. Your first save

Paste the token into the save dialog's **GitHub token** field and save. The
app keeps it for that browser tab's session alone (it's gone when the tab
closes), sends it only to `api.github.com`, and never writes it into the
repository or an address; the gear menu's **Forget token** removes it
sooner. A save is one commit on `main`, which the site shows about a
minute later, and other open tabs within about two minutes.

**Outside collaborators** can't use fine-grained tokens: make a classic one
(Developer settings → Personal access tokens → Tokens (classic) → Generate
new token (classic)) with the `repo` scope. Single sign-on doesn't apply to
outside collaborators, so it needs no authorizing for the organization. It
can write to every repository you can, so keep it to this use, or become a
member instead.

## Troubleshooting

### When saving

What the app says when it saves (or shows a branch preview, `?ref=`), and
what to do. Where it names an HTTP status, that's GitHub's answer.

| The app says | Why | What to do |
|---|---|---|
| "GitHub rejected this token" (401) | The token was mistyped, has expired or was revoked. | Make a new one. |
| "This token can’t see `<org>/<repo>`" (404) | Its resource owner is your account, not the organization; the repository isn't selected; approval is pending; its lifetime is over the organization's maximum; or you're an outside collaborator with a fine-grained token. | Check the token on GitHub (Settings → Developer settings → Fine-grained tokens), or wait for approval. |
| "This token can see `<org>/<repo>` but not read its files" (403) | It has no Contents permission, only Metadata. | Edit the token: Contents → Read and write. |
| "This token can see `<org>/<repo>` but can’t save to it", or "can read `<org>/<repo>` but not write to it" (403) | Contents is Read-only. | Edit the token: Contents → Read and write. |
| "Your GitHub account can’t write to `<org>/<repo>`" | Your account has Read, not Write. | Ask a repository admin for Write. |
| "`<org>/<repo>` has no branch “main”" | The branch the site was built from isn't there any more (renamed or deleted); in a preview, `?ref=` names a branch that isn't there. | Reload once the site has deployed again: if the default branch was renamed, an admin first changes `main` in `deploy.yml` and in the `github-pages` environment's rule. In a preview, check the branch's name. |
| "`<org>` uses single sign-on. Authorize this token" | A member's classic token not authorized for SAML. | Configure SSO → Authorize, next to the token. |
| "`<org>` doesn’t accept this token" | The organization forbids this kind of token, or its lifetime is over the maximum. | Make the kind it allows, expiring within its limit. |
| "`<org>` only allows GitHub access from approved networks" | An IP allow list or Conditional Access policy. | Save from the office network or VPN. |
| "GitHub’s rules for main blocked this save" | A ruleset (pull requests, checks, signed commits, commit metadata). | An admin lets editors through: [Organization rulesets](#7-organization-rulesets), [Rulesets](#4-rulesets). |
| "This token has used up GitHub’s hourly allowance" | Your account has made as many GitHub API calls this hour as GitHub allows it, with all its tokens and tools. | Try again at the time the app gives. |
| "This network has used up GitHub’s hourly allowance for calls without a token (60 an hour per IP address)" | Without a token (a branch preview of a public repository, say), the app's calls count against your network's address, which everyone behind it shares. | Try again at the time the app gives, or with a token. |
| "GitHub asked BoxOps to slow down" | Too many calls in a short time (GitHub's secondary rate limits). | Wait as long as the app says, then try again. |
| "GitHub had a problem" (5xx) | An error or an outage at GitHub. | Try again in a minute. A save that may have gone through is checked before it's made again. |
| "BoxOps is being upgraded; reload in a minute" | An upgrade to a newer data format was merged and is deploying. | Reload in a minute. |
| "Couldn’t reach GitHub" | Offline, or a network filter blocks `api.github.com`. | Reconnect, or ask for `api.github.com` to be allowed. |

A token GitHub rejects (401) is forgotten at once; for anything else the
dialog keeps it, so you can fix the token on GitHub and try again.

### When deploying

Each deploy is a run of **Deploy roadmap** (Actions tab): its jobs are
**Check and assemble**, **Publish** and, when the roadmap has problems,
**Roadmap problems**. The BoxOps step's errors have "BoxOps" as their
title; the one that stops it is also its `result` output and a line in the
run's summary.

| The run says | Why | What to do |
|---|---|---|
| "GitHub Pages isn't set up" | Pages has no source yet (a new repository). | [Step 2](#2-turn-on-pages-private-before-the-first-deploy-that-passes), then run it again. |
| "Pages source isn't GitHub Actions" | Source is a branch. | Settings → Pages → Source: GitHub Actions. |
| "Refusing to publish to a public site" | The repository isn't public, but its site is. | Settings → Pages → GitHub Pages visibility: Private. |
| **Check and assemble** fails at `actions/checkout`: "… has an IP allow list enabled, and your IP address is not permitted to access this resource" | GitHub's standard runners can't be on the organization's IP allow list. | Runners with allowed addresses, in every job of both workflows: [enterprise.md](enterprise.md#ip-allow-lists). |
| "Couldn't read the Pages settings (HTTP 403)" | **Publish** runs where an IP allow list keeps it out, though **Check and assemble** didn't: `runs-on` was changed in some jobs, not all (or the job lost `pages: write`). | Every job on a runner with an allowed address: [enterprise.md](enterprise.md#ip-allow-lists). |
| "GitHub API problem (502)", or another status, or "(no response)" | The Pages check couldn't read the Pages settings: an error or an outage at GitHub. | Run it again later. |
| "The roadmap has N problem(s)" | Files with mistakes, made by hand. The site was published without the broken entries. | Fix the files the annotations on **Check and assemble** name, and push. |
| "This roadmap is in data format N; BoxOps X reads format M" | An upgrade needs a migration, or the pin is older than the data. | [upgrading.md](upgrading.md). |
| "roadmap/settings.yaml:N: … The data format can’t be read until that’s fixed" | A mistake in `settings.yaml` (a YAML syntax error, say) keeps its `format:` from being read. | Fix the line it names, and push. |
| "roadmap/settings.yaml is missing: every roadmap needs one, with at least `format: 1`" | There's no `roadmap/settings.yaml`. | Add one, with `format: 1` at least, and push. |
| "roadmap/… is a symlink; a roadmap folder holds plain files only", or "… is a submodule; …" | `roadmap/` holds a symlink or a submodule (outside hidden folders): BoxOps reads plain files only, and never follows a link. | Put the file itself in its place, or take it out, and push. |
| "roadmap/… isn’t UTF-8 text" | A file in another encoding. | Save it as UTF-8, and push. |
| "roadmap/… is 1.2 MiB; a roadmap file can be at most 1.0 MiB", "roadmap holds more than 20,000 files" or "… more than 64.0 MiB of roadmap files" | The limits BoxOps reads a roadmap within. | Make the file smaller, or take what isn't roadmap data out of `roadmap/`, and push. |
| "The workspace has no .git folder: actions/checkout downloads a tarball instead when the runner has no git 2.18 or later" | A runner of your own without git, or with git older than 2.18: BoxOps reads the roadmap from git's objects. | Install git 2.18 or later on the runner ([enterprise.md](enterprise.md#self-hosted-runners)). |
| "BoxOps 0.1 runs on Linux and macOS runners, not Windows" | A Windows runner. | `runs-on: ubuntu-24.04`, as the starter has it, or a Linux or macOS runner of your own. |
| "BoxOps builds the site from the default branch (main) only" | The run is for another branch. | Run it from `main`. |
| "BoxOps builds the site from the commit this run is for" | The workflow checks out another commit (a `ref:` on `actions/checkout`). | Check out the run's commit: `actions/checkout` with no `ref:`, as the starter's does. |
| The run fails before its first step: an action isn't allowed, or isn't pinned to a full commit SHA | The organization's Actions policy. | [Allow the actions](#3-allow-the-actions). |

Nothing is published when **Check and assemble** or **Publish** fails: the
site stays as it was.

## Public repositories

On any GitHub plan (Free, Pro, Team or Enterprise Cloud), a public
repository gets a public site: anyone can read the roadmap and its history
([privacy](#before-you-add-real-people-privacy)). Set it up as above, with
these differences:

- Create the repository as **Public**. GitHub Actions minutes are free for
  public repositories on GitHub's standard runners.
- Settings → Pages: Source **GitHub Actions**; there's no visibility to
  choose. The deploy publishes a public repository to a public site.
- Push rulesets aren't available for public repositories. Anyone with
  Write can change any file, with their token or as themselves:
  `.boxops/boxops.mjs`, `AGENTS.md` and the other files teammates' tools
  act on ([Rulesets](#4-rulesets) lists them), and the workflows as
  themselves (on GitHub's web page, or with git; their token can't, having
  no Workflows permission, except to copy a workflow file that's already
  on another branch, unchanged: [security.md](security.md#the-chain-of-trust)).
  Give Write only to people you trust with those files, delete branches
  once they're merged (Settings → General → **Automatically delete head
  branches** does it for pull requests), and look over what changes outside
  `roadmap/` now and then: `git log -p -- . ':!roadmap'`. Each deploy also
  warns when the launcher or `AGENTS.md`'s BoxOps block isn't the
  release's text.
- The token's **Resource owner** is the repository's owner: the
  organization, or your own account for a repository you own.
- A private repository on Team or Pro gets a public site, which the deploy
  refuses (on Free, it gets no site at all). To publish it anyway, on
  purpose, set `ALLOW_PUBLIC_SITE: "true"` in `deploy.yml`'s "Check the
  GitHub Pages settings" step (that edit needs the Workflows permission and,
  with the push ruleset, an admin).

## From a copy of BoxOps itself

Before 0.1.0, a team could run BoxOps from a copy of `Allenfp/BoxOps` itself:
the app in `web/` and the data in `roadmap/`, in one repository. Such a
roadmap moves onto the starter one of two ways: into a new repository made
from the starter, which starts with the starter's settings, or in place,
which keeps the repository: the roadmap's history, and the tokens editors
have (approved, where the organization approves them).

### Into a new repository

Create a repository from the starter as above (with its Pages settings,
rulesets and people), then, in a folder holding a clone of the old copy
(`old-copy` here), bring its roadmap over:

```sh
git clone https://github.com/<org>/<name>.git && cd <name>
git rm -rq roadmap
cp -R ../old-copy/roadmap roadmap
node .boxops/boxops.mjs migrate
node .boxops/boxops.mjs validate
git add roadmap && git commit -m "Bring the roadmap over from the old copy" && git push
```

`migrate` stamps `format: 1` in `settings.yaml`, the data format this
BoxOps reads; `validate` must end in "— OK". The old history stays in the
old repository: take its site down (Settings → Pages → the menu beside "Your
site is live at" → **Unpublish site**), then archive it (Settings → General
→ Danger Zone → **Archive this repository**). Editors make new tokens, for
the new repository, and reload tabs they had open.

### In place

A repository admin does it, since it replaces the workflows (pushing
`.github/workflows/` takes SSH, or a token with the `workflow` scope), with
Node.js 22.12 or later and the GitHub CLI. In a fresh clone of the old copy,
with the release to move to (v0.1.0 here):

```sh
git clone https://github.com/<org>/<name>.git && cd <name>
curl -fsSLo ../boxops.mjs https://github.com/Allenfp/BoxOps/releases/download/v0.1.0/boxops.mjs
gh attestation verify ../boxops.mjs -R Allenfp/BoxOps --signer-workflow Allenfp/BoxOps/.github/workflows/release.yml
node ../boxops.mjs init ../starter-files
git rm -rq --ignore-unmatch web docs LICENSE .github/workflows/pages.yml .github/workflows/validate.yml
rsync -a --exclude=/roadmap/ ../starter-files/ ./
node .boxops/boxops.mjs migrate
node .boxops/boxops.mjs validate
git add -A && git status
```

`init` writes the starter's files, pinned to that release, into
`../starter-files` (a folder that isn't there yet), and `rsync` copies them
all but the example roadmap over the old copy: the starter's workflows,
launcher, Dependabot file, `AGENTS.md`, `CLAUDE.md`, `README.md` and
`.gitignore` take the place of BoxOps' own, and `git rm` takes away its
app, docs, licence and old workflows (take anything else of BoxOps' away
the same way). Look over what `git status` lists: files of your own stay,
but changes you made to `README.md` or `AGENTS.md` are replaced, so put
back what you want (in `AGENTS.md`, below its BoxOps block). `migrate` and
`validate` are as above. Then:

```sh
git commit -m "Run the roadmap from the BoxOps starter, pinned to v0.1.0" && git push
```

The push runs **Deploy roadmap**. Then go through the
[Repository admin](#repository-admin) steps from 2 on, as for a new
repository, since the old copy has none of the starter's rules: Pages
([2](#2-turn-on-pages-private-before-the-first-deploy-that-passes)), the
`github-pages` environment ([3](#3-let-only-main-deploy-then-deploy)), the
rulesets, the push ruleset above all ([4](#4-rulesets)), and Dependabot
([5](#5-dependabot)). Editors keep their access and their tokens; have
them reload tabs they have open before they save again, since an open tab
runs the old app until it's reloaded.

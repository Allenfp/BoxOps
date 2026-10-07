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
  residency, on `*.ghe.com`) aren't supported: the deploy stops with
  "GitHub Enterprise Server and GHE.com aren't supported in BoxOps 0.1".

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
  in your repository names a version.
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
> - **Each save is a commit by the person who saved.** Its author is their
>   GitHub account: their name, and their email address unless they've
>   turned on **Keep my email addresses private** (profile picture →
>   Settings → Emails), which makes it a `…@users.noreply.github.com`
>   address. Everyone who can read the repository can read its history; for
>   a public repository, that's everyone.
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

- **Private Pages needs GitHub Enterprise Cloud.** On GitHub Free and Team,
  sites are public, and the deploy refuses to publish a private
  repository's roadmap to one: use a public repository
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
(with the `repo` scope, which reaches every repository they can write to,
and authorized for SAML single sign-on if the organization uses it). If you
restrict classic tokens, outside collaborators can view but not save; make
editors members instead.

### 5. IP allow lists and runners

Only if Settings → Authentication security → **IP allow list** is enabled
(or, with Enterprise Managed Users on Entra ID, a Conditional Access policy
checks addresses):

- GitHub's standard hosted runners can't reach the organization's
  repositories, so the workflows fail: `actions/checkout` can't fetch the
  repository, and "Check the GitHub Pages settings" gets HTTP 403. Use
  larger runners with static IP address ranges (always billed, even within
  your included minutes) or self-hosted runners, add their addresses to the
  allow list, and change `runs-on` in every job of both workflows:
  [enterprise.md](enterprise.md).
- Every save, and the app's check for newer saves, sends the editor's token
  from their browser, so editors save from allowed networks only (the
  office, or a VPN).

### 6. Network access

Browsers that view or edit the roadmap need:

- the site's address, `https://<random name>.pages.github.io/` (a private
  site's own host under `pages.github.io`; Settings → Pages shows it);
- `github.com`, where a private site's viewers sign in and editors make
  tokens;
- `api.github.com`, which the app calls (with an editor's token, or none on
  a public repository), and `raw.githubusercontent.com`, from which it reads
  a public repository's files without a token. Its Content-Security-Policy
  allows no other host.

People who run BoxOps' command-line tool in a clone
([Make it yours](#7-make-it-yours)) also need `raw.githubusercontent.com`,
`api.github.com` and `github.com`. Self-hosted runners need what GitHub's
"Self-hosted runners reference" lists for them (`github.com`,
`api.github.com`, `*.actions.githubusercontent.com`, `codeload.github.com`,
`results-receiver.actions.githubusercontent.com`, `*.blob.core.windows.net`
and more); the BoxOps action itself makes no network calls.

### 7. Organization rulesets

Settings → Repository → **Rulesets**. A ruleset aimed at the roadmap
repository's `main` that a save from the browser can't meet refuses every
save: requiring a pull request, status checks, a merge queue or successful
deployments, restricting updates, or restricting commit metadata (message,
author or committer email) to patterns. The app then says "GitHub's rules
for main blocked this save" and quotes the rule. For each such ruleset,
either:

- exclude the roadmap repository from its targets, or
- add a team all editors are in, or the Write role, to its bypass list as
  **Always allow** (or Exempt): not "For pull requests only". An
  organization's or enterprise's ruleset takes teams, roles and apps on its
  bypass list, not individual people.

A save's commit is authored by the editor and committed by GitHub (as
`noreply@github.com`), so a committer email pattern must allow that address.
**Require signed commits**: GitHub signs a save's commit where it can, but
whether a save with a fine-grained token passes this rule hasn't been
checked live yet; until it has, bypass it for the editors' team, or leave
it off for this repository. A push ruleset that restricts file paths must
let Dependabot through (it changes `.github/workflows/`).

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

Settings → Environments → **github-pages** (the first run made it, with
no rules) → **Deployment branches and tags**: **Selected branches and
tags** → **Add deployment branch or tag rule** → Ref type **Branch**, name
`main` → **Add rule**. Then only runs on `main` can publish the site (BoxOps'
action also refuses to build it from any other branch).

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
   or a merge queue, restricting updates, commit metadata patterns) unless
   a team all editors are in is on its bypass list as **Always allow**:
   saves go straight to `main`.
2. **New push ruleset** (private and internal repositories), named
   `boxops-files`: **Bypass list** → **Add bypass** → **Repository admin**
   and **Dependabot**; under **Push protections**, **Restrict file paths**:
   `.github/**/*`, `.boxops/**/*`, `AGENTS.md` and `CLAUDE.md`. **Create.**
   - Why: an editor's token can change any file, and these decide what
     runs: the workflows pin the release that builds your site, the
     launcher runs on teammates' laptops, and `AGENTS.md` instructs their
     AI assistants. Editors still change `roadmap/` freely.
   - Dependabot must be on the bypass list, or it can't push the branch of
     its upgrade pull request (which changes the workflows). Push rulesets
     also apply to the repository's forks.
   - GitHub matches these paths as `fnmatch` patterns, in which `**/` is
     any number of folders: `.github/**` alone would cover
     `.github/dependabot.yml` but not `.github/workflows/deploy.yml`.
   - Check it: someone with Write but not Admin edits `AGENTS.md` on
     GitHub's web page; the commit must be refused.
   - Allowed exceptions to path rules are in public preview (since
     2026-08-25). Once they're generally available, the stricter form is
     to restrict every path and allow only `roadmap/`; check it the same
     way, `.github/` and `.boxops/` included.
3. **Require signed commits**: compatible with saves from the app only once
   it's been checked live (GitHub signs a save's commit where it can, but
   it hasn't been tried with a fine-grained token yet). Until then, leave it
   off, or put a team all editors are in on its bypass list. With it on,
   commits pushed by hand must be signed too.

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
- **Admin** for whoever changes these settings, or merges the upgrade pull
  requests that change files in `.github/` and `.boxops/` (the push ruleset
  lets admins through).

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
  `preview` shows the working copy in the app at http://127.0.0.1:4173, and
  `guide` prints the full guide. The launcher downloads the pinned release's
  tool the first time; the starter's `README.md` has the rest.
- To hear of new releases (a security fix's title starts "Security:"): on
  https://github.com/Allenfp/BoxOps, **Watch** → **Custom** → **Releases**
  → **Apply**. Managed users can't watch a repository outside their
  enterprise; the feed https://github.com/Allenfp/BoxOps/releases.atom
  works for anyone. Each deploy also warns of a security release, and the
  site shows a notice ([upgrading.md](upgrading.md)).

## Editors

Each editor needs Write access to the repository and, at their first save,
a fine-grained personal access token. Viewing needs neither.

### 1. Create your token

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

### 2. Wait for approval, if asked

If the organization requires approval, the token is pending until an owner
approves it (GitHub emails you either way). A pending token reads only
public repositories, so the app says "This token can't see `<org>/<repo>`".

### 3. Your first save

Paste the token into the save dialog's **GitHub token** field and save. The
app keeps it for that browser tab's session alone (it's gone when the tab
closes), sends it only to `api.github.com`, and never writes it into the
repository or an address; the gear menu's **Forget token** removes it
sooner. A save is one commit on `main`, which the site shows about a
minute later, and other open tabs within about two minutes.

**Outside collaborators** can't use fine-grained tokens: make a classic one
(Developer settings → Personal access tokens → Tokens (classic) → Generate
new token (classic)) with the `repo` scope, and, if the organization uses
single sign-on, **Configure SSO** → **Authorize** next to it. It can write to
every repository you can, so keep it to this use, or become a member
instead.

## Troubleshooting

### When saving

What the app says, and what to do. Where it names an HTTP status, that's
GitHub's answer.

| The app says | Why | What to do |
|---|---|---|
| "GitHub rejected this token" (401) | The token was mistyped, has expired or was revoked. | Make a new one. |
| "This token can't see `<org>/<repo>`" (404) | Its resource owner is your account, not the organization; the repository isn't selected; approval is pending; its lifetime is over the organization's maximum; or you're an outside collaborator with a fine-grained token. | Check the token on GitHub (Settings → Developer settings → Fine-grained tokens), or wait for approval. |
| "This token can see `<repo>` but can't save to it", or "can read `<repo>` but not write to it" (403) | Contents is Read-only. | Edit the token: Contents → Read and write. |
| "Your GitHub account can't write to `<repo>`" | Your account has Read, not Write. | Ask a repository admin for Write. |
| "`<org>` uses single sign-on. Authorize this token" | A classic token not authorized for SAML. | Configure SSO → Authorize, next to the token. |
| "`<org>` doesn't accept this token" | The organization forbids this kind of token, or its lifetime is over the maximum. | Make the kind it allows, expiring within its limit. |
| "`<org>` only allows GitHub access from approved networks" | An IP allow list or Conditional Access policy. | Save from the office network or VPN. |
| "GitHub's rules for main blocked this save" | A ruleset (pull requests, checks, signed commits, commit metadata). | An admin lets editors through: [Organization rulesets](#7-organization-rulesets), [Rulesets](#4-rulesets). |
| "BoxOps is being upgraded; reload in a minute" | An upgrade to a newer data format was merged and is deploying. | Reload in a minute. |
| "Couldn't reach GitHub" | Offline, or a network filter blocks `api.github.com`. | Reconnect, or ask for `api.github.com` to be allowed. |

A token GitHub rejects (401) is forgotten at once; for anything else the
dialog keeps it, so you can fix the token on GitHub and try again.

### When deploying

Each deploy is a run of **Deploy roadmap** (Actions tab): its jobs are
**Check and assemble**, **Publish** and, when the roadmap has problems,
**Roadmap problems**.

| The run says | Why | What to do |
|---|---|---|
| "GitHub Pages isn't set up" | Pages has no source yet (a new repository). | [Step 2](#2-turn-on-pages-private-before-the-first-deploy-that-passes), then run it again. |
| "Pages source isn't GitHub Actions" | Source is a branch. | Settings → Pages → Source: GitHub Actions. |
| "Refusing to publish to a public site" | The repository isn't public, but its site is. | Settings → Pages → GitHub Pages visibility: Private. |
| "Couldn't read the Pages settings (HTTP 403)" | An IP allow list keeps the runner out (or the job lost `pages: write`). | A runner with an allowed address: [enterprise.md](enterprise.md). |
| "The roadmap has N problem(s)" | Files with mistakes, made by hand. The site was published without the broken entries. | Fix the files the annotations on **Check and assemble** name, and push. |
| "This roadmap is in data format N; BoxOps X reads format M" | An upgrade needs a migration, or the pin is older than the data. | [upgrading.md](upgrading.md). The site stays as it was. |
| "BoxOps builds the site from the default branch (main) only" | The run is for another branch. | Run it from `main`. |
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
  Write can change `.boxops/boxops.mjs` and `AGENTS.md`, with their token or
  as themselves, and the workflows as themselves (on GitHub's web page, or
  with git; their token can't, having no Workflows permission). Give Write
  only to people you trust with those files, and look over what changes
  there now and then: `git log -- .github .boxops AGENTS.md CLAUDE.md`.
- The token's **Resource owner** is the repository's owner: the
  organization, or your own account for a repository you own.
- A private repository on Team or Pro gets a public site, which the deploy
  refuses. To publish it anyway, on purpose, set `ALLOW_PUBLIC_SITE: "true"`
  in `deploy.yml`'s "Check the GitHub Pages settings" step (that edit
  needs the Workflows permission and, with the push ruleset, an admin).

## From a copy of BoxOps itself

Before 0.1.0, a team could run BoxOps from a copy of `Allenfp/BoxOps` itself:
the app in `web/` and the data in `roadmap/`, in one repository. To move
such a roadmap onto the starter, create a repository from the starter as
above (with its Pages settings, rulesets and people), then, in a folder
holding a clone of the old copy (`old-copy` here), bring its roadmap over:

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

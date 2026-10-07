# Changelog

BoxOps' releases, newest first. A version's section is its GitHub release's
notes (the release workflow publishes them), so each opens with the same
lines, in the same order, saying what a roadmap repository has to do to
upgrade, then lists what changed. The form is in
[docs/releasing.md](docs/releasing.md#the-changelog), and
`web/scripts/check-changelog.mjs` checks it.

## Unreleased

- Security: none
- Data format: 1 (new): `format: 1` in `roadmap/settings.yaml`; a roadmap without it is format 0, which `node .boxops/boxops.mjs migrate` brings to 1
- Workflow changes: new: a roadmap repository runs the starter's `deploy.yml` and `check.yml` (Path B's, in organizations that allow only GitHub's own actions)
- Action inputs and outputs: new: inputs `mode`, `roadmap`, `path`, `on-problems` (default `deploy`), `releases-file`, `read-only`, `repository`, `summary`; outputs `site`, `version`, `build`, `format`, `commit`, `problems`, `result`
- AGENTS.md block: 1 (new): `node .boxops/boxops.mjs sync` writes it
- Launcher: 1 (new) · Guard: 1 (new)
- Node and runner: Node.js 22.12 or later for the command-line tool; the action runs on the runner's node24; tested on ubuntu-24.04, ubuntu-24.04-arm and ubuntu-26.04; github.com only (not GitHub Enterprise Server or GHE.com)
- Open tabs: a tab of the demo opened before this release gets no prompt to reload: reload it

### Changes

- BoxOps is a release that a roadmap repository pins by commit, made from the starter repository: a prebuilt GitHub Action that checks the roadmap and assembles its Pages site from git objects alone (no network, no token, no build in the roadmap repository), and the command-line tool its launcher runs: `validate`, `report`, `preview`, `migrate`, `guide`, `sync`, `doctor`, `upgrade`, `init`, `build`.
- A roadmap has a data format, 1; the app opens a roadmap in another format read-only, and `migrate` moves one to this release's.
- A save is one commit on `main`, made with GraphQL's `createCommitOnBranch` on top of the head it was checked against, and signed by GitHub; edits by others to the same item are offered as keep mine or keep theirs.
- Private repositories: the app reads newer saves through the API, fetching only files whose blob SHA changed, and previews a branch (`?ref=`) for those who can read it.
- Open tabs learn of a new release from the site's `roadmap.json`, go read-only, and reload into it; a security or other update notice from the deploy shows in the app as plain text.
- Unsaved edits are kept in the browser, one draft per tab, and offered again after a crash or a closed tab; they can be downloaded when they can't be saved.
- The timeline, the table and People draw only what's near the screen on a big roadmap (over 300 boxes, or 200 rows); the app's code is fetched in parts as it's used, and the YAML parser only when needed.
- Keyboard and screen readers: the timeline is a grid the arrow keys move around, where boxes and PTO are added, moved and deleted; date fields have a calendar dialog; changes, saves and others' saves are announced; the views are checked against WCAG 2.2 A and AA.
- The site's Content-Security-Policy allows only the app's own code and GitHub's API; no roadmap data ever becomes HTML, CSS or SVG.
- Releases are built twice to the same bytes, tested as built (the browser tests, and the action on three runners), committed and tagged only by the release workflow's deploy key once the maintainer approves, and attested with provenance and an SBOM.

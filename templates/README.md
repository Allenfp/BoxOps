# Templates

Text the BoxOps command-line tool carries in `dist/boxops.mjs`, for roadmap
repositories (not for working on BoxOps itself):

- `agents-block.md`: the managed block `node .boxops/boxops.mjs sync` writes
  into a roadmap repository's `AGENTS.md`, between its `<!-- boxops:begin
  block=N … -->` and `<!-- boxops:end -->` markers. `block` in its front
  matter is that N; raise it whenever the text changes (and `AGENTS_BLOCK` in
  `web/cli/release.ts` with it), so the action and `doctor` can tell a copy
  is old.
- `guide/*.md`: `node .boxops/boxops.mjs guide [topic]`, the full reference
  for assistants and people editing a roadmap by hand. `guide format` prints
  `docs/data-format.md`.
- `path-b/`: the starter's `deploy.yml` and `check.yml` for organizations
  that allow only GitHub's own actions: git fetches the pinned release and
  Node.js runs its `dist/action.mjs`. Only the BoxOps step differs from the
  starter's (a unit test checks), and the starter's README shows that step.

The starter repository's files are in `starter/`; its `AGENTS.md` is this
block plus a heading and the team's notes, which a unit test checks.

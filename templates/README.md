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

The starter repository's files are in `starter/`; its `AGENTS.md` is this
block plus a heading and the team's notes, which a unit test checks.

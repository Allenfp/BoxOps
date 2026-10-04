# <img src="web/public/favicon.svg" width="32" height="32" alt="" align="top"> BoxOps

A team roadmap that lives in this repo. The plan is a set of small YAML files in
`roadmap/`. A web app on GitHub Pages shows them as a swim-lane timeline and lets
you edit them in the browser: press **Save** and the change is committed
straight to `main`, and the site updates within a minute.

**Open it:** https://allenfp.github.io/BoxOps/

## Using the app

- **Timeline.** Departments of lanes, one per FTE of capacity, over weeks,
  months or quarters (working days only; weekends aren't shown). Drag a box to
  move it, drag its ends to resize it, click it to edit, and double-click empty
  space to add one. A box is as tall as the FTE it needs (0.5–2). A department
  turns red where more FTE is planned than its lanes hold. Every box has a code
  like `DE-A1F`, and boxes can be related ("finishes before", "happens
  during"…); a broken rule pops up a warning but blocks nothing. **+ Add
  department** and the ✎ on a department heading add, rename, recolour, reorder
  and remove departments and their lanes. Each department has a **PTO** row
  where engineers' time off shows as grey blocks: double-click to add, drag to
  move, click to edit.
- **Table.** Every box as an editable row (dates, FTE, engineers, status flag,
  links, description), grouped by department, with search and sorting. PTO
  rows sit under each department's boxes.
- **People.** The engineer roster: name, department, role, email, manager and
  notes, plus their PTO (read-only; edit it on the timeline or table). Boxes
  are assigned engineers from this list.
- **Saving.** Edits stay in your browser until you press **Save** (⌘S). The
  first save asks for a GitHub token: create a fine-grained token with access to
  only this repo and *Contents: Read and write*. If someone else saved while you
  were editing, you see their changes before anything is written, and choose
  whose version to keep for anything you both changed. Open tabs pick up other
  people's saves every couple of minutes.

## Editing without the app

The YAML files can be edited directly, by a person or an AI assistant, and
pushed to `main`; every push is validated before it deploys.

- [docs/data-format.md](docs/data-format.md): every file and field, and what the
  validator checks.
- [AGENTS.md](AGENTS.md): step-by-step instructions for AI assistants, with
  recipes.
- From `web/`: `npm run validate` checks the files; `npm run report` lists
  over-capacity departments, overloaded engineers and unassigned boxes.

## Developing the app

The app is in `web/`: Vite, React and TypeScript.

```sh
cd web
npm ci
npm run dev        # http://localhost:5173; reads ../roadmap and reloads on change
npm test           # unit tests
npm run e2e        # browser tests (Playwright, WebKit)
npm run validate   # check the roadmap files
npm run report     # capacity and staffing summary
```

Every branch and pull request runs validation, the unit tests, a build and the
browser tests. On `main`, a push that only changes `roadmap/` (as a save from
the app does) skips the browser tests so it goes live in about 30 seconds. Any
other push must pass them before deploying.

- [docs/architecture.md](docs/architecture.md): how loading, saving, conflicts,
  polling, layout and CI work.
- [docs/decisions.md](docs/decisions.md): what was decided and why, and what
  isn't built yet.

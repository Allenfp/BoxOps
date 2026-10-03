# BoxOps Roadmap

A swim-lane roadmap that runs as a static GitHub Pages site and keeps its data
as YAML files in this repo. Open it, edit, press **Save**: the change is
committed straight to `main` and the site updates about a minute later.

**Live:** https://allenfp.github.io/BoxOps/

## Using it

- **Timeline**: departments of FTE lanes over weeks, months or quarters
  (working days only). Drag boxes to move or resize them, click one to edit it,
  double-click a lane to add one. A box is as tall as its FTE (0.5–2); a
  department warns when more FTE is planned than its lanes hold.
- **Table**: every box as an editable row, grouped by department.
- **People**: the engineer roster (name, department, role, email, manager,
  notes). Boxes are assigned engineers from this list.
- **Save** (⌘S) needs a GitHub fine-grained token with *Contents: Read and
  write* on this repo; it's asked for once per tab. If someone else saved in
  the meantime you're shown their changes first. Open tabs pick up other
  people's saves every couple of minutes.

## Data

```
roadmap/
  settings.yaml          title, fiscal year, box types and statuses
  departments/<id>.yaml  a department and its lanes (FTE capacity)
  boxes/<id>.yaml        one file per box
  people.yaml            the engineer roster
```

The files can also be edited by hand; every push is validated before it
deploys.

## Development

The app is in `web/` (Vite, React, TypeScript).

```sh
cd web
npm install
npm run dev        # http://localhost:5173, reads ../roadmap live
npm test           # unit tests
npm run e2e        # browser tests (Playwright, WebKit)
npm run validate   # check the roadmap files
```

CI runs validation, unit tests, the build and the browser tests on every branch
and pull request. On `main`, saves that only change `roadmap/` skip the browser
tests so they go live quickly; anything else must pass them before deploying.
See `docs/PLAN.md` for the design and decisions.

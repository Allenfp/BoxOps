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
  department** and the pencil on a department heading add, rename, recolour, reorder
  and remove departments and their lanes; dragging a department heading moves
  it up or down. Each department has a **PTO** row
  where engineers' time off shows as grey blocks: double-click to add, drag to
  move, click to edit.
- **Table.** Every box as an editable row (dates, FTE, engineers, flag,
  links, description) plus its **Scale** (FTE × working days, also shown on each
  timeline box), grouped by department, with search, sorting, a date range
  (boxes and PTO that overlap it) and a **Hide finished boxes** switch. PTO
  rows sit under each department's boxes.
- **People.** The engineer roster: name, department, role, email, manager and
  notes, plus their PTO (read-only; edit it on the timeline or table). Boxes
  are assigned engineers from this list.
- **Saving.** Edits stay in your browser until you press **Save** (⌘S, or
  Ctrl+S on Windows and Linux), each tab's on its own; edits left in a tab
  you closed are offered back in the roadmap's other tabs, or the next time
  you open it. Safari forgets them after 7 days of use without a visit to
  the site, so save before then. The
  first save asks for a GitHub token; its link opens GitHub's new-token page
  filled in for this repo. Check there that *Resource owner* is the repo's
  owner (the organization, not your own account), that *Repository access* is
  *Only select repositories* with this repo, and that *Contents* is *Read and
  write*. If the organization approves tokens, it works once an owner has
  approved it; if it caps token lifetimes, pick an expiration within the cap.
  A classic token with the `repo` scope works too (an outside collaborator
  needs one) but can write to all your repos, so fine-grained is recommended.
  The token is kept for the tab's session and sent only to GitHub; if a save
  fails, the dialog says why and what to change. A save is one commit,
  authored by your GitHub account (with the email your email-privacy setting
  gives it) and committed by GitHub: a ruleset that restricts author or
  committer emails, or commit messages, by pattern must allow these, or it
  rejects every save. If someone else saved while you were editing, you see
  their changes before anything is written, and choose whose version to keep
  for anything you both changed. Open tabs pick up other people's saves every
  couple of minutes, and ask you to reload when BoxOps itself is updated.
- **Settings (gear menu).** Your own preferences: theme (light, dark or
  match the system), density, what boxes show (codes, flags, initials,
  scale), the zoom and view to open with, PTO rows on or off, and hiding
  finished boxes. These are kept in your browser only (only the ones you
  changed, so a new default reaches you, and a change in one tab reaches the
  others) and never change anyone else's view; Reset puts them all back.
  The menu also has the key, keyboard shortcuts (⌘ on a Mac, Ctrl
  elsewhere), "Forget token", discard and a link to the history. **Team
  settings** (title, fiscal year, default zoom, box types and flags) change
  `roadmap/settings.yaml` for everyone and are saved like any other edit.
- **Keyboard and screen readers.** "Skip to roadmap" is the first stop for
  Tab. Dialogs and the box and PTO editors keep Tab inside them, Esc closes
  them, and focus goes back where it was. In the table and People, Enter
  keeps what's typed and stays in the cell, and Esc puts it back. Saves,
  other people's saves, search results, broken rules and problems with a
  field are announced to screen readers. Delete a box or PTO with its
  editor's **Delete** button (⌘Z or Ctrl+Z brings it back): the Delete key
  does nothing while an editor is open. Boxes on the timeline itself can't
  yet be reached from the keyboard; the Table view edits all of a box.

## Editing without the app

The YAML files can be edited directly, by a person or an AI assistant, and
pushed to `main`; every push is validated before it deploys.

- [docs/data-format.md](docs/data-format.md): every file and field, and what the
  validator checks.
- [AGENTS.md](AGENTS.md): step-by-step instructions for AI assistants, with
  recipes.
- From `web/`: `npm run validate` checks the files; `npm run report` lists
  over-capacity and full departments, overloaded engineers, engineers booked
  during their PTO, everyone's bookings and PTO by date, unassigned boxes and
  broken rules. Both take another roadmap folder as an argument:
  `npm run validate -- <folder>`.

## Developing the app

The app is in `web/`: Vite, React and TypeScript, on Node 24 (`.nvmrc`; Node 22
from 22.12, and 26 or later, work too).

```sh
cd web
npm ci
npm run dev        # http://localhost:5173; shows ../roadmap (or $BOXOPS_ROADMAP) read-only, reloading on change
npm run lint       # oxlint, including the React hooks rules; a warning fails it
npm run typecheck  # TypeScript, browser and Node code apart (npm run build checks types too)
npm test           # unit tests
npx playwright install webkit chromium firefox  # once: the browsers the browser tests use
npm run e2e        # browser tests (Playwright: WebKit, Chromium and Firefox)
npm run perf       # first load of a 2,000-box roadmap in WebKit: sizes checked, times printed
npm run validate   # check the roadmap files
npm run report     # capacity and staffing summary
npm run gen-roadmap -- 2000 2026-10-03 <folder>  # a synthetic roadmap (boxes, "today") for scale tests
```

Every pull request, and every push to a branch other than `main` (docs-only
too), runs CI: lint, type check, the unit tests (also in two time zones far
apart), validation, a build, the browser tests (in WebKit, then Chromium and
Firefox) and the performance checks. On `main`, the deploy lints,
type-checks, validates, runs the unit tests and builds, and runs the browser
tests in WebKit unless nothing outside `roadmap/` has changed since the
version that is live. So a save from the app usually goes live within a
minute (a few minutes if an app change is deploying at the same time), and
anything else must pass the browser tests before it deploys.

- [docs/architecture.md](docs/architecture.md): how loading, saving, conflicts,
  polling, layout and CI work.
- [docs/decisions.md](docs/decisions.md): what was decided, when and why.

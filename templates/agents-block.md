---
block: 1
---
This repository is a team roadmap: YAML files in `roadmap/`, shown and edited by the BoxOps
web app on this repository's GitHub Pages site. The app isn't in this repository: it's the
BoxOps release pinned in `.github/workflows/deploy.yml`, and `node .boxops/boxops.mjs` runs
exactly that release's tools (Node.js 22.12 or later; the first run downloads them).

Full reference for this version: `node .boxops/boxops.mjs guide` (recipes, commit messages,
capacity rules) and `node .boxops/boxops.mjs guide format` (every file and field).

## How the roadmap works

- **Departments** (`roadmap/departments/<id>.yaml`) hold **lanes**: anonymous capacity of 1 or
  0.5 FTE, not people. A lane can have `start` and `end` dates (a new hire, a contractor).
- **Boxes** (`roadmap/boxes/<id>.yaml`) are planned work: in a lane, from `start` to `end`
  (inclusive weekdays), needing 0.5, 1, 1.5 or 2 FTE, optionally naming their **engineers**.
- **Engineers** are in `roadmap/people.yaml`, with any **PTO** as a `pto:` list of
  `start`/`end` dates and an optional `note`.
- **Codes.** People name boxes like `ENG-K7P`: the department's `code` plus the box's own
  3-character `code`. `grep -lE '^code: "?K7P"?$' roadmap/boxes/*` finds the file.
- **Rules** (`relations` on a box) say how boxes sit in time relative to each other. A broken
  rule, a department **over capacity** (more FTE planned than its lanes hold on some day) and
  an engineer over 1 FTE are warnings, not errors.
- **No weekends**: dates are Monday–Friday and durations are working days ("two weeks" is 10).
  Holidays aren't modelled, but point out work landing in a usual holiday period.

## Workflow

1. `git checkout main && git pull --ff-only` (people save from the app all the time).
2. Save the report to a fresh file and note its path:
   `B=$(mktemp) && node .boxops/boxops.mjs report > "$B" && echo "$B"`.
3. Edit only files under `roadmap/`, only the lines you need; keep comments and field order.
4. `node .boxops/boxops.mjs validate` must end in `— OK`; then
   `node .boxops/boxops.mjs report | diff "$B" -` and tell the user what got worse
   (a department over capacity, someone over 1 FTE or booked during PTO, a broken rule).
5. `git pull --ff-only`, `git add roadmap/` (never `git add -A`), and commit in the app's
   style: one change → that change as the subject; otherwise `Roadmap: <n> changes` with one
   bullet per item (details: `node .boxops/boxops.mjs guide commits`).
6. `git push origin main`; the site updates in about a minute.
7. Rejected because someone saved: `git pull --rebase`, validate, push. Never force-push.
   Rejected for unsigned commits or a protected path: stop and tell the user.

## Common recipes

- **Add a box.** Id `bx-<4 random hex digits>-<slug of the title>`; a new 3-character `code`
  from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, not all digits and not like `2E5`; check neither is
  taken (`ls roadmap/boxes`, `grep -h "^code:" roadmap/boxes/*`). Then
  `roadmap/boxes/<id>.yaml`:

  ```yaml
  id: bx-3f9c-q3-planning
  code: Q3P
  title: Q3 planning
  lane: eng-1
  start: 2027-06-07
  end: 2027-06-18
  type: project
  ```

  Add `fte:` only if it isn't 1, and `engineers:` with ids from `people.yaml`.
- **Move or reschedule.** Change `start` and `end` (by the same number of working days to keep
  its length), or `lane`.
- **Resize, re-staff or flag.** Edit `end`, `fte`, `engineers`; `status:` is `at_risk`,
  `late` or `blocked` (delete the line when it's resolved).
- **Book PTO.** Add `- start: …` / `end: …` / `note: …` (weekdays, inclusive) to the
  engineer's `pto:` list, and tell the user about boxes it overlaps (the report lists them).
- **Working days**, in Python:

  ```python
  from datetime import date, timedelta
  def add_workdays(d: date, n: int) -> date:
      step = 1 if n >= 0 else -1
      while n:
          d += timedelta(days=step)
          if d.weekday() < 5:
              n -= step
      return d
  ```

## Rules

- Never edit `.github/`, `.boxops/`, this block or `CLAUDE.md`, and never change the BoxOps
  version, unless the user asks.
- Ids and file names never change once saved; a box's `id` equals its file name.
- If a command says the data format is newer or older than this BoxOps, stop and tell the user.
- No branches or pull requests for roadmap edits unless asked.

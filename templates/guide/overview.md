# BoxOps guide: overview

This repository is a team roadmap. The data is plain YAML in `roadmap/`; the
BoxOps web app on the repository's GitHub Pages site shows and edits it, and
every save from the app is a commit on `main`. You can do everything the app
does by editing the YAML files and pushing to `main`. The app isn't in this
repository: `.github/workflows/deploy.yml` pins a BoxOps release by commit,
and `node .boxops/boxops.mjs` runs that release's command-line tool, so this
guide always matches the BoxOps the site runs.

Other topics: `node .boxops/boxops.mjs guide recipes` (how to make each kind
of change), `guide commits` (commit messages), `guide format` (every file and
field, and what the validator checks) and `guide upgrading` (new BoxOps
releases and data formats).

## How the roadmap works

- **Departments** (`roadmap/departments/<id>.yaml`) contain **lanes**. A lane is
  anonymous capacity of 1 or 0.5 FTE, not a person. A lane can have `start`
  and `end` dates when it only exists for a while (a new hire, a contractor).
- **Boxes** (`roadmap/boxes/<id>.yaml`) are pieces of planned work. Each sits in
  a lane, runs from `start` to `end` (inclusive weekdays), needs 0.5–2 FTE, and
  can name the **engineers** working on it.
- **Engineers** are listed in `roadmap/people.yaml`, with any **PTO** (time
  off) they've booked as a `pto:` list of `start`/`end` dates and an optional
  `note`.
- **Codes.** People refer to boxes by code, like `DE-A1F`: the department's
  `code` plus the box's own 3-character `code`. To find the file for `DE-A1F`,
  `grep -lE '^code: "?A1F"?$' roadmap/boxes/*` (a code YAML would read as a
  number, like `"234"`, is quoted). The prefix follows the box's current
  department.
- **Rules** (`relations` on a box) say how boxes sit in time relative to each
  other: finishes before, starts after, happens during, starts when, ends
  when, runs at the same time as, doesn't overlap. Broken rules are warnings.
- A department is **over capacity** when, on some day, its boxes need more FTE
  than its lanes hold. An engineer is **overloaded** when their share of their
  boxes is over 1 FTE (a box's FTE is split evenly across its engineers). Both
  are warnings, not errors.
- There are **no weekends**: dates must be Monday–Friday and durations are
  counted in working days. "Two weeks" means 10 working days. Holidays aren't
  modelled: treat every weekday as a working day unless the user says
  otherwise, but point it out when work (especially on-call or a deadline)
  lands in a usual holiday period such as late December.

## Workflow

People edit the roadmap in the web app at the same time, and every app save is
a commit on `main`. So:

1. **Start from the latest `main`:** `git checkout main && git pull --ff-only`.
2. **Look before you change.** Save the report to a fresh file and note its
   path, since shell variables may not last between your commands:
   `B=$(mktemp) && node .boxops/boxops.mjs report > "$B" && echo "$B"`.
   The report shows over-capacity and fully booked departments, engineers over
   1 FTE (one line per stretch, at that stretch's level), engineers booked on
   a box during their PTO, every engineer's bookings and PTO by date (use that
   to answer "who's free then?": nobody is free while on PTO), unassigned
   boxes and broken rules. It covers all dates, past ones too.
3. **Edit the YAML files** (`node .boxops/boxops.mjs guide recipes`). Change
   only what you need: don't reformat files, reorder fields, or rewrite
   unrelated lines, and keep comments.
4. **Check your work:**
   - `node .boxops/boxops.mjs validate` must end in `— OK` (e.g.
     `3 departments, 9 lanes, 16 boxes — OK`). It lists any problem and exits
     non-zero (3 when the data format isn't this BoxOps's: stop and tell the
     user).
   - `node .boxops/boxops.mjs report | diff <before file> -` compares with
     step 2.
     Tell the user about anything your change made worse: a department newly
     over capacity or full, someone newly over 1 FTE or at a higher level,
     someone newly booked during their PTO, a rule now broken.
   - To see the roadmap as the app shows it, `node .boxops/boxops.mjs preview`
     serves this working copy at http://127.0.0.1:4173: read-only, showing
     each saved file within a second, until it's stopped (Ctrl-C), so start
     it in the background if you need the shell meanwhile.
5. **Commit to `main`.** Always `git pull --ff-only` right before committing
   (validate again if anything came in). Stage only the roadmap
   (`git add roadmap/`), never `git add -A`. Write the message the way the app
   does (`node .boxops/boxops.mjs guide commits`). Commits use the local git
   identity. If you normally add a trailer such as `Co-Authored-By:`, add it
   after a blank line at the end.
6. **Push:** `git push origin main`. Changes to `roadmap/` usually deploy
   within a minute, and open browser tabs pick them up within a few minutes.
7. **If the push is rejected** because someone saved meanwhile:
   `git pull --rebase`, then validate again and push. If the rebase conflicts
   in a file someone else also changed, stop and ask the user whose version to
   keep. Never force-push.

Don't open pull requests or create branches for roadmap edits unless asked:
the team's convention is that saves go straight to `main`. Changes to
`.github/`, `.boxops/`, `AGENTS.md` and `CLAUDE.md` are for a repository
admin (a push rule may refuse them from anyone else).

## The tools and the network

`node .boxops/boxops.mjs` needs Node.js 22.12 or later, and the network the
first time: it downloads the pinned release's tools once, and `preview`
downloads the app the first time it runs, into a cache outside the
repository (`$BOXOPS_CACHE`, else `$XDG_CACHE_HOME/boxops` or
`~/.cache/boxops`, else a folder in the temp folder). In a sandbox that has
the network only while it's set up, run `node .boxops/boxops.mjs version`
then, which fills the cache (and `preview` once, if you'll want it). With no
network at all, set `BOXOPS_CLI` to the `dist/boxops.mjs` of a copy of the
pinned release (a checkout of its commit, say): `preview` then uses the
`dist/app` beside it.

## Lane labels

A lane without a `name` is labelled by its position in its department: the
second lane is `FTE 2`. That's a position, not a size, so a 1.5-FTE box in the
second lane is still "Data Engineering / FTE 2".

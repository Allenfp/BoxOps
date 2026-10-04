# Working on the BoxOps roadmap (for AI assistants)

This repo is a team roadmap. The data is plain YAML in `roadmap/`; a web app in
`web/` (published at https://allenfp.github.io/BoxOps/) displays and edits it.
You can do everything the app does by editing the YAML files and pushing to
`main`. This file explains how.

Read [docs/data-format.md](docs/data-format.md) for the full file format. The
essentials are below.

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
  `grep -l "^code: A1F$" roadmap/boxes/*`. The prefix follows the box's
  current department.
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
2. **Look before you change.** From `web/` (run `npm ci` once first), save the
   report to a fresh file and note its path, since shell variables may not
   last between your commands:
   `B=$(mktemp) && npm run report --silent > "$B" && echo "$B"`.
   The report shows over-capacity and fully booked departments, engineers over
   1 FTE (one line per stretch, at that stretch's level), unassigned boxes,
   broken rules, and every engineer's bookings by date (use that to answer
   "who's free then?").
3. **Edit the YAML files** (recipes below). Change only what you need: don't
   reformat files, reorder fields, or rewrite unrelated lines, and keep comments.
4. **Check your work** from `web/`:
   - `npm run validate` must end in `— OK` (e.g. `3 departments, 9 lanes,
     16 boxes — OK`). It lists any problem and exits non-zero.
   - `npm run report --silent | diff <before file> -` compares with step 2.
     Tell the user about anything your change made worse: a department newly
     over capacity or full, someone newly over 1 FTE or at a higher level, a
     rule now broken.
5. **Commit to `main`.** Always `git pull --ff-only` right before committing
   (validate again if anything came in). Stage only the roadmap
   (`git add roadmap/`), never `git add -A`. Write the message the way the app
   does (see [Commit messages](#commit-messages)). Commits use the local git
   identity. If you normally add a trailer such as `Co-Authored-By:`, add it
   after a blank line at the end.
6. **Push:** `git push origin main`. Changes to `roadmap/` deploy in about 30
   seconds, and open browser tabs pick them up within a few minutes.
7. **If the push is rejected** because someone saved meanwhile:
   `git pull --rebase`, then validate again and push. If the rebase conflicts
   in a file someone else also changed, stop and ask the user whose version to
   keep. Never force-push.

Don't open pull requests or create branches for roadmap edits unless asked:
the team's convention is that saves go straight to `main`. Changes to the app
itself (`web/`) are different: do those on a branch, run `npm test` and
`npm run e2e`, and merge only when the user says to (merging deploys).

## Commit messages

Match the app, so history reads the same whichever way a change was made. With
exactly one change, the subject is that change (without any "(was …)" part, at
most 72 characters); otherwise it's `Roadmap: <n> changes`. The body has one
bullet per changed item, in this order: engineers, new boxes, edited boxes,
deleted boxes, departments; within each group, by file name. All of one box's
changes go on its one bullet. Word them like this (`<range>` is like
`2026-03-01 – 2026-03-19`: dates are always `YYYY-MM-DD`, as everywhere in the
app; a lane is `<Department> / <lane label>`; `<code>` is always the full code
with its prefix, like `DE-K7P`; quotes are curly “ ”):

| Change | Line |
|---|---|
| New box | `Added <title> (<code>) to <lane>, <range>` |
| Deleted box | `Deleted <title> (<code>, <lane>, <range>)` |
| Edited box | `<title> (<code>): ` then the parts that changed, joined by `; ` |
| … renamed | `renamed from “<old title>”` |
| … new lane | `moved from <old lane> to <new lane>` |
| … same length, new dates | `rescheduled to <range> (was <old range>)` |
| … other date change | `dates now <range> (was <old range>)` |
| … status, type or FTE | `status On track → Blocked`, `status At risk → On track`, `type <old> → <new>`, `FTE 1 → 1.5` (names, not ids; no status is "On track") |
| … engineers | `engineers now Sam Lee, Alex Kim` (or `engineers now nobody`) |
| … epic, description, tags, links | `epic link updated` / `epic link removed`, `description edited`, `tags edited`, `links edited` |
| … rule added or removed | `now finishes before <other title> (<code>)`, `no longer happens during <other title> (<code>)` |
| Department code changed | `<Department>'s code is now <NEW> (was <OLD>): its boxes are <NEW>-…` |
| … anything else | `edited` |
| Department added | `Added department <name> (<n> lanes, <fte> FTE)` |
| Department renamed, recoloured, deleted | `Renamed department <old> to <new>`, `Changed the colour of <name>`, `Deleted department <name>` |
| Departments reordered | `Reordered departments` |
| Lane added, removed, resized, reordered | `Added lane <label> (<fte> FTE) to <Department>`, `Removed lane <label> from <Department>`, `Lane <label> in <Department> is now 0.5 FTE (was 1)`, `Reordered the lanes in <Department>` |
| Lane renamed | `Renamed lane <old label> to <new label> in <Department>` |
| Lane dates changed | `Lane <label> in <Department> now runs until 2027-03-31 (was always open)`; the dates read `from <day>`, `until <day>` or `<day> – <day>`; cleared: `… is now always open (was …)`. A new dated lane: `Added lane <label> (1 FTE, from <day>) to <Department>` |
| Person added, edited or removed | `Added engineer <name>`, `Updated engineer <name>`, `Removed engineer <name>` (a PTO-only change has just its PTO lines) |
| PTO added, changed, removed | `PTO for <name>: <range> (<note>)` (no `(<note>)` without one), `PTO for <name>: <range> (was <old range>)`, `Removed PTO for <name>: <range>`; a single day is just that day |

For example:

```
Roadmap: 2 changes

- Added Data quality checks (DE-K7P) to Data Engineering / FTE 2, 2027-03-01 – 2027-03-19
- Updated engineer Jordan Diaz
```

The app ends its messages with "Saved from the BoxOps web app."; don't add that
to hand-made commits.

## Lane labels

A lane without a `name` is labelled by its position in its department: the
second lane is `FTE 2`. That's a position, not a size, so a 1.5-FTE box in the
second lane is still "Data Engineering / FTE 2".

## Recipes

Working-day arithmetic comes up often. In Python:

```python
from datetime import date, timedelta

def add_workdays(d: date, n: int) -> date:
    """Move d by n working days (n may be negative)."""
    step = 1 if n >= 0 else -1
    while n:
        d += timedelta(days=step)
        if d.weekday() < 5:
            n -= step
    return d

def workdays(start: date, end: date) -> int:
    """Working days from start to end, inclusive."""
    return sum((start + timedelta(i)).weekday() < 5 for i in range((end - start).days + 1))
```

**Add a box.** Pick an id `bx-<4 random hex digits>-<slug>` (the slug is the
title in lowercase, non-letters/digits replaced by `-`, at most 40 characters)
and a new 3-character `code` from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0, O,
1 or I). Check that no file has that id (`ls roadmap/boxes`) or that code
(`grep -h "^code:" roadmap/boxes/*`), and create `roadmap/boxes/<id>.yaml`:

```yaml
id: bx-3f9c-q3-planning
code: K7P
title: Q3 planning
lane: ml-1
start: 2027-06-07
end: 2027-06-18
type: research
```

Add `fte:` only if it isn't 1, and `engineers:` with ids from `people.yaml`.

*Choosing a lane:* use the department the work belongs to, and a lane that's
free for those dates (check the other boxes' `lane`, `start` and `end`). A box
over 1 FTE also covers the lane(s) below its own, so pick one whose next lane
is free too. The app redraws boxes into any free space in the department, so
the lane is a preference; the department and dates are what count for
capacity.

*Choosing engineers:* usually one per started FTE (one for 0.5–1, two for
1.5–2), from the same department. Use the bookings in `npm run report` to find
who's free over the box's dates. If several are equally free, say who you
picked and why, and offer the alternatives.

*When nobody is free:* if the only candidates would go over 1 FTE, and the user
asked you to staff it ("sort out their work" counts), assign the least loaded
one and say so plainly, with their resulting load and dates. Offer
alternatives: leave it unassigned, move the dates, or someone from another
department. If the user didn't ask for staffing, leave `engineers` out rather
than overloading someone. Keeping people who are already on a box isn't a new
assignment.

**Move or reschedule a box.** Change `start` and `end`. To keep its length,
shift both by the same number of working days. To move it to another lane or
department, change `lane`.

**Resize, re-staff or update a box.** Edit `end`, `fte`, `engineers`,
`description` and so on in place. Progress (not started, under way, finished)
comes from the dates, so there's nothing to update when work starts or ends.

**Flag a problem.** Set `status:` to `at_risk`, `late` or `blocked` (after
`type`); delete the line once it's resolved. Most boxes have no `status`.

**Delete a box.** Delete its file, and remove any `relations` entries on other
boxes that point at its code (`grep -l "box: <code>" roadmap/boxes/*`).

**Relate two boxes.** Add to the box the rule is about:

```yaml
relations:
  - type: before        # before, after, during, starts_with, ends_with, overlaps, apart
    box: M8T            # the other box's code (example; use a real one)
```

Check with `npm run report` whether the rule holds today; a broken rule is
allowed but tell the user. The full table of rules is in
[docs/data-format.md](docs/data-format.md#rules-between-boxes).

**Move a box to another department.** Change its `lane`. Its code stays the
same; only the prefix people see changes (DE-A1F becomes AN-A1F).

**Add an engineer.** Append to `people:` in `roadmap/people.yaml` with a new
id (a slug of their name, unique), `name`, and ideally `department`. Fields go
in this order: `id`, `name`, `department`, `role`, `email`, `manager`, `notes`,
`pto`.

**Edit an engineer.** Change or add fields on their entry in the order above.
Never change their `id`: boxes refer to it.

**Book PTO.** Add an entry to the engineer's `pto:` list (create it after
`notes` if missing), with weekday `start` and `end` (inclusive; a Friday–Monday
trip is `start` Friday, `end` Monday) and an optional short `note`:

```yaml
    pto:
      - start: 2026-12-14
        end: 2026-12-25
        note: Holiday
```

PTO shows in the engineer's department on the timeline and table. It doesn't
reduce capacity, but an engineer on a box during PTO is a warning: tell the
user about any boxes it overlaps. Delete the `pto:` key when removing the last
entry.

**A lane that comes or goes.** For a new hire, give a new lane `start:` (their
first day); for a contractor or someone leaving, give their lane `end:` (the
last day). Weekdays only; keys go after `fte`. Then check `npm run report`:
boxes in the lane outside its dates count against the rest of the department
and may push it over capacity, so tell the user.

**Remove an engineer.** Delete their entry *and* remove their id from every
box's `engineers` list (`grep -rl "<id>" roadmap/boxes`). Delete an emptied
`engineers:` key rather than leaving an empty list.

**Someone leaving on a future date.** Keep them on the roster until then (they
still own their earlier boxes) and note the date in their `notes`. Then, for
each of their boxes:

- *Ends on or before their last day:* leave it.
- *Starts after their last day:* take them off it, and staff it as above.
- *Spans their last day (flagged or not):* ask the user unless they
  said. Either hand the whole box to someone else, or split it: end the box on
  their last day, and add a box from the next working day titled
  `<title> (part 2)` with the rest of the work, a description pointing back to
  the original's code, and the new engineer. When a box several people share
  is split, the FTE is split evenly across whoever's left, so lower part 2's
  `fte` by the leaver's share (to an allowed value) unless someone replaces
  them.

Remove them from the roster only once none of their boxes are left, or if the
user asks.

**Rename a lane.** Set or change the lane's `name`. Never change a lane `id`
without updating every box that uses it.

**Add a lane or department.** A new department needs a unique `code` (2–4
capital letters/digits, usually its initials). Lane ids must be unique across all departments;
follow the department's pattern (`de-1`, `de-2` → `de-3`), or use
`<department id>-<n>` for a new department. A new department is a new file
whose `id` matches its file name; give it an `order` after the others and a
`color`. (People can do this in the app too, from **+ Add department** or the
pencil on a department heading.)

**Remove a lane or department.** First move its boxes: set each affected box's
`lane` to a lane that stays. Then delete the lane entry, or the department
file. For a department, also delete `department:` from people who had it.
Renumber the remaining departments' `order` 1, 2, 3… if you like; only the
order matters.

**Answer questions.** `npm run report` covers capacity, overloads, unassigned
boxes and each engineer's bookings by date. The files are small and greppable
too: `grep -l "sam-lee" roadmap/boxes/*` finds Sam's boxes.

## Rules

- IDs and file names never change once saved. `id` must equal the file name.
- Dates are weekdays, inclusive, `YYYY-MM-DD`, and `end` is not before `start`.
- `fte` on a box is 0.5, 1, 1.5 or 2; on a lane, more than 0 and at most 1.
- Everything a box refers to must exist: `lane`, `type`, `status` if set (in
  `settings.yaml`) and each `engineers` id.
- Always run `npm run validate` before pushing; never push a failing roadmap.
- Stage only `roadmap/` for roadmap changes.
- Pull before editing and never force-push: people save from the app all the
  time.

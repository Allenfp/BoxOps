# BoxOps guide: recipes

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
1 or I), not all digits and not digit-E-digit like `2E5` (YAML would read
those as numbers). Check that no file has that id (`ls roadmap/boxes`) or that
code (`grep -h "^code:" roadmap/boxes/*`), and create
`roadmap/boxes/<id>.yaml`:

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
1.5–2), from the same department. Use the bookings in `node .boxops/boxops.mjs report` to find
who's free over the box's dates; someone with PTO then isn't. If several are
equally free, say who you picked and why, and offer the alternatives.

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
  - type: before # before, after, during, starts_with, ends_with, overlaps, apart
    box: M8T # the other box's code (example; use a real one)
```

Check with `node .boxops/boxops.mjs report` whether the rule holds today; a broken rule is
allowed but tell the user. The full table of rules is in
`node .boxops/boxops.mjs guide format` (Rules between boxes).

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
user about any boxes it overlaps (`node .boxops/boxops.mjs report` lists them under "Engineers
booked during PTO"). Delete the `pto:` key when removing the last entry.

**A lane that comes or goes.** For a new hire, give a new lane `start:` (their
first day); for a contractor or someone leaving, give their lane `end:` (the
last day). Weekdays only; keys go after `fte`. Then check `node .boxops/boxops.mjs report`:
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

**Answer questions.** `node .boxops/boxops.mjs report` covers capacity, overloads, PTO clashes,
unassigned boxes and each engineer's bookings and PTO by date. The files are
small and greppable too: `grep -l "sam-lee" roadmap/boxes/*` finds Sam's boxes.

## Rules

- IDs and file names never change once saved. `id` must equal the file name:
  a copied file whose `id` wasn't changed is skipped (and fails validation).
- Dates are weekdays, inclusive, `YYYY-MM-DD`, and `end` is not before `start`.
- `fte` on a box is 0.5, 1, 1.5 or 2; on a lane, 0.5 or 1.
- Colours are `"#rrggbb"` (quoted); `epic` and `links` are `http(s)://` links.
  Quote text YAML would read as a number or `true`/`false` (`title: "1.10"`).
- Leave `format` in `settings.yaml` alone: it's the data format version, and
  only `node .boxops/boxops.mjs migrate` changes it.
- Everything a box refers to must exist: `lane`, `type`, `status` if set (in
  `settings.yaml`) and each `engineers` id.
- Always run `node .boxops/boxops.mjs validate` before pushing; never push a
  failing roadmap.
- Stage only `roadmap/` for roadmap changes.
- Pull before editing and never force-push: people save from the app all the
  time.

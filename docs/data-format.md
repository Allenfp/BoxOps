# Roadmap data format

Everything the roadmap shows lives in `roadmap/` as YAML. The web app reads and
writes these files; you can also edit them by hand. Every push to `main` is
checked by the same validator the app uses (`cd web && npm run validate`), and
an invalid roadmap is not deployed.

```
roadmap/
  settings.yaml           title, fiscal year, box types, status flags
  people.yaml             the engineer roster
  departments/<id>.yaml   one file per department, with its lanes
  boxes/<id>.yaml         one file per box (a piece of planned work)
```

Any other file under `roadmap/` is reported as unexpected.

## Common rules

- **IDs** are lowercase letters, digits, `-` and `_`, starting with a letter or
  digit (`^[a-z0-9][a-z0-9_-]*$`). A department's or box's `id` must equal its
  file name without `.yaml`. IDs never change once saved: other files refer to
  them.
- **Dates** are `YYYY-MM-DD`. A box's `start` and `end` are **inclusive** and
  must be **weekdays**: the roadmap has no weekends. Durations are counted in
  working days (Monday–Friday).
- **Codes.** Every department has a short code (`DE`) and every box a
  3-character code (`A1F`); people refer to a box as `DE-A1F`. A box's code is
  unique across the roadmap and never changes. The prefix is always its
  current department's code, so it changes if the box moves.
- **FTE** (full-time equivalent) measures capacity. A lane holds 1 or 0.5 FTE;
  a box needs 0.5, 1, 1.5 or 2.
- Optional fields can be left out. An empty string or empty list means the same
  as leaving the field out.
- Fields the app doesn't know about are kept untouched when the app edits a
  file, and so are comments.

## settings.yaml

Edited by hand or in the app (gear menu, **Team settings**). A box type or flag that boxes still use can't be removed in the app; there is always at least one of each.

```yaml
title: BoxOps
fiscal_year_start_month: 1   # 1 = calendar quarters; 2 = FY starts in February, etc.
default_zoom: months          # weeks | months | quarters
types:
  - id: project
    name: Project
    color: "#4f7cff"
statuses:
  - id: at_risk
    name: At risk
```

| Field | Required | Meaning |
|---|---|---|
| `title` | no | Shown in the toolbar and browser tab. Default `Roadmap`. |
| `fiscal_year_start_month` | no | 1–12. Quarter labels follow it (`FY27 Q1` when it isn't 1). Default 1. |
| `default_zoom` | no | `weeks`, `months` or `quarters`. Default `months`. |
| `types` | yes* | Kinds of box, each with `id`, `name` and `color` (CSS colour). A box's `type` must be one of these ids. |
| `statuses` | no | Flags for boxes that need attention, each with `id` and `name`. A box's `status`, if it has one, must be one of these ids. |

\* If missing, a single default type (`project`) is used. If `statuses` is
missing, the flags are `at_risk`, `late` and `blocked`.

The current flags are `at_risk` (At risk), `late` (Late) and `blocked`
(Blocked); the types are `project`, `maintenance`, `research` and `support`.

A box's progress isn't stored: the app works it out from the dates (not
started before `start`, under way until `end`, finished after). `status` is
only for flagging a problem, and most boxes have none ("on track").

## departments/&lt;id&gt;.yaml

```yaml
id: data-eng
code: DE
name: Data Engineering
color: "#4f7cff"
order: 1
lanes:
  - id: de-1
    fte: 1
  - id: de-4
    name: Contractor
    fte: 0.5
    end: 2027-03-31   # contract ends
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Must match the file name. |
| `code` | yes | 2–4 capital letters or digits, starting with a letter; unique. Prefixes its boxes' codes. Changing it relabels every box in the department (box files don't change). |
| `name` | yes | Shown as the department heading. |
| `color` | no | Department colour. Default `#8a94a6`. |
| `order` | no | Departments are shown by `order`, then name. Default 0. |
| `collapsed` | no | `true` to start collapsed. |
| `lanes` | no | The department's capacity, top to bottom. |

Each lane:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | **Unique across all departments**; boxes refer to a lane by this id alone. |
| `name` | no | Label. Without one, the lane shows as `FTE 1`, `FTE 2`… by position. |
| `fte` | no | Capacity: more than 0, at most 1. Default 1. |
| `start` | no | First weekday the lane exists (a new hire's lane). Without it, the lane has always existed. |
| `end` | no | Last weekday the lane exists (a contractor's last day). Without it, the lane never closes. |

A lane is anonymous capacity, not a person. A department's capacity on a day
is the sum of the FTE of its lanes that exist that day (all of them, unless
some have `start` or `end`). Outside its dates a lane is hatched out on the
timeline and no box is drawn in it.

## boxes/&lt;id&gt;.yaml

```yaml
id: bx-b27c-fivetran-cost-review
code: H2B                      # example values throughout
title: Fivetran cost review
lane: de-1
start: 2026-12-07
end: 2027-01-15
type: maintenance
status: blocked                # optional; leave out when on track
fte: 1.5
engineers:
  - jordan-diaz
  - sam-lee
relations:
  - type: after
    box: M8T
epic: https://example.atlassian.net/browse/DATA-42
description: Audit connector usage and cut unused syncs.
tags:
  - cost
links:
  - https://example.com/notes
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Must match the file name. New boxes use `bx-<4 hex digits>-<slug of the title>`, e.g. `bx-7f3a-q2-planning`. |
| `code` | yes | Exactly 3 capital letters or digits, unique across all boxes, never changed. Shown as `<department code>-<code>`. New codes avoid look-alikes (0/O, 1/I). |
| `title` | yes | Shown on the box. |
| `lane` | yes | The lane it sits in (any department). |
| `start`, `end` | yes | Inclusive weekday dates; `end` on or after `start`. |
| `type` | yes | One of the `types` in settings. |
| `status` | no | A flag: one of the `statuses` in settings (`at_risk`, `late`, `blocked`). Leave it out when the box is on track; delete the line to clear a flag. |
| `fte` | no | 0.5, 1, 1.5 or 2. Default 1, so it's usually left out for 1-FTE boxes. |
| `engineers` | no | Ids from `people.yaml`. Usually one engineer per started FTE (one for 0.5–1, two for 1.5–2). |
| `relations` | no | Rules relating this box to others: a list of `type` (below) and `box` (the other box's 3-character code; the full `DE-M8T` form is also accepted). |
| `epic` | no | `http(s)://` link to the epic or ticket. If it's a Jira link (`/browse/DATA-42`, `?selectedIssue=DATA-42`), the timeline and table label the box `DATA-42` instead of its code; the editor still shows the code. |
| `description` | no | Free text; may span lines. |
| `tags`, `links` | no | Lists of text. |

The app writes fields in the order shown above, inserting new fields where they
belong rather than at the end.

### Rules between boxes

A rule says how this box should sit in time relative to another. Dates are
inclusive working days.

| `type` | Reads as | Broken when |
|---|---|---|
| `before` | this box finishes before the other starts | this box's `end` is on or after the other's `start` |
| `after` | this box starts after the other finishes | this box's `start` is on or before the other's `end` |
| `during` | this box happens during the other | it starts before the other starts, or ends after it ends |
| `starts_with` | starts when the other starts | the `start` dates differ |
| `ends_with` | ends when the other ends | the `end` dates differ |
| `overlaps` | runs at the same time as the other | they share no days |
| `apart` | doesn't overlap the other | they share any day |

A rule lives on one box; the app also shows it on the other box, worded the
other way round ("starts after DE-H2B finishes"). Broken rules are warnings,
like over capacity: nothing is blocked. Deleting a box in the app also removes
rules that point at it.

### FTE and capacity

A box's **scale** is its `fte` times its working days (a 1.5-FTE box over 10
working days has scale 15). It isn't stored: the app shows it on the box, right
of the engineers' initials, and in the table's Scale column. Hovering the
number shows it in weeks, months and quarters of one engineer's time (5, 20
and 60 Eng Days, where an Eng Day is one engineer's working day) and the share of the department's capacity the box takes while
it runs (its FTE ÷ the department's FTE).

A box is drawn as tall as its FTE and sits in its own lane when there's room:
a 2-FTE box also covers the lane below it, and two 0.5-FTE boxes can share a
1-FTE lane. If its lane is taken at those dates, the app draws it in the nearest
free space in the department.

A department is **over capacity** on any working day when the FTE of the boxes
running that day is more than its lanes add up to. Over capacity is a warning,
not an error: it's allowed, and the app shows it in red. An engineer is
**overloaded** when their share of the boxes they're on is more than 1 FTE on
some day; a box's FTE is split evenly across its engineers.

`cd web && npm run report` lists both, plus boxes with no engineer.

## people.yaml

```yaml
# Engineers who can be assigned to boxes.
people:
  - id: sam-lee
    name: Sam Lee
    department: data-eng
    role: Senior Data Engineer
    email: sam@example.com
    manager: Dana Whitfield
    notes: |-
      Owns the Dagster migration.
    pto:
      - start: 2026-12-14
        end: 2026-12-25
        note: Holiday
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique. New people use a slug of their name (`sam-lee`; `sam-lee-2` if taken). |
| `name` | yes | Shown everywhere. |
| `department` | no | A department id; they're listed first in that department's pickers. |
| `role` | no | Job title. |
| `email` | no | Must look like an email address. |
| `manager` | no | Free text; managers needn't be on the roster. |
| `notes` | no | Free text; may span lines. |
| `pto` | no | Time off: a list of `start` and `end` (inclusive weekday dates, `end` on or after `start`) and an optional `note`. |

PTO is drawn as blocks in the engineer's department on the timeline and listed
in the table, where it's edited; the People tab lists it read-only. It doesn't
change capacity, but an engineer on a box during their PTO is a warning.

Removing someone from the roster also means removing their id from every box's
`engineers` list; otherwise validation fails.

## What the validator checks

`npm run validate` (and every deploy) fails on:

- YAML that doesn't parse, or a file that isn't a mapping at the top level
- missing required fields, or fields of the wrong kind
- malformed or impossible dates; `end` before `start`; weekend dates
- ids that don't match the file name, aren't valid, or are used twice
- a lane id used in two departments
- a box whose `lane`, `type`, `status` or `engineers` don't exist
- a missing or malformed department or box `code`, or one used twice
- a rule with an unknown `type`, pointing at a box code that doesn't exist, or
  pointing at its own box
- a box `fte` other than 0.5, 1, 1.5 or 2; a lane `fte` outside (0, 1]
- a lane `start` or `end` that's malformed or on a weekend, or `end` before `start`
- a person's `department` that doesn't exist, or an invalid `email`
- PTO with malformed or weekend dates, or `end` before `start`
- unexpected files in `roadmap/`

Over capacity, overloaded engineers and broken rules are not validation
errors; `npm run report` lists them.

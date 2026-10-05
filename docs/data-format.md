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

Any other file under `roadmap/` is reported as unexpected. Hidden paths are
skipped without a word, whatever they are: a path with any part starting with
`.` (`.DS_Store`, `boxes/.#b1.yaml`, anything in `.cache/`), even a symlink or
a submodule. (Department and box files may also end in `.yml`.) Everything
else under `roadmap/` must be a plain file: a symlink or a submodule is an
error that stops validation and the build, and so is a roadmap file that
isn't UTF-8 text or is over 1 MiB. A roadmap file git has as executable (mode
100755) is read like any other, with a warning in the build's log.

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
- **Colours** are hex, `"#rrggbb"` (quoted, since `#` starts a comment), as the
  app's colour pickers write them. **Links** (`epic`, `links`) start with
  `http://` or `https://`.
- Optional fields can be left out. An empty string, an empty list or a key
  with nothing after it (`status:`) means the same as leaving the field out.
- The files are **YAML 1.2**: only `true` and `false` are booleans (`yes`,
  `no`, `on` and `off` are text). Text that YAML would read as a number, a
  boolean or a date must be quoted: `code: "234"`, `code: "2E5"`, `title:
  "1.10"`. Unquoted, it's a validation error, never silently converted.
- Fields the app doesn't know about are kept untouched when the app edits a
  file, and so are comments. (A comment at the end of a line that starts a
  list, like `statuses: # flags`, moves to its own line above the list, and
  the spacing before an end-of-line comment becomes one space. A PTO entry
  moved to dates that don't overlap where it was, or a rule pointed at
  another box, is written as a new entry, without the old one's extra fields
  and comments.)
- `settings.yaml` says which version of this format the files use: see
  [Format versions](#format-versions).

## settings.yaml

Edited by hand or in the app (gear menu, **Team settings**). A box type or flag that boxes still use can't be removed in the app; there is always at least one of each.

```yaml
format: 1 # BoxOps data format; don't change it by hand
title: BoxOps
fiscal_year_start_month: 1 # 1 = calendar quarters; 2 = FY starts in February, etc.
default_zoom: months # weeks | months | quarters
types:
  - id: project
    name: Project
    color: "#4f7cff"
statuses:
  - id: at_risk
    name: At risk
```

The file must exist, even though every field but `format` has a default.

| Field | Required | Meaning |
|---|---|---|
| `format` | yes | The data format version, `1`. See [Format versions](#format-versions). |
| `title` | no | Shown in the toolbar and browser tab. Default `Roadmap`. |
| `fiscal_year_start_month` | no | 1–12. Quarter labels follow it (`FY27 Q1` when it isn't 1). Default 1. |
| `default_zoom` | no | `weeks`, `months` or `quarters`. Default `months`. |
| `types` | no | Kinds of box, each with `id`, `name` and `color` (`"#rrggbb"`). A box's `type` must be one of these ids. Default: one type, `project`. |
| `statuses` | no | Flags for boxes that need attention, each with `id` and `name`. A box's `status`, if it has one, must be one of these ids. Default: `at_risk`, `late` and `blocked`. |

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
    end: 2027-03-31 # contract ends
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Must match the file name. |
| `code` | yes | 2–4 capital letters or digits, starting with a letter; unique. Prefixes its boxes' codes. Changing it relabels every box in the department (box files don't change). |
| `name` | yes | Shown as the department heading. |
| `color` | no | Department colour, `"#rrggbb"`. Default `#8a94a6`. |
| `order` | no | Departments are shown by `order`, then name. Default 0. |
| `collapsed` | no | `true` to start collapsed; default `false`. |
| `lanes` | no | The department's capacity, top to bottom. |

Each lane:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | **Unique across all departments**; boxes refer to a lane by this id alone. |
| `name` | no | Label. Without one, the lane shows as `FTE 1`, `FTE 2`… by position. |
| `fte` | no | Capacity: 0.5 or 1. Default 1. |
| `start` | no | First weekday the lane exists (a new hire's lane). Without it, the lane has always existed. |
| `end` | no | Last weekday the lane exists (a contractor's last day). Without it, the lane never closes. |

A lane is anonymous capacity, not a person. A department's capacity on a day
is the sum of the FTE of its lanes that exist that day (all of them, unless
some have `start` or `end`). Outside its dates a lane is hatched out on the
timeline and no box is drawn in it.

## boxes/&lt;id&gt;.yaml

```yaml
id: bx-b27c-fivetran-cost-review
code: H2B # example values throughout
title: Fivetran cost review
lane: de-1
start: 2026-12-07
end: 2027-01-15
type: maintenance
status: blocked # optional; leave out when on track
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
| `epic` | no | `http(s)://` link to the epic or ticket. If it's a Jira issue link (`/browse/DATA-42`, `?selectedIssue=DATA-42` or `/projects/DATA/issues/DATA-42`) or a Linear one (`linear.app/<team>/issue/ENG-12`), the timeline and table label the box `DATA-42` instead of its code; the editor still shows the code. Other links (a GitHub repo, a wiki page) are never taken for an issue. |
| `description` | no | Free text; may span lines. |
| `tags`, `links` | no | Lists of text; each link an `http(s)://` link. |

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
and 60 working days of one engineer) and the share of the department's
capacity the box takes while it runs (its FTE ÷ the department's FTE).

A box is drawn as tall as its FTE and sits in its own lane when there's room:
a 2-FTE box also covers the lane below it, and two 0.5-FTE boxes can share a
1-FTE lane. If its lane is taken at those dates, the app draws it in the nearest
free space in the department.

A department is **over capacity** on any working day when the FTE of the boxes
running that day is more than its lanes add up to. Over capacity is a warning,
not an error: it's allowed, and the app shows it in red. An engineer is
**overloaded** when their share of the boxes they're on is more than 1 FTE on
some day; a box's FTE is split evenly across its engineers.

`cd web && npm run report` lists both, past and future, plus engineers on a box
during their PTO, every engineer's bookings and PTO by date, boxes with no
engineer and broken rules. (The app warns about over capacity and PTO from
today on.)

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

`npm run validate` (and every deploy) fails on any of these. Those marked \*
leave something out of the roadmap the app loads (the value, the entry or the
whole file), so the app won't save changes to that file until it's fixed by
hand: writing it would delete what was left out. The others only flag a
problem.

Any file:

- YAML that doesn't parse, or a file that isn't a mapping at the top level\*
- a YAML alias (`*name`, standing for the value marked `&name`)\*: nothing is
  left out, but the app won't save the file either, as an edit to one would
  change the other too
- a text field that YAML reads as something else: a number (`2E5`, `1.10`),
  `true`/`false`, a date (under a `%YAML 1.1` header), a list or a mapping\*;
  or a required one it reads as empty (`title: Null`, `name: ~`)\*
- a missing required field of a type, flag, department, lane, box, person or
  PTO entry\* (a department without a `code` still loads)
- a list (`types`, `statuses`, `lanes`, `people`, `pto`, `relations`,
  `engineers`, `tags`, `links`) that isn't one, or an entry of the wrong
  kind\*
- a file in `roadmap/` other than `settings.yaml`, `people.yaml`,
  `departments/<id>.yaml` and `boxes/<id>.yaml`

`settings.yaml`:

- a missing `settings.yaml`
- a missing `format`, one that isn't a whole number from 1 up, or one newer
  than this BoxOps reads (see [Format versions](#format-versions))
- a `fiscal_year_start_month` that isn't 1–12, or a `default_zoom` that isn't
  `weeks`, `months` or `quarters`\*
- a type or flag whose `id` isn't valid or is used twice\*, or a type whose
  `color` isn't `"#rrggbb"`\*

Departments and boxes:

- an `id` that isn't valid or doesn't match the file name\*, or that two
  files use (`x.yaml` and `x.yml`)\*
- a file name Windows reserves (`con`, `prn`, `aux`, `nul`, `com1`–`com9`,
  `lpt1`–`lpt9`), since the repo couldn't be checked out there
- a missing or malformed department `code`, or one another department has
  (reported on both)
- a department `color` that isn't `"#rrggbb"`\*, an `order` that isn't a
  number\*, or a `collapsed` that isn't `true` or `false`\*
- a lane `id` that isn't valid\*, is used twice in its department\*, or is
  used in another department (reported on both; left out of the one that
  sorts later\*)
- a lane `fte` other than 0.5 or 1\*; a lane `start` or `end` that's
  malformed\* or on a weekend; a lane `end` before its `start`\*
- a malformed box `code`\*, or one another box has (reported on both)
- malformed box dates\* or `end` before `start`\*; weekend dates
- a box whose `lane` no department has\*, or whose `type` or `status` isn't in
  `settings.yaml`
- a box `fte` other than 0.5, 1, 1.5 or 2\*
- `engineers` not in `people.yaml`, or listed twice
- a rule with an unknown `type`\* or a `box` that isn't a code\*; a rule
  pointing at a code no box has, at its own box, or listed twice
- an `epic` or a `links` entry that isn't an `http(s)://` link\*

`people.yaml`:

- a person `id` that isn't valid or is used twice\*
- a `department` that doesn't exist, or an `email` that doesn't look like one
- PTO with malformed dates\* or `end` before `start`\*; weekend PTO dates

Over capacity, overloaded engineers, engineers booked during PTO and broken
rules are not validation errors; `npm run report` lists them.

`npm run validate -- <folder>` (and `npm run report -- <folder>`) checks a
roadmap folder other than `../roadmap`; a relative `<folder>` is relative to
where you run `npm`.

## Format versions

`format` in `settings.yaml` says which version of this file format the
roadmap is in. This BoxOps reads and writes format **1**, frozen as of BoxOps
0.1.0: the rules on this page.

- A roadmap without `format` counts as format 0. It opens read-only in the app
  and fails validation until `format: 1` is added to `settings.yaml`. (Later
  releases will do that, and any other change of format, with a `migrate`
  command.)
- A roadmap in a newer format opens read-only too, and fails validation. A
  tab left open from before an upgrade to a newer format won't save once the
  upgrade is merged: it says "BoxOps is being upgraded; reload in a minute"
  (its banner, that BoxOps is probably being upgraded). Unsaved changes made
  in the old format can't be opened by the upgraded BoxOps: after reloading,
  it offers them only as a download (JSON), to make again.
- Anything an older BoxOps would read wrongly or damage needs a new format
  number: a new field or value it would drop or mangle, or a stricter rule.
  Only a minor release (0.2.0, not 0.1.1) may change the format.

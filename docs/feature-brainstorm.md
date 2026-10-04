# Feature brainstorm

Ideas for BoxOps, roughly ordered by value for effort. Update the **Status**
column as items are built: `Idea`, `In progress`, `Done (<date>)` or `Dropped`.

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Time off (PTO) | Built, not deployed | PTO blocks on the timeline and table, stored per engineer in `people.yaml`; the People tab lists it read-only; a warning when someone is on a box during PTO. Doesn't reduce capacity yet. |
| 2 | Engineer load view | Idea | |
| 3 | Unstaffed demand | Idea | |
| 4 | Rules that cascade | Idea | |
| 5 | Baseline and slippage | Idea | |
| 6 | History | Idea | |
| 7 | Milestones | Idea | |
| 8 | Flag details | Idea | |
| 9 | Filters, saved views and deep links | Idea | |
| 10 | Export | Idea | |
| 11 | Change digest | Idea | |
| 12 | Jira sync | Idea | |
| 13 | Lane start and end dates | Built, not deployed | Optional `start` and `end` on a lane, set in the department editor. Capacity, over-capacity warnings and the timeline follow them. |
| 14 | Box scale | Built, not deployed | FTE × working days, shown right of the initials on each box, in the editor and tooltip, and as a sortable table column. Not stored. |

## Planning and capacity

1. **Time off.** Engineers get PTO with dates. Today, people write it in their
   notes ("Out for two weeks in December"). Later, PTO could lower capacity on
   those days so over-capacity and overload warnings match reality.
2. **Engineer load view.** A per-person strip or heatmap on the People tab
   showing how much FTE each engineer carries week by week, with overloaded
   stretches in red. `npm run report` already works this out; the UI doesn't
   show it.
3. **Unstaffed demand.** A "Needs a lane" row for boxes that no one has capacity
   for yet, plus a quarterly summary of demand against supply in FTE per
   department. This makes the case for hiring.
4. **Rules that cascade.** When a box moves, offer to move the boxes that depend
   on it ("Move 3 later boxes too?"). Draw the rule arrows on the timeline when
   a box is selected.

## Tracking over time

5. **Baseline and slippage.** Save a snapshot of the plan at the start of each
   quarter, then show the original dates as faint ghosts behind boxes that have
   moved, so "slipped 3 weeks" is visible at a glance.
6. **History.** Every save is a git commit, so a box's editor can show its
   change log. Add a "view the roadmap as of…" date picker and a diff between
   two dates.
7. **Milestones.** Dated markers such as launches, code freezes and board
   meetings, drawn as vertical lines like the Today line. A box can have a
   "must finish before" milestone.
8. **Flag details.** A flag can carry a reason and the date it was set
   ("Blocked by vendor contract, since Sep 12"). The app could also suggest
   Late automatically when a box's end date passes while it's still marked
   under way.

## Sharing and integrations

9. **Filters, saved views and deep links.** Filter by tag, type, person or
   flag, and keep the filter in the URL so a link like "Platform's at-risk
   work" can be pasted into Slack. Each box also gets its own link.
10. **Export.** Export the visible timeline as PNG or PDF for slides, and the
    data as CSV for spreadsheets.
11. **Change digest.** Commit messages already describe each change ("status On
    track → Blocked"). A scheduled action posts a weekly "what changed on the
    roadmap" summary to Slack or email.
12. **Jira sync.** Boxes already link to epics, so pull each epic's status and
    percent complete into the box, and raise a flag automatically when Jira and
    the roadmap disagree.

## Added later

13. **Lane start and end dates.** A lane (capacity) can exist for a set
    period, for example a contractor until March or a new hire from January.
    Capacity and over-capacity warnings take this into account.
14. **Box scale.** Each box shows a "scale" figure: FTE × working days, a
    rough measure of how much work it is.

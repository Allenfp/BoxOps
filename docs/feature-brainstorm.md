# Feature brainstorm

Ideas for BoxOps, roughly ordered by value for effort. Update the **Status**
column as items are built: `Idea`, `In progress`, `Done (<date>)` or `Dropped`.

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Time off (PTO) | Done (2026-10-03) | PTO blocks on the timeline and table, stored per engineer in `people.yaml`; the People tab lists it read-only; a warning when someone is on a box during PTO. Doesn't reduce capacity yet. |
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
| 13 | Lane start and end dates | Done (2026-10-03) | Optional `start` and `end` on a lane, set in the department editor. Capacity, over-capacity warnings and the timeline follow them. |
| 14 | Box scale | Done (2026-10-03) | FTE × working days, shown right of the initials on each box, in the editor and tooltip, and as a sortable table column. Not stored. The underlined number shows a short hover card: the sum in Eng Days, weeks/months/quarters (FTE per Month = ~20), and the share of the department it takes while it runs. |
| 15 | Jira key as the box label | Done (2026-10-03) | A box whose epic link is a Jira issue shows that key (DATA-123) on the timeline and table instead of its BoxOps code. The code stays in the editor and tooltip, and rules still use it. Table search matches either. |
| 16 | Polish pass | Done (2026-10-04) | Line icons instead of Unicode symbols; a calm grey segmented control; department colour only as the stripe; no on-screen instructions (tips moved to the Key); two-line department labels; over capacity as a warning edge on the boxes; a thin Today line; dates as YYYY-MM-DD text everywhere; right-aligned number columns; one style for add buttons; the box editor in sections, with empty optional fields hidden and the footer pinned. |
| 17 | Settings menu | Done (2026-10-04) | A gear menu with personal preferences kept in the browser (theme incl. system, density, what boxes show, opening zoom and view, PTO rows, hide finished), the key, keyboard shortcuts, token and discard, and **Team settings** that edit settings.yaml through the normal save. |
| 18 | Table date filter | Done (2026-10-04) | From/To dates at the top of the table show the boxes and PTO that overlap them; a **Hide completed** switch hides boxes that ended before today (the same preference as the gear menu's "Hide finished boxes", so it applies to the timeline too). A first step towards #9. |
| 19 | Capacity chart on collapsed departments | Done (2026-10-04) | A collapsed department's row shows how much of its capacity the boxes use, week by week (average FTE used ÷ FTE of open lanes), as a **line** or **bars**: a gear-menu choice under Timeline → Collapsed rows, with **Boxes** for the old squeezed boxes. One scale for every department (0–125%), a dashed 100% line, anything over it in the warning colour. Hovering a week gives the figures and any day in it that was over capacity. Finished boxes count even when hidden. |

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
15. **Jira key as the box label.** When a box's epic link points at a Jira
    issue, the box is labelled with the issue key instead of its BoxOps code.
16. **Polish pass.** A round of visual clean-up so the app reads as one
    designed product (details in the table).
17. **Settings menu.** Personal display preferences in the browser, plus team
    settings saved to `settings.yaml`.
18. **Table date filter.** A date range and a Hide completed switch on the table.
19. **Capacity chart on collapsed departments.** A collapsed department shows
    a small line or bar chart of the share of its capacity in use.

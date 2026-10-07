# BoxOps guide: commit messages

Match the app, so history reads the same whichever way a change was made. The
body has one bullet per line below, in this order: engineers (those added,
then changed, then removed, in roster order, each followed by its PTO lines),
new boxes in the order they were added, edited and then deleted boxes by file
name, departments added or changed in the order they're shown (by `order`,
then name), deleted departments, `Reordered departments`, team settings. All
of one box's changes go on its one bullet; a department gets a bullet per
change (each lane's too), and an engineer one per PTO entry. With exactly one
bullet, the subject is that bullet (without its "(was …)" parts, at most 72
characters); otherwise it's `Roadmap: <n> changes`, where `<n>` is the
number of bullets, with a thousands separator (`Roadmap: 1,200 changes`;
the app's Save button counts the same way). Word them
like this (`<range>` is like `2026-03-02 – 2026-03-20`: dates are always
`YYYY-MM-DD`, as everywhere in the app; a lane is `<Department> / <lane
label>`; `<code>` is always the full code with its prefix, like `DE-K7P`;
quotes and apostrophes are curly: “ ” ’):

| Change | Line |
|---|---|
| New box | `Added <title> (<code>) to <lane>, <range>` |
| Deleted box | `Deleted <title> (<code>, <lane>, <range>)` |
| Edited box | `<title> (<code>): ` then the parts that changed, joined by `; ` |
| … renamed | `renamed from “<old title>”` |
| … new lane | `moved from <old lane> to <new lane>` |
| … same number of working days, new dates | `rescheduled to <range> (was <old range>)` |
| … other date change | `dates now <range> (was <old range>)` |
| … flag, type or FTE | `flag On track → Blocked`, `flag At risk → On track`, `type <old> → <new>`, `FTE 1 → 1.5` (names, not ids; no flag is "On track") |
| … engineers | `engineers now Sam Lee, Alex Kim` (or `engineers now nobody`) |
| … epic, description, tags, links | `epic link updated` / `epic link removed`, `description edited`, `tags edited`, `links edited` |
| … rule added or removed | `now <rule>` or `no longer <rule>`, where `<rule>` is one of `finishes before <other title> (<code>) starts`, `starts after <other title> (<code>) finishes`, `happens during <other title> (<code>)`, `starts when <other title> (<code>) starts`, `ends when <other title> (<code>) ends`, `runs at the same time as <other title> (<code>)`, `doesn’t overlap <other title> (<code>)` |
| … anything else | `edited` |
| Department code changed | `<Department>’s code is now <NEW> (was <OLD>): its boxes are <NEW>-…` |
| Department added | `Added department <name> (<n> lanes, <fte> FTE)` (`1 lane` for one) |
| Department renamed, recoloured, deleted | `Renamed department <old> to <new>`, `Changed the colour of <name>`, `Deleted department <name>` |
| Departments reordered | `Reordered departments` (once, however many moved; only when their order changed, not their numbers) |
| Department changed some other way | `Updated department <name>` |
| Lane added, removed, resized, reordered | `Added lane <label> (<fte> FTE) to <Department>`, `Removed lane <label> from <Department>`, `Lane <label> in <Department> is now 0.5 FTE (was 1)`, `Reordered the lanes in <Department>` |
| Team settings (settings.yaml) | One line for all of it: `Team settings: ` then the parts joined by `; `, e.g. `fiscal year starts in February (was January)`, `default zoom Quarters (was Months)`, `title now “X” (was “Y”)`, `added type <name>`, `renamed type <old> to <new>`, `changed the colour of type <name>`, `removed type <name>`, `reordered types` (the same for `flag`) |
| Lane renamed | `Renamed lane <old label> to <new label> in <Department>` |
| Lane dates changed | `Lane <label> in <Department> now runs until 2027-03-31 (was always open)`; the dates read `from <day>`, `until <day>` or `<day> – <day>`; cleared: `… is now always open (was …)`. A new dated lane: `Added lane <label> (1 FTE, from <day>) to <Department>` |
| Person added, edited or removed | `Added engineer <name>`, `Updated engineer <name>`, `Removed engineer <name>` (a PTO-only change has just its PTO lines; one with no words of its own, like reordered PTO, is `Updated engineer <name>`) |
| PTO added, changed, removed | `PTO for <name>: <range> (<note>)` (no `(<note>)` without one), `Removed PTO for <name>: <range>`; one entry in place of another (one added and one removed) is `PTO for <name>: <range> (<note>) (was <old range>)`; a single day is just that day |

For example:

```
Roadmap: 2 changes

- Updated engineer Jordan Diaz
- Added Data quality checks (DE-K7P) to Data Engineering / FTE 2, 2027-03-01 – 2027-03-19
```

The app ends its messages with "Saved from the BoxOps web app."; don't add that
to hand-made commits.

# Decisions

What was decided, when, and why. Newest changes are noted where a decision
replaced an earlier one.

| Topic | Decision | Why |
|---|---|---|
| Hosting | A static site on GitHub Pages; the repo is the database. | No server to run. Every change is a reviewable, revertible commit. |
| Data layout | One YAML file per box and per department, plus settings and a roster. | Readable diffs, and two people editing different boxes never touch the same file. |
| Auth | A pasted fine-grained personal access token (Contents: write on this repo), kept in `sessionStorage`. | Works with no server. An OAuth proxy (e.g. a Cloudflare Worker) could replace it later. |
| Saving (2026-10-03, replaced pull requests) | Save commits straight to `main`, like saving a file. | The team wanted saving to feel like saving a file, not a review step. Each save is still its own commit, so any one can be reverted. |
| Concurrent edits (2026-10-03) | Different items merge automatically. For the same item, the user picks keep mine or keep theirs. A pre-save check shows others' saves for review before writing. | No silent overwrites, and no blocking for the common case. |
| Live updates (2026-10-03) | Open tabs re-check the site's `roadmap.json` every 2 minutes. | Free and unlimited. The GitHub API's anonymous limit also counts "not modified" replies. |
| Lanes | A lane is anonymous FTE capacity (1 or 0.5), not a person. | Plans are about capacity. Who does the work is a separate question. |
| Box FTE (2026-10-03, replaced one box per lane) | A box needs 0.5, 1, 1.5 or 2 FTE and is drawn that tall. Over capacity means more FTE than the lanes on some day. | Multi-person projects in one box. Capacity warnings that match the arithmetic. |
| Engineers (2026-10-03) | Boxes name their engineers, picked from `roadmap/people.yaml` (name, department, role, email, manager, notes), edited in the People tab. | Staffing is visible without tying it to lanes. |
| Working days (2026-10-03) | No weekends anywhere: axis, durations, dragging, date fields, validation. | Plans are made in working days. |
| Repo visibility | Public for now; the roadmap data is part of the public site. | Simplest during development. For a private repo: GitHub Enterprise Cloud can restrict the Pages site to repo readers. Branch previews would then need to read through the API with a token. |
| Stack | Vite, React and TypeScript in `web/`; Vitest; Playwright with WebKit; GitHub Actions. | WebKit matches Safari, which the team uses. |
| Departments and lanes (2026-10-03) | Added, edited, reordered and removed in the app (pencil on a department heading, **+ Add department**). Removing a lane or department that still has boxes requires choosing where they move. | Changing the team's shape shouldn't need a code editor, and should never silently drop work. |
| Box codes (2026-10-03) | Every box has a 3-character code, unique and permanent, shown with its department's code: `DE-A1F`. The prefix follows the department when a box moves. Files store only the 3 characters. | Short, speakable references. A department code change relabels its boxes without rewriting their files. |
| Rules between boxes (2026-10-03) | Boxes can be related: finishes before, starts after, happens during, starts/ends when, runs at the same time as, doesn't overlap. A broken rule shows a popup, red marks and a toolbar list, and never blocks anything. | Dependencies are guidance for planning, like capacity. Plans are sometimes knowingly out of order. |
| Repo scope (2026-10-03) | The repo contains only the roadmap. The earlier Python knowledge-coverage tool (`src/`, `config/`) was removed; it's in history before commit `3d9b821`. | Keep the repo focused. |

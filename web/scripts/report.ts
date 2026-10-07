// `npm run report [-- <roadmap folder>]`: the roadmap as text (see
// src/model/report.ts) — departments' capacity and where they're over or full,
// engineers over 1 FTE, engineers booked during their PTO, every engineer's
// bookings and PTO by date, unassigned boxes and broken rules. Exits non-zero
// only if the roadmap files themselves are invalid (capacity warnings are
// information, not errors), or 2 if there's no such folder. It's the
// command-line tool's `report` (scripts/roadmap-dir.ts).

import { runOnRoadmapArg } from "./roadmap-dir";

process.exitCode = await runOnRoadmapArg("report");

// `npm run report [-- <roadmap folder>]`: the roadmap as text (see
// src/model/report.ts) — departments' capacity and where they're over or full,
// engineers over 1 FTE, engineers booked during their PTO, every engineer's
// bookings and PTO by date, unassigned boxes and broken rules. Exits non-zero
// only if the roadmap files themselves are invalid (capacity warnings are
// information, not errors), or 2 if there's no such folder.

import { buildReport, formatReport } from "../src/model/report";
import { issueLine, loadRoadmapArg } from "./roadmap-dir";

const { dir, roadmap, issues } = await loadRoadmapArg("report");
for (const issue of issues) console.error(issueLine(dir, issue));
console.log(formatReport(buildReport(roadmap)));
process.exit(issues.length ? 1 : 0);

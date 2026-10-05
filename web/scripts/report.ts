// `npm run report [-- <roadmap folder>]`: the app's warnings as text —
// over-capacity departments, engineers over 1 FTE, unassigned boxes. Exits
// non-zero only if the roadmap files themselves are invalid (capacity warnings
// are information, not errors), or 2 if there's no such folder.

import { buildReport, formatReport } from "../src/model/report";
import { issueLine, loadRoadmapArg } from "./roadmap-dir";

const { dir, roadmap, issues } = await loadRoadmapArg("report");
for (const issue of issues) console.error(issueLine(dir, issue));
console.log(formatReport(buildReport(roadmap)));
process.exit(issues.length ? 1 : 0);

// CI check: `npm run validate [-- <roadmap folder>]` exits non-zero if any
// roadmap file has a problem (2 if there's no such folder).

import { thousands } from "../src/model/count";
import { issueLine, loadRoadmapArg } from "./roadmap-dir";

const { dir, roadmap, issues } = await loadRoadmapArg("validate");

for (const issue of issues) {
  console.error(issueLine(dir, issue));
}
const lanes = roadmap.departments.reduce((n, d) => n + d.lanes.length, 0);
console.log(
  `${thousands(roadmap.departments.length)} departments, ${thousands(lanes)} lanes, ${thousands(roadmap.boxes.length)} boxes — ` +
    (issues.length ? `${thousands(issues.length)} issue(s)` : "OK"),
);
process.exit(issues.length ? 1 : 0);

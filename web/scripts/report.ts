// `npm run report`: the app's warnings as text — over-capacity departments,
// engineers over 1 FTE, unassigned boxes. Exits non-zero only if the roadmap
// files themselves are invalid (capacity warnings are information, not errors).

import { resolve } from "node:path";
import { readRoadmapDir } from "../src/model/files";
import { loadRoadmap } from "../src/model/load";
import { buildReport, formatReport } from "../src/model/report";

const dir = resolve(process.argv[2] ?? "../roadmap");
const { roadmap, issues } = loadRoadmap(readRoadmapDir(dir));
for (const issue of issues) console.error(`roadmap/${issue.path}: ${issue.message}`);
console.log(formatReport(buildReport(roadmap)));
process.exit(issues.length ? 1 : 0);

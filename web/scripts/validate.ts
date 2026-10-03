// CI check: `npm run validate` exits non-zero if any roadmap file has a problem.

import { resolve } from "node:path";
import { readRoadmapDir } from "../src/model/files";
import { loadRoadmap } from "../src/model/load";

const dir = resolve(process.argv[2] ?? "../roadmap");
const { roadmap, issues } = loadRoadmap(readRoadmapDir(dir));

for (const issue of issues) {
  console.error(`roadmap/${issue.path}: ${issue.message}`);
}
const lanes = roadmap.departments.reduce((n, d) => n + d.lanes.length, 0);
console.log(
  `${roadmap.departments.length} departments, ${lanes} lanes, ${roadmap.boxes.length} boxes — ` +
    (issues.length ? `${issues.length} issue(s)` : "OK"),
);
process.exit(issues.length ? 1 : 0);

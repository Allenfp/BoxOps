// CI check: `npm run validate [-- <roadmap folder>]` exits non-zero if any
// roadmap file has a problem: 1, or 3 if the roadmap is in another data
// format (2 if there's no such folder). It's the command-line tool's
// `validate` (scripts/roadmap-dir.ts).

import { runOnRoadmapArg } from "./roadmap-dir";

process.exitCode = await runOnRoadmapArg("validate");

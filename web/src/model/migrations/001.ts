// Format 0 → 1 (BoxOps 0.1.0): a roadmap from before data formats existed.
// Format 1 is what those roadmaps already were, so nothing changes but the
// stamp, `format: 1` in settings.yaml, which the chain adds last (index.ts);
// a roadmap without a settings.yaml gets one holding just that.

import type { Migration } from "./index.ts";

const migration: Migration = {
  from: 0,
  to: 1,
  summary: "stamps format: 1 in settings.yaml",
  files: (files) => files,
};

export default migration;

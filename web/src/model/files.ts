// Reads a roadmap/ directory from disk. Node-only: used by the Vite plugin and CI.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { RoadmapFiles } from "./types.ts";

export function readRoadmapDir(dir: string): RoadmapFiles {
  const files: RoadmapFiles = {};
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[relative(dir, full).split(sep).join("/")] = readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return files;
}

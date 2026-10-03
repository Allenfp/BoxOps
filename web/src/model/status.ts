// Where a box stands. Progress comes from its dates, so it never goes stale;
// the only thing people set by hand is a flag (at risk, late, blocked) when
// something needs attention.

import type { Day } from "./dates";
import type { Box, Settings } from "./types";

export type Progress = "upcoming" | "underway" | "finished";

export const PROGRESS_NAME: Record<Progress, string> = {
  upcoming: "Not started",
  underway: "Under way",
  finished: "Finished",
};

export function progress(box: Pick<Box, "start" | "end">, today: Day): Progress {
  if (today < box.start) return "upcoming";
  return today > box.end ? "finished" : "underway";
}

/** What an unflagged box is called. */
export const NO_FLAG = "On track";

export const flagName = (settings: Settings, status: string | undefined) =>
  status === undefined ? NO_FLAG : (settings.statuses.find((s) => s.id === status)?.name ?? status);

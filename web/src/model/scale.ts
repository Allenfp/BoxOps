// A box's scale: how much work it is, as FTE × working days (FTE-days).
// Derived from the box, never stored.

import { workdays } from "./dates";
import type { Box } from "./types";

export const boxScale = (b: Pick<Box, "fte" | "start" | "end">) => Math.round(b.fte * workdays(b.start, b.end) * 10) / 10;

export const SCALE_HELP = "Scale: FTE × working days";

// The roadmap's data format: the whole number `format` in roadmap/settings.yaml.
//
// Policy: anything an older BoxOps would read wrongly or damage (a new field or
// value it would drop or mangle, a stricter validation rule) needs a format
// bump, and only a minor release may make one. BoxOps opens a roadmap in any
// other format read-only: an older one has to be migrated first, and a newer
// one needs a newer BoxOps.

/** The data format this BoxOps reads and writes. */
export const FORMAT = 1;

/** How a roadmap's format compares with ours; "unknown" when settings.yaml doesn't say in a way we can read. */
export type FormatStatus = "current" | "older" | "newer" | "unknown";

/** `format` is 0 when settings.yaml doesn't state one, null when it can't be read. */
export function formatStatus(format: number | null): FormatStatus {
  if (format === null) return "unknown";
  return format === FORMAT ? "current" : format < FORMAT ? "older" : "newer";
}

// A box whose epic link points at a Jira issue is labelled with that issue's
// key (DATA-123) instead of its BoxOps code; the code still shows in its editor.

/** A Jira issue key: project key, a dash, a number. */
const KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

/**
 * The Jira key in a link, if there is one. Handles /browse/DATA-123, board
 * links with ?selectedIssue=DATA-123 and /projects/DATA/issues/DATA-123.
 */
export function jiraKey(link: string | undefined): string | undefined {
  if (!link) return undefined;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return undefined;
  }
  const selected = url.searchParams.get("selectedIssue")?.toUpperCase();
  if (selected && KEY.test(selected)) return selected;
  const segments = url.pathname.split("/").map((s) => decodeURIComponent(s).toUpperCase());
  return segments.reverse().find((s) => KEY.test(s));
}

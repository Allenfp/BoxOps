// A box whose epic link points at a Jira issue is labelled with that issue's
// key (DATA-123) instead of its BoxOps code; the code still shows in its editor.
// Only where a Jira link puts a key counts (and Linear's, which look alike): a
// GitHub repository called api-2 or a page called Q3-2026 is no issue.

/** A Jira issue key: project key, a dash, a number. */
const KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

/** A path segment decoded, or as it is when its %-escapes are malformed ("100%", "%E0%A4"): never throws. */
function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The issue key in a link, if there is one: Jira's /browse/DATA-123, board
 * links with ?selectedIssue=DATA-123 and /projects/DATA/issues/DATA-123 (the
 * key in that project), on any host; and linear.app/<team>/issue/ENG-12.
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
  const parts = url.pathname.split("/").map((s) => decode(s).toUpperCase());
  /** The segment after `name`, if it's a key. */
  const after = (name: string) => {
    const i = parts.indexOf(name);
    return i >= 0 && KEY.test(parts[i + 1] ?? "") ? parts[i + 1] : undefined;
  };
  const browsed = after("BROWSE");
  if (browsed) return browsed;
  const issue = after("ISSUES");
  const project = parts[parts.indexOf("ISSUES") - 2] === "PROJECTS" ? parts[parts.indexOf("ISSUES") - 1] : undefined;
  if (issue && project && issue.startsWith(`${project}-`)) return issue;
  return url.hostname === "linear.app" ? after("ISSUE") : undefined;
}

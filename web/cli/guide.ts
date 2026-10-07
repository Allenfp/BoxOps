// `guide [topic]`: the full guide to editing a roadmap repository, carried in
// the tool (templates/guide/, and docs/data-format.md for `format`), so it
// always matches the release that runs. Node-only.

import { carried } from "./embedded.ts";

export const TOPICS = ["overview", "recipes", "commits", "format", "upgrading"] as const;
export type Topic = (typeof TOPICS)[number];

/**
 * docs/data-format.md as a roadmap repository's reader needs it: its checks
 * are run with the launcher there, not with npm in BoxOps' web/.
 */
export function formatGuide(doc: string): string {
  return doc
    .replace(/`npm run validate -- <folder>`[\s\S]*?where you run `npm`\./, "`node .boxops/boxops.mjs validate <folder>` (and `report <folder>`) checks another roadmap folder.")
    .replace(/`(?:cd web && )?npm run (validate|report)`/g, "`node .boxops/boxops.mjs $1`");
}

/** One topic's text. */
export function guideTopic(topic: Topic): string {
  return topic === "format" ? formatGuide(carried("docs/data-format.md")) : carried(`templates/guide/${topic}.md`);
}

/** `guide` with no topic: everything but the file format (`guide format`, which is long). */
export function wholeGuide(version: string): string {
  const parts = TOPICS.filter((t) => t !== "format").map((t) => guideTopic(t).trimEnd());
  return [
    `BoxOps ${version}: the guide for this release. Topics: ${TOPICS.join(", ")} (\`node .boxops/boxops.mjs guide <topic>\`).`,
    ...parts,
    "Every file and field, and what the validator checks: `node .boxops/boxops.mjs guide format`.",
  ].join("\n\n");
}

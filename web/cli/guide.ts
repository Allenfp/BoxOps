// `guide [topic]`: the full guide to editing a roadmap repository, carried in
// the tool (templates/guide/<topic>.md), so it always matches the release
// that runs. Node-only.

import { carried } from "./embedded.ts";

export const TOPICS = ["overview", "recipes", "commits", "format", "upgrading"] as const;
export type Topic = (typeof TOPICS)[number];

/** One topic's text. */
export function guideTopic(topic: Topic): string {
  return carried(`templates/guide/${topic}.md`);
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

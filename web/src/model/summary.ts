// Human-readable description of a draft, for the Save dialog and the commit message.

import { prettyDay } from "./dates";
import { diffDraft, type DraftState } from "./draft";
import type { Box, Department, Settings } from "./types";

export interface ChangeLine {
  kind: "added" | "changed" | "deleted";
  text: string;
}

function laneLabels(departments: Department[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of departments) {
    d.lanes.forEach((l, i) => out.set(l.id, `${d.name} / ${l.name ?? `FTE ${i + 1}`}`));
  }
  return out;
}

const range = (b: Box) => `${prettyDay(b.start)} – ${prettyDay(b.end)}`;

export function describeChanges(base: DraftState, draft: DraftState, settings: Settings): ChangeLine[] {
  const changes = diffDraft(base, draft);
  const baseLanes = laneLabels(base.departments);
  const lanes = laneLabels(draft.departments);
  const status = new Map(settings.statuses.map((s) => [s.id, s.name]));
  const type = new Map(settings.types.map((t) => [t.id, t.name]));
  const baseBoxes = new Map(base.boxes.map((b) => [b.id, b]));
  const lines: ChangeLine[] = [];

  for (const b of changes.added) {
    lines.push({ kind: "added", text: `Added **${b.title}** to ${lanes.get(b.lane) ?? b.lane}, ${range(b)}` });
  }

  for (const b of changes.modified) {
    const was = baseBoxes.get(b.id)!;
    const parts: string[] = [];
    if (was.title !== b.title) parts.push(`renamed from “${was.title}”`);
    if (was.lane !== b.lane) parts.push(`moved from ${baseLanes.get(was.lane) ?? was.lane} to ${lanes.get(b.lane) ?? b.lane}`);
    if (was.start !== b.start || was.end !== b.end) {
      const shifted = b.end - b.start === was.end - was.start;
      parts.push(shifted ? `rescheduled to ${range(b)} (was ${range(was)})` : `dates now ${range(b)} (was ${range(was)})`);
    }
    if (was.status !== b.status) parts.push(`status ${status.get(was.status) ?? was.status} → ${status.get(b.status) ?? b.status}`);
    if (was.type !== b.type) parts.push(`type ${type.get(was.type) ?? was.type} → ${type.get(b.type) ?? b.type}`);
    if ((was.epic ?? "") !== (b.epic ?? "")) parts.push(b.epic ? "epic link updated" : "epic link removed");
    if ((was.description ?? "") !== (b.description ?? "")) parts.push("description edited");
    if ((was.tags ?? []).join() !== (b.tags ?? []).join()) parts.push("tags edited");
    if ((was.links ?? []).join() !== (b.links ?? []).join()) parts.push("links edited");
    lines.push({ kind: "changed", text: `**${b.title}**: ${parts.join("; ") || "edited"}` });
  }

  for (const b of changes.removed) {
    lines.push({ kind: "deleted", text: `Deleted **${b.title}** (${baseLanes.get(b.lane) ?? b.lane}, ${range(b)})` });
  }

  const baseDepts = new Map(base.departments.map((d) => [d.id, d]));
  for (const d of changes.departments) {
    const was = baseDepts.get(d.id);
    if (!was) {
      lines.push({ kind: "added", text: `Added department **${d.name}**` });
      continue;
    }
    d.lanes.forEach((l, i) => {
      const old = was.lanes.find((x) => x.id === l.id);
      const oldName = old ? (old.name ?? `FTE ${was.lanes.indexOf(old) + 1}`) : undefined;
      const newName = l.name ?? `FTE ${i + 1}`;
      if (oldName !== undefined && oldName !== newName) {
        lines.push({ kind: "changed", text: `Renamed lane **${oldName}** to **${newName}** in ${d.name}` });
      }
    });
    if (was.name !== d.name) lines.push({ kind: "changed", text: `Renamed department **${was.name}** to **${d.name}**` });
  }
  return lines;
}

/** Cut at a word boundary, marking the cut with an ellipsis. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : cut.length).replace(/[;,:]$/, "")}…`;
}

/** Commit message: the change itself when there is one, otherwise a count, then the details. */
export function commitMessage(lines: ChangeLine[]): string {
  const plain = (t: string) => t.replace(/\*\*/g, "");
  const subject = lines.length === 1 ? shorten(plain(lines[0].text).replace(/ \(was [^)]*\)/g, ""), 72) : `Roadmap: ${lines.length} changes`;
  return [subject, "", ...lines.map((l) => `- ${plain(l.text)}`), "", "Saved from the BoxOps web app."].join("\n");
}

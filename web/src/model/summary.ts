// Human-readable description of a draft, for the Save dialog and the commit message.

import { flagName } from "./status";
import { prettyDay } from "./dates";
import { diffDraft, type DraftState } from "./draft";
import { RELATION_TYPES, fullCode } from "./relations";
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
  const type = new Map(settings.types.map((t) => [t.id, t.name]));
  const baseBoxes = new Map(base.boxes.map((b) => [b.id, b]));
  const names = new Map([...base.people, ...draft.people].map((p) => [p.id, p.name]));
  const who = (ids: string[] | undefined) => (ids?.length ? ids.map((id) => names.get(id) ?? id).join(", ") : "nobody");
  const lines: ChangeLine[] = [];

  for (const p of changes.people.added) lines.push({ kind: "added", text: `Added engineer **${p.name}**` });
  for (const p of changes.people.changed) lines.push({ kind: "changed", text: `Updated engineer **${p.name}**` });
  for (const p of changes.people.removed) lines.push({ kind: "deleted", text: `Removed engineer **${p.name}**` });

  const code = (b: Box) => fullCode(b, draft.departments);
  const allBoxes = new Map([...base.boxes, ...draft.boxes].map((b) => [b.code, b]));
  const ruleText = (r: { type: keyof typeof RELATION_TYPES; box: string }) => {
    const other = allBoxes.get(r.box);
    return RELATION_TYPES[r.type].label.replace("{other}", other ? `**${other.title}** (${code(other)})` : r.box);
  };
  const ruleKey = (r: { type: string; box: string }) => `${r.type}:${r.box}`;

  for (const b of changes.added) {
    lines.push({ kind: "added", text: `Added **${b.title}** (${code(b)}) to ${lanes.get(b.lane) ?? b.lane}, ${range(b)}` });
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
    if (was.status !== b.status) parts.push(`status ${flagName(settings, was.status)} → ${flagName(settings, b.status)}`);
    if (was.type !== b.type) parts.push(`type ${type.get(was.type) ?? was.type} → ${type.get(b.type) ?? b.type}`);
    if (was.fte !== b.fte) parts.push(`FTE ${was.fte} → ${b.fte}`);
    if ((was.engineers ?? []).join() !== (b.engineers ?? []).join()) parts.push(`engineers now ${who(b.engineers)}`);
    if ((was.epic ?? "") !== (b.epic ?? "")) parts.push(b.epic ? "epic link updated" : "epic link removed");
    if ((was.description ?? "") !== (b.description ?? "")) parts.push("description edited");
    if ((was.tags ?? []).join() !== (b.tags ?? []).join()) parts.push("tags edited");
    if ((was.links ?? []).join() !== (b.links ?? []).join()) parts.push("links edited");
    const wasRules = new Set((was.relations ?? []).map(ruleKey));
    const nowRules = new Set((b.relations ?? []).map(ruleKey));
    for (const r of b.relations ?? []) if (!wasRules.has(ruleKey(r))) parts.push(`now ${ruleText(r)}`);
    for (const r of was.relations ?? []) if (!nowRules.has(ruleKey(r))) parts.push(`no longer ${ruleText(r)}`);
    lines.push({ kind: "changed", text: `**${b.title}** (${code(b)}): ${parts.join("; ") || "edited"}` });
  }

  for (const b of changes.removed) {
    lines.push({
      kind: "deleted",
      text: `Deleted **${b.title}** (${fullCode(b, base.departments)}, ${baseLanes.get(b.lane) ?? b.lane}, ${range(b)})`,
    });
  }

  const baseDepts = new Map(base.departments.map((d) => [d.id, d]));
  const laneLabel = (d: Department, laneId: string) => {
    const i = d.lanes.findIndex((l) => l.id === laneId);
    return d.lanes[i]?.name ?? `FTE ${i + 1}`;
  };
  let reordered = false;
  for (const d of changes.departments) {
    const was = baseDepts.get(d.id);
    if (!was) {
      const fte = d.lanes.reduce((n, l) => n + l.fte, 0);
      lines.push({ kind: "added", text: `Added department **${d.name}** (${d.lanes.length} lane${d.lanes.length === 1 ? "" : "s"}, ${fte} FTE)` });
      continue;
    }
    if (was.name !== d.name) lines.push({ kind: "changed", text: `Renamed department **${was.name}** to **${d.name}**` });
    if (was.code !== d.code) {
      lines.push({ kind: "changed", text: `${d.name}'s code is now **${d.code}** (was ${was.code}): its boxes are ${d.code}-…` });
    }
    if (was.color !== d.color) lines.push({ kind: "changed", text: `Changed the colour of **${d.name}**` });
    if (was.order !== d.order) reordered = true;
    const wasIds = was.lanes.map((l) => l.id);
    const nowIds = d.lanes.map((l) => l.id);
    for (const l of d.lanes) {
      const old = was.lanes.find((x) => x.id === l.id);
      if (!old) {
        lines.push({ kind: "added", text: `Added lane **${laneLabel(d, l.id)}** (${l.fte} FTE) to ${d.name}` });
        continue;
      }
      const oldName = laneLabel(was, l.id);
      const newName = laneLabel(d, l.id);
      if (old.name !== l.name && oldName !== newName) {
        lines.push({ kind: "changed", text: `Renamed lane **${oldName}** to **${newName}** in ${d.name}` });
      }
      if (old.fte !== l.fte) lines.push({ kind: "changed", text: `Lane **${newName}** in ${d.name} is now ${l.fte} FTE (was ${old.fte})` });
    }
    for (const l of was.lanes) {
      if (!nowIds.includes(l.id)) lines.push({ kind: "deleted", text: `Removed lane **${laneLabel(was, l.id)}** from ${d.name}` });
    }
    const kept = wasIds.filter((id) => nowIds.includes(id));
    if (kept.join() !== nowIds.filter((id) => wasIds.includes(id)).join()) {
      lines.push({ kind: "changed", text: `Reordered the lanes in ${d.name}` });
    }
  }
  for (const d of changes.removedDepartments) {
    lines.push({ kind: "deleted", text: `Deleted department **${d.name}**` });
  }
  if (reordered) lines.push({ kind: "changed", text: "Reordered departments" });
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

// Human-readable description of a draft, for the Save dialog and the commit message.

import { flagName } from "./status";
import { ptoChanges, ptoRange } from "./pto";
import { laneDates } from "./lanes";
import { prettyDay } from "./dates";
import { type Changes, diffDraft, type DraftState, normalize } from "./draft";
import { RELATION_TYPES, fullCode } from "./relations";
import type { Box, Department, Person, Settings } from "./types";

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

/** `changes`: diffDraft(base, draft), when the caller has it already. */
export function describeChanges(base: DraftState, draft: DraftState, changes: Changes = diffDraft(base, draft)): ChangeLine[] {
  const settings = draft.settings;
  const baseLanes = laneLabels(base.departments);
  const lanes = laneLabels(draft.departments);
  const type = new Map(settings.types.map((t) => [t.id, t.name]));
  const baseBoxes = new Map(base.boxes.map((b) => [b.id, b]));
  const names = new Map([...base.people, ...draft.people].map((p) => [p.id, p.name]));
  const who = (ids: string[] | undefined) => (ids?.length ? ids.map((id) => names.get(id) ?? id).join(", ") : "nobody");
  const lines: ChangeLine[] = [];

  const basePeople = new Map(base.people.map((p) => [p.id, p]));
  const ptoLines = (name: string, was: Person["pto"], now: Person["pto"]) => {
    const { added, removed } = ptoChanges(was, now);
    if (added.length === 1 && removed.length === 1) {
      const note = added[0].note?.trim();
      return lines.push({ kind: "changed", text: `PTO for **${name}**: ${ptoRange(added[0])}${note ? ` (${note})` : ""} (was ${ptoRange(removed[0])})` });
    }
    for (const t of added) lines.push({ kind: "added", text: `PTO for **${name}**: ${ptoRange(t)}${t.note?.trim() ? ` (${t.note.trim()})` : ""}` });
    for (const t of removed) lines.push({ kind: "deleted", text: `Removed PTO for **${name}**: ${ptoRange(t)}` });
  };
  for (const p of changes.people.added) {
    lines.push({ kind: "added", text: `Added engineer **${p.name}**` });
    ptoLines(p.name, [], p.pto);
  }
  for (const p of changes.people.changed) {
    const was = basePeople.get(p.id)!;
    const { pto: wasPto, ...wasRest } = was;
    const { pto: nowPto, ...nowRest } = p;
    if (JSON.stringify(normalize(wasRest)) !== JSON.stringify(normalize(nowRest))) {
      lines.push({ kind: "changed", text: `Updated engineer **${p.name}**` });
    }
    ptoLines(p.name, wasPto, nowPto);
  }
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
        lines.push({ kind: "added", text: `Added lane **${laneLabel(d, l.id)}** (${l.fte} FTE${laneDates(l) ? `, ${laneDates(l)}` : ""}) to ${d.name}` });
        continue;
      }
      const oldName = laneLabel(was, l.id);
      const newName = laneLabel(d, l.id);
      if (old.name !== l.name && oldName !== newName) {
        lines.push({ kind: "changed", text: `Renamed lane **${oldName}** to **${newName}** in ${d.name}` });
      }
      if (old.start !== l.start || old.end !== l.end) {
        const span = (x: typeof l) => laneDates(x) || "always open";
        const now = laneDates(l) ? `now runs ${laneDates(l)}` : "is now always open";
        lines.push({ kind: "changed", text: `Lane **${newName}** in ${d.name} ${now} (was ${span(old)})` });
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
  if (changes.settings) lines.push({ kind: "changed", text: `Team settings: ${settingsParts(base.settings, draft.settings).join("; ") || "edited"}` });
  return lines;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ZOOM_NAME = { weeks: "Weeks", months: "Months", quarters: "Quarters" } as const;

/** What changed in the team settings, as short phrases. */
function settingsParts(was: Settings, now: Settings): string[] {
  const parts: string[] = [];
  if (was.title !== now.title) parts.push(`title now “${now.title}” (was “${was.title}”)`);
  if (was.fiscal_year_start_month !== now.fiscal_year_start_month) {
    parts.push(
      `fiscal year starts in ${MONTH_NAMES[now.fiscal_year_start_month - 1]} (was ${MONTH_NAMES[was.fiscal_year_start_month - 1]})`,
    );
  }
  if (was.default_zoom !== now.default_zoom) parts.push(`default zoom ${ZOOM_NAME[now.default_zoom]} (was ${ZOOM_NAME[was.default_zoom]})`);
  const list = <T extends { id: string; name: string; color?: string }>(a: T[], b: T[], noun: string) => {
    const before = new Map(a.map((x) => [x.id, x]));
    const after = new Map(b.map((x) => [x.id, x]));
    for (const x of b) {
      const old = before.get(x.id);
      if (!old) parts.push(`added ${noun} ${x.name}`);
      else {
        if (old.name !== x.name) parts.push(`renamed ${noun} ${old.name} to ${x.name}`);
        if (old.color !== x.color) parts.push(`changed the colour of ${noun} ${x.name}`);
      }
    }
    for (const x of a) if (!after.has(x.id)) parts.push(`removed ${noun} ${x.name}`);
    const kept = a.filter((x) => after.has(x.id)).map((x) => x.id);
    if (kept.join() !== b.filter((x) => before.has(x.id)).map((x) => x.id).join()) parts.push(`reordered ${noun}s`);
  };
  list(was.types, now.types, "type");
  list(was.statuses, now.statuses, "flag");
  return parts;
}

/** Cut at a word boundary, marking the cut with an ellipsis. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : cut.length).replace(/[;,:]$/, "")}…`;
}

/** Commit message: the change itself when there is one, otherwise a count, then the details. */
export function commitMessage(lines: ChangeLine[]): string {
  // One line per change: a line break in a title can't start a trailer (Co-authored-by: …) of its own.
  const plain = (t: string) => t.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  const subject = lines.length === 1 ? shorten(plain(lines[0].text).replace(/ \(was [^)]*\)/g, ""), 72) : `Roadmap: ${lines.length} changes`;
  return [subject, "", ...lines.map((l) => `- ${plain(l.text)}`), "", "Saved from the BoxOps web app."].join("\n");
}

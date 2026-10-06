// Human-readable description of a draft, for the Save dialog and the commit message.

import { flagName } from "./status";
import { ptoChanges, ptoRange } from "./pto";
import { laneDates } from "./lanes";
import { prettyDay, workdays } from "./dates";
import { type Changes, departmentsReordered, diffDraft, type DraftState, normalize } from "./draft";
import { RELATION_TYPES, fullCode } from "./relations";
import type { Box, Department, Person, Settings } from "./types";

/**
 * One line of the summary. Every changed item gets at least one; a department
 * or a person can get several (each lane, each PTO entry), and all the
 * departments that moved share "Reordered departments". The count shown for
 * unsaved changes is the number of lines.
 */
export interface ChangeLine {
  kind: "added" | "changed" | "deleted";
  text: string;
  /** The line as a commit subject, without its "(was …)" parts; `text` when there are none. */
  subject?: string;
}

/** A line whose `was` part (" (was …)") a commit subject leaves out. */
const withWas = (kind: ChangeLine["kind"], now: string, was: string, after = ""): ChangeLine => ({
  kind,
  text: `${now} (was ${was})${after}`,
  subject: `${now}${after}`,
});

/** A lazily built lookup, for what only some changes need. */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
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
  // Built only if some change needs them: a summary is worked out on every edit.
  const baseBoxes = lazy(() => new Map(base.boxes.map((b) => [b.id, b])));
  const names = lazy(() => new Map([...base.people, ...draft.people].map((p) => [p.id, p.name])));
  const who = (ids: string[] | undefined) => (ids?.length ? ids.map((id) => names().get(id) ?? id).join(", ") : "nobody");
  const lines: ChangeLine[] = [];

  const basePeople = new Map(changes.people.changed.length ? base.people.map((p) => [p.id, p]) : []);
  const ptoLines = (name: string, was: Person["pto"], now: Person["pto"]) => {
    const { added, removed } = ptoChanges(was, now);
    const note = (t: { note?: string }) => (t.note?.trim() ? ` (${t.note.trim()})` : "");
    if (added.length === 1 && removed.length === 1) {
      return lines.push(withWas("changed", `PTO for **${name}**: ${ptoRange(added[0])}${note(added[0])}`, ptoRange(removed[0])));
    }
    for (const t of added) lines.push({ kind: "added", text: `PTO for **${name}**: ${ptoRange(t)}${note(t)}` });
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
    const before = lines.length;
    const updated = JSON.stringify(normalize(wasRest)) !== JSON.stringify(normalize(nowRest));
    if (updated) lines.push({ kind: "changed", text: `Updated engineer **${p.name}**` });
    ptoLines(p.name, wasPto, nowPto);
    // Something changed that has no words of its own (their PTO, reordered): still a line.
    if (lines.length === before) lines.push({ kind: "changed", text: `Updated engineer **${p.name}**` });
  }
  for (const p of changes.people.removed) lines.push({ kind: "deleted", text: `Removed engineer **${p.name}**` });

  const code = (b: Box) => fullCode(b, draft.departments);
  const allBoxes = lazy(() => new Map([...base.boxes, ...draft.boxes].map((b) => [b.code, b])));
  const ruleText = (r: { type: keyof typeof RELATION_TYPES; box: string }) => {
    const other = allBoxes().get(r.box);
    return RELATION_TYPES[r.type].label.replace("{other}", other ? `**${other.title}** (${code(other)})` : r.box);
  };
  const ruleKey = (r: { type: string; box: string }) => `${r.type}:${r.box}`;

  for (const b of changes.added) {
    lines.push({ kind: "added", text: `Added **${b.title}** (${code(b)}) to ${lanes.get(b.lane) ?? b.lane}, ${range(b)}` });
  }

  for (const b of changes.modified) {
    const was = baseBoxes().get(b.id)!;
    // Each part, and the part as a commit subject has it (without "(was …)").
    const parts: { text: string; subject: string }[] = [];
    const part = (text: string, subject = text) => parts.push({ text, subject });
    if (was.title !== b.title) part(`renamed from “${was.title}”`);
    if (was.lane !== b.lane) part(`moved from ${baseLanes.get(was.lane) ?? was.lane} to ${lanes.get(b.lane) ?? b.lane}`);
    if (was.start !== b.start || was.end !== b.end) {
      // The same number of working days: a move, as a drag on the timeline makes.
      const shifted = workdays(b.start, b.end) === workdays(was.start, was.end);
      const now = `${shifted ? "rescheduled to" : "dates now"} ${range(b)}`;
      part(`${now} (was ${range(was)})`, now);
    }
    if (was.status !== b.status) part(`flag ${flagName(settings, was.status)} → ${flagName(settings, b.status)}`);
    if (was.type !== b.type) part(`type ${type.get(was.type) ?? was.type} → ${type.get(b.type) ?? b.type}`);
    if (was.fte !== b.fte) part(`FTE ${was.fte} → ${b.fte}`);
    if ((was.engineers ?? []).join() !== (b.engineers ?? []).join()) part(`engineers now ${who(b.engineers)}`);
    if ((was.epic ?? "") !== (b.epic ?? "")) part(b.epic ? "epic link updated" : "epic link removed");
    if ((was.description ?? "") !== (b.description ?? "")) part("description edited");
    if ((was.tags ?? []).join() !== (b.tags ?? []).join()) part("tags edited");
    if ((was.links ?? []).join() !== (b.links ?? []).join()) part("links edited");
    const wasRules = new Set((was.relations ?? []).map(ruleKey));
    const nowRules = new Set((b.relations ?? []).map(ruleKey));
    for (const r of b.relations ?? []) if (!wasRules.has(ruleKey(r))) part(`now ${ruleText(r)}`);
    for (const r of was.relations ?? []) if (!nowRules.has(ruleKey(r))) part(`no longer ${ruleText(r)}`);
    const head = `**${b.title}** (${code(b)}): `;
    const text = `${head}${parts.map((x) => x.text).join("; ") || "edited"}`;
    const subject = `${head}${parts.map((x) => x.subject).join("; ") || "edited"}`;
    lines.push({ kind: "changed", text, ...(subject !== text && { subject }) });
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
  for (const d of changes.departments) {
    const was = baseDepts.get(d.id);
    if (!was) {
      const fte = d.lanes.reduce((n, l) => n + l.fte, 0);
      lines.push({ kind: "added", text: `Added department **${d.name}** (${d.lanes.length} lane${d.lanes.length === 1 ? "" : "s"}, ${fte} FTE)` });
      continue;
    }
    const before = lines.length;
    if (was.name !== d.name) lines.push({ kind: "changed", text: `Renamed department **${was.name}** to **${d.name}**` });
    if (was.code !== d.code) {
      lines.push(withWas("changed", `${d.name}’s code is now **${d.code}**`, was.code, `: its boxes are ${d.code}-…`));
    }
    if (was.color !== d.color) lines.push({ kind: "changed", text: `Changed the colour of **${d.name}**` });
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
        lines.push(withWas("changed", `Lane **${newName}** in ${d.name} ${now}`, span(old)));
      }
      if (old.fte !== l.fte) lines.push(withWas("changed", `Lane **${newName}** in ${d.name} is now ${l.fte} FTE`, String(old.fte)));
    }
    for (const l of was.lanes) {
      if (!nowIds.includes(l.id)) lines.push({ kind: "deleted", text: `Removed lane **${laneLabel(was, l.id)}** from ${d.name}` });
    }
    const kept = wasIds.filter((id) => nowIds.includes(id));
    if (kept.join() !== nowIds.filter((id) => wasIds.includes(id)).join()) {
      lines.push({ kind: "changed", text: `Reordered the lanes in ${d.name}` });
    }
    // Changed in a way that has no words of its own (a lane given the name it showed anyway, say); a new place in the order is "Reordered departments".
    if (lines.length === before && JSON.stringify(normalize({ ...was, order: d.order })) !== JSON.stringify(normalize(d))) {
      lines.push({ kind: "changed", text: `Updated department **${d.name}**` });
    }
  }
  for (const d of changes.removedDepartments) {
    lines.push({ kind: "deleted", text: `Deleted department **${d.name}**` });
  }
  if (departmentsReordered(base.departments, draft.departments)) lines.push({ kind: "changed", text: "Reordered departments" });
  if (changes.settings) {
    const parts = settingsParts(base.settings, draft.settings);
    const text = `Team settings: ${parts.map((x) => x.text).join("; ") || "edited"}`;
    const subject = `Team settings: ${parts.map((x) => x.subject).join("; ") || "edited"}`;
    lines.push({ kind: "changed", text, ...(subject !== text && { subject }) });
  }
  return lines;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ZOOM_NAME = { weeks: "Weeks", months: "Months", quarters: "Quarters" } as const;

/** What changed in the team settings, as short phrases (and each as a commit subject has it). */
function settingsParts(was: Settings, now: Settings): { text: string; subject: string }[] {
  const parts: { text: string; subject: string }[] = [];
  const part = (text: string) => parts.push({ text, subject: text });
  const changed = (now: string, before: string) => parts.push({ text: `${now} (was ${before})`, subject: now });
  if (was.title !== now.title) changed(`title now “${now.title}”`, `“${was.title}”`);
  if (was.fiscal_year_start_month !== now.fiscal_year_start_month) {
    changed(`fiscal year starts in ${MONTH_NAMES[now.fiscal_year_start_month - 1]}`, MONTH_NAMES[was.fiscal_year_start_month - 1]);
  }
  if (was.default_zoom !== now.default_zoom) changed(`default zoom ${ZOOM_NAME[now.default_zoom]}`, ZOOM_NAME[was.default_zoom]);
  const list = <T extends { id: string; name: string; color?: string }>(a: T[], b: T[], noun: string) => {
    const before = new Map(a.map((x) => [x.id, x]));
    const after = new Map(b.map((x) => [x.id, x]));
    for (const x of b) {
      const old = before.get(x.id);
      if (!old) part(`added ${noun} ${x.name}`);
      else {
        if (old.name !== x.name) part(`renamed ${noun} ${old.name} to ${x.name}`);
        if (old.color !== x.color) part(`changed the colour of ${noun} ${x.name}`);
      }
    }
    for (const x of a) if (!after.has(x.id)) part(`removed ${noun} ${x.name}`);
    const kept = a.filter((x) => after.has(x.id)).map((x) => x.id);
    if (kept.join() !== b.filter((x) => before.has(x.id)).map((x) => x.id).join()) part(`reordered ${noun}s`);
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

/**
 * Commit message: the change itself when there's one line (without its
 * "(was …)" parts), otherwise the number of lines, then the lines. Never just
 * a count of nothing: a save always has at least one line.
 */
export function commitMessage(lines: ChangeLine[]): string {
  // One line per change: a line break in a title can't start a trailer (Co-authored-by: …) of its own.
  const plain = (t: string) => t.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  const subject =
    lines.length === 1 ? shorten(plain(lines[0].subject ?? lines[0].text), 72) : lines.length ? `Roadmap: ${lines.length} changes` : "Roadmap: update";
  return [subject, "", ...lines.map((l) => `- ${plain(l.text)}`), "", "Saved from the BoxOps web app."].join("\n");
}

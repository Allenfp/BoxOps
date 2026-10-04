import { useEffect, useRef, useState } from "react";
import { useAnchor } from "./useAnchor";
import { boxScale, SCALE_HELP } from "../model/scale";
import { NO_FLAG } from "../model/status";
import { formatDay, isWeekend, nextWorkday, parseDay, prettyDay, prevWorkday, workdays } from "../model/dates";
import { jiraKey } from "../model/jira";
import { RELATION_ORDER, RELATION_TYPES, type Violation, fullCode, incoming } from "../model/relations";
import { BOX_FTE_OPTIONS, type Box, type Department, type Person, type RelationType, type Settings } from "../model/types";
import { EngineerPicker } from "./EngineerPicker";

const WIDTH = 440;

interface Props {
  box: Box;
  settings: Settings;
  departments: Department[];
  people: Person[];
  /** Every box, for rules. */
  boxes: Box[];
  /** Broken rules involving this box. */
  violations: Violation[];
  onAddPerson(name: string, department?: string): string;
  /** Remove a rule that another box has about this one. */
  onRemoveIncoming(fromBoxId: string, type: RelationType): void;
  /** `field` groups keystrokes in one field into a single undo step. */
  onChange(patch: Partial<Box>, field: string): void;
  onDelete(): void;
  onClose(): void;
}

const splitList = (text: string, sep: RegExp) =>
  text
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);

export function BoxEditor(props: Props) {
  const { box, settings, departments, people, boxes, violations, onAddPerson, onChange, onDelete, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  // Sit below the box (or above if there's no room), and follow it while the timeline scrolls.
  const pos = useAnchor(ref, `[data-box-id="${CSS.escape(box.id)}"]`, WIDTH, [box]);
  // Free-text list fields keep their raw text while typing so commas and newlines aren't eaten.
  const [tagsText, setTagsText] = useState(() => (box.tags ?? []).join(", "));
  const [linksText, setLinksText] = useState(() => (box.links ?? []).join("\n"));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      // Clicking another box re-targets the editor instead of closing it.
      if (!ref.current?.contains(t) && !t.closest("[data-box-id]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  // Only weekdays exist on the roadmap: a weekend start moves to Monday, a weekend end to Friday.
  const [snapped, setSnapped] = useState<string | null>(null);
  const setStart = (text: string) => {
    const picked = parseDay(text);
    if (picked === null) return;
    const start = nextWorkday(picked);
    setSnapped(isWeekend(picked) ? `Moved to ${prettyDay(start)}: boxes start on a weekday.` : null);
    onChange(start > box.end ? { start, end: start } : { start }, "start");
  };
  const setEnd = (text: string) => {
    const picked = parseDay(text);
    if (picked === null) return;
    const end = prevWorkday(picked);
    setSnapped(isWeekend(picked) ? `Moved to ${prettyDay(end)}: boxes end on a weekday.` : null);
    onChange(end < box.start ? { end, start: end } : { end }, "end");
  };
  const department = departments.find((d) => d.lanes.some((l) => l.id === box.lane))?.id;

  // Rules: this box's own, plus ones other boxes have about it.
  const [newRuleType, setNewRuleType] = useState<RelationType>("before");
  const relations = box.relations ?? [];
  const others = boxes.filter((b) => b.id !== box.id);
  const byCode = new Map(boxes.map((b) => [b.code, b]));
  const label = (b: Box) => `${fullCode(b, departments)} ${b.title}`;
  const brokenOut = (type: RelationType, code: string) =>
    violations.find((v) => v.from.id === box.id && v.type === type && v.to.code === code);
  const brokenIn = (from: Box, type: RelationType) => violations.find((v) => v.from.id === from.id && v.type === type && v.to.id === box.id);
  const setRelations = (next: typeof relations) => onChange({ relations: next }, "relations");
  const boxOptions = departments.map((d) => {
    const inDept = others.filter((b) => d.lanes.some((l) => l.id === b.lane)).sort((a, b) => a.start - b.start);
    return inDept.length ? (
      <optgroup key={d.id} label={d.name}>
        {inDept.map((b) => (
          <option key={b.id} value={b.code}>
            {label(b)}
          </option>
        ))}
      </optgroup>
    ) : null;
  });

  const epicValid = !box.epic || /^https?:\/\/\S+$/.test(box.epic);
  const jira = epicValid ? jiraKey(box.epic) : undefined;
  const days = workdays(box.start, box.end);
  const typeColor = settings.types.find((t) => t.id === box.type)?.color;

  return (
    <div
      ref={ref}
      className="editor"
      role="dialog"
      aria-label={`Edit ${box.title || "box"}`}
      style={{ width: WIDTH, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      <div className="editor-head" style={{ borderTopColor: typeColor }}>
        <span className="code-chip" title="This box's code. The prefix follows its department.">
          {fullCode(box, departments)}
        </span>
        <input
          className="editor-title"
          value={box.title}
          placeholder="Box title"
          autoFocus
          onFocus={(e) => box.title === "New box" && e.currentTarget.select()}
          onChange={(e) => onChange({ title: e.target.value }, "title")}
        />
        <button className="icon-button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {!box.title.trim() && <p className="field-error">A title is required.</p>}

      <div className="editor-grid">
        <label>
          Type
          <select value={box.type} onChange={(e) => onChange({ type: e.target.value }, "type")}>
            {settings.types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={box.status ?? ""} onChange={(e) => onChange({ status: e.target.value || undefined }, "status")}>
            <option value="">{NO_FLAG}</option>
            {settings.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {snapped && <p className="field-note span-2">{snapped}</p>}
        <label>
          Start
          <input type="date" value={formatDay(box.start)} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          End
          <input type="date" value={formatDay(box.end)} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label>
          FTE
          <select value={box.fte} onChange={(e) => onChange({ fte: Number(e.target.value) }, "fte")}>
            {BOX_FTE_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lane
          <select value={box.lane} onChange={(e) => onChange({ lane: e.target.value }, "lane")}>
            {departments.map((d) => (
              <optgroup key={d.id} label={d.name}>
                {d.lanes.map((l, i) => (
                  <option key={l.id} value={l.id}>
                    {l.name ?? `FTE ${i + 1}`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="span-2 field">
          <span className="field-label">Engineers</span>
          <EngineerPicker
            value={box.engineers ?? []}
            people={people}
            department={department}
            onChange={(engineers) => onChange({ engineers }, "engineers")}
            onAddPerson={(name) => onAddPerson(name, department)}
          />
        </div>
        <label className="span-2">
          Epic link
          <span className="with-action">
            <input
              type="url"
              placeholder="https://…"
              value={box.epic ?? ""}
              onChange={(e) => onChange({ epic: e.target.value.trim() || undefined }, "epic")}
            />
            {box.epic && epicValid && (
              <a className="button-link" href={box.epic} target="_blank" rel="noopener noreferrer">
                Open ↗
              </a>
            )}
          </span>
          {!epicValid && <span className="field-error">Use a full http(s) link.</span>}
          {jira && (
            <span className="hint">
              Labelled {jira} on the timeline and table (BoxOps code {fullCode(box, departments)})
            </span>
          )}
        </label>
        <div className="span-2 field">
          <span className="field-label">
            Rules for this box <span className="hint">warnings only; nothing is blocked</span>
          </span>
          <ul className="rule-list">
            {relations.map((r, i) => {
              const broken = brokenOut(r.type, r.box);
              return (
                <li key={`${r.type}:${r.box}:${i}`} className={broken ? "broken" : undefined}>
                  <span className="rule-row">
                    <select
                      value={r.type}
                      aria-label="Rule"
                      onChange={(e) =>
                        setRelations(relations.map((x, j) => (j === i ? { ...x, type: e.target.value as RelationType } : x)))
                      }
                    >
                      {RELATION_ORDER.map((t) => (
                        <option key={t} value={t}>
                          {RELATION_TYPES[t].short}
                        </option>
                      ))}
                    </select>
                    <select
                      value={r.box}
                      aria-label="Other box"
                      onChange={(e) => setRelations(relations.map((x, j) => (j === i ? { ...x, box: e.target.value } : x)))}
                    >
                      {!byCode.has(r.box) && <option value={r.box}>{r.box} (missing)</option>}
                      {boxOptions}
                    </select>
                    <button
                      className="icon-button row-remove"
                      aria-label="Remove rule"
                      onClick={() => setRelations(relations.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </span>
                  {broken && <span className="rule-warning">⚠ {broken.message}</span>}
                </li>
              );
            })}
            {incoming(boxes, box.code).map(({ box: from, relation }) => {
              const broken = brokenIn(from, relation.type);
              return (
                <li key={`in:${from.id}:${relation.type}`} className={`incoming${broken ? " broken" : ""}`}>
                  <span className="rule-row">
                    <span>
                      This box {RELATION_TYPES[relation.type].inverse.replace("{other}", label(from))}
                      <span className="hint"> (set on {fullCode(from, departments)})</span>
                    </span>
                    <button
                      className="icon-button row-remove"
                      aria-label={`Remove rule set on ${fullCode(from, departments)}`}
                      onClick={() => props.onRemoveIncoming(from.id, relation.type)}
                    >
                      ×
                    </button>
                  </span>
                  {broken && <span className="rule-warning">⚠ {broken.message}</span>}
                </li>
              );
            })}
          </ul>
          <span className="rule-row add-rule">
            <span className="hint">Add:</span>
            <select value={newRuleType} onChange={(e) => setNewRuleType(e.target.value as RelationType)} aria-label="New rule">
              {RELATION_ORDER.map((t) => (
                <option key={t} value={t}>
                  {RELATION_TYPES[t].short}
                </option>
              ))}
            </select>
            <select
              value=""
              aria-label="Add a rule with"
              onChange={(e) => {
                if (!e.target.value) return;
                const exists = relations.some((r) => r.type === newRuleType && r.box === e.target.value);
                if (!exists) setRelations([...relations, { type: newRuleType, box: e.target.value }]);
              }}
            >
              <option value="">Add a rule with…</option>
              {boxOptions}
            </select>
          </span>
        </div>
        <label className="span-2">
          Description
          <textarea
            rows={2}
            value={box.description ?? ""}
            onChange={(e) => onChange({ description: e.target.value || undefined }, "description")}
          />
        </label>
        <label className="span-2">
          <span>
            Tags <span className="hint">comma separated</span>
          </span>
          <input
            value={tagsText}
            onChange={(e) => {
              setTagsText(e.target.value);
              onChange({ tags: splitList(e.target.value, /,/) }, "tags");
            }}
          />
        </label>
        <label className="span-2">
          <span>
            Other links <span className="hint">one per line</span>
          </span>
          <textarea
            rows={2}
            value={linksText}
            onChange={(e) => {
              setLinksText(e.target.value);
              onChange({ links: splitList(e.target.value, /\n/) }, "links");
            }}
          />
        </label>
      </div>

      <div className="editor-foot">
        <span className="hint">
          {prettyDay(box.start)} – {prettyDay(box.end)} · {days} working day{days === 1 ? "" : "s"} ·{" "}
          <span title={SCALE_HELP}>Scale {boxScale(box)}</span>
        </span>
        <button className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

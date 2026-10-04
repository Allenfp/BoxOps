// The colour key, tucked into a small toolbar popover: box types, progress
// marks, flags and the warning sign.

import type { CSSProperties } from "react";
import type { Settings } from "../model/types";
import { Popover } from "./Popover";
import { type Progress, PROGRESS_NAME } from "../model/status";
import { Icon } from "./Icon";

const PROGRESS: Progress[] = ["upcoming", "underway", "finished"];

export function KeyMenu({ settings }: { settings: Settings }) {
  return (
    <Popover
      className="key-menu"
      label="Key"
      button={
        <>
          <span className="key-dots" aria-hidden="true">
            {settings.types.slice(0, 4).map((t) => (
              <span key={t.id} style={{ background: t.color }} />
            ))}
          </span>
          Key
        </>
      }
    >
      {() => (
        <>
          <h3>Type</h3>
          <ul>
            {settings.types.map((t) => (
              <li key={t.id}>
                <span className="swatch" style={{ background: t.color }} />
                {t.name}
              </li>
            ))}
          </ul>
          <h3>Progress (from the dates)</h3>
          <ul>
            {PROGRESS.map((p) => (
              <li key={p} className={`progress-${p}`} style={{ "--c": "var(--text-muted)" } as CSSProperties}>
                <span className="status-mark" />
                {PROGRESS_NAME[p]}
              </li>
            ))}
          </ul>
          <h3>Flags (set by hand)</h3>
          <ul>
            {settings.statuses.map((s) => (
              <li key={s.id}>
                <span className="box-flag">{s.name}</span>
              </li>
            ))}
          </ul>
          <h3>On a box</h3>
          <ul>
            <li>
              <Icon name="alert" size={12} className="key-warn" />Broken rule, or clash with another save
            </li>
            <li>
              <span className="key-updated" />
              Changed by someone else
            </li>
          </ul>
          <h3>In a department</h3>
          <ul>
            <li>
              <span className="key-pto" />
              PTO (an engineer away)
            </li>
            <li>
              <span className="key-overflow" />
              Over capacity: more FTE than the lanes hold
            </li>
          </ul>
          <h3>Tips</h3>
          <ul className="key-tips">
            <li>Double-click empty lane space to add a box</li>
            <li>Double-click a PTO row to book time off</li>
            <li>Drag a box to move it; drag its ends to change dates</li>
          </ul>
        </>
      )}
    </Popover>
  );
}

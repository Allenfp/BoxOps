// The colour key, tucked into a small toolbar popover: box types, status
// marks and the warning sign.

import type { CSSProperties } from "react";
import type { Settings } from "../model/types";
import { Popover } from "./Popover";

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
          <h3>Status</h3>
          <ul>
            {settings.statuses.map((s) => (
              <li key={s.id} className={`status-${s.id}`} style={{ "--c": "var(--text-muted)" } as CSSProperties}>
                <span className="status-mark" />
                {s.name}
              </li>
            ))}
          </ul>
          <h3>On a box</h3>
          <ul>
            <li>
              <span className="key-warn">⚠</span>Broken rule, or clash with another save
            </li>
            <li>
              <span className="key-updated" />
              Changed by someone else
            </li>
          </ul>
        </>
      )}
    </Popover>
  );
}

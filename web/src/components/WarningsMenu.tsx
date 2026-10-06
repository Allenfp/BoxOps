// Everything that needs a look, in one toolbar button: clashes with someone
// else's save, broken rules, departments over capacity, engineers booked
// during their PTO, and problems in the roadmap files. Hidden when there's
// nothing to say.

import { useEffect, useRef } from "react";
import { Popover } from "./Popover";
import { Icon } from "./Icon";
import { announce } from "../a11y/announce";
import { counted, thousands } from "../model/count";

export interface WarningItem {
  text: string;
  /** Where clicking it goes; plain text when absent. */
  onGo?: () => void;
}
export interface WarningGroup {
  title: string;
  items: WarningItem[];
}

export function WarningsMenu({ groups }: { groups: WarningGroup[] }) {
  const shown = groups.filter((g) => g.items.length);
  const total = shown.reduce((n, g) => n + g.items.length, 0);
  // More warnings than before (an edit put a department over capacity, say): the count in the toolbar is said.
  const before = useRef(total);
  useEffect(() => {
    if (total > before.current) announce(`${counted(total, "warning")} now.`);
    before.current = total;
  }, [total]);
  if (!total) return null;
  return (
    <Popover
      className="warnings-menu"
      label={counted(total, "warning")}
      buttonClass="warnings-button"
      button={<><Icon name="alert" size={14} /> {thousands(total)}</>}
    >
      {(close) =>
        shown.map((g) => (
          <section key={g.title}>
            <h3>
              {g.title} <span className="count">{thousands(g.items.length)}</span>
            </h3>
            <ul>
              {g.items.map((it, i) => (
                <li key={i}>
                  {it.onGo ? (
                    <button
                      className="link-button"
                      onClick={() => {
                        close();
                        it.onGo!();
                      }}
                    >
                      {it.text}
                    </button>
                  ) : (
                    it.text
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      }
    </Popover>
  );
}

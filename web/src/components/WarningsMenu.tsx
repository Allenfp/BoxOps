// Everything that needs a look, in one toolbar button: clashes with someone
// else's save, broken rules, departments over capacity, and problems in the
// roadmap files. Hidden when there's nothing to say.

import { Popover } from "./Popover";

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
  if (!total) return null;
  return (
    <Popover
      className="warnings-menu"
      label={`${total} warning${total === 1 ? "" : "s"}`}
      buttonClass="warnings-button"
      button={<>⚠ {total}</>}
    >
      {(close) =>
        shown.map((g) => (
          <section key={g.title}>
            <h3>
              {g.title} <span className="count">{g.items.length}</span>
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

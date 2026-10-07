// Text from a roadmap as a terminal, or GitHub's log, shows it. Node-only.
//
// The command-line tool and the action print what a roadmap holds: the
// values its problems quote (`type: "…" is not defined in settings.yaml`),
// names in the report, file names. Anyone who can save to the roadmap
// chooses them, and a terminal obeys the control characters it's given: ESC
// starts sequences that move the cursor, erase or hide text, set the
// window's title or, in some terminals, the clipboard; CR goes back to a
// line's start; a bidirectional override reorders what follows it. GitHub's
// log viewer reads ESC's colour sequences too. So every line the tool or
// the action prints shows them as escapes instead, as JSON writes them.

/** Control characters (C0, DEL and C1: \p{Cc}), and the bidirectional embeddings, overrides and isolates. */
const CONTROL = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu;

/**
 * `text` with each control character a terminal or log viewer would obey
 * shown as an escape: `\r`, `\n`, `\u001b` and so on. Tab stays as it is,
 * and so does a line feed where `lines` is true (text of several lines).
 * The escapes are JSON's, so JSON stays JSON, meaning the same.
 */
export function visible(text: string, lines = false): string {
  return text.replace(CONTROL, (c) => {
    if (c === "\t" || (c === "\n" && lines)) return c;
    if (c === "\n") return "\\n";
    if (c === "\r") return "\\r";
    return `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

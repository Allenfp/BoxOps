// What's wrong with a field, or what was done to it (a weekend date moved to
// a weekday): shown next to it, tied to it (the field's aria-describedby
// names `id`), and announced when it appears or changes, since a screen
// reader would otherwise only meet it on going back to the field. It's
// rendered along with its field, empty while there's nothing to say, so
// that a problem already there when the field first shows (an editor or the
// table opened on a value that won't do) isn't announced as news; and one
// put right before it's read out isn't read out.

import { useAnnounce } from "../a11y/useAnnounce";

export function FieldError({
  id,
  children,
  className = "field-error",
  news,
}: {
  id: string;
  /** Nothing to say: false, null or "". */
  children: string | false | null | undefined;
  className?: string;
  /** For a message that may be the same twice running: new each time it's meant, so it's said again. */
  news?: unknown;
}) {
  useAnnounce(children, { ready: false, news: children ? news : undefined, withdraw: true });
  return children ? (
    <span id={id} className={className}>
      {children}
    </span>
  ) : null;
}

/** An `aria-describedby` value from the ids of what's shown (falsy ones aren't). */
export const describedBy = (...ids: (string | false | null | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

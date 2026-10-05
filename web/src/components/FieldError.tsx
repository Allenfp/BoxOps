// What's wrong with a field, or what was done to it (a weekend date moved to
// a weekday): shown next to it, tied to it (the field's aria-describedby
// names `id`), and announced when it appears or changes, since a screen
// reader would otherwise only meet it on going back to the field.

import { useAnnounce } from "../a11y/announce";

export function FieldError({ id, children, className = "field-error" }: { id: string; children: string; className?: string }) {
  useAnnounce(children);
  return (
    <span id={id} className={className}>
      {children}
    </span>
  );
}

/** An `aria-describedby` value from the ids of what's shown (falsy ones aren't). */
export const describedBy = (...ids: (string | false | null | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

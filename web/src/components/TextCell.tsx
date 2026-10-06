import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { FieldError } from "./FieldError";

/**
 * A spreadsheet-style text cell: edits locally, saves on Enter or when focus
 * leaves, Esc puts the old value back. Either way focus stays in the cell
 * (losing it would send the next Tab back to the top of the page), and until
 * something's typed, ⌘Z there is the app's undo (`data-settled`), not the
 * field's own, as once focus had left it. One saved edit = one undo step.
 * What's saved has no spaces at either end, as `invalid` and `required` check
 * it. `multiline` cells wrap; Shift+Enter adds a line break there. They show
 * at most two lines (with … when there's more) until focused, when they grow
 * to fit, sized by CSS alone: a copy of the text, hidden from screen readers
 * (which read the field's whole value), sits in the same grid cell as the
 * field and sets its height, so nothing is measured. A cell that's invalid
 * has a red edge while it's typed in; once saved like that, `problem` says
 * why under it (tied to it, and announced), so the colour isn't all there
 * is to go by. A cell taken off the page mid-edit (WebKit says nothing when
 * a focused field goes) saves what was typed.
 */
export function TextCell({
  value,
  onCommit,
  onBlur,
  readOnly,
  placeholder,
  required,
  invalid,
  problem,
  autoFocus,
  ariaLabel,
  multiline,
}: {
  value: string;
  onCommit(value: string): void;
  onBlur(): void;
  readOnly?: boolean;
  placeholder?: string;
  required?: boolean;
  invalid?(value: string): boolean;
  /** Why a value that's required (and blank) or invalid won't do. */
  problem?: string;
  autoFocus?: boolean;
  ariaLabel: string;
  multiline?: boolean;
}) {
  const [text, setText] = useState(value);
  const editing = useRef(false);
  /** Enter or Esc pressed, nothing typed since. */
  const [settled, setSettled] = useState(false);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  // Follow outside changes (undo, someone else's save) unless mid-edit.
  useEffect(() => {
    if (!editing.current) setText(value);
  }, [value]);

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      ref.current.select();
      ref.current.scrollIntoView({ block: "nearest" });
    }
  }, [autoFocus]);

  const bad = (required && !text.trim()) || invalid?.(text.trim());
  /** The value as saved won't do: it's what the message is about (not text half typed). */
  const wrong = !!problem && ((required && !value.trim()) || invalid?.(value.trim()));
  const problemId = useId();
  /** Save what's typed if it's changed: without spaces at either end, and spaces alone are no change. */
  const commit = () => {
    const next = text.trim();
    if (next !== value.trim()) {
      setText(next);
      onCommit(next);
    } else setText(value); // the value as it stands (spaces and all, if the file has them)
  };

  // Taken off the page mid-edit: what's typed is saved, once (a blur that comes too has nothing left to save).
  const unsaved = useRef<{ text: string; value: string; onCommit(value: string): void } | null>(null);
  useEffect(() => {
    unsaved.current = editing.current ? { text, value, onCommit } : null;
  });
  useEffect(
    () => () => {
      const u = unsaved.current;
      unsaved.current = null;
      if (u && u.text.trim() !== u.value.trim()) u.onCommit(u.text.trim());
    },
    [],
  );

  const props = {
    ref,
    className: `cell-input${multiline ? " multiline" : ""}${bad ? " invalid" : ""}`,
    value: text,
    placeholder,
    disabled: readOnly,
    "aria-label": ariaLabel,
    "aria-invalid": bad || undefined,
    "aria-describedby": wrong ? problemId : undefined,
    "data-settled": settled || undefined,
    onFocus: () => (editing.current = true),
    onChange: (e: { target: { value: string } }) => {
      editing.current = true;
      setSettled(false);
      setText(e.target.value);
    },
    onBlur: () => {
      editing.current = false;
      unsaved.current = null;
      setSettled(false);
      commit();
      onBlur();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const enter = e.key === "Enter" && !(multiline && e.shiftKey);
      if (enter) {
        e.preventDefault();
        commit();
        onBlur(); // the edit is one undo step, as if focus had left
      }
      if (e.key === "Escape") setText(value);
      // As if focus had left: an undo (or someone else's save) shows here.
      if (enter || e.key === "Escape") {
        editing.current = false;
        setSettled(true);
      }
    },
  };
  return (
    <>
      {multiline ? (
        <div className="grow-wrap">
          <div className="grow-text" aria-hidden="true">
            {/* The space keeps a last empty line's height. */}
            {`${text} `}
          </div>
          <textarea rows={1} {...props} />
        </div>
      ) : (
        <input {...props} />
      )}
      <FieldError id={problemId} className="field-error cell-problem">
        {wrong && problem}
      </FieldError>
    </>
  );
}

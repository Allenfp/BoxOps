import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A spreadsheet-style text cell: edits locally, saves on Enter or when focus
 * leaves, Esc puts the old value back. One saved edit = one undo step. What's
 * saved has no spaces at either end, as `invalid` and `required` check it.
 * `multiline` cells wrap and grow to fit; Shift+Enter adds a line break there.
 */
export function TextCell({
  value,
  onCommit,
  onBlur,
  readOnly,
  placeholder,
  required,
  invalid,
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
  autoFocus?: boolean;
  ariaLabel: string;
  multiline?: boolean;
}) {
  const [text, setText] = useState(value);
  const editing = useRef(false);
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

  // A wrapping cell is exactly as tall as its text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!multiline || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [multiline, text]);

  const bad = (required && !text.trim()) || invalid?.(text.trim());
  const props = {
    ref,
    className: `cell-input${multiline ? " multiline" : ""}${bad ? " invalid" : ""}`,
    value: text,
    placeholder,
    disabled: readOnly,
    "aria-label": ariaLabel,
    "aria-invalid": bad || undefined,
    onFocus: () => (editing.current = true),
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: () => {
      editing.current = false;
      const next = text.trim();
      if (next !== text) setText(next);
      if (next !== value.trim()) onCommit(next);
      onBlur();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" && !(multiline && e.shiftKey)) {
        e.preventDefault();
        e.currentTarget.blur();
      }
      if (e.key === "Escape") {
        setText(value);
        editing.current = false;
        // Let the blur that follows see the restored value.
        requestAnimationFrame(() => ref.current?.blur());
      }
    },
  };
  return multiline ? <textarea rows={1} {...props} /> : <input {...props} />;
}

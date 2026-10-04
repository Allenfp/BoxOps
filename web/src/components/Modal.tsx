// A small modal dialog: title bar with a close button, closes on Escape.

import { type ReactNode, useEffect, useRef } from "react";
import { Icon } from "./Icon";

export function Modal({
  title,
  className,
  onClose,
  children,
}: {
  title: string;
  className?: string;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      d.showModal();
      d.focus(); // not the close button, which would show a focus ring on open
    }
  }, []);
  return (
    <dialog
      ref={ref}
      className={`save-dialog${className ? ` ${className}` : ""}`}
      aria-label={title}
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="dialog-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <Icon name="x" size={16} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

// Keyboard shortcuts as each platform writes them (⌘S on a Mac, iPhone or
// iPad; Ctrl+S elsewhere), and which letter a key press means.

const platform = typeof navigator === "undefined" ? "" : ((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform);

/** Apple's platforms, whose shortcuts use ⌘ (the app takes Ctrl too, everywhere). */
export const APPLE = /mac|iphone|ipad|ipod/i.test(platform);

/** A shortcut as this platform writes it: `shortcut("S")` is ⌘S or Ctrl+S, `shortcut("Z", true)` ⇧⌘Z or Ctrl+Shift+Z. */
export function shortcut(key: string, shift = false, apple = APPLE): string {
  return apple ? `${shift ? "⇧" : ""}⌘${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`;
}

/** A key with Shift, as this platform writes it: ⇧Tab, or Shift+Tab. */
export const shifted = (key: string, apple = APPLE) => (apple ? `⇧${key}` : `Shift+${key}`);

/** "Undo with ⌘Z." (Ctrl+Z elsewhere), after something that can be undone. */
export const undoHint = () => `Undo with ${shortcut("Z")}.`;

/**
 * The letter a key press stands for, in lower case: its own when it's a Latin
 * letter, else the letter at that place on a US keyboard, so ⌘S and Ctrl+S
 * work in a Cyrillic or Greek layout too. Null for anything else, and for a
 * character typed with Alt: Option on a Mac, or AltGr, which Windows reports
 * as Ctrl+Alt (Polish ś is AltGr+S).
 */
export function letter(e: Pick<KeyboardEvent, "key" | "code"> & { altKey?: boolean }): string | null {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  const m = !e.altKey && /^Key([A-Z])$/.exec(e.code);
  return m && !/^[\x20-\x7e]$/.test(e.key) ? m[1].toLowerCase() : null;
}

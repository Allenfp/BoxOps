// Following one pointer through a drag, from its press until it's released or
// lost: boxes, PTO blocks and department headings all drag this way. Only the
// pointer that pressed counts (a second finger on a touch screen is ignored).
// Once a drag has started, the pointer is captured by `capture` (a scroller,
// which never re-mounts), so a release outside the window still arrives; a
// press is left uncaptured until then, so a plain click still goes to what
// was pressed. A release the page never hears (the window lost focus
// mid-press, a context menu opened) ends the drag as Escape does: cancelled.

export interface PointerFollower {
  /** The pressed pointer moved; true once it's a drag (rather than a click still). */
  move(e: PointerEvent): boolean;
  /** Released (`true`), or cancelled: Escape, the pointer lost, the window left. */
  end(released: boolean): void;
}

/** Follow the pointer of `down` until it ends; returns a function that cancels it (for an unmount). */
export function followPointer(down: { pointerId: number }, capture: HTMLElement | null, on: PointerFollower): () => void {
  const id = down.pointerId;
  let dragging = false;
  let captured = false;
  let done = false;

  const move = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    // No button held any more: it was let go where the page didn't hear it.
    if ((e.buttons & 1) === 0) return stop(false);
    dragging = on.move(e) || dragging;
    if (dragging && !captured && capture) {
      try {
        capture.setPointerCapture(id);
        captured = true;
      } catch {
        // The pointer has already gone (a pointerup is on its way).
      }
    }
  };
  const up = (e: PointerEvent) => e.pointerId === id && stop(true);
  const lost = (e: PointerEvent) => e.pointerId === id && stop(false);
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // Escape cancels a drag under way, and nothing else (not an editor open beside it).
    if (dragging) e.stopPropagation();
    stop(false);
  };
  const blur = () => stop(false);

  function stop(released: boolean) {
    if (done) return;
    done = true;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", lost);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", blur);
    capture?.removeEventListener("lostpointercapture", lost);
    if (captured && capture?.hasPointerCapture(id)) capture.releasePointerCapture(id);
    on.end(released);
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", lost);
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", blur);
  capture?.addEventListener("lostpointercapture", lost);
  return () => stop(false);
}

/**
 * The click the pointer's release makes once a drag is over (on what was
 * dragged, or where it was let go) does nothing: a drag isn't a click, and a
 * drag cancelled with Escape doesn't open or collapse anything when the
 * button comes up later. Until the next press, at the latest.
 */
export function swallowNextClick(): void {
  const swallow = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    done();
  };
  const done = () => {
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerdown", done, true);
  };
  window.addEventListener("click", swallow, true);
  window.addEventListener("pointerdown", done, true);
}

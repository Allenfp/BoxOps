// Movement on the page for those who haven't asked for less. A smooth scroll
// can sweep across thousands of pixels of timeline, which some people find
// hard to follow or that makes them unwell, so it's a jump for anyone whose
// system asks to reduce motion (prefers-reduced-motion). The stylesheet does
// the same for its transitions (--motion in styles/tokens.css).

/** How to scroll something into view: smoothly, unless the system asks to reduce motion. */
export function scrollBehavior(): ScrollBehavior {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

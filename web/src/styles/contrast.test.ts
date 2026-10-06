import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEPARTMENT_COLORS } from "../model/structure";

// WCAG 2.2 AA contrast, from the stylesheet's own colours: 4.5:1 for text
// (none of the app's is large), 3:1 for what shows a control or its state.
// Each theme's tokens are read from tokens.css, and colours mixed from them
// from the rules that mix them, so a changed colour is checked as it is. A
// box's type colour and a department's colour are the team's choice: what's
// drawn in one is checked against every colour it can be (an even sweep of
// the sRGB cube, and the colours a new department is offered).

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const TOKENS = read("./tokens.css");
const CSS = Object.fromEntries(["base", "toolbar", "timeline", "table", "dialogs"].map((f) => [f, read(`./${f}.css`)]));

type Tokens = Map<string, string>;

/** A rule's declarations: `selector { … }`, the first block with exactly that selector. */
function declarations(css: string, selector: string): Tokens {
  const at = css.split(/(?<=\})/).find((block) => {
    const head = block.slice(0, block.lastIndexOf("{")).split("{").pop()!;
    return head.replace(/^[\s}]+/, "").trim().replace(/\s+/g, " ") === selector;
  });
  if (!at) throw new Error(`No rule for ${selector}`);
  const body = at.slice(at.lastIndexOf("{") + 1, at.lastIndexOf("}"));
  return new Map(
    body
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d.includes(":"))
      .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]),
  );
}

const LIGHT = declarations(TOKENS, ":root");
const DARK = new Map([...LIGHT, ...declarations(TOKENS, ':root[data-theme="dark"]')]);
const THEMES: [string, Tokens][] = [
  ["light", LIGHT],
  ["dark", DARK],
];

/** sRGB channels 0–255 and alpha 0–1. */
type Rgba = [number, number, number, number];

/** A colour as CSS writes it here: hex, rgb()/rgba(), transparent, var() and color-mix(in srgb, …). */
function color(text: string, tokens: Tokens): Rgba {
  const t = text.trim();
  const v = t.match(/^var\((--[\w-]+)\)$/);
  if (v) {
    const value = tokens.get(v[1]);
    if (value === undefined) throw new Error(`No ${v[1]}`);
    return color(value, tokens);
  }
  if (t === "transparent") return [0, 0, 0, 0];
  const hex = t.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as Rgba;
  }
  const rgb = t.match(/^rgba?\(([^)]*)\)$/);
  if (rgb) {
    const [r, g, b, a = 1] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [r, g, b, a];
  }
  const mix = t.match(/^color-mix\(in srgb,\s*(.*)\)$/);
  if (mix) {
    const [a, b] = splitTop(mix[1]).map((part) => {
      const pct = part.match(/\s(\d+(?:\.\d+)?)%$/);
      return { c: color(pct ? part.slice(0, pct.index) : part, tokens), p: pct ? Number(pct[1]) / 100 : null };
    });
    const pa = a.p ?? (b.p === null ? 0.5 : 1 - b.p);
    const pb = b.p ?? 1 - pa;
    // Premultiplied, as CSS mixes colours with alpha.
    const alpha = a.c[3] * pa + b.c[3] * pb;
    const ch = (i: number) => (alpha ? (a.c[i] * a.c[3] * pa + b.c[i] * b.c[3] * pb) / alpha : 0);
    return [ch(0), ch(1), ch(2), alpha];
  }
  throw new Error(`Can't read the colour ${t}`);
}

/** `list` split at its top-level commas. */
function splitTop(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  return [...parts, cur.trim()];
}

/** `top` drawn over `under` (opaque), at `opacity` too. */
const over = (top: Rgba, under: Rgba, opacity = 1): Rgba => {
  const a = top[3] * opacity;
  return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1) as Rgba;
};

const luminance = ([r, g, b]: Rgba) => {
  const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT = 4.5;
const UI = 3;

interface Check {
  what: string;
  /** The colour in front; with `opacity` (a token, or a number), drawn at that much. */
  fg: string;
  /** What it's on; translucent, it's drawn over `on` first. */
  bg: string;
  on?: string;
  opacity?: string;
  min: number;
}

/** The surfaces text sits on: the page, views, and panels over them (popovers, editors, dialogs). */
const SURFACES = ["--bg", "--surface", "--surface-2", "--surface-raised", "--surface-raised-2"];
const PANELS = ["--surface", "--surface-raised"];

/** A declaration in one of the stylesheets, e.g. `rule("dialogs", ".kind-added", "color")`. */
const rule = (file: string, selector: string, prop: string) => {
  const value = declarations(CSS[file], selector).get(prop);
  if (!value) throw new Error(`No ${prop} for ${selector} in ${file}.css`);
  return value;
};
/** A rule's text colour on its background, both from the stylesheet, on each of `PANELS`. */
const pair = (what: string, file: string, selector: string, min = TEXT, fgFrom = selector): Check[] =>
  PANELS.map((s) => ({ what: `${what} on ${s}`, fg: rule(file, fgFrom, "color"), bg: rule(file, selector, "background"), on: `var(${s})`, min }));

/** A collapsed department's capacity bars' opacity, if they have one (the line is drawn solid). */
const BARS = declarations(CSS.timeline, ".use-chart.bars .use-marks rect").get("opacity");

const CHECKS: Check[] = [
  ...SURFACES.flatMap((s) => [
    { what: `text on ${s}`, fg: "var(--text)", bg: `var(${s})`, min: TEXT },
    { what: `muted text (hints, labels, headers, PTO) on ${s}`, fg: "var(--text-muted)", bg: `var(${s})`, min: TEXT },
    { what: `accent text (links, notes, Jira keys) on ${s}`, fg: "var(--accent)", bg: `var(${s})`, min: TEXT },
    { what: `warning text on ${s}`, fg: "var(--warn)", bg: `var(${s})`, min: TEXT },
    { what: `danger text (errors, Delete) on ${s}`, fg: "var(--danger)", bg: `var(${s})`, min: TEXT },
    { what: `a field's or switch's edge on ${s}`, fg: "var(--control-border)", bg: `var(${s})`, min: UI },
    { what: `the "changed by someone else" dot on ${s}`, fg: "var(--updated)", bg: `var(${s})`, min: UI },
    { what: `a switch that's on, on ${s}`, fg: "var(--accent)", bg: `var(${s})`, min: UI },
  ]),
  { what: "unchosen segment text on the track", fg: "var(--text-muted)", bg: "var(--seg-track)", min: TEXT },
  { what: "chosen segment text", fg: "var(--text)", bg: "var(--seg-on)", min: TEXT },
  { what: "the chosen segment's edge against the track", fg: "var(--control-border)", bg: "var(--seg-track)", min: UI },
  { what: "the chosen segment's edge against itself", fg: "var(--control-border)", bg: "var(--seg-on)", min: UI },
  { what: "a primary button (Save)", fg: rule("base", "button.primary", "color"), bg: rule("base", "button.primary", "background"), min: TEXT },
  {
    what: "a primary button, hovered",
    fg: rule("base", "button.primary", "color"),
    bg: rule("base", 'button.primary:hover:not(:disabled, [aria-disabled="true"])', "background"),
    min: TEXT,
  },
  { what: "the picked day in a calendar", fg: "var(--on-accent)", bg: "var(--accent-fill)", min: TEXT },
  { what: "the Today flag", fg: rule("timeline", ".today-flag", "color"), bg: rule("timeline", ".today-flag", "background"), min: TEXT },
  { what: "the Today line", fg: rule("timeline", ".today-line", "background"), bg: "var(--surface)", min: UI },
  { what: "the switch's knob, off", fg: "var(--on-accent)", bg: "var(--control-border)", min: UI },
  { what: "the switch's knob, on", fg: "var(--on-accent)", bg: "var(--accent)", min: UI },
  { what: "a collapsed department's capacity line, above 100%", fg: rule("timeline", ".use-marks.over", "color"), bg: "var(--surface)", min: UI },
  { what: "a collapsed department's capacity bars, above 100%", fg: rule("timeline", ".use-marks.over", "color"), bg: "var(--surface)", opacity: BARS, min: UI },
  ...pair("a flag (At risk)", "timeline", ".box-flag"),
  ...pair("the warnings button", "toolbar", ".warnings-button"),
  ...pair('the "added" badge', "dialogs", ".kind-added"),
  ...pair('the "changed" badge', "dialogs", ".kind-changed"),
  ...pair('the "deleted" badge', "dialogs", ".kind-deleted"),
  ...pair("a hovered Delete button", "base", "button.danger:hover", TEXT, "button.danger"),
  ...pair("an error callout", "dialogs", ".callout.error"),
  ...PANELS.flatMap((s) => [
    { what: `a quiet icon (table group ✎ and +, calendar button), the full-capacity line, on ${s}`, fg: "var(--text-muted)", bg: `var(${s})`, opacity: "--quiet", min: UI },
  ]),
  { what: "banner text", fg: "var(--text)", bg: rule("toolbar", ".banner", "background"), min: TEXT },
  { what: "banner links", fg: rule("toolbar", ".banner a", "color"), bg: rule("toolbar", ".banner", "background"), min: TEXT },
  { what: "a banner's warning (a clash in someone else's save)", fg: rule("base", ".warn-text", "color"), bg: rule("toolbar", ".banner", "background"), min: TEXT },
  { what: "the saved banner", fg: "var(--text)", bg: rule("toolbar", ".banner.success", "background"), min: TEXT },
  { what: "the saved banner's link to the commit", fg: rule("toolbar", ".banner a", "color"), bg: rule("toolbar", ".banner.success", "background"), min: TEXT },
  ...[["text", "var(--text)"], ["links", rule("toolbar", ".banner a", "color")]].map(([what, fg]) => ({
    what: `a warning banner's ${what}`,
    fg,
    bg: rule("toolbar", ".banner.notice-security, .banner.notice-warning", "background"),
    min: TEXT,
  })),
  { what: "a table row someone else changed", fg: "var(--text)", bg: rule("table", ".box-table tr.updated td:where(:not(.calendar *))", "background"), min: TEXT },
  { what: "a table row that clashes", fg: "var(--text)", bg: rule("table", ".box-table tr.conflict td:where(:not(.calendar *))", "background"), min: TEXT },
  { what: "muted text (code, days) in a row someone else changed", fg: "var(--text-muted)", bg: rule("table", ".box-table tr.updated td:where(:not(.calendar *))", "background"), min: TEXT },
  { what: "muted text (code, days) in a row that clashes", fg: "var(--text-muted)", bg: rule("table", ".box-table tr.conflict td:where(:not(.calendar *))", "background"), min: TEXT },
  { what: "a drag's dates", fg: rule("timeline", ".drag-dates", "color"), bg: rule("timeline", ".drag-dates", "background"), min: TEXT },
  // On its stripes of --surface-2; the others are mixed from it and --surface, where muted text is checked above.
  { what: "a PTO block's resize grip", fg: rule("timeline", ".pto-block:hover .handle::after", "background"), bg: "var(--surface-2)", min: UI },
];

/** What's on a box, from timeline.css, for type colour `--c`. */
const BOX = {
  fill: rule("timeline", ".box", "background"),
  finished: rule("timeline", ".box.progress-finished", "background"),
  ring: rule("timeline", ".status-mark", "color"),
  muted: rule("timeline", ".box-code", "color"),
  jira: rule("timeline", ".box-code.jira", "color"),
};
/** What's on a box or drawn in its type colour, `--c`, or in a department's, `--dept`: checked on every colour of `SWEEP`. */
const BOX_CHECKS: Check[] = [
  { what: "a box's title", fg: "var(--text)", bg: BOX.fill, min: TEXT },
  { what: "a box's code and scale", fg: BOX.muted, bg: BOX.fill, min: TEXT },
  { what: "a box's Jira key", fg: BOX.jira, bg: BOX.fill, min: TEXT },
  { what: "a finished box's title, code and scale", fg: rule("timeline", ".box.progress-finished", "color"), bg: BOX.finished, min: TEXT },
  { what: "a finished box's Jira key", fg: BOX.jira, bg: BOX.finished, min: TEXT },
  { what: "a box's progress mark", fg: BOX.ring, bg: BOX.fill, min: UI },
  { what: "a box's ⚠ (a broken rule) and its warning edge", fg: rule("timeline", ".box-warn", "color"), bg: BOX.fill, min: UI },
  { what: "a finished box's progress mark", fg: BOX.ring, bg: BOX.finished, min: UI },
  { what: "a box's resize grip", fg: rule("timeline", ".box:hover .handle::after", "background"), bg: BOX.fill, min: UI },
  { what: "a finished box's resize grip", fg: rule("timeline", ".box:hover .handle::after", "background"), bg: BOX.finished, min: UI },
  { what: "a collapsed department's box (a bar on its heading's row)", fg: rule("timeline", ".box.compact", "background"), bg: "var(--surface)", min: UI },
  { what: "a collapsed department's capacity line", fg: rule("timeline", ".use-marks", "color"), bg: "var(--surface)", min: UI },
  { what: "a collapsed department's capacity bars", fg: rule("timeline", ".use-marks", "color"), bg: "var(--surface)", opacity: BARS, min: UI },
];
/** Type and department colours: every 51st step of each channel, 216 of them, and the departments' own. */
const SWEEP = [
  ...[0, 51, 102, 153, 204, 255].flatMap((r) => [0, 51, 102, 153, 204, 255].flatMap((g) => [0, 51, 102, 153, 204, 255].map((b) => `rgb(${r}, ${g}, ${b})`))),
  ...DEPARTMENT_COLORS,
];
/** `tokens` with `c` as both the box's type colour and the department's. */
const colored = (tokens: Tokens, c: string): Tokens => new Map([...tokens, ["--c", c], ["--dept", c]]);

const ratio = (check: Check, tokens: Tokens) => {
  const base = check.on ? color(check.on, tokens) : ([255, 255, 255, 1] as Rgba);
  const bg = over(color(check.bg, tokens), base);
  const opacity = check.opacity === undefined ? 1 : Number(check.opacity.startsWith("--") ? tokens.get(check.opacity) : check.opacity);
  return contrast(over(color(check.fg, tokens), bg, opacity), bg);
};

describe("contrast", () => {
  for (const [theme, tokens] of THEMES) {
    it(`meets WCAG AA in the ${theme} theme`, () => {
      const short = CHECKS.map((c) => ({ what: c.what, ratio: ratio(c, tokens), min: c.min }))
        .filter((c) => c.ratio < c.min)
        .map((c) => `${c.what}: ${c.ratio.toFixed(3)}, under ${c.min}`);
      expect(short).toEqual([]);
    });

    it(`meets WCAG AA on a box of any type colour, and in any department colour, in the ${theme} theme`, () => {
      const short: string[] = [];
      for (const check of BOX_CHECKS) {
        const worst = SWEEP.map((c) => ({ c, r: ratio(check, colored(tokens, c)) })).sort((a, b) => a.r - b.r)[0];
        if (worst.r < check.min) short.push(`${check.what}: ${worst.r.toFixed(2)} on ${worst.c}`);
      }
      expect(short).toEqual([]);
    });
  }
});

// CONTRAST_REPORT=<file> npx vitest run src/styles/contrast.test.ts writes every ratio to <file>, for tuning colours.
if (process.env.CONTRAST_REPORT) {
  const lines: string[] = [];
  for (const [theme, tokens] of THEMES) {
    lines.push(`${theme}`);
    for (const c of CHECKS) lines.push(`${ratio(c, tokens).toFixed(2).padStart(6)} ${c.min}  ${c.what}`);
    for (const check of BOX_CHECKS) {
      const rs = SWEEP.map((c) => ({ c, r: ratio(check, colored(tokens, c)) })).sort((a, b) => a.r - b.r);
      lines.push(`${rs[0].r.toFixed(2).padStart(6)} ${check.min}  ${check.what} (worst ${rs[0].c})`);
    }
  }
  writeFileSync(process.env.CONTRAST_REPORT, lines.join("\n") + "\n");
}

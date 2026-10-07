// The licence files a release ships (cli/licenses.ts): Vite's lists, reworded
// for the command-line tool, and the app's with the notice for its icons,
// which must name every icon Icon.tsx draws.

import { readFileSync } from "node:fs";
import type { Rolldown } from "vite";
import { describe, expect, it } from "vitest";
import { ICONS_NOTICE, licenseFile } from "./licenses";

type OutputAsset = Rolldown.OutputAsset;
type OutputBundle = Rolldown.OutputBundle;

const VITE_LIST = "# Licenses\n\nThe app bundles dependencies which contain the following licenses:\n\n## yaml - 2.9.1 (ISC)\n\nCopyright Eemeli Aro\n";

/** Runs the plugin's generateBundle on a bundle holding `files` (name → text); the bundle after. */
function run(plugin: ReturnType<typeof licenseFile>, files: Record<string, string | Uint8Array>): OutputBundle {
  const bundle = Object.fromEntries(Object.entries(files).map(([fileName, source]) => [fileName, { type: "asset", fileName, source } as OutputAsset])) as OutputBundle;
  const hook = plugin.generateBundle as { order: string; handler: (this: unknown, options: unknown, bundle: OutputBundle) => void };
  expect(hook.order).toBe("post");
  hook.handler.call({}, {}, bundle);
  return bundle;
}

const text = (bundle: OutputBundle, name: string) => (bundle[name] as OutputAsset).source;

describe("the licence files", () => {
  it("adds the icons' notice to the end of the app's list", () => {
    const out = run(licenseFile("licenses.txt", { append: ICONS_NOTICE }), { "licenses.txt": VITE_LIST, "index.html": "<!doctype html>" });
    expect(text(out, "licenses.txt")).toBe(`${VITE_LIST}\n${ICONS_NOTICE}`);
    expect(text(out, "index.html")).toBe("<!doctype html>");
  });

  it("says what bundles the packages, for the command-line tool's list (bytes too)", () => {
    const out = run(licenseFile("THIRD_PARTY_LICENSES.txt", { bundler: "dist/boxops.mjs" }), { "THIRD_PARTY_LICENSES.txt": new TextEncoder().encode(VITE_LIST) });
    expect(text(out, "THIRD_PARTY_LICENSES.txt")).toBe(VITE_LIST.replace("The app bundles", "dist/boxops.mjs bundles"));
  });

  it("fails the build when Vite wrote no list, or one it no longer opens the same way", () => {
    expect(() => run(licenseFile("licenses.txt", { append: ICONS_NOTICE }), {})).toThrow("licenses.txt, the licences of what this build bundles, wasn’t written");
    expect(() => run(licenseFile("THIRD_PARTY_LICENSES.txt", { bundler: "dist/boxops.mjs" }), { "THIRD_PARTY_LICENSES.txt": "# Licenses\n" })).toThrow("doesn’t open as Vite’s list did");
  });

  it("names, in the icons' notice, every icon Icon.tsx draws (by Lucide's name), with Lucide's and Feather's terms", () => {
    const source = readFileSync(new URL("../src/components/Icon.tsx", import.meta.url), "utf8");
    const block = /const PATHS = \{\n([\s\S]*?)\n\} as const;/.exec(source)?.[1] ?? "";
    const icons = [...block.matchAll(/^ {2}"?([\w-]+)"?: \[/gm)].map((m) => m[1]);
    // The app's name for an icon → Lucide's.
    const lucide: Record<string, string> = { alert: "triangle-alert", external: "arrow-up-right", undo: "undo-2", redo: "redo-2", grip: "grip-vertical" };
    expect(icons.length).toBeGreaterThan(10);
    const listed = /their SVG paths copied in: ([^.]*)\./.exec(ICONS_NOTICE.replace(/\n/g, " "))?.[1].split(/, | and /) ?? [];
    expect(listed, "the icons the notice names: one for each in Icon.tsx's PATHS").toEqual(icons.map((i) => lucide[i] ?? i));
    expect(ICONS_NOTICE).toContain("ISC License\n\nCopyright (c) 2026 Lucide Icons and Contributors\n");
    expect(ICONS_NOTICE).toContain("The MIT License (MIT) (for the icons derived from Feather)\n\nCopyright (c) 2013-present Cole Bemis\n");
  });
});

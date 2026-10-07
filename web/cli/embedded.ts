// Text from the BoxOps repository that the command-line tool carries, so it
// works offline and always matches its own release: the AGENTS.md block and
// the guide (templates/), the starter repository's files (starter/), and the
// data format reference (docs/data-format.md). vite.cli.config.ts compiles
// them into dist/boxops.mjs; run from source, they're read from the checkout.
// Node-only.

import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { HERE } from "./release.ts";

declare const __BOXOPS_EMBEDDED__: Record<string, string> | undefined;

/** What's carried, from the BoxOps repository's top level: folders (every file in them, dotfiles too) and files. */
export const EMBEDDED_PATHS = ["templates", "starter", "docs/data-format.md"];

/** The carried files (path from the BoxOps repository's top level → text) read from a checkout at `repoDir`. */
export function collectEmbedded(repoDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (path: string) => {
    const full = join(repoDir, path);
    const st = lstatSync(full);
    if (st.isDirectory()) for (const name of readdirSync(full).sort()) add(`${path}/${name}`);
    else if (st.isFile()) out[path] = readFileSync(full, "utf8");
    else throw new Error(`${path} isn’t a plain file: BoxOps carries plain files only`);
  };
  for (const path of EMBEDDED_PATHS) add(path);
  return out;
}

let cache: Record<string, string> | undefined;

/** The carried files: compiled in, or read from this source checkout. */
export function embedded(): Record<string, string> {
  if (typeof __BOXOPS_EMBEDDED__ !== "undefined") return __BOXOPS_EMBEDDED__;
  cache ??= collectEmbedded(resolve(HERE, "../.."));
  return cache;
}

/** One carried file's text; throws if it isn't carried. */
export function carried(path: string): string {
  const text = embedded()[path];
  if (text === undefined) throw new Error(`BoxOps doesn’t carry ${path}`);
  return text;
}

/** The starter repository's files (path in the starter → text). */
export function starterFiles(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(embedded())
      .filter(([p]) => p.startsWith("starter/"))
      .map(([p, t]) => [p.slice("starter/".length), t]),
  );
}

// Where the command-line tool keeps releases it downloads (upgrade fetches the
// new release's tool to run it): the launcher's cache, never inside the
// repository, since a file committed there would run as code on teammates'
// machines. The order and checks are the launcher's (starter/.boxops/boxops.mjs).
// Node-only.

import { mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { Env } from "./gha.ts";

/**
 * The cache folder: $BOXOPS_CACHE, $XDG_CACHE_HOME/boxops, ~/.cache/boxops,
 * then a folder of this user's in the temp folder; the first that can be
 * made, is outside `root`, is this user's and isn't writable by others.
 * Throws if none is, or if $BOXOPS_CACHE is inside `root`.
 */
export function cacheRoot(env: Env, root: string): string {
  const uid = process.getuid?.();
  const tries = [env.BOXOPS_CACHE, env.XDG_CACHE_HOME && join(env.XDG_CACHE_HOME, "boxops"), join(homedir(), ".cache", "boxops"), join(tmpdir(), `boxops-cache-${uid ?? "user"}`)];
  const top = realpathSync(root);
  for (const dir of tries.filter((d): d is string => !!d)) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const real = realpathSync(dir);
      if (real === top || real.startsWith(top + sep)) {
        if (dir === env.BOXOPS_CACHE) throw new Error("BOXOPS_CACHE must be outside this repository");
        continue;
      }
      const st = statSync(real);
      if (uid !== undefined && (st.uid !== uid || st.mode & 0o022)) continue;
      writeFileSync(join(real, ".write-test"), "");
      return real;
    } catch (e) {
      if ((e as Error).message === "BOXOPS_CACHE must be outside this repository") throw e;
    }
  }
  throw new Error("no writable cache folder outside this repository; set BOXOPS_CACHE");
}

/** The folder a release's files are cached in: `<cache>/<owner>__<repo>/<sha>`, as the launcher keeps them. */
export const releaseCache = (cache: string, repo: string, sha: string) => join(cache, repo.replace("/", "__"), sha);

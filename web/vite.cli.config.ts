import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin, defineConfig } from "vite";
import { collectEmbedded } from "./cli/embedded.ts";
import { licenseFile } from "./cli/licenses.ts";
import { buildJsonText, identity, makeBuildJson } from "./cli/release.ts";

// `npm run build:cli`: the command-line tool and the action, bundled for Node
// by Vite 8's Rolldown (no other bundler): dist/boxops.mjs (the engine, every
// command and what they carry: what git tracks in templates/ and starter/;
// the yaml library inside; unminified, so anyone can read what runs) and
// dist/action.mjs (a few lines: it imports ./boxops.mjs and runs runAction,
// with Path B's flags if it's given any).
// Then dist/BUILD.json, naming the build and every file's SHA-256, as a
// release's does: run `npm run build` first, so dist/app is there to list.
// The build id and time are the app's (cli/site.ts's appInfo), so the tool
// and the app it ships agree; BUILD.json's `source` is HEAD.

const WEB_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_DIR = resolve(WEB_DIR, "..");
const OUT = join(WEB_DIR, "dist");
const RELEASE = identity();

/** Every file under `dir`, "/"-separated, relative to it. */
function walk(dir: string, rel = ""): string[] {
  return readdirSync(join(dir, rel))
    .sort()
    .flatMap((name) => {
      const path = rel ? `${rel}/${name}` : name;
      return statSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path];
    });
}

/**
 * dist/action.mjs, which action.yml runs: the action is in boxops.mjs, with
 * everything else (one file, not a chunk the two share, so boxops.mjs is
 * whole for the launcher, Path B and anyone reading it). The runner gives it
 * no arguments, only INPUT_* variables; Path B runs it with flags instead
 * (`node dist/action.mjs --mode check`).
 */
const ACTION_MJS = `// BoxOps action entry: action.yml runs this (runs.using: node24), and Path B runs it with flags.
// Everything is in boxops.mjs.
import { runAction } from "./boxops.mjs";

process.exitCode = await runAction({ argv: process.argv.slice(2) });
`;

/** Emits dist/action.mjs. */
function actionEntry(): Plugin {
  return {
    name: "boxops-action-entry",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "action.mjs", source: ACTION_MJS });
    },
  };
}

/** Writes dist/BUILD.json once the bundles are written. */
function buildJson(): Plugin {
  return {
    name: "boxops-build-json",
    apply: "build",
    closeBundle() {
      const app = join(OUT, "app");
      let appFiles: string[];
      try {
        appFiles = walk(app);
      } catch {
        throw new Error("dist/app is missing: run `npm run build` (the app) before `npm run build:cli`");
      }
      const index = readFileSync(join(app, "index.html"), "utf8");
      if (!index.includes(`<meta name="boxops-build" content="${RELEASE.build}"`)) {
        throw new Error(`dist/app was built as another build than ${RELEASE.build}: run \`npm run build\` again first`);
      }
      const files: Record<string, Uint8Array> = {};
      for (const path of ["boxops.mjs", "action.mjs", ...appFiles.map((p) => `app/${p}`)]) files[`dist/${path}`] = readFileSync(join(OUT, ...path.split("/")));
      writeFileSync(join(OUT, "BUILD.json"), buildJsonText(makeBuildJson(RELEASE, files)));
      const shown = relative(process.cwd(), join(OUT, "BUILD.json")).split(sep).join("/");
      this.info?.(`${shown}: ${RELEASE.build}, ${Object.keys(files).length} files`);
    },
  };
}

export default defineConfig({
  // No public/ files and no index.html here: this build is for Node.
  publicDir: false,
  logLevel: "warn",
  define: {
    __BOXOPS_RELEASE__: JSON.stringify(RELEASE),
    __BOXOPS_EMBEDDED__: JSON.stringify(collectEmbedded(REPO_DIR)),
  },
  ssr: {
    // Bundle the yaml library (and anything else) in: adopters install nothing.
    noExternal: true,
  },
  plugins: [actionEntry(), buildJson(), licenseFile("THIRD_PARTY_LICENSES.txt", { bundler: "dist/boxops.mjs" })],
  build: {
    ssr: true,
    target: "node22.12",
    outDir: OUT,
    // dist/app is the app's build (npm run build); only the two files here are this build's.
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    copyPublicDir: false,
    reportCompressedSize: false,
    // The licences of what boxops.mjs bundles (yaml): THIRD_PARTY_LICENSES.txt
    // at the top of a release commit (scripts/release-tree.ts puts it there).
    license: { fileName: "THIRD_PARTY_LICENSES.txt" },
    rolldownOptions: {
      input: { boxops: join(WEB_DIR, "cli/boxops.ts") },
      output: { format: "es", entryFileNames: "[name].mjs" },
      onLog(level, log, handler) {
        // model/load.ts fetches the parser on first use in the app; here it's in the one file anyway.
        if (log.code === "INEFFECTIVE_DYNAMIC_IMPORT") return;
        handler(level, log);
      },
    },
  },
});

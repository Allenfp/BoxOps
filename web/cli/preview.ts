// `preview [--port 4173] [--open]`: the working tree's roadmap in the app,
// served on 127.0.0.1 only. The site is what the action would build, but read
// from the files on disk and marked local: the app shows it read-only, asks
// GitHub nothing, and fetches roadmap.json every second, so a saved file shows
// within a second. The app's files are this release's: dist/app beside the
// tool, or, for a tool the launcher downloaded alone, fetched once by the
// pinned commit, checked against its BUILD.json and kept beside it.
// Node-only.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, relative, sep } from "node:path";
import { loadRoadmap } from "../src/model/parse.ts";
import { type Io, type LaunchContext, UsageError } from "./context.ts";
import { fileAt, gitHub } from "./github.ts";
import { type BuildJson, buildJsonText, digest, findBuildJson, openRelease, parseBuildJson, releaseFile, verifiedApp } from "./release.ts";
import { resultLine } from "./roadmap.ts";
import { buildBundle } from "./site.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

/**
 * Makes sure the app's files are beside the tool in `cliDir`: if there's no
 * BUILD.json there, fetches it and every dist/app file from `repo@sha` (the
 * pin), checking each against it, then keeps them (the launcher's cache).
 */
export async function ensureApp(cliDir: string, ctx: LaunchContext, io: Io): Promise<void> {
  if (findBuildJson(cliDir)) return;
  if (!ctx.repo || !ctx.sha) {
    throw new UsageError(`No app beside ${cliDir}: run preview through .boxops/boxops.mjs, or set BOXOPS_CLI to a release’s dist/boxops.mjs`);
  }
  io.err(`Fetching the app of ${ctx.repo}@${ctx.sha.slice(0, 12)} (once)…`);
  const gh = gitHub(io.env, io.fetch);
  const text = new TextDecoder().decode(await fileAt(gh, ctx.repo, ctx.sha, "BUILD.json"));
  const build: BuildJson = parseBuildJson(text);
  for (const [path, want] of Object.entries(build.files)) {
    if (!path.startsWith("dist/app/")) continue;
    const bytes = await fileAt(gh, ctx.repo, ctx.sha, path);
    if (digest(bytes) !== want) throw new Error(`${path} from ${ctx.repo}@${ctx.sha.slice(0, 12)} isn’t the file its BUILD.json describes`);
    const file = releaseFile(cliDir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  // Last, so a fetch cut short is tried again next time.
  writeFileSync(join(cliDir, `BUILD.json.${process.pid}`), buildJsonText(build));
  renameSync(join(cliDir, `BUILD.json.${process.pid}`), join(cliDir, "BUILD.json"));
}

export interface Preview {
  url: string;
  server: Server;
  close(): Promise<void>;
}

export interface PreviewOptions {
  root: string;
  /** The roadmap folder on disk. */
  dir: string;
  port: number;
  io: Io;
}

/** Starts the server; resolves once it's listening. */
export async function startPreview(o: PreviewOptions): Promise<Preview> {
  const id = o.io.identity();
  const app = new Map(verifiedApp(openRelease(o.io.cliDir, id.build)).map((f) => [f.path, f.file]));
  const roadmapDir = relative(o.root, o.dir).split(sep).join("/") || "roadmap";
  let lastResult = "";
  const bundle = async () => {
    const b = await buildBundle({
      repoDir: o.root,
      dir: roadmapDir,
      worktree: o.dir,
      app: { version: id.version, build: id.build, time: id.time },
      // Never Actions' view of things, whatever the environment.
      env: {},
      warn: () => {},
    });
    const loaded = loadRoadmap(b.files, b.ignored);
    const result = resultLine(loaded.roadmap, loaded.issues.length);
    if (result !== lastResult) o.io.err(`${new Date().toTimeString().slice(0, 8)} ${roadmapDir}/: ${result}`);
    lastResult = result;
    return JSON.stringify(b);
  };

  const server = createServer((req, res) => {
    const port = (server.address() as AddressInfo | null)?.port;
    // Only this machine's names: a page elsewhere can't reach it through a DNS name that points here.
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? "/", "http://site").pathname.slice(1)) || "index.html";
    } catch {
      res.writeHead(400).end();
      return;
    }
    const headers = { "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" };
    if (path === "roadmap.json") {
      bundle().then(
        (json) => {
          const etag = `"${createHash("sha256").update(json).digest("base64url")}"`;
          if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, { ...headers, ETag: etag }).end();
            return;
          }
          res.writeHead(200, { ...headers, "Content-Type": "application/json", ETag: etag }).end(req.method === "HEAD" ? undefined : json);
        },
        (e: Error) => {
          o.io.err(e.message);
          res.writeHead(500, { ...headers, "Content-Type": "text/plain; charset=utf-8" }).end(e.message);
        },
      );
      return;
    }
    const file = app.get(path);
    if (!file) {
      res.writeHead(404, headers).end();
      return;
    }
    res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(req.method === "HEAD" ? undefined : readFileSync(file));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (e: NodeJS.ErrnoException) =>
      reject(e.code === "EADDRINUSE" ? new UsageError(`Port ${o.port} is in use: give another with --port`) : e),
    );
    server.listen(o.port, "127.0.0.1", () => resolve());
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  return {
    url,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections(); // a browser's kept-alive connections would hold it open
      }),
  };
}

/** Opens a URL in the default browser, if it can; never fails. */
function openBrowser(url: string): void {
  const [command, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // No browser to open: the address is printed anyway.
  }
}

export async function previewCommand(o: Omit<PreviewOptions, "io"> & { open: boolean }, ctx: LaunchContext, io: Io): Promise<number> {
  await ensureApp(io.cliDir, ctx, io);
  const preview = await startPreview({ ...o, io });
  io.out(`BoxOps preview of ${relative(io.cwd, o.dir) || "."}/ at ${preview.url}`);
  io.out("Read-only, from the files on disk: a saved file shows within a second. Ctrl+C stops it.");
  if (o.open) openBrowser(preview.url);
  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void preview.close().then(resolve);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  return 0;
}

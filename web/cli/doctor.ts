// `doctor`: checks a roadmap repository's BoxOps setup and says what to fix.
// Reads the working tree, and asks GitHub (read-only) whether the pin is a
// release; with the GitHub CLI installed, also whether the tool running was
// signed by BoxOps' release workflow. Never changes anything. Node-only.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isMap, parseDocument } from "yaml";
import { EXIT, type Io, type LaunchContext } from "./context.ts";
import { carried } from "./embedded.ts";
import { GitHubError, gitHub, tags } from "./github.ts";
import { COMMIT_SHA, contractNumber, findPins, type Pin } from "./pins.ts";
import { AGENTS_BLOCK, GUARD, LAUNCHER, UPSTREAM } from "./release.ts";
import { retiredRunners } from "./runners.ts";
import { hasReleaseBlock, isReleaseLauncher, plainText } from "./sync.ts";

type Level = "ok" | "warning" | "problem" | "skipped";

export interface Finding {
  level: Level;
  text: string;
  /** Lines shown under it: a suggested change. */
  detail?: string[];
}

/** A workflow's text, by path from the top level; only plain files. */
export function workflowFiles(root: string): Record<string, string> {
  const dir = join(root, ".github", "workflows");
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (!/\.ya?ml$/.test(name) || !lstatSync(join(dir, name)).isFile()) continue;
    out[`.github/workflows/${name}`] = readFileSync(join(dir, name), "utf8");
  }
  return out;
}

/** Every BoxOps pin in the workflows, with its file. */
export const allPins = (workflows: Record<string, string>): (Pin & { file: string })[] =>
  Object.entries(workflows).flatMap(([file, text]) => findPins(text).map((p) => ({ file, ...p })));

/** A workflow's `permissions` (top level, then each job's) as sorted `key: value` lines; "(not set)" when absent. */
export function permissions(text: string): Record<string, string[]> {
  const doc = parseDocument(text);
  const out: Record<string, string[]> = {};
  if (doc.errors.length || !isMap(doc.contents)) return out;
  const describe = (p: unknown): string[] => {
    if (p === undefined) return ["(not set: the repository’s default)"];
    if (p === null || (typeof p === "object" && Object.keys(p as object).length === 0)) return ["{} (none)"];
    if (typeof p === "string") return [p];
    return Object.entries(p as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .sort();
  };
  const json = doc.toJS() as { permissions?: unknown; jobs?: Record<string, { permissions?: unknown }> };
  out["(workflow)"] = describe(json.permissions);
  for (const [job, def] of Object.entries(json.jobs ?? {})) out[`jobs.${job}`] = describe(def?.permissions);
  return out;
}

/** The starter's reference permissions against the repository's, for deploy.yml and check.yml. */
export function permissionFindings(workflows: Record<string, string>): Finding[] {
  const findings: Finding[] = [];
  for (const name of ["deploy.yml", "check.yml"]) {
    const path = `.github/workflows/${name}`;
    const mine = workflows[path];
    if (mine === undefined) {
      findings.push({ level: "warning", text: `${path} is missing (the starter has one)` });
      continue;
    }
    const want = permissions(carried(`starter/${path}`));
    const have = permissions(mine);
    const differ = Object.keys(want).filter((scope) => JSON.stringify(want[scope]) !== JSON.stringify(have[scope] ?? ["(no such job)"]));
    if (!differ.length) {
      findings.push({ level: "ok", text: `${path}: permissions as in the starter` });
      continue;
    }
    for (const scope of differ) {
      findings.push({
        level: "problem",
        text: `${path} ${scope}: permissions differ from the starter’s`,
        detail: [...(have[scope] ?? ["(no such job)"]).map((l) => `- ${l}`), ...want[scope].map((l) => `+ ${l}`)],
      });
    }
  }
  return findings;
}

/** Is it Node.js 22.12 or later? */
export function nodeFinding(version = process.versions.node): Finding {
  const [maj, min] = version.split(".").map(Number);
  const ok = maj > 22 || (maj === 22 && min >= 12);
  return { level: ok ? "ok" : "problem", text: `Node.js ${version}${ok ? "" : ": BoxOps needs 22.12 or later"}` };
}

/**
 * The launcher's, the guard's and AGENTS.md's block numbers against this
 * release's, and the launcher's and the block's text, which `sync` writes:
 * one that says it's this release's may still have been changed, and a
 * launcher that doesn't say isn't one. (doctor runs through the launcher, so
 * one changed to deceive has run already and could print anything:
 * docs/security.md says what doesn't run it.)
 */
export function contractFindings(root: string, workflows: Record<string, string>): Finding[] {
  const read = (path: string) => plainText(join(root, path));
  const out: Finding[] = [];
  /** `text`: whether the file's there but isn't what this release writes, and the command that shows its changes. */
  const check = (what: string, n: number | null, want: number, fix: string, text?: { differs: boolean; log: string }) => {
    if (n !== null && n !== want) out.push({ level: "problem", text: `${what} is ${n}; this BoxOps’s is ${want} (${fix})` });
    else if (text?.differs) {
      out.push({ level: "problem", text: `${what} isn’t this release’s text${n === null ? "" : ` (though it says ${n})`}: see what changed (\`${text.log}\`), then ${fix}` });
    } else if (n === null) out.push({ level: "warning", text: `${what}: not found (${fix})` });
    else out.push({ level: "ok", text: `${what} ${n}${text ? ", this release’s text" : ""}` });
  };
  const sync = "run `node .boxops/boxops.mjs sync`";
  const launcher = read(".boxops/boxops.mjs");
  check("Launcher", launcher === undefined ? null : contractNumber(launcher, "launcher"), LAUNCHER, sync, {
    differs: launcher !== undefined && !isReleaseLauncher(launcher),
    log: "git log -p -- .boxops/boxops.mjs",
  });
  // An AGENTS.md without the block is the team's own: the block is missing, not changed.
  const agents = read("AGENTS.md");
  const block = agents === undefined ? null : contractNumber(agents, "block");
  check("AGENTS.md’s BoxOps block", block, AGENTS_BLOCK, sync, {
    differs: agents !== undefined && block !== null && !hasReleaseBlock(agents),
    log: "git log -p -- AGENTS.md",
  });
  const deploy = workflows[".github/workflows/deploy.yml"];
  const guard = deploy === undefined ? null : contractNumber(deploy, "guard");
  if (guard !== null && guard !== GUARD) {
    const reference = carried("starter/.github/workflows/deploy.yml");
    const step = /^ {6}- name: Check the GitHub Pages settings[\s\S]*?(?=^ {6}- id: deployment)/m.exec(reference)?.[0];
    out.push({
      level: "problem",
      text: `The Pages guard in deploy.yml is ${guard}; this BoxOps’s is ${GUARD}: replace the step “Check the GitHub Pages settings” with this release’s`,
      detail: step?.trimEnd().split("\n"),
    });
  } else check("Pages guard (deploy.yml)", guard, GUARD, "see the starter’s deploy.yml");
  return out;
}

/** What `gh attestation verify` made of the tool. */
export interface Attested {
  ok: boolean;
  /** What gh printed. */
  output: string;
  /** Set when it checked nothing, saying why (no sign-in, no network, too slow): not a failed check. */
  unchecked?: string;
}

export interface DoctorOptions {
  /** Default: run `gh` (ghAttest). */
  attest?(file: string): Attested | null;
  /** The tool's own file, for the attestation; default: the running module. */
  cliFile?: string;
}

/**
 * Why `gh attestation verify` checked nothing, from how it ended (killed, or
 * its exit code) and what it printed; undefined if it did check and the file
 * failed. gh exits 4 when it needs a sign-in, and checks nothing without
 * GitHub's API and Sigstore's trust root, both online.
 */
export function uncheckedBecause(end: { status?: number | null; signal?: string | null; code?: string }, output: string): string | undefined {
  if (end.signal || end.code === "ETIMEDOUT") return "gh didn’t finish in time";
  if (end.status === 4 || /\bHTTP 401\b/.test(output)) return "the GitHub CLI isn’t signed in to github.com, or its sign-in was refused (`gh auth login`)";
  if (/sigstore verifier|error connecting|could not connect|connection refused|no such host|dial tcp|network is unreachable|timeout|timed out|deadline exceeded|TLS handshake|\bHTTP (5\d\d|429)\b|rate limit/i.test(output)) {
    return "couldn’t reach GitHub or Sigstore";
  }
  return undefined;
}

/**
 * `gh attestation verify` of the tool, or null if the GitHub CLI isn't
 * installed. Against github.com, where BoxOps' releases are, whichever host
 * gh would choose by itself (GH_HOST, or the one it's signed in to: a GitHub
 * Enterprise Server's, which gh attestation refuses).
 */
export function ghAttest(file: string, timeout = 60_000): Attested | null {
  try {
    const output = execFileSync(
      "gh",
      ["attestation", "verify", file, "-R", UPSTREAM, "--signer-workflow", `${UPSTREAM}/.github/workflows/release.yml`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, env: { ...process.env, GH_HOST: "github.com" } },
    );
    return { ok: true, output: output.trim() };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string; stdout?: string; status?: number | null; signal?: string | null };
    if (err.code === "ENOENT") return null;
    const output = `${err.stderr ?? ""}${err.stdout ?? ""}`.trim() || err.message;
    const unchecked = uncheckedBecause(err, output);
    return { ok: false, output, ...(unchecked !== undefined && { unchecked }) };
  }
}

export async function doctor(root: string, ctx: LaunchContext, io: Io, o: DoctorOptions = {}): Promise<Finding[]> {
  const findings: Finding[] = [nodeFinding()];
  const workflows = workflowFiles(root);
  const pins = allPins(workflows);
  const shas = [...new Set(pins.map((p) => p.ref))];
  const repos = [...new Set(pins.map((p) => p.repo))];
  if (!pins.length) findings.push({ level: "problem", text: "No BoxOps pin (`uses: <owner>/<boxops repo>@<commit>`) in .github/workflows" });
  else if (shas.length > 1 || repos.length > 1) {
    findings.push({ level: "problem", text: `The pins differ: ${pins.map((p) => `${p.file}:${p.line} ${p.repo}@${p.ref.slice(0, 12)}`).join(", ")} (\`node .boxops/boxops.mjs upgrade\` puts them all on one release)` });
  } else if (!COMMIT_SHA.test(shas[0])) {
    findings.push({ level: "problem", text: `BoxOps is pinned to “${shas[0]}”, not a commit: a tag or branch can be moved (\`node .boxops/boxops.mjs upgrade\` pins the release’s commit)` });
  } else findings.push({ level: "ok", text: `${pins.length} pin${pins.length === 1 ? "" : "s"}, all ${repos[0]}@${shas[0].slice(0, 12)}` });

  if (pins.length && shas.length === 1 && repos.length === 1 && COMMIT_SHA.test(shas[0])) {
    const [repo, sha] = [repos[0], shas[0]];
    try {
      const named = (await tags(gitHub(io.env, io.fetch), repo)).filter((t) => t.commit === sha).map((t) => t.tag);
      if (!named.length) {
        findings.push({ level: "problem", text: `${sha.slice(0, 12)} isn’t the commit of any tag in ${repo}: it may be a fork’s commit seen through ${repo}. Pin a release (\`node .boxops/boxops.mjs upgrade\`)` });
      } else {
        findings.push({ level: "ok", text: `${sha.slice(0, 12)} is ${named.join(", ")} of ${repo}` });
        const wrong = pins.filter((p) => p.tag !== undefined && !named.includes(p.tag));
        const bare = pins.filter((p) => p.tag === undefined);
        if (wrong.length) findings.push({ level: "warning", text: `The comment says ${wrong.map((p) => `${p.tag} (${p.file}:${p.line})`).join(", ")}, but the pin is ${named.join(", ")}` });
        else if (bare.length) findings.push({ level: "warning", text: `No \`# ${named[0]}\` comment on ${bare.map((p) => `${p.file}:${p.line}`).join(", ")} (Dependabot keeps one there)` });
        else findings.push({ level: "ok", text: `The pins’ comments name that tag` });
      }
    } catch (e) {
      if (!(e instanceof GitHubError)) throw e;
      findings.push({ level: "warning", text: `Couldn’t ask GitHub about the pin: ${e.message}` });
    }
  }

  const cliFile = o.cliFile ?? join(io.cliDir, "boxops.mjs");
  if (!existsSync(cliFile)) {
    findings.push({ level: "skipped", text: "Attestation: this tool isn’t a release’s boxops.mjs (run from source?)" });
  } else {
    const result = (o.attest ?? ghAttest)(cliFile);
    const detail = result?.output.split("\n").slice(0, 10);
    if (result === null) findings.push({ level: "skipped", text: "Attestation: the GitHub CLI (gh) isn’t installed" });
    else if (result.ok) findings.push({ level: "ok", text: `Attestation: signed by ${UPSTREAM}/.github/workflows/release.yml` });
    else if (result.unchecked !== undefined) findings.push({ level: "warning", text: `Attestation: couldn’t check the tool: ${result.unchecked}`, detail });
    else findings.push({ level: "problem", text: `Attestation: gh attestation verify failed for ${cliFile}`, detail });
  }
  if (ctx.launcher !== undefined && ctx.launcher !== LAUNCHER) {
    findings.push({ level: "problem", text: `The launcher that ran is ${ctx.launcher}; this BoxOps’s is ${LAUNCHER} (run \`node .boxops/boxops.mjs sync\`)` });
  }
  findings.push(...contractFindings(root, workflows));
  findings.push(...permissionFindings(workflows));
  const today = new Date().toISOString().slice(0, 10);
  const retired = Object.entries(workflows).flatMap(([file, text]) => retiredRunners(text, today).map((w) => `${file}:${w.line} ${w.message}`));
  if (retired.length) for (const r of retired) findings.push({ level: "problem", text: r });
  else findings.push({ level: "ok", text: "Runners: none retired" });
  return findings;
}

export async function doctorCommand(root: string, ctx: LaunchContext, io: Io, o: DoctorOptions = {}): Promise<number> {
  const id = io.identity();
  io.out(`BoxOps doctor: ${root} (BoxOps ${id.version}, build ${id.build})`);
  const findings = await doctor(root, ctx, io, o);
  for (const f of findings) {
    io.out(`  ${f.level.padEnd(8)} ${f.text}`);
    for (const d of f.detail ?? []) io.out(`             ${d}`);
  }
  const problems = findings.filter((f) => f.level === "problem").length;
  io.out(problems ? `${problems} problem${problems === 1 ? "" : "s"} to fix.` : "No problems.");
  return problems ? EXIT.problems : EXIT.ok;
}

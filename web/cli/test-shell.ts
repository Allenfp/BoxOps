// For the tests of commands BoxOps prints for someone to paste (`init`'s next
// steps, publish-starter's): pasted into a shell as a person would, copied
// with their indents and run without -e (an interactive shell has none) or
// startup files, with stand-ins for gh and mktemp, and git told to reach
// local repositories only.

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { tempDir } from "./test-release";

/** Where a program is on this PATH, if it is. */
export function which(name: string): string | undefined {
  return (process.env.PATH ?? "")
    .split(":")
    .filter((d) => isAbsolute(d))
    .map((d) => join(d, name))
    .find((file) => existsSync(file));
}

/**
 * The shells commands are pasted into, with no startup files: bash, and zsh
 * (macOS's own) where `find` finds it (on this PATH, by default). Where zsh
 * must be there, with BOXOPS_TEST_ZSH=1 (CI's unit tests, which install it),
 * a missing one is an error, not its cases left out without a word.
 */
export function shells(find: (name: string) => string | undefined = which, env: NodeJS.ProcessEnv = process.env): string[][] {
  const zsh = find("zsh");
  if (!zsh && env.BOXOPS_TEST_ZSH === "1") throw new Error("BOXOPS_TEST_ZSH=1, but zsh isn’t installed: the commands printed for pasting would go untried in it");
  return [["bash", "--noprofile", "--norc"], ...(zsh ? [["zsh", "-f"]] : [])];
}

/** The shells commands are pasted into here (shells()). */
export const SHELLS: string[][] = shells();

/**
 * Stand-ins, in a folder to put first on PATH, for what printed commands run
 * besides git and rsync: `gh`, noting each call's arguments in gh.log beside
 * it, and `mktemp -d`, making its folder in TMPDIR, which macOS's ignores (so
 * no clone is left in the system's temp folder).
 */
export function standIns(): string {
  const stand = tempDir();
  const mktemp = which("mktemp");
  if (!mktemp) throw new Error("mktemp isn’t installed");
  writeFileSync(join(stand, "gh"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${join(stand, "gh.log")}'\n`, { mode: 0o755 });
  writeFileSync(join(stand, "mktemp"), `#!/bin/sh\n[ "$*" = "-d" ] || exit 64\nexec '${mktemp}' -d "$TMPDIR/tmp.XXXXXXXXXX"\n`, { mode: 0o755 });
  return stand;
}

/**
 * The environment commands are pasted in: the stand-ins first on PATH, this
 * git configuration alone, a fixed identity, local repositories only, and no
 * GitHub sign-in (no token, and an empty gh configuration), so that even
 * GitHub's own gh, were a command ever to reach it, could change nothing.
 */
export function shellEnv(stand: string, gitconfig = ""): NodeJS.ProcessEnv {
  writeFileSync(join(stand, "gitconfig"), gitconfig);
  return {
    PATH: `${stand}:${process.env.PATH}`,
    HOME: stand,
    GH_CONFIG_DIR: join(stand, "gh-config"),
    TMPDIR: tempDir(),
    GIT_CONFIG_GLOBAL: join(stand, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    // Local repositories only: nothing reaches github.com, whatever the commands say.
    GIT_ALLOW_PROTOCOL: "file",
    GIT_AUTHOR_NAME: "Maintainer",
    GIT_AUTHOR_EMAIL: "maintainer@example.com",
    GIT_COMMITTER_NAME: "Maintainer",
    GIT_COMMITTER_EMAIL: "maintainer@example.com",
  };
}

/** The command under the printed line that starts so (after its indent): the lines after it indented further, as someone copies them. */
export function block(printed: string[], heading: string): string {
  const at = printed.findIndex((l) => l.trimStart().startsWith(heading));
  if (at < 0) throw new Error(`Nothing printed starts with “${heading}”`);
  const indent = (line: string) => line.length - line.trimStart().length;
  const rest = printed.slice(at + 1);
  const end = rest.findIndex((l) => indent(l) <= indent(printed[at]));
  const lines = end < 0 ? rest : rest.slice(0, end);
  if (!lines.length) throw new Error(`No command is printed under “${heading}”`);
  return `${lines.join("\n")}\n`;
}

/** `text` pasted into `shell` in `cwd`: run as a script, so without -e, as an interactive shell is. */
export function paste(shell: string[], text: string, cwd: string, env: NodeJS.ProcessEnv): { status: number | null; stderr: string } {
  const script = join(tempDir(), "pasted.sh");
  writeFileSync(script, text);
  const r = spawnSync(shell[0], [...shell.slice(1), script], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { status: r.status, stderr: r.stderr };
}

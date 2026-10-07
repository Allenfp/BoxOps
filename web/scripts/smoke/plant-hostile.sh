#!/usr/bin/env bash
# Makes the roadmap repository DIR hostile, for the smoke tests: files and git
# configuration that would run code if anything ran, imported or configured
# itself from them (npm scripts and .npmrc, vite.config.*, a tsconfig.json
# plugin, a .env, a launcher, a `git` of its own where a relative folder on
# PATH would find it, git hooks, filters, textconv, fsmonitor, a pager,
# credential and ssh helpers, an alias). Each leaves a file in the empty
# folder SENTINELS when it runs, so a run of the action that leaves
# SENTINELS empty ran none of them. The files are committed (an adopter's
# repository could hold them), then the git configuration is planted, then
# the controls: plain `git status` in DIR must set a trap off, and git in DIR
# with a relative folder first on PATH must run the planted one, proving
# they're live on this machine; their sentinels are cleared.
#
# Usage: plant-hostile.sh DIR SENTINELS
set -euo pipefail

dir=$(cd "${1:?usage: plant-hostile.sh DIR SENTINELS}" && pwd)
mkdir -p "${2:?usage: plant-hostile.sh DIR SENTINELS}"
sentinels=$(cd "$2" && pwd)
[ -d "$dir/.git" ] || { echo "plant-hostile.sh: $dir isn't a git repository" >&2; exit 2; }
[ -z "$(ls -A "$sentinels")" ] || { echo "plant-hostile.sh: $sentinels isn't empty" >&2; exit 2; }

export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME="BoxOps smoke test" GIT_AUTHOR_EMAIL="smoke@example.com"
export GIT_COMMITTER_NAME="BoxOps smoke test" GIT_COMMITTER_EMAIL="smoke@example.com"

# Shell code that leaves the sentinel NAME.
touch_() { printf 'touch %q' "$sentinels/$1"; }
evil="$dir/.hostile/evil.cjs"
mkdir -p "$dir/.hostile" "$dir/hooks"
printf 'require("node:fs").writeFileSync(%s, "ran");\n' "\"$sentinels/node-options\"" >"$evil"
for f in vite.config.js vite.config.mjs vite.config.ts; do
  printf 'import { writeFileSync } from "node:fs";\nwriteFileSync(%s, "ran");\nexport default {};\n' "\"$sentinels/$f\"" >"$dir/$f"
done
{
  printf '{ "name": "hostile", "private": true, "scripts": {'
  sep=""
  for s in preinstall install postinstall prepare build test; do
    printf '%s "%s": "%s"' "$sep" "$s" "$(touch_ "npm-$s")"
    sep=","
  done
  printf ' } }\n'
} >"$dir/package.json"
printf 'node-options=--require %s\nscript-shell=/bin/sh\n' "$evil" >"$dir/.npmrc"
printf '{ "compilerOptions": { "plugins": [{ "name": "%s" }] } }\n' "$evil" >"$dir/tsconfig.json"
printf 'NODE_OPTIONS=--require %s\nGIT_DIR=/nonexistent\nBOXOPS_CLI=%s\n' "$evil" "$evil" >"$dir/.env"
printf '* filter=evil diff=evil\n*.yaml filter=evil\n' >"$dir/.gitattributes"
printf '#!/bin/sh\n%s\n' "$(touch_ hook)" >"$dir/hooks/post-checkout"
chmod +x "$dir/hooks/post-checkout"
# A launcher that isn't BoxOps': nothing in CI may run it.
printf '// BoxOps launcher (launcher: 1)\nimport { writeFileSync } from "node:fs";\nwriteFileSync(%s, "ran");\n' "\"$sentinels/launcher\"" >"$dir/.boxops/boxops.mjs"
# A git of its own, executable, at the top and where npm puts programs (an
# editor's token can commit them through the API, .gitignore or not): what
# `.`, `node_modules/.bin` or an empty entry on PATH finds in DIR.
mkdir -p "$dir/node_modules/.bin"
printf '#!/bin/sh\n%s\nexit 1\n' "$(touch_ git)" >"$dir/git"
printf '#!/bin/sh\n%s\nexit 1\n' "$(touch_ node_modules-git)" >"$dir/node_modules/.bin/git"
chmod +x "$dir/git" "$dir/node_modules/.bin/git"
git -C "$dir" add -A
git -C "$dir" add -f node_modules/.bin/git
git -C "$dir" commit -q -m "Hostile files"

# Configuration only this clone has: every way git could be made to run something.
cat >>"$dir/.git/config" <<EOF
[core]
	fsmonitor = $(touch_ fsmonitor)
	pager = $(touch_ pager)
	hooksPath = $dir/hooks
	sshCommand = $(touch_ ssh)
	editor = $(touch_ editor)
	askPass = $(touch_ askpass)
[filter "evil"]
	smudge = $(touch_ smudge)
	clean = $(touch_ clean)
	process = $(touch_ filter-process)
[diff "evil"]
	textconv = $(touch_ textconv)
[credential]
	helper = !$(touch_ credential)
[protocol]
	allow = always
[alias]
	ls = !$(touch_ alias)
EOF
for hook in post-checkout pre-commit post-index-change reference-transaction fsmonitor-watchman; do
  printf '#!/bin/sh\n%s\n' "$(touch_ "hook-$hook")" >"$dir/.git/hooks/$hook"
  chmod +x "$dir/.git/hooks/$hook"
done

# The controls: plain git in DIR sets traps off, and a relative folder first
# on PATH finds the planted git there.
git -C "$dir" status >/dev/null 2>&1 || true
if [ -z "$(ls -A "$sentinels")" ]; then
  echo "plant-hostile.sh: plain git status in $dir set no trap off, so the traps prove nothing here" >&2
  exit 1
fi
(cd "$dir" && PATH="node_modules/.bin:$PATH" git --version) >/dev/null 2>&1 || true
(cd "$dir" && PATH=".:$PATH" git --version) >/dev/null 2>&1 || true
if [ ! -e "$sentinels/git" ] || [ ! -e "$sentinels/node_modules-git" ]; then
  echo "plant-hostile.sh: a relative folder on PATH didn't find the git planted in $dir, so that trap proves nothing here" >&2
  exit 1
fi
set_off=$(cd "$sentinels" && printf '%s ' *)
echo "$dir: hostile (the controls set off: ${set_off% })"
rm -f "$sentinels"/*

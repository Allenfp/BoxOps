#!/usr/bin/env bash
# The action of a release tree (its dist/action.mjs, with INPUT_* variables
# and a GitHub Actions environment, as `uses:` runs it) against roadmap
# repositories it must refuse, each failing with the error that says why: a
# symlink in the roadmap and as it, a submodule in it and as it, a .git file,
# data format 0 and 2, no settings.yaml, a branch that isn't the default, a
# file that isn't UTF-8, a roadmap input with "..", a path outside the
# workspace, GitHub Enterprise Server. And a roadmap with problems, which
# check mode fails, build mode publishes without the broken entries
# (on-problems: deploy, the count in the `problems` output) or refuses
# (on-problems: fail); and a scheduled run, which builds.
#
# Usage: bad-repos.sh RELEASE_DIR [STARTER]   (RELEASE_DIR: a release tree,
# npm run release:build's build/release; STARTER: default this checkout's starter/)
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
release=$(cd "${1:?usage: bad-repos.sh RELEASE_DIR [STARTER]}" && pwd)
starter=$(cd "${2:-$here/../../../starter}" && pwd)
action="$release/dist/action.mjs"
[ -f "$action" ] || { echo "bad-repos.sh: no dist/action.mjs in $release" >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/ws" "$work/home" "$work/temp"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME="BoxOps smoke test" GIT_AUTHOR_EMAIL="smoke@example.com"
export GIT_COMMITTER_NAME="BoxOps smoke test" GIT_COMMITTER_EMAIL="smoke@example.com"
printf '%s\n' '{"repository":{"full_name":"acme/roadmap","default_branch":"main","private":true,"visibility":"private"}}' >"$work/event.json"
printf '%s\n' '{"schedule":"23 6 * * 1"}' >"$work/schedule.json"
failures=0
cases=0

# A repository NAME in the workspace with the starter's roadmap committed on main; its path in $repo.
new_repo() {
  repo="$work/ws/$1"
  mkdir -p "$repo"
  cp -R "$starter/roadmap" "$repo/roadmap"
  git -C "$repo" init -q -b main
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "Start roadmap"
}
commit() { git -C "$repo" add -A && git -C "$repo" commit -q -m "${1:-Change}"; }

# The action on $repo, as a push to main runs it, plus these variables (NAME=VALUE; INPUT_MODE=check, …).
# Its log in $work/log, its outputs in $work/output, its exit code in $code.
run() {
  : >"$work/output"
  : >"$work/summary"
  rm -rf "$work/temp/boxops-site"
  code=0
  env -i PATH="$PATH" HOME="$work/home" LANG=C.UTF-8 \
    GITHUB_ACTIONS=true GITHUB_SERVER_URL=https://github.com GITHUB_REPOSITORY=acme/roadmap \
    GITHUB_REF_NAME=main GITHUB_REF_TYPE=branch GITHUB_EVENT_NAME=push GITHUB_EVENT_PATH="$work/event.json" \
    GITHUB_WORKSPACE="$work/ws" GITHUB_RUN_ID=1 GITHUB_OUTPUT="$work/output" GITHUB_STEP_SUMMARY="$work/summary" \
    RUNNER_OS=Linux RUNNER_TEMP="$work/temp" INPUT_PATH="${repo#"$work/ws/"}" "$@" \
    node "$action" >"$work/log" 2>&1 || code=$?
}

# An output of the last run ($GITHUB_OUTPUT's heredoc form, which is all the action writes).
output() {
  awk -v name="$1" '
    !open && index($0, name "<<") == 1 { delim = substr($0, length(name) + 3); open = 1; next }
    open && $0 == delim { exit }
    open { print }
  ' "$work/output"
}

# expect NAME CODE TEXT: the last run exited CODE and its log has a line holding TEXT.
expect() {
  cases=$((cases + 1))
  if [ "$code" -eq "$2" ] && grep -qF -- "$3" "$work/log"; then
    echo "ok: $1"
  else
    failures=$((failures + 1))
    echo "FAILED: $1: exit $code (expected $2), and the log should hold: $3"
    sed 's/^/    | /' "$work/log"
  fi
}

new_repo symlink
ln -s ../people.yaml "$repo/roadmap/boxes/link.yaml"
commit "A symlink"
run INPUT_MODE=check
expect "a symlink in the roadmap" 1 "::error file=roadmap/boxes/link.yaml,title=BoxOps::roadmap/boxes/link.yaml is a symlink; a roadmap folder holds plain files only"

new_repo symlinked-folder
mv "$repo/roadmap" "$repo/data"
ln -s data "$repo/roadmap"
commit "The roadmap is a symlink"
run
expect "the roadmap folder a symlink" 1 "::error file=roadmap,title=BoxOps::roadmap is a file or a symlink, not a folder"

new_repo submodule
git -C "$repo" update-index --add --cacheinfo "160000,$(git -C "$repo" rev-parse HEAD),roadmap/boxes/sub"
git -C "$repo" commit -q -m "A submodule"
run INPUT_MODE=check
expect "a submodule in the roadmap" 1 "roadmap/boxes/sub is a submodule; a roadmap folder holds plain files only"

new_repo submodule-folder
head=$(git -C "$repo" rev-parse HEAD)
git -C "$repo" rm -rq --cached roadmap
git -C "$repo" update-index --add --cacheinfo "160000,$head,roadmap"
git -C "$repo" commit -q -m "The roadmap is a submodule"
run
expect "the roadmap folder a submodule" 1 "roadmap is a submodule, not a folder"

new_repo main-checkout
git -C "$repo" worktree add -q --detach "$work/ws/worktree" main
repo="$work/ws/worktree"
run INPUT_MODE=check
expect "a .git file (a worktree's)" 1 "worktree/.git is a file (a worktree or submodule checkout): BoxOps reads only a repository’s own .git folder"

new_repo format-0
grep -v '^format:' "$repo/roadmap/settings.yaml" >"$work/settings" && cp "$work/settings" "$repo/roadmap/settings.yaml"
commit "No format"
run
expect "data format 0" 1 "This roadmap is in data format 0; BoxOps $(output version) reads format 1. Run \`node .boxops/boxops.mjs migrate\`, commit and push. The site wasn’t changed"

new_repo format-2
sed 's/^format: 1/format: 2/' "$repo/roadmap/settings.yaml" >"$work/settings" && cp "$work/settings" "$repo/roadmap/settings.yaml"
commit "Format 2"
run INPUT_MODE=check
expect "data format 2" 1 "this roadmap needs BoxOps that reads format 2; upgrade the pin"

new_repo no-settings
git -C "$repo" rm -q roadmap/settings.yaml
git -C "$repo" commit -q -m "No settings"
run
expect "no settings.yaml" 1 "roadmap/settings.yaml is missing: every roadmap needs one"

new_repo branch
run GITHUB_REF_NAME=feature
expect "a branch that isn't the default, in build mode" 1 "BoxOps builds the site from the default branch (main) only, and this run is for feature: run it from main, or use mode: check"
run GITHUB_REF_NAME=feature INPUT_MODE=check
expect "…which check mode reads" 0 "1 departments, 2 lanes, 2 boxes — OK"
run GITHUB_EVENT_NAME=schedule GITHUB_EVENT_PATH="$work/schedule.json"
expect "a scheduled run, which builds (GitHub runs schedules on the default branch)" 0 "Site assembled in $work/temp/boxops-site"

new_repo not-utf8
printf 'id: bx-9z9z-bad\ntitle: \377\376\n' >"$repo/roadmap/boxes/bx-9z9z-bad.yaml"
commit "Not UTF-8"
run INPUT_MODE=check
expect "a file that isn't UTF-8" 1 "roadmap/boxes/bx-9z9z-bad.yaml isn’t UTF-8 text"

new_repo inputs
run INPUT_ROADMAP=../roadmap
expect "a roadmap input with .." 1 "Input roadmap is \"../roadmap\""
run INPUT_PATH=..
expect "a path outside the workspace" 1 "Input path is \"..\", which is outside the workspace"
run GITHUB_SERVER_URL=https://github.example.com
expect "GitHub Enterprise Server" 1 "GitHub Enterprise Server and GHE.com aren’t supported in BoxOps 0.1"

new_repo problems
sed 's/^lane: eng-1$/lane: no-such-lane/' "$repo/roadmap/boxes/bx-1a2b-example-project.yaml" >"$work/box"
cp "$work/box" "$repo/roadmap/boxes/bx-1a2b-example-project.yaml"
commit "A box in a lane that isn't there"
run INPUT_MODE=check
expect "a problem, in check mode" 1 "::error file=roadmap/boxes/bx-1a2b-example-project.yaml"
run
expect "…which build mode publishes without (on-problems: deploy)" 0 "Site assembled in $work/temp/boxops-site"
if [ "$(output problems)" != 1 ] || [ ! -f "$work/temp/boxops-site/roadmap.json" ]; then
  failures=$((failures + 1))
  echo "FAILED: …with problems=1 and a site: problems=$(output problems)"
fi
run INPUT_ON-PROBLEMS=fail
expect "…or refuses (on-problems: fail)" 1 "and on-problems is fail: nothing was built"
if [ -e "$work/temp/boxops-site" ]; then
  failures=$((failures + 1))
  echo "FAILED: on-problems: fail left a site"
fi

echo
if [ "$failures" -gt 0 ]; then
  echo "bad-repos.sh: $failures of $cases checks failed"
  exit 1
fi
echo "bad-repos.sh: all $cases cases failed as they should, or passed as they should ($release)"

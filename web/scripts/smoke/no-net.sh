#!/usr/bin/env bash
# The action of a release tree makes no network call: run as `uses:` runs it
# (INPUT_* variables, a push to main's environment), in check mode and in
# build mode, on the roadmap repository REPO, with every way Node reaches the
# network cut off and noted (no-net.mjs), it succeeds and nothing is noted. A
# control first: a fetch under the same module is noted.
#
# Usage: no-net.sh RELEASE_DIR REPO
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
release=$(cd "${1:?usage: no-net.sh RELEASE_DIR REPO}" && pwd)
repo=$(cd "${2:?usage: no-net.sh RELEASE_DIR REPO}" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/home" "$work/temp"
export BOXOPS_NO_NET_LOG="$work/net.log"
: >"$BOXOPS_NO_NET_LOG"
printf '%s\n' '{"repository":{"full_name":"acme/roadmap","default_branch":"main","private":true,"visibility":"private"}}' >"$work/event.json"
no_net="--import=$here/no-net.mjs"

node "$no_net" -e 'fetch("https://api.github.com/").then(() => process.exit(1), () => process.exit(0))'
if ! grep -q '^fetch https://api.github.com/' "$BOXOPS_NO_NET_LOG"; then
  echo "no-net.sh: the control fetch wasn't noted, so the check below proves nothing" >&2
  exit 1
fi
: >"$BOXOPS_NO_NET_LOG"

for mode in check build; do
  : >"$work/output"
  env -i PATH="$PATH" HOME="$work/home" LANG=C.UTF-8 NODE_OPTIONS="$no_net" BOXOPS_NO_NET_LOG="$BOXOPS_NO_NET_LOG" \
    GITHUB_ACTIONS=true GITHUB_SERVER_URL=https://github.com GITHUB_REPOSITORY=acme/roadmap \
    GITHUB_REF_NAME=main GITHUB_REF_TYPE=branch GITHUB_EVENT_NAME=push GITHUB_EVENT_PATH="$work/event.json" \
    GITHUB_WORKSPACE="$(dirname "$repo")" GITHUB_RUN_ID=1 GITHUB_OUTPUT="$work/output" GITHUB_STEP_SUMMARY="$work/summary" \
    RUNNER_OS=Linux RUNNER_TEMP="$work/temp" INPUT_PATH="$(basename "$repo")" INPUT_MODE="$mode" \
    node "$release/dist/action.mjs" >"$work/log" 2>&1 || {
    echo "no-net.sh: the action failed in $mode mode:" >&2
    sed 's/^/    | /' "$work/log" >&2
    exit 1
  }
  if [ -s "$BOXOPS_NO_NET_LOG" ]; then
    echo "no-net.sh: the action tried the network in $mode mode:" >&2
    sed 's/^/    | /' "$BOXOPS_NO_NET_LOG" >&2
    exit 1
  fi
  echo "ok: $mode mode, no network call ($(grep -m 1 -F -- '— OK' "$work/log"))"
done
[ -f "$work/temp/boxops-site/roadmap.json" ] || { echo "no-net.sh: build mode assembled no site" >&2; exit 1; }

#!/usr/bin/env bash
# The action of a release tree makes no network call: run as `uses:` runs it
# (INPUT_* variables, a push to main's environment), in check mode and in
# build mode, on the roadmap repository REPO, with every way Node reaches the
# network cut off and noted (no-net.mjs), it succeeds and nothing is noted. A
# control first, run the same way (cut_off: a bare environment, no-net.mjs
# given in NODE_OPTIONS): a fetch, and a DNS lookup and a UDP socket through
# names imported from Node's modules (as the release's bundle imports them),
# are noted. And each run, the control's too, must have loaded no-net.mjs
# (it says so in $BOXOPS_NO_NET_LOADED): a run without it proves nothing.
#
# Usage: no-net.sh RELEASE_DIR REPO
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
release=$(cd "${1:?usage: no-net.sh RELEASE_DIR REPO}" && pwd)
repo=$(cd "${2:?usage: no-net.sh RELEASE_DIR REPO}" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/home" "$work/temp"
net_log="$work/net.log"
loaded="$work/loaded"
printf '%s\n' '{"repository":{"full_name":"acme/roadmap","default_branch":"main","private":true,"visibility":"private"}}' >"$work/event.json"

# cut_off RUN OUT [NAME=VALUE …] COMMAND …: runs the command in a bare
# environment with no-net.mjs in NODE_OPTIONS, so every Node process it
# starts loads it; what it prints goes to OUT, its exit code to $code, the
# network calls it tried to $net_log. Stops the script, naming RUN, if
# no-net.mjs wasn't loaded.
cut_off() {
  local run=$1 out=$2
  shift 2
  : >"$net_log"
  : >"$loaded"
  code=0
  env -i PATH="$PATH" HOME="$work/home" LANG=C.UTF-8 NODE_OPTIONS="--import=\"$here/no-net.mjs\"" \
    BOXOPS_NO_NET_LOG="$net_log" BOXOPS_NO_NET_LOADED="$loaded" "$@" >"$out" 2>&1 || code=$?
  if [ ! -s "$loaded" ]; then
    echo "no-net.sh: no-net.mjs wasn't loaded in $run, so nothing was cut off:" >&2
    sed 's/^/    | /' "$out" >&2
    exit 1
  fi
}

cut_off "the control" "$work/control.log" node --input-type=module -e '
import { lookup } from "node:dns";
import { createSocket } from "node:dgram";
for (const call of [() => fetch("https://api.github.com/"), () => lookup("api.github.com", () => {}), () => createSocket("udp4")]) {
  try { await call(); } catch {}
}
process.exit(0);
'
for tried in "fetch https://api.github.com/" "dns.lookup api.github.com" "dgram.createSocket udp4"; do
  if [ "$code" -ne 0 ] || ! grep -qxF "$tried" "$net_log"; then
    echo "no-net.sh: the control's try ($tried) wasn't noted, so the check below proves nothing" >&2
    sed 's/^/    | /' "$work/control.log" >&2
    exit 1
  fi
done

for mode in check build; do
  : >"$work/output"
  cut_off "$mode mode" "$work/log" GITHUB_ACTIONS=true GITHUB_SERVER_URL=https://github.com GITHUB_REPOSITORY=acme/roadmap \
    GITHUB_REF_NAME=main GITHUB_REF_TYPE=branch GITHUB_EVENT_NAME=push GITHUB_EVENT_PATH="$work/event.json" \
    GITHUB_WORKSPACE="$(dirname "$repo")" GITHUB_RUN_ID=1 GITHUB_OUTPUT="$work/output" GITHUB_STEP_SUMMARY="$work/summary" \
    RUNNER_OS=Linux RUNNER_TEMP="$work/temp" INPUT_PATH="$(basename "$repo")" INPUT_MODE="$mode" \
    node "$release/dist/action.mjs"
  if [ "$code" -ne 0 ]; then
    echo "no-net.sh: the action failed in $mode mode:" >&2
    sed 's/^/    | /' "$work/log" >&2
    exit 1
  fi
  if [ -s "$net_log" ]; then
    echo "no-net.sh: the action tried the network in $mode mode:" >&2
    sed 's/^/    | /' "$net_log" >&2
    exit 1
  fi
  echo "ok: $mode mode, no network call ($(grep -m 1 -F -- '— OK' "$work/log"))"
done
[ -f "$work/temp/boxops-site/roadmap.json" ] || { echo "no-net.sh: build mode assembled no site" >&2; exit 1; }

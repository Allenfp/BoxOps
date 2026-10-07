#!/usr/bin/env bash
# A roadmap repository made from the starter's files, for the smoke tests
# (CI's smoke jobs; scripts/release-tree.test.ts): DIR gets the files of
# STARTER (default: this checkout's starter/) as a git repository whose one
# commit is on main, with every BoxOps pin moved to a stand-in release commit,
# as a release's starter has its own. git runs with no configuration but a
# fixed author, wherever it's run.
#
# Usage: starter-repo.sh DIR [STARTER]
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
dir=${1:?usage: starter-repo.sh DIR [STARTER]}
starter=${2:-$here/../../../starter}
[ ! -e "$dir" ] || { echo "starter-repo.sh: $dir is there already" >&2; exit 2; }
[ -f "$starter/roadmap/settings.yaml" ] || { echo "starter-repo.sh: no starter at $starter" >&2; exit 2; }

export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME="BoxOps smoke test" GIT_AUTHOR_EMAIL="smoke@example.com"
export GIT_COMMITTER_NAME="BoxOps smoke test" GIT_COMMITTER_EMAIL="smoke@example.com"

mkdir -p "$dir"
cp -R "$starter/." "$dir/"
# The release the starter is made for: a stand-in commit.
pin=0123456789abcdef0123456789abcdef01234567
for f in "$dir"/.github/workflows/*.yml; do
  sed "s/<RELEASE_COMMIT_SHA>/$pin/g" "$f" >"$f.new"
  mv "$f.new" "$f"
done
if grep -rq "<RELEASE_COMMIT_SHA>" "$dir/.github"; then
  echo "starter-repo.sh: a pin in $dir/.github wasn't filled in" >&2
  exit 1
fi
git -C "$dir" init -q -b main
git -C "$dir" add -A
git -C "$dir" commit -q -m "Start roadmap from the starter"
echo "$dir: the starter's files, committed on main ($(git -C "$dir" rev-parse --short=12 HEAD))"

#!/usr/bin/env bash
# Publishes a built catalog as the orphan branch `data`: one commit with no parent, force-pushed,
# and only when the content differs from what is already published. Never touches any other branch.
#
#   catalog/tools/publish-data-branch.sh <out-dir> <remote> [branch=data]
#
# <remote> is anything `git push` accepts: a URL (with a token for CI) or a path to a (bare) repository.
# Exit codes: 0 published or unchanged, 1 refused (not a catalog), 2 usage, other = git failure.
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: $0 <out-dir> <remote> [branch=data]" >&2
  exit 2
fi
OUT="$1"
REMOTE="$2"
BRANCH="${3:-data}"

if [ ! -f "$OUT/manifest.json" ]; then
  echo "refusing to publish: $OUT/manifest.json is missing (not a catalog)" >&2
  exit 1
fi
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "refusing to force-push to $BRANCH" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# What is published now (if anything): a clone of the branch.
if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
  # autocrlf off: the bytes in the branch are the bytes we compare (matters on Windows)
  git -c core.autocrlf=false clone --quiet --branch "$BRANCH" "$REMOTE" "$WORK/published" 2>/dev/null
  if diff -r -q --exclude=.git "$WORK/published" "$OUT" >/dev/null; then
    echo "catalog unchanged; nothing to publish"
    exit 0
  fi
fi

# A fresh repository holding exactly the new content in a single commit.
# catalogVersion without needing node: the manifest is canonical JSON
VERSION="$(sed -n 's/.*"catalogVersion": *\([0-9][0-9]*\).*/\1/p' "$OUT/manifest.json" | head -n 1)"
VERSION="${VERSION:-unknown}"
mkdir "$WORK/new"
cp -R "$OUT"/. "$WORK/new"/
rm -rf "$WORK/new/.git"
cd "$WORK/new"
git init --quiet -b "$BRANCH"
git config core.autocrlf false
git config core.safecrlf false
git config user.name "${GIT_AUTHOR_NAME:-github-actions[bot]}"
git config user.email "${GIT_AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"
git add -A
git commit --quiet -m "catalog $VERSION"
git push --quiet --force "$REMOTE" "$BRANCH"
echo "published catalog $VERSION to $BRANCH"

#!/usr/bin/env bash
# Builds and publishes a GitHub Release for the version currently in package.json.
#
# electron-builder's own `--publish always` races its per-artifact upload tasks
# against each other on the *first* publish for a tag (each one tries to create
# the release), which can 422 and leave the release missing latest-mac.yml or a
# blockmap. To avoid that, this script builds locally with `--publish never`
# and then hands the finished artifacts to `gh release create/upload` — a
# single sequential process, so there's nothing to race. It's also safe to
# re-run: if the release already exists (e.g. a previous run partially
# uploaded), it fills in/overwrites assets instead of failing.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="bnfy/bowser"
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

command -v gh >/dev/null || { echo "gh CLI not found — required to publish releases." >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh CLI not authenticated. Run: gh auth login" >&2; exit 1; }

echo "==> Releasing Bowser $VERSION ($TAG)"

NEWER_ELECTRON=$(npm view electron version 2>/dev/null || true)
INSTALLED_ELECTRON=$(node -p "require('./node_modules/electron/package.json').version" 2>/dev/null || true)
if [ -n "$NEWER_ELECTRON" ] && [ -n "$INSTALLED_ELECTRON" ] && [ "$NEWER_ELECTRON" != "$INSTALLED_ELECTRON" ]; then
  echo "==> Note: electron $INSTALLED_ELECTRON is installed, but $NEWER_ELECTRON is the latest stable."
  echo "    Chromium can't be swapped at runtime — consider bumping the devDependency for this release."
fi

echo "==> Cleaning dist/"
rm -rf dist

echo "==> Building (unpublished)"
npx electron-builder --publish never

ASSETS=(
  "dist/Bowser-$VERSION-arm64-mac.zip"
  "dist/Bowser-$VERSION-arm64-mac.zip.blockmap"
  "dist/Bowser-$VERSION-arm64.dmg"
  "dist/Bowser-$VERSION-arm64.dmg.blockmap"
  "dist/latest-mac.yml"
)
for f in "${ASSETS[@]}"; do
  [ -f "$f" ] || { echo "Expected build artifact missing: $f" >&2; exit 1; }
done

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "==> Release $TAG already exists — filling in/overwriting assets"
  gh release upload "$TAG" "${ASSETS[@]}" --repo "$REPO" --clobber
else
  echo "==> Creating GitHub release $TAG"
  gh release create "$TAG" "${ASSETS[@]}" --repo "$REPO" --title "$VERSION" --generate-notes
fi

echo "==> Done: https://github.com/$REPO/releases/tag/$TAG"

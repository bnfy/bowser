#!/usr/bin/env bash
# Builds and publishes a GitHub Release for the version currently in package.json.
#
# electron-builder's own `--publish always` races its per-artifact upload tasks
# against each other on the *first* publish for a tag (each one tries to create
# the release), which can 422 and leave the release missing latest-mac.yml or a
# blockmap. To avoid that, this script builds locally with `--publish never`
# and then hands the finished artifacts to `gh release create/upload` — a
# single sequential process, so there's nothing to race. Release versions are
# immutable: if the tag or GitHub release already exists, this script refuses
# to build or upload anything. Bump package.json and start a new version.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="bnfy/blanc"
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

command -v gh >/dev/null || { echo "gh CLI not found — required to publish releases." >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh CLI not authenticated. Run: gh auth login" >&2; exit 1; }

echo "==> Releasing Blanc $VERSION ($TAG)"

# Published versions are immutable. Check both local/remote tags and releases
# before touching metadata or dist/ so a stale package version can never
# overwrite assets that users may already have downloaded.
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null ||
   git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1 ||
   gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Release $TAG already exists. Refusing to overwrite it; bump package.json to a new version." >&2
  exit 1
fi

# Artifacts must correspond to committed release sources. `build/` holds
# Electron packaging inputs (including macOS entitlements and the app icon),
# so include it alongside source and package metadata. Other platform work
# outside those inputs may remain in progress without contaminating this
# desktop release.
RELEASE_SOURCES=(
  src
  build
  package.json
  package-lock.json
  scripts/release.sh
  scripts/preflight-mac-signing.mjs
  scripts/after-sign-verify.js
  .github/workflows/release-windows-linux.yml
)
# Check the index and working tree separately so staged and unstaged edits
# both block a release.
if ! git diff --cached --quiet HEAD -- "${RELEASE_SOURCES[@]}" ||
   ! git diff --quiet -- "${RELEASE_SOURCES[@]}" ||
   [ -n "$(git ls-files --others --exclude-standard -- "${RELEASE_SOURCES[@]}")" ]; then
  echo "Release sources are dirty. Commit src/, build/, package metadata, and release workflow changes before publishing." >&2
  exit 1
fi

# Keep the marketing site's release metadata in sync: the JSON-LD
# softwareVersion in site/index.html and the sitemap's lastmod are the only
# version-dated bits (download links point at /releases/latest, always fresh).
echo "==> Syncing site metadata to $VERSION"
sed -i '' -E "s/\"softwareVersion\": \"[^\"]*\"/\"softwareVersion\": \"$VERSION\"/" site/index.html
sed -i '' -E "s|<lastmod>[^<]*</lastmod>|<lastmod>$(date +%F)</lastmod>|" site/sitemap.xml
if ! git diff --quiet -- site/index.html site/sitemap.xml; then
  echo "==> site/ metadata updated — commit and redeploy the site after this release."
fi

NEWER_ELECTRON=$(npm view electron version 2>/dev/null || true)
INSTALLED_ELECTRON=$(node -p "require('./node_modules/electron/package.json').version" 2>/dev/null || true)
if [ -n "$NEWER_ELECTRON" ] && [ -n "$INSTALLED_ELECTRON" ] && [ "$NEWER_ELECTRON" != "$INSTALLED_ELECTRON" ]; then
  echo "==> Note: electron $INSTALLED_ELECTRON is installed, but $NEWER_ELECTRON is the latest stable."
  echo "    Chromium can't be swapped at runtime — consider bumping the devDependency for this release."
fi

# The embedded provisioning profile must list the exact certificate this
# build will be signed with, or the restricted keychain-access-groups
# entitlement is unauthorized and AMFI kills the shipped app at spawn.
echo "==> Preflight: signing identity vs embedded provisioning profile"
node scripts/preflight-mac-signing.mjs

echo "==> Cleaning dist/"
rm -rf dist

echo "==> Building (unpublished)"
BUILD_CMD=(npx electron-builder --publish never)
if command -v op >/dev/null; then
  if ! op run --env-file=.env.1password --no-masking -- "${BUILD_CMD[@]}"; then
    echo "==> op run failed (1Password locked, or 'Apple Notarization' item missing?) — see .env.1password / CLAUDE.md." >&2
    exit 1
  fi
else
  echo "==> Note: 1Password CLI not found — building unnotarized. See .env.1password / CLAUDE.md."
  "${BUILD_CMD[@]}"
fi

ASSETS=(
  "dist/Blanc-$VERSION-arm64-mac.zip"
  "dist/Blanc-$VERSION-arm64-mac.zip.blockmap"
  "dist/Blanc-$VERSION-arm64.dmg"
  "dist/Blanc-$VERSION-arm64.dmg.blockmap"
  "dist/Blanc-$VERSION-mac.zip"
  "dist/Blanc-$VERSION-mac.zip.blockmap"
  "dist/Blanc-$VERSION.dmg"
  "dist/Blanc-$VERSION.dmg.blockmap"
  "dist/latest-mac.yml"
)
for f in "${ASSETS[@]}"; do
  [ -f "$f" ] || { echo "Expected build artifact missing: $f" >&2; exit 1; }
done

echo "==> Creating GitHub release $TAG"
gh release create "$TAG" "${ASSETS[@]}" --repo "$REPO" --title "$VERSION" --generate-notes

echo "==> Done: https://github.com/$REPO/releases/tag/$TAG"

# Windows (NSIS) and Linux (AppImage) can't be built here — this script runs
# on a macOS dev machine, and cross-compiling a *signed* Windows installer
# needs a real Windows toolchain. Instead, dispatch the CI workflow that
# builds both on their native runners and uploads onto this same tag.
echo "==> Dispatching Windows/Linux CI build for $TAG"
if ! gh workflow run release-windows-linux.yml --repo "$REPO" -f tag="$TAG" 2>/tmp/release-wf-dispatch.err; then
  echo "==> Could not dispatch release-windows-linux.yml — it may not exist on the default branch yet (workflow_dispatch only works off the default branch), or gh may be missing the 'workflow' scope." >&2
  cat /tmp/release-wf-dispatch.err >&2
  echo "==> Build Windows/Linux manually once resolved: gh workflow run release-windows-linux.yml --repo $REPO -f tag=$TAG" >&2
  exit 0
fi

echo "==> Waiting for the run to register..."
sleep 8
RUN_ID=$(gh run list --repo "$REPO" --workflow=release-windows-linux.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')
if [ -z "$RUN_ID" ]; then
  echo "==> Dispatched, but couldn't find the run to watch — check: gh run list --repo $REPO --workflow=release-windows-linux.yml" >&2
  exit 0
fi

echo "==> Watching run $RUN_ID (Windows + Linux builds, several minutes)"
if gh run watch "$RUN_ID" --repo "$REPO" --exit-status; then
  echo "==> Windows/Linux artifacts uploaded to $TAG"
else
  echo "==> Windows/Linux CI build failed or was inconclusive — see: gh run view $RUN_ID --repo $REPO --log-failed" >&2
  exit 1
fi

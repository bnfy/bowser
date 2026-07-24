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
  scripts/after-pack-app-icons.js
  scripts/after-sign-verify.js
  .github/workflows/release-windows-linux.yml
  scripts/generate-site-changelog.mjs
)
# Check the index and working tree separately so staged and unstaged edits
# both block a release.
if ! git diff --cached --quiet HEAD -- "${RELEASE_SOURCES[@]}" ||
   ! git diff --quiet -- "${RELEASE_SOURCES[@]}" ||
   [ -n "$(git ls-files --others --exclude-standard -- "${RELEASE_SOURCES[@]}")" ]; then
  echo "Release sources are dirty. Commit src/, build/, package metadata, and release workflow changes before publishing." >&2
  exit 1
fi

# The tag must point at exactly the commit we build. gh release create makes a
# missing tag from the REMOTE default-branch HEAD, so require local HEAD to be
# pushed and bind the tag to it explicitly (see --target below).
git fetch origin --quiet
LOCAL_HEAD="$(git rev-parse HEAD)"
if [ "$LOCAL_HEAD" != "$(git rev-parse origin/main)" ]; then
  echo "HEAD is not on origin/main. Push the release commit first: git push origin main" >&2
  exit 1
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
# Hand-written, per-release summary prepended to GitHub's auto-generated notes.
# REWRITE THIS every release to describe what actually shipped. Keep each
# paragraph on ONE line: generate-site-changelog.mjs splits the release body by
# newline and turns every non-bullet line into its own <p>, so a hard-wrapped
# paragraph fragments on the marketing changelog (and a literal "---" becomes a
# stray paragraph — hence no separator rule here, just a blank line between
# paragraphs). Fails CLOSED: if the changelog can't be generated we abort BEFORE
# publishing an immutable release with incomplete notes.
NOTES_FILE="$(mktemp)"
trap 'rm -f "$NOTES_FILE"' EXIT
if ! GENERATED="$(gh api "repos/$REPO/releases/generate-notes" -f tag_name="$TAG" -f target_commitish="$LOCAL_HEAD" --jq .body)" || [ -z "$GENERATED" ]; then
  echo "Failed to generate the release changelog — aborting before publish." >&2
  exit 1
fi
{
  echo "Blanc v$VERSION turns the Island into a full search surface. Start typing in ⌘L and Blanc now blends your open tabs, groups, Favorites, and history with live suggestions from the search engine you chose in Settings; arrow through the six-row list or press Enter to search exactly what you typed. Suggestions can be switched off, and private tabs, pasted text, addresses, local paths, and sensitive-looking input never leave the device for autocomplete."
  echo
  echo "Tabs synced from your other Blanc devices now carry their site icons too. The source device converts each favicon into a tiny inert PNG inside a separate end-to-end-encrypted sidecar, so another device never contacts a remote tab's site just to draw its row; strict budgets, cancellation, mixed-version compatibility, and graceful fallback keep this cosmetic layer from interfering with tab sync."
  echo
  printf '%s\n' "$GENERATED"
} > "$NOTES_FILE"
gh release create "$TAG" "${ASSETS[@]}" --repo "$REPO" --title "$VERSION" --target "$LOCAL_HEAD" --notes-file "$NOTES_FILE"

echo "==> Done: https://github.com/$REPO/releases/tag/$TAG"

# Refresh the static changelog now that the new release exists on GitHub.
# Non-fatal: the release is already published and aborting here would strand
# the Windows/Linux dispatch below.
if npm run site:changelog; then
  echo "==> Changelog refreshed — commit and redeploy site/ after this release."
else
  echo "==> Warning: changelog refresh failed; continuing with platform builds." >&2
fi

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

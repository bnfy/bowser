#!/usr/bin/env bash
# Draft-first, fail-closed release pipeline.
#
# Required invariants:
# - one immutable source tag/commit for every platform;
# - notarized macOS and signed Windows artifacts only;
# - every selected platform asset staged in one draft;
# - exact names + SHA-256 checksums verified before publication;
# - no rebuild between staged verification and publication.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="bnfy/blanc"
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
MODE="${BLANC_RELEASE_MODE:-}"
PLATFORM_CSV="${BLANC_RELEASE_PLATFORMS:-}"
MAC_ARCH_CSV="${BLANC_MAC_ARCHES:-}"
MIGRATION_BASE_VERSION="${BLANC_MIGRATION_BASE_VERSION:-0.22.0}"
NOTES_FILE="docs/press/release-notes/$TAG.md"

case "$MODE" in
  candidate)
    [[ "$VERSION" == *-* ]] || {
      echo "Candidate mode requires a prerelease package version (for example 1.0.0-rc.1)." >&2
      exit 1
    }
    ;;
  stable)
    [[ "$VERSION" != *-* ]] || {
      echo "Stable mode refuses a prerelease package version: $VERSION" >&2
      exit 1
    }
    ;;
  *)
    echo "BLANC_RELEASE_MODE must be explicitly set to candidate or stable." >&2
    exit 1
    ;;
esac

[ -n "$PLATFORM_CSV" ] || {
  echo "BLANC_RELEASE_PLATFORMS must explicitly list mac and any verified native targets." >&2
  exit 1
}
[ -n "$MAC_ARCH_CSV" ] || {
  echo "BLANC_MAC_ARCHES must explicitly list the verified mac architecture(s): arm64 and/or x64." >&2
  exit 1
}

IFS=',' read -r -a PLATFORMS <<< "$PLATFORM_CSV"
HAS_MAC=false
HAS_WINDOWS=false
HAS_LINUX=false
for platform in "${PLATFORMS[@]}"; do
  case "$platform" in
    mac) HAS_MAC=true ;;
    windows) HAS_WINDOWS=true ;;
    linux) HAS_LINUX=true ;;
    *)
      echo "Unknown release platform '$platform'; use mac,windows,linux." >&2
      exit 1
      ;;
  esac
done
$HAS_MAC || {
  echo "The local release path requires mac in BLANC_RELEASE_PLATFORMS." >&2
  exit 1
}

IFS=',' read -r -a MAC_ARCHES <<< "$MAC_ARCH_CSV"
HAS_MAC_ARM64=false
HAS_MAC_X64=false
for arch in "${MAC_ARCHES[@]}"; do
  case "$arch" in
    arm64) HAS_MAC_ARM64=true ;;
    x64) HAS_MAC_X64=true ;;
    *)
      echo "Unknown mac architecture '$arch'; use arm64,x64." >&2
      exit 1
      ;;
  esac
done
($HAS_MAC_ARM64 || $HAS_MAC_X64) || {
  echo "At least one mac architecture must be selected." >&2
  exit 1
}

HOST_ARCH="$(uname -m)"
case "$HOST_ARCH" in
  arm64)
    $HAS_MAC_ARM64 || {
      echo "The native release host is arm64, but arm64 is not selected for package smoke." >&2
      exit 1
    }
    NATIVE_MAC_ARCH="arm64"
    NATIVE_MAC_DIR="mac-arm64"
    MIGRATION_MAC_SUFFIX="-arm64-mac"
    ;;
  x86_64)
    $HAS_MAC_X64 || {
      echo "The native release host is x64, but x64 is not selected for package smoke." >&2
      exit 1
    }
    NATIVE_MAC_ARCH="x64"
    NATIVE_MAC_DIR="mac"
    MIGRATION_MAC_SUFFIX="-mac"
    ;;
  *)
    echo "Unsupported native Mac release host architecture: $HOST_ARCH" >&2
    exit 1
    ;;
esac
[ -f "$NOTES_FILE" ] || {
  echo "Checked-in release notes are required: $NOTES_FILE" >&2
  exit 1
}

command -v gh >/dev/null || { echo "gh CLI not found." >&2; exit 1; }
command -v op >/dev/null || {
  echo "1Password CLI is required; refusing an unnotarized release build." >&2
  exit 1
}
gh auth status >/dev/null 2>&1 || {
  echo "gh CLI is not authenticated. Run: gh auth login" >&2
  exit 1
}

echo "==> Preparing Blanc $VERSION ($TAG), mode=$MODE, platforms=$PLATFORM_CSV, mac=$MAC_ARCH_CSV"

# Released and staged versions are immutable. A failed draft remains evidence
# of that attempt; fix forward with a new rc.N/version rather than overwriting.
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null ||
   git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1 ||
   gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Tag or release $TAG already exists. Bump package.json; never overwrite release assets." >&2
  exit 1
fi

RELEASE_SOURCES=(
  src
  build
  test
  scripts
  site
  spec
  settings-schema
  tokens
  copy
  adblock
  docs/press
  docs/grants
  README.md
  SECURITY.md
  package.json
  package-lock.json
  .github/workflows
  "$NOTES_FILE"
)
if ! git diff --cached --quiet HEAD -- "${RELEASE_SOURCES[@]}" ||
   ! git diff --quiet -- "${RELEASE_SOURCES[@]}" ||
   [ -n "$(git ls-files --others --exclude-standard -- "${RELEASE_SOURCES[@]}")" ]; then
  echo "Release sources are dirty. Commit every release input before staging." >&2
  exit 1
fi

git fetch origin --quiet
LOCAL_HEAD="$(git rev-parse HEAD)"
if [ "$LOCAL_HEAD" != "$(git rev-parse origin/main)" ]; then
  echo "HEAD is not origin/main. Push the exact release commit first." >&2
  exit 1
fi

echo "==> Installing locked dependencies and running the press verification gate"
npm ci
npm run release:verify:press

echo "==> Preflighting the macOS identity and provisioning profile"
node scripts/preflight-mac-signing.mjs

echo "==> Cleaning and building notarized macOS artifacts"
rm -rf dist
MAC_BUILD_ARGS=()
$HAS_MAC_ARM64 && MAC_BUILD_ARGS+=(--arm64)
$HAS_MAC_X64 && MAC_BUILD_ARGS+=(--x64)
if ! op run --env-file=.env.1password --no-masking -- \
  npx electron-builder --mac "${MAC_BUILD_ARGS[@]}" --publish never; then
  echo "Signed/notarized macOS build failed. Nothing has been published." >&2
  exit 1
fi

MAC_ASSETS=("dist/latest-mac.yml")
if $HAS_MAC_ARM64; then
  MAC_ASSETS+=(
    "dist/Blanc-$VERSION-arm64-mac.zip"
    "dist/Blanc-$VERSION-arm64-mac.zip.blockmap"
    "dist/Blanc-$VERSION-arm64.dmg"
    "dist/Blanc-$VERSION-arm64.dmg.blockmap"
  )
fi
if $HAS_MAC_X64; then
  MAC_ASSETS+=(
    "dist/Blanc-$VERSION-mac.zip"
    "dist/Blanc-$VERSION-mac.zip.blockmap"
    "dist/Blanc-$VERSION.dmg"
    "dist/Blanc-$VERSION.dmg.blockmap"
  )
fi
for asset in "${MAC_ASSETS[@]}"; do
  [ -s "$asset" ] || { echo "Expected macOS artifact missing: $asset" >&2; exit 1; }
done

echo "==> Smoke-testing the signed packaged first-run experience"
BLANC_PACKAGED_EXECUTABLE="$PWD/dist/$NATIVE_MAC_DIR/Blanc.app/Contents/MacOS/Blanc" \
  npm run test:packaged:first-run

echo "==> Verifying migration from public Stable v$MIGRATION_BASE_VERSION"
MIGRATION_DIR="$(mktemp -d)"
cleanup_migration() { rm -rf "$MIGRATION_DIR"; }
trap cleanup_migration EXIT
curl --fail --silent --show-error --location \
  "https://github.com/$REPO/releases/download/v$MIGRATION_BASE_VERSION/Blanc-$MIGRATION_BASE_VERSION$MIGRATION_MAC_SUFFIX.zip" \
  --output "$MIGRATION_DIR/stable.zip"
ditto -x -k "$MIGRATION_DIR/stable.zip" "$MIGRATION_DIR/stable"
BLANC_STABLE_EXECUTABLE="$MIGRATION_DIR/stable/Blanc.app/Contents/MacOS/Blanc" \
  BLANC_CANDIDATE_EXECUTABLE="$PWD/dist/$NATIVE_MAC_DIR/Blanc.app/Contents/MacOS/Blanc" \
  npm run test:packaged:migration
rm -rf "$MIGRATION_DIR"
trap - EXIT

CREATE_ARGS=(
  release create "$TAG"
  "${MAC_ASSETS[@]}"
  --repo "$REPO"
  --title "$VERSION"
  --target "$LOCAL_HEAD"
  --notes-file "$NOTES_FILE"
  --draft
)
if [ "$MODE" = "candidate" ]; then CREATE_ARGS+=(--prerelease); fi

echo "==> Creating authenticated draft release"
gh "${CREATE_ARGS[@]}"
DRAFT_CREATED=true
VERIFY_DIR="$(mktemp -d)"
cleanup() { rm -rf "$VERIFY_DIR"; }
trap cleanup EXIT

WORKFLOW_PLATFORM=""
if $HAS_WINDOWS && $HAS_LINUX; then
  WORKFLOW_PLATFORM="all"
elif $HAS_WINDOWS; then
  WORKFLOW_PLATFORM="windows"
elif $HAS_LINUX; then
  WORKFLOW_PLATFORM="linux"
fi

if [ -n "$WORKFLOW_PLATFORM" ]; then
  echo "==> Dispatching native $WORKFLOW_PLATFORM build(s) against $TAG"
  DISPATCHED_AT=$(date -u +%s)
  EXPECTED_RUN_TITLE="Release $TAG ($WORKFLOW_PLATFORM)"
  gh workflow run release-windows-linux.yml \
    --repo "$REPO" \
    -f tag="$TAG" \
    -f platform="$WORKFLOW_PLATFORM"

  RUN_ID=""
  for _attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
    RUN_ID=$(gh run list \
      --repo "$REPO" \
      --workflow=release-windows-linux.yml \
      --event workflow_dispatch \
      --limit 10 \
      --json databaseId,createdAt,displayTitle \
      --jq "map(select(.displayTitle == \"$EXPECTED_RUN_TITLE\" and (.createdAt | fromdateiso8601) >= ($DISPATCHED_AT - 5))) | first | .databaseId // empty")
    [ -n "$RUN_ID" ] && break
    sleep 2
  done
  [ -n "$RUN_ID" ] || {
    echo "Workflow dispatch did not register. Draft remains unpublished." >&2
    exit 1
  }

  echo "==> Waiting for native build run $RUN_ID"
  gh run watch "$RUN_ID" --repo "$REPO" --exit-status || {
    echo "Native build failed. Draft remains unpublished." >&2
    exit 1
  }
fi

echo "==> Downloading the authenticated draft asset set"
gh release download "$TAG" --repo "$REPO" --dir "$VERIFY_DIR"
node scripts/verify-release-manifest.mjs \
  --dir "$VERIFY_DIR" \
  --version "$VERSION" \
  --platforms "$PLATFORM_CSV" \
  --mac-arches "$MAC_ARCH_CSV"
node scripts/create-checksums.mjs "$VERIFY_DIR"
node scripts/verify-release-manifest.mjs \
  --dir "$VERIFY_DIR" \
  --version "$VERSION" \
  --platforms "$PLATFORM_CSV" \
  --mac-arches "$MAC_ARCH_CSV"
gh release upload "$TAG" "$VERIFY_DIR/SHA256SUMS" --repo "$REPO"

echo "==> Publishing the already-verified draft"
if [ "$MODE" = "candidate" ]; then
  gh release edit "$TAG" --repo "$REPO" --draft=false --prerelease
else
  gh release edit "$TAG" --repo "$REPO" --draft=false --prerelease=false --latest
fi

echo "==> Logged-out download smoke"
while IFS= read -r url; do
  [ -n "$url" ] || continue
  curl --fail --silent --show-error --location --head "$url" >/dev/null
done < <(gh api "repos/$REPO/releases/tags/$TAG" --jq '.assets[].browser_download_url')

if npm run site:changelog; then
  echo "==> Changelog refreshed. Verify the staged site, then promote it before outreach."
else
  echo "==> Warning: changelog refresh failed after publication; fix forward before outreach." >&2
fi

echo "==> Published and smoke-checked: https://github.com/$REPO/releases/tag/$TAG"

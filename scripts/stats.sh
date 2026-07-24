#!/usr/bin/env bash
# Per-release download counts from GitHub Releases, splitting real
# installer downloads (.dmg / -mac.zip / .exe / .AppImage) from
# update-check metadata (.yml / .blockmap), which the auto-updater
# fetches on every launch and would otherwise inflate the numbers.
# Read-only; uses the gh CLI's cached auth like release.sh.
set -euo pipefail

command -v gh >/dev/null 2>&1 || { echo "error: gh CLI is required" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "error: gh is not authenticated (run: gh auth login)" >&2; exit 1; }

{
  printf 'tag\tartifact-downloads\tupdate-checks\n'
  gh api 'repos/bnfy/blanc/releases' --paginate --jq '
    .[] | [
      .tag_name,
      ([.assets[] | select(.name | test("\\.(dmg|exe|AppImage)$|\\.zip$")) | .download_count] | add // 0),
      ([.assets[] | select(.name | test("\\.(yml|blockmap)$")) | .download_count] | add // 0)
    ] | @tsv'
} | column -t -s $'\t'

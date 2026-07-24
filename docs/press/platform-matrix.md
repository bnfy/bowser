# Press-build platform matrix

Last verified: July 23, 2026

This is the fail-closed distribution matrix. A target moves to
**release-eligible** only after the exact candidate package passes its native
gate. `scripts/release.sh` requires the release operator to name both the
selected platforms and selected Mac architectures explicitly.

| Target | Current P0 evidence | Status before an RC exists |
|---|---|---|
| macOS Apple Silicon | Developer ID identity and provisioning profile pass; notarization credentials resolve; signed packaged cold-online, fresh-consent, corrupt-cache/offline recovery, OAuth, DNS, and v0.22.0 same-profile migration smokes pass natively | Candidate path ready; exact RC still requires notarization, stapling, install, and hashes |
| macOS Intel | Build target and public v0.22.0 artifact exist; no native Intel test of this working tree was available | Not release-eligible |
| Windows x64 | Workflow now refuses unsigned output and verifies both Authenticode validity and expected publisher. GitHub auth and Azure tenant/client/account/endpoint values are present, but the required certificate-profile/publisher values and a current Windows 11 install/SmartScreen test are absent | Not release-eligible |
| Linux x86_64 | Native CI job and AppImage artifact checks are defined; current workflow dispatch and x86_64 launch were not available to verify locally | Not release-eligible |

No RC has been built or distributed from this working tree. The initial safe
scope is macOS Apple Silicon; other targets may be added without extending
the schedule only when their existing native gates turn green before the
candidate is staged.

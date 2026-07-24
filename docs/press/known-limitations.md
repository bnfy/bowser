# Blanc 1.0 press-build limitations

Last updated: July 23, 2026

These are product boundaries, not buried footnotes. Reviewers should evaluate
the release candidate with them in view.

## Planned release-candidate availability

- The planned press build is for **Apple Silicon Macs only**.
- Intel macOS, Windows, Linux, iPhone, iPad, and Android will not be included
  in this candidate.
- A platform will not be added to the launch claim merely because a package can
  be produced. Its exact package must pass applicable signing and notarization
  requirements plus native clean-install, launch, and same-profile migration
  checks first.

## Browser scope

- Blanc has **no extension support**. The previous extension runtime was
  deliberately removed after it caused native Chromium crashes and could not
  make allowlisted password-manager integrations work in a custom browser
  shell.
- Blanc does not import passwords and cannot read passkeys stored by iCloud or
  third-party password managers. Signed macOS builds can create and use Blanc's
  own device-bound Touch ID passkeys.
- Blanc is single-window. It supports many tabs and named groups inside that
  window, but not separate browsing windows or profiles.
- There is no mobile app in this release.
- The typed-address classifier is intentionally lightweight and can
  misclassify unusual dotted search text as a domain.

## Privacy and network behavior

- Blanc does not claim zero telemetry. The optional usage ping is presented on
  by default during first run, is committed before sending, can be turned off,
  and contains only the fields documented in the privacy policy and fact sheet.
- Search suggestions are on by default when accepted during first run. Eligible
  typed prefixes may be sent to the selected search provider; the feature can
  be disabled.
- Blocking filters, update metadata, optional sync, supporter activation, and
  enabled search suggestions require network requests initiated by the app.
- Ad and tracker blocking is best effort. It cannot promise to block every ad,
  tracker, cookie prompt, or fingerprinting technique.
- On a fresh profile, Blanc fetches and compiles its blocking lists. The local
  chrome remains available during that work; a failure presents Retry and an
  explicit option to continue without blocking.

## Private tabs

- Private tabs share one non-persistent private session with one another during
  the current app run. They are isolated from normal tabs, not from other
  simultaneously open private tabs.
- Downloads still work from private tabs and can leave user-requested files and
  download records outside the private session. Existing Favorites may be
  opened there, but Blanc does not add Favorites from private browsing.
- A passkey created from a private tab is usable only for that app run; the
  private session's sealing material is intentionally not persisted.

## Sync

- Profile Sync is optional and server-blind, but the derived encryption key is
  stored with Blanc's other local profile data. The guarantee is encrypted
  transport/storage on Blanc's server, not local-at-rest encryption.
- History, downloads, cookies/site storage, permissions, supporter status,
  app-icon, search-suggestion, usage-ping, tab-layout, encrypted-DNS, and
  WebRTC choices are not synced.
- Open-tab sharing is an off-by-default, read-only per-device snapshot, not a
  live merged session; its optional bounded favicon sidecar is encrypted
  separately.

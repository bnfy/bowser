# Settings schema (substrate S5)

One source of truth for Blanc's settings schema — keys, defaults, and the
enumerations (search engines, appearance themes, app-icon colorways free +
supporter). This is [substrate S5](../spec/shared-substrate.md#s5-settings-schema--validation)
made real: the desktop `src/main/settings.js` is **guarded** against drifting from
here, and the mobile Swift/Kotlin enums + defaults are **generated** from here, so
the key/enum/default set is never hand-copied into two more languages.

## Files

```
settings-schema/
  schema.json        the source of truth — edit HERE
  build.mjs          generator + drift checker
  generated/
    BlancSettings.swift   iOS: BlancSearchEngine / BlancThemePreference / BlancAppIcon + defaults
    BlancSettings.kt      Android: the same enums + defaults
```

## Commands

```bash
npm run settings:build   # regenerate settings-schema/generated/* from schema.json
npm run settings:check    # verify src/main/settings.js matches schema.json, and the
                          # generated files are current. Exit 1 on drift.
```

Run `settings:check` in CI / before a release. It fails if `settings.js` and the
schema disagree on any search engine, theme, app-icon id/label, or default — the
subtle, corrosive drift S5 exists to prevent (e.g. a different default search
engine, or one platform accepting an icon id another rejects).

## What is checked

`settings:check` parses the stable structures out of `settings.js`
(`SEARCH_ENGINES`, `THEMES`, `APP_ICON_LABELS`, `SUPPORTER_ICON_LABELS`,
`DEFAULTS`) and compares ids, labels, and default values to `schema.json`. It also
flags any `DEFAULTS` key that is neither a schema setting nor in `schema.json`'s
`internalDefaults` allowlist (desktop-only keys not synced to mobile, e.g. the
sync clock `_syncMeta`) — so a new user-facing setting can't be added on desktop
and silently skip the mobile schema. It does
**not** attempt to parse the imperative validation logic in `setSettings` — the
contract for that (e.g. `sanitize-on-read == validate-on-write` for `appIcon`,
hostname normalization for `adblockExceptions`) lives as prose in the schema's
notes and in [F14](../spec/features.md) / the acceptance scenarios (F14-1/2/3).

## Why desktop is guarded, not overwritten

Same rationale as the design tokens (`tokens/README.md`): `settings.js` is
load-bearing main-process code that a headless build can't exercise, and drift
*prevention* is the substrate's purpose. The guard delivers that safely today;
the mobile files (new, no such constraint) are fully generated.

## Verification

- `npm run settings:check` is **green** against the current `settings.js`.
- Negative-tested: perturbing a default or an enum in `schema.json` fails the
  check with a precise `DRIFT:` line and exit 1.

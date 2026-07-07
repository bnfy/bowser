# Design tokens (substrate S2)

One source of truth for Blanc's design tokens — colors, typography, geometry,
shadows, the themed select caret — across the three theme scopes (light / dark /
**private**). This is [substrate S2](../spec/shared-substrate.md#s2-design-tokens)
made real: the mobile Swift/Kotlin token files are **generated** from here, and the
desktop CSS is **guarded** against drifting from here.

## Files

```
tokens/
  tokens.json        the source of truth — edit values HERE
  build.mjs          generator + drift checker
  generated/         emitted; committed so mobile devs see them without a build
    Tokens.swift     iOS
    Tokens.kt        Android
    tokens.css       reference (what a future codegen'd desktop block looks like)
```

## Commands

```bash
npm run tokens:build   # regenerate tokens/generated/* from tokens.json
npm run tokens:check   # verify: live desktop CSS matches the source, and the
                       # generated files are up to date. Exit 1 on drift.
```

Run `tokens:check` in CI / before a release; it fails loudly if anyone edits a
token value in `styles.css` or `pages.css` without updating the source (or vice
versa), which is exactly the hand-sync drift the substrate exists to prevent.

## Model

A token in `tokens.json` is **themed** if it has `light`/`dark`/`private` values
(the ten color roles + the select caret) — emitted in all three scopes. Otherwise
it has a single `common` value (fonts, radius, shadows, strip height) — emitted
only in `:root`. Each token lists its `consumers` (`chrome` = `styles.css`, `pages`
= `pages.css`); the mobile files receive the full union.

To change or add a token: edit `tokens.json`, run `tokens:build`, and — for now —
update the matching declaration in the CSS file(s) by hand (the check confirms you
did). Adding it to `tokens.json` is what keeps Swift/Kotlin and the drift guard in
sync automatically.

## Why desktop CSS is guarded, not overwritten

The substrate's job is that the palette **can't fork**. Two ways to get there:
generate the CSS, or guard hand-written CSS against the source. This uses the
guard, deliberately:

- The chrome CSS can't be visually re-verified from a headless build, and
  `styles.css`/`pages.css` are load-bearing chrome files (`CLAUDE.md`: editing them
  needs an app relaunch to confirm). A guard changes **nothing** at runtime.
- Drift prevention — not codegen for its own sake — is the actual value. The check
  delivers it today, safely.
- Flipping the two CSS files to be emitted from the source (marker-based, matching
  the reference `generated/tokens.css`) is a mechanical follow-up once someone can
  run the app to confirm the rendered result is unchanged.

The mobile side has no such constraint (the files are new), so it is fully
generated — no palette is ever hand-copied into Swift or Kotlin.

## Verification

- `npm run tokens:check` is **green** against the current `styles.css` /
  `pages.css` — i.e. the source reproduces every live token value across all three
  scopes in both files.
- Negative-tested: perturbing a single value in `tokens.json` makes the check fail
  with a precise `DRIFT:` line for each affected file and exit 1.

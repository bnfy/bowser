# Polar setup — Blanc Supporter (manual, one-time)

The code ships with placeholders; these steps light it up.

1. Create a Polar organization at https://polar.sh — use handle `bnfy`
   (it's what `.github/FUNDING.yml` points at; if you pick another,
   update that file).
2. Create product **Blanc Supporter**: one-time purchase, **$19**, with
   the **License Keys** benefit enabled, activation limit **5**.
   Do the same in the sandbox dashboard (https://sandbox.polar.sh) with a
   test product for dev testing.
3. Copy the organization id (Settings → General in the Polar dashboard)
   into `POLAR_ORGANIZATION_ID` in `src/main/supporter.js`. Note the
   sandbox org has its own id — for dev testing, temporarily use the
   sandbox org id (dev builds already point at sandbox-api.polar.sh).
4. Copy the hosted checkout URL into the `href="#"` of the
   "become a supporter" link in `site/src/pages/index.astro` (marked TODO(polar)).
5. Test end-to-end in dev: buy the sandbox product with Polar's test
   card, activate the key in Settings, confirm colorways unlock.
6. Deploy the site: `npm run site:deploy`.
7. Ship a release so packaged builds carry the production org id.

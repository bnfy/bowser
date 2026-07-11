// Collector for Blanc's anonymous launch ping (see src/main/telemetry.js in
// the main repo). Tallies anonymous counts in Workers KV — no IPs, no
// browsing data are ever stored.
//
// Two things are counted, from one ping:
//   1. Launches — every ping bumps aggregate counters (total, per-day,
//      per-version, per-platform). One person launching 10× counts as 10.
//   2. Active users — the ping carries a random, per-install id (the client
//      mints it once and reuses it). The first ping from a given install in a
//      given day/week/month flips that period's "seen" flag and bumps that
//      period's unique counter, so repeat launches are deduped into distinct
//      active users (DAU/WAU/MAU) and growth over time. The install id is an
//      opaque random token — it maps to a device install, never a person, and
//      no name/account/IP/browsing data is ever stored beside it.
//
// The raw install id is never stored or forwarded (2026-07-11 audit decision):
// it's HMAC'd with the INSTALL_HASH_SECRET worker secret on arrival, and only
// that keyed hash appears in KV keys and in the GA4 mirror's client_id. The
// hash is stable per install (so dedup and retention still work) but can't be
// reversed or recomputed by anyone without the secret — the privacy policy
// describes exactly this. If the secret is unset, uniques are SKIPPED (fail
// closed) rather than falling back to the raw id; launches still count.

const ALLOWED_PLATFORMS = new Set(['darwin', 'win32', 'linux']);
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GA_MEASUREMENT_ID = 'G-MN8BLY6GE9';
const GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

// How long each period's per-install "seen" flags live. The unique COUNTERS
// (active:*) never expire — they're the growth history. The seen flags only
// need to outlive their own period (for dedup) plus enough slack to compute
// retention against adjacent periods, so they're given generous but bounded
// TTLs to keep KV from growing without limit.
const DAY_SEEN_TTL = 90 * 24 * 3600; // ~3 months of daily-cohort history
const WEEK_SEEN_TTL = 400 * 24 * 3600; // ~13 months of weekly cohorts
const MONTH_SEEN_TTL = 400 * 24 * 3600; // ~13 months of monthly cohorts (retention) — trimmed from 800d, 2026-07-11 audit

// Keyed hash of the install id — the only form that ever touches storage or
// GA. HMAC-SHA-256 under a worker secret, hex-encoded. Returns null (uniques
// skipped, launches still counted) when the secret isn't configured, so a
// misdeployed worker degrades to less data, never to raw ids at rest.
// Deploy note: set with `wrangler secret put INSTALL_HASH_SECRET`. Rotating
// the secret (or first enabling it) re-buckets every install once — active
// counts see a one-time discontinuity, then dedup as before.
async function hashInstallId(env, installId) {
  if (!env.INSTALL_HASH_SECRET) {
    console.warn('INSTALL_HASH_SECRET unset — skipping unique-install counting');
    return null;
  }
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.INSTALL_HASH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(installId));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Mirrors each ping into GA4 so app launches sit next to website traffic in
// one dashboard. Three things make GA4's Measurement Protocol actually count
// the user as "active" in its built-in reports:
//   1. client_id — stable per install (the HASHED install id — see
//      hashInstallId; Google never receives the raw token); GA keys users on this.
//   2. session_id — a random number per launch; GA needs it to count sessions.
//   3. engagement_time_msec > 0 — without this GA silently drops the user from
//      its Active Users metric. We send 1ms (nominal) since the ping is a
//      point event, not a timed session.
// User properties (platform, arch, app_version) are set once per client_id
// and stick to the user in GA's user-scoped reports / explorations.
function forwardToGA(env, { version, platform, arch, installId, sessionId }) {
  if (!env.GA_API_SECRET || !installId) return Promise.resolve();
  const url = `${GA_ENDPOINT}?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${env.GA_API_SECRET}`;
  const sid = sessionId || String((Math.random() * 0x7FFFFFFF) >>> 0);
  return fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      client_id: installId,
      user_properties: {
        app_version: { value: version },
        platform: { value: platform },
        arch: { value: arch },
      },
      events: [{
        name: 'app_launch',
        params: {
          session_id: parseInt(sid, 10),
          engagement_time_msec: 1,
          app_version: version,
          platform,
          arch,
        },
      }],
    }),
  }).catch((err) => console.warn('GA forward failed:', err.message));
}

// Not atomic (KV has no increment primitive) — a handful of concurrent
// pings can undercount by a request or two. Fine here: nothing downstream
// needs an exact number, only the aggregate trend.
async function bump(kv, key) {
  const current = parseInt((await kv.get(key)) ?? '0', 10);
  await kv.put(key, String(current + 1));
}

// Count an install as active in a period the first time it's seen there. The
// seen flag makes this idempotent across the install's repeat launches; the
// get-then-bump is only racy for concurrent launches of the SAME install in
// the SAME period (vanishingly rare, and worst case over-counts by one),
// which is within the same best-effort tolerance as bump() above.
// The counter is bumped BEFORE the seen flag is written so a crash between
// the two loses idempotency (possible +1 overcount on next launch) rather
// than permanently losing the count (undercount with no recovery).
async function markActive(kv, scope, bucket, installId, ttl) {
  const seenKey = `seen:${scope}:${bucket}:${installId}`;
  if ((await kv.get(seenKey)) !== null) return;
  await bump(kv, `active:${scope}:${bucket}`);
  await kv.put(seenKey, '1', { expirationTtl: ttl });
}

// ---- UTC period buckets ----
function dayBucket(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function monthBucket(d) {
  return d.toISOString().slice(0, 7); // YYYY-MM
}
function weekBucket(dt) {
  // ISO-8601 week: GGGG-Www, week belonging to the year of its Thursday.
  const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this week
  const isoYear = d.getUTCFullYear();
  const week1Thursday = new Date(Date.UTC(isoYear, 0, 4));
  const w1Day = (week1Thursday.getUTCDay() + 6) % 7;
  week1Thursday.setUTCDate(week1Thursday.getUTCDate() - w1Day + 3);
  const week = 1 + Math.round((d - week1Thursday) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}
function prevMonthBucket(dt) {
  const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() - 1, 1));
  return monthBucket(d);
}

function todayLaunchKey(now) {
  return `day:${dayBucket(now)}`;
}

async function handlePing(request, env, ctx, now) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (!body || typeof body !== 'object') return new Response('bad request', { status: 400 });

  const version = typeof body.version === 'string' && VERSION_RE.test(body.version.slice(0, 32))
    ? body.version.slice(0, 32)
    : 'unknown';
  const platform = ALLOWED_PLATFORMS.has(body.platform) ? body.platform : 'unknown';
  const arch = typeof body.arch === 'string' ? body.arch.slice(0, 16) : 'unknown';
  // Opaque random token from the client; cap length defensively. Absent for
  // pre-metrics clients — those still count as launches, just not as uniques.
  const installId =
    typeof body.installId === 'string' && UUID_RE.test(body.installId.trim())
      ? body.installId.trim()
      : null;
  const sessionId =
    typeof body.sessionId === 'number' && Number.isFinite(body.sessionId)
      ? String(Math.floor(body.sessionId))
      : null;

  // The raw id stops here: everything downstream — KV seen-keys AND the GA
  // mirror — sees only the keyed hash (or nothing, if the secret is unset).
  const hashedId = installId ? await hashInstallId(env, installId) : null;

  // GA mirror is queued before the KV writes so a KV failure can't cost
  // the launch event too.
  ctx.waitUntil(forwardToGA(env, { version, platform, arch, installId: hashedId, sessionId }));

  // KV get/put can throw transiently; the counts are best-effort anyway
  // (see bump()), so log and still 204 rather than turning a blip into a
  // dropped ping — the client (src/main/telemetry.js) never retries.
  const work = [
    bump(env.PINGS, 'total'),
    bump(env.PINGS, todayLaunchKey(now)),
    bump(env.PINGS, `version:${version}`),
    bump(env.PINGS, `platform:${platform}`),
  ];
  if (hashedId) {
    work.push(
      markActive(env.PINGS, 'day', dayBucket(now), hashedId, DAY_SEEN_TTL),
      markActive(env.PINGS, 'week', weekBucket(now), hashedId, WEEK_SEEN_TTL),
      markActive(env.PINGS, 'month', monthBucket(now), hashedId, MONTH_SEEN_TTL)
    );
  }
  await Promise.all(work).catch((err) => console.error('KV write failed:', err.message));

  return new Response(null, { status: 204 });
}

// Read every key under a prefix into { suffix: intValue }. Gets within each
// list page run in parallel to stay within Workers' CPU/wall-clock budget.
async function readMap(kv, prefix) {
  const out = {};
  let cursor;
  do {
    const res = await kv.list({ prefix, cursor });
    const entries = await Promise.all(
      res.keys.map(async ({ name }) => [
        name.slice(prefix.length),
        parseInt((await kv.get(name)) ?? '0', 10),
      ])
    );
    for (const [k, v] of entries) out[k] = v;
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return out;
}

// Gather the set of install ids seen in one period, for cohort/retention math.
// Capped so a runaway install base can't blow the Worker's memory/time budget;
// truncation is surfaced in the response rather than silently miscomputed.
async function collectSeen(kv, scope, bucket, cap = 50000) {
  const prefix = `seen:${scope}:${bucket}:`;
  const ids = new Set();
  let cursor;
  let truncated = false;
  do {
    const res = await kv.list({ prefix, cursor });
    for (const { name } of res.keys) ids.add(name.slice(prefix.length));
    cursor = res.list_complete ? undefined : res.cursor;
    if (ids.size >= cap) {
      truncated = true;
      break;
    }
  } while (cursor);
  return { ids, truncated };
}

function pickRecent(map, n) {
  return Object.fromEntries(
    Object.keys(map)
      .sort()
      .slice(-n)
      .map((k) => [k, map[k]])
  );
}

// POST /admin/purge-legacy-ids — one-shot migration for the 2026-07-11 HMAC
// change: pings before it wrote seen:* markers keyed by the RAW install UUID
// (some monthly ones with the old 800-day TTL). Deleting them is what makes
// the privacy policy's "the raw install ID is never stored" true for the
// whole store, not just for new pings. Deletes ONLY keys whose install
// segment matches the old UUID format — 64-hex HMAC keys and the aggregate
// active:*/day:*/version:* counters are untouched. Bounded per invocation to
// stay inside the Workers subrequest budget; idempotent, so re-run until it
// returns done:true. Note: deleting the legacy markers breaks active-user
// dedup and retention cohorts ACROSS the migration boundary only — installs
// re-count as new once, then dedup as before.
const PURGE_DELETE_BUDGET = 800;
const purgeReport = (obj) =>
  new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } });
async function handlePurgeLegacy(request, env) {
  if (!env.STATS_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.STATS_TOKEN}`) {
    return new Response('unauthorized', { status: 401 });
  }
  let scanned = 0;
  let deleted = 0;
  let cursor;
  for (;;) {
    const res = await env.PINGS.list({ prefix: 'seen:', cursor });
    for (const { name } of res.keys) {
      scanned++;
      // Buckets never contain ':' (YYYY-MM-DD / GGGG-Www / YYYY-MM), so the
      // final segment is always the install token.
      const installSegment = name.slice(name.lastIndexOf(':') + 1);
      if (UUID_RE.test(installSegment)) {
        await env.PINGS.delete(name);
        deleted++;
        if (deleted >= PURGE_DELETE_BUDGET) {
          return purgeReport({ scanned, deleted, done: false });
        }
      }
    }
    if (res.list_complete) return purgeReport({ scanned, deleted, done: true });
    cursor = res.cursor;
  }
}

// GET /stats — bearer-token-gated readout so the counts are visible
// without opening the Cloudflare dashboard's KV browser.
async function handleStats(request, env, now) {
  if (!env.STATS_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.STATS_TOKEN}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const [total, byDay, byVersion, byPlatform, daily, weekly, monthly] = await Promise.all([
    env.PINGS.get('total'),
    readMap(env.PINGS, 'day:'),
    readMap(env.PINGS, 'version:'),
    readMap(env.PINGS, 'platform:'),
    readMap(env.PINGS, 'active:day:'),
    readMap(env.PINGS, 'active:week:'),
    readMap(env.PINGS, 'active:month:'),
  ]);

  // Month-over-month retention: of the installs active last month, how many
  // came back this month. Bounded by collectSeen's cap.
  const thisMonth = monthBucket(now);
  const lastMonth = prevMonthBucket(now);
  const [cohort, current] = await Promise.all([
    collectSeen(env.PINGS, 'month', lastMonth),
    collectSeen(env.PINGS, 'month', thisMonth),
  ]);
  let returned = 0;
  for (const id of cohort.ids) if (current.ids.has(id)) returned++;
  const cohortSize = cohort.ids.size;

  const stats = {
    launches: {
      total: parseInt(total ?? '0', 10),
      byDay,
      byVersion,
      byPlatform,
    },
    activeUsers: {
      daily: pickRecent(daily, 30),
      weekly: pickRecent(weekly, 12),
      monthly: pickRecent(monthly, 12),
    },
    retention: {
      cohortMonth: lastMonth,
      returnedInMonth: thisMonth,
      cohortSize,
      returned,
      rate: cohortSize ? Number((returned / cohortSize).toFixed(4)) : 0,
      truncated: cohort.truncated || current.truncated,
    },
  };
  return new Response(JSON.stringify(stats, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const now = new Date();
    if (request.method === 'POST' && url.pathname === '/ping') return handlePing(request, env, ctx, now);
    if (request.method === 'GET' && url.pathname === '/stats') return handleStats(request, env, now);
    if (request.method === 'POST' && url.pathname === '/admin/purge-legacy-ids') return handlePurgeLegacy(request, env);
    return new Response('not found', { status: 404 });
  },
};

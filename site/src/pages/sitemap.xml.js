// Explicit route manifest — changefreq/priority preserved from the
// hand-maintained sitemap this endpoint replaced. lastmod is the build date
// (the old file's lastmod was sed-bumped by release.sh; that step is gone).
const MANIFEST = [
  { path: '/',                         changefreq: 'weekly',  priority: '1.0' },
  { path: '/download',                 changefreq: 'monthly', priority: '0.9' },
  { path: '/features',                 changefreq: 'monthly', priority: '0.8' },
  { path: '/features/ad-blocking',     changefreq: 'monthly', priority: '0.8' },
  { path: '/features/island',          changefreq: 'monthly', priority: '0.7' },
  { path: '/features/private-tabs',    changefreq: 'monthly', priority: '0.7' },
  { path: '/features/command-palette', changefreq: 'monthly', priority: '0.7' },
  { path: '/features/tab-groups',      changefreq: 'monthly', priority: '0.7' },
  { path: '/features/sync',            changefreq: 'monthly', priority: '0.7' },
  { path: '/features/security',        changefreq: 'monthly', priority: '0.7' },
  { path: '/changelog',                changefreq: 'weekly',  priority: '0.8' },
  { path: '/about',                    changefreq: 'yearly',  priority: '0.6' },
  { path: '/privacy',                  changefreq: 'monthly', priority: '0.3' },
  { path: '/terms',                    changefreq: 'monthly', priority: '0.3' },
];

const SITE = 'https://blancbrowser.com';

export function GET() {
  // Discover the real pages and assert the manifest matches them exactly —
  // adding or removing a page without updating MANIFEST fails the build.
  const unlisted = new Set(['/press']);
  const discovered = Object.keys(import.meta.glob('./**/*.astro'))
    .map((file) => file
      .replace(/^\.\//, '/')
      .replace(/\.astro$/, '')
      .replace(/\/index$/, '/'))
    .filter((route) => !unlisted.has(route));
  const manifestSet = new Set(MANIFEST.map((r) => r.path));
  const discoveredSet = new Set(discovered);
  const missingFromManifest = discovered.filter((p) => !manifestSet.has(p));
  const missingPages = MANIFEST.filter((r) => !discoveredSet.has(r.path)).map((r) => r.path);
  if (missingFromManifest.length || missingPages.length) {
    throw new Error(
      `sitemap manifest out of sync — add to MANIFEST: [${missingFromManifest}] / no page for: [${missingPages}]`
    );
  }

  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = MANIFEST.map((r) => `  <url>
    <loc>${SITE}${r.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}

import releases from '../data/releases.json';
import { renderRss } from '../lib/rss.mjs';

export function GET() {
  return new Response(renderRss(releases), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}

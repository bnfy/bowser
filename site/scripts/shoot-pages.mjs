#!/usr/bin/env node
// Screenshots every page from the baseline (git archive) and from dist/,
// at desktop and mobile widths, into site/.parity-shots/{old,new}/ for
// side-by-side human review. Requires the repo root's playwright.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'site/.parity-shots');
const PAGES = ['index.html', 'download.html', 'features.html', 'about.html', 'privacy.html',
  'terms.html', 'changelog.html', 'features/island.html', 'features/ad-blocking.html',
  'features/private-tabs.html', 'features/command-palette.html', 'features/tab-groups.html',
  'features/sync.html', 'features/security.html'];
const SIZES = [{ tag: 'desktop', width: 1280, height: 2400 }, { tag: 'mobile', width: 480, height: 2400 }];

// Materialize the baseline into a temp dir.
const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-site-old-'));
execFileSync('bash', ['-c', `git archive site-pre-astro site | tar -x -C ${oldDir}`], { cwd: ROOT });

function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(dir, url.endsWith('/') ? url + 'index.html' : url);
      if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, () => resolve(server));
  });
}

const oldServer = await serve(path.join(oldDir, 'site'));
const newServer = await serve(path.join(ROOT, 'site/dist'));
const browser = await chromium.launch();
for (const [label, server] of [['old', oldServer], ['new', newServer]]) {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, reducedMotion: 'reduce' });
    for (const file of PAGES) {
      const dest = path.join(OUT, label, size.tag, file.replace('/', '__') + '.png');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await page.goto(`http://localhost:${server.address().port}/${file}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: dest, fullPage: true });
    }
    await page.close();
  }
}
await browser.close();
oldServer.close(); newServer.close();
console.log(`Screenshots in ${OUT} — review old/ vs new/ side by side.`);

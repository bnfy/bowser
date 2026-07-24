import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  site: 'https://blancbrowser.com',
  // 'file' reproduces the pre-Astro deployed layout exactly: about.html,
  // features/island.html, ... — the URL contract with search engines.
  build: {
    format: 'file',
    // Explicit asset contract: styles and scripts are always external hashed
    // files, never inlined (site.js is 4023 bytes, under Vite's 4096 default).
    inlineStylesheets: 'never',
  },
  vite: {
    build: { assetsInlineLimit: 0 },
    // Dev server: index.astro imports the ROOT package.json (JSON-LD
    // softwareVersion), which sits outside this Vite root.
    server: { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  },
});

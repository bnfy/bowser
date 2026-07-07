// A tiny local HTTP server so tab URLs load reliably offline (no external
// network in tests). Any /site/<name> path returns a minimal page whose title
// is <name> and whose body contains the word "widget" three times (used by the
// find-in-page scenario when that step is implemented).
const http = require('node:http');

function start() {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url || '/').replace(/^\/site\//, '').split('?')[0]) || 'page';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head>` +
      `<body><h1>${name}</h1><p>widget widget widget</p></body></html>`
    );
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { start };

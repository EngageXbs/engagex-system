// Minimal static file server + /api/ai route, standing in for what Vercel provides,
// so tests can exercise the real same-origin fetch('/api/ai') path (impossible from
// a file:// page, which the browser correctly CORS-blocks) without needing an actual
// Vercel deployment. Mounts the REAL api/ai.js handler unmodified.
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const aiHandler = require(path.join(ROOT, 'api', 'ai.js'));

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };

function expressify(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
  return res;
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/ai' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      req.body = raw;
      try {
        await aiHandler(req, expressify(res));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(ROOT, decodeURIComponent(urlPath));
  if (!filePath.startsWith(ROOT)) { res.statusCode = 403; res.end('forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.statusCode = 404; res.end('not found: ' + urlPath); return; }
    res.setHeader('content-type', MIME[path.extname(filePath)] || 'application/octet-stream');
    res.end(data);
  });
});

const PORT = process.env.PORT || 8934;
server.listen(PORT, () => console.log('local test server on http://localhost:' + PORT));
module.exports = server;

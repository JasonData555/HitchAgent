/**
 * Minimal local dev server — no Vercel CLI needed.
 * Loads .env.local, then serves POST /api/generate-tile-pptx and /api/generate-tile-draft.
 * Run: node dev-server.mjs
 */
import { createServer } from 'http';
import { readFileSync } from 'fs';

// ── Load .env.local ────────────────────────────────────────────────────────
const env = readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const clean = line.split('#')[0].trim();
  const match = clean.match(/^([A-Z_]+)=(.+)$/);
  if (match) process.env[match[1]] = match[2].trim();
}

// ── Dynamically import handlers ────────────────────────────────────────────
const { default: pptxHandler }  = await import('./api/generate-tile-pptx.js');
const { default: draftHandler } = await import('./api/generate-tile-draft.js');
const { default: pdfHandler }   = await import('./api/generate-tile-pdf.js');

const ROUTES = {
  '/api/generate-tile-pptx':  pptxHandler,
  '/api/generate-tile-draft': draftHandler,
  '/api/generate-tile-pdf':   pdfHandler,
};

// ── HTTP server ────────────────────────────────────────────────────────────
const server = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', async () => {
    try {
      req.body = body ? JSON.parse(body) : {};
    } catch {
      req.body = {};
    }

    const handler = ROUTES[req.url];
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No handler for ${req.url}` }));
      return;
    }

    // Wrap res with Express-style helpers
    res.status = (code) => { res.statusCode = code; return res; };
    res.json   = (data) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data, null, 2));
    };

    try {
      await handler(req, res);
    } catch (err) {
      console.error('Handler error:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});

server.listen(3000, () => {
  console.log('Dev server running at http://localhost:3000');
  console.log('Ready for requests.');
});

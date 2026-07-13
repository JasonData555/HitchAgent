/**
 * Minimal local dev server — no Vercel CLI needed.
 * Loads .env.local, then serves all api/* endpoints.
 * Run: node dev-server.mjs
 */
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { URL } from 'url';

// ── Load .env.local ────────────────────────────────────────────────────────
const env = readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const clean = line.split('#')[0].trim();
  const match = clean.match(/^([A-Z_]+)=(.+)$/);
  if (match) process.env[match[1]] = match[2].trim();
}

// ── Dynamically import handlers ────────────────────────────────────────────
const { default: pptxHandler }             = await import('./api/generate-tile-pptx.js');
const { default: draftHandler }            = await import('./api/generate-tile-draft.js');
const { default: pdfHandler }              = await import('./api/generate-tile-pdf.js');
const { default: tileHtmlHandler }         = await import('./api/generate-tile-html.js');
const { default: tileViewHandler }         = await import('./api/tile-view.js');
const { default: deactivateTileHandler }   = await import('./api/deactivate-tile.js');
const { default: rubricDraftHandler }      = await import('./api/generate-rubric-draft.js');
const { default: rubricHtmlHandler }       = await import('./api/generate-rubric-html.js');
const { default: rubricViewHandler }       = await import('./api/rubric-view.js');
const { default: deactivateRubricHandler } = await import('./api/deactivate-rubric.js');
const { default: portalLoginHandler }      = await import('./api/portal-auth/login.js');
const { default: portalCallbackHandler }   = await import('./api/portal-auth/callback.js');
const { default: generatePortalHandler }   = await import('./api/generate-portal.js');
const { default: portalDataHandler }       = await import('./api/portal-data.js');
const { default: portalViewHandler }       = await import('./api/portal-view.js');
const { default: portalFeedbackHandler }   = await import('./api/portal-feedback.js');

const ROUTES = {
  '/api/generate-tile-pptx':    pptxHandler,
  '/api/generate-tile-draft':   draftHandler,
  '/api/generate-tile-pdf':     pdfHandler,
  '/api/generate-tile-html':    tileHtmlHandler,
  '/api/tile-view':             tileViewHandler,
  '/api/deactivate-tile':       deactivateTileHandler,
  '/api/generate-rubric-draft': rubricDraftHandler,
  '/api/generate-rubric-html':  rubricHtmlHandler,
  '/api/rubric-view':           rubricViewHandler,
  '/api/deactivate-rubric':     deactivateRubricHandler,
  '/api/portal-auth/login':     portalLoginHandler,
  '/api/portal-auth/callback':  portalCallbackHandler,
  '/api/generate-portal':       generatePortalHandler,
  '/api/portal-data':           portalDataHandler,
  '/api/portal-view':           portalViewHandler,
  '/api/portal-feedback':       portalFeedbackHandler,
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

    // Parse path and query string so handlers can use req.query
    const parsed = new URL(req.url, 'http://localhost');
    const pathname = parsed.pathname;
    req.query = Object.fromEntries(parsed.searchParams.entries());

    const handler = ROUTES[pathname];
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No handler for ${pathname}` }));
      return;
    }

    // Wrap res with Express-style helpers
    res.status = (code) => { res.statusCode = code; return res; };
    res.json   = (data) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data, null, 2));
    };
    res.send   = (data) => {
      res.end(data);
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

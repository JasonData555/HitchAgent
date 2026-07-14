/**
 * Dispatcher — PPTX and hosted-HTML generation (no Chromium).
 *
 * Serves, via vercel.json rewrites:
 *   POST /api/generate-tile-pptx   -> ?__fn=tile-pptx
 *   POST /api/generate-tile-html   -> ?__fn=tile-html
 *   POST /api/generate-rubric-html -> ?__fn=rubric-html
 *
 * Keep Chromium out of this bundle — PDF handlers live in api/generate-pdf.js.
 * See CLAUDE.md for why dispatchers exist (Vercel Hobby 12-function cap).
 */

import tilePptx from '../lib/handlers/generate-tile-pptx.js';
import tileHtml from '../lib/handlers/generate-tile-html.js';
import rubricHtml from '../lib/handlers/generate-rubric-html.js';

const ROUTES = {
  'tile-pptx': tilePptx,
  'tile-html': tileHtml,
  'rubric-html': rubricHtml,
};

export default async function handler(req, res) {
  const fn = ROUTES[req.query?.__fn];
  if (!fn) {
    return res.status(404).json({ status: 'error', message: 'Not found', data: null, warnings: [] });
  }
  return fn(req, res);
}

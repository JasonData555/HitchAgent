/**
 * Dispatcher — PDF generation (Chromium-bearing).
 *
 * Serves, via vercel.json rewrites:
 *   POST /api/generate-tile-pdf    -> ?__fn=tile-pdf
 *   POST /api/generate-rubric-pdf  -> ?__fn=rubric-pdf
 *
 * These two handlers are grouped ALONE on purpose. They are the only handlers
 * that reach lib/pdf-render.js (puppeteer-core + @sparticuz/chromium, ~180MB
 * unzipped). Keeping them in their own function confines that bundle to one
 * lambda instead of inflating every cold start. Do not add a handler here
 * unless it needs Chromium.
 *
 * Why a dispatcher exists at all: Vercel's Hobby plan caps a deployment at 12
 * Serverless Functions, and it creates one per file under api/. See CLAUDE.md.
 */

import tilePdf from '../lib/handlers/generate-tile-pdf.js';
import rubricPdf from '../lib/handlers/generate-rubric-pdf.js';

const ROUTES = {
  'tile-pdf': tilePdf,
  'rubric-pdf': rubricPdf,
};

export default async function handler(req, res) {
  const fn = ROUTES[req.query?.__fn];
  if (!fn) {
    return res.status(404).json({ status: 'error', message: 'Not found', data: null, warnings: [] });
  }
  return fn(req, res);
}

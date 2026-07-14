/**
 * Dispatcher — deactivation routes (called from Airtable buttons).
 *
 * Serves, via vercel.json rewrites:
 *   POST /api/deactivate-tile   -> ?__fn=tile
 *   POST /api/deactivate-rubric -> ?__fn=rubric
 *
 * See CLAUDE.md for why dispatchers exist (Vercel Hobby 12-function cap).
 */

import tile from '../lib/handlers/deactivate-tile.js';
import rubric from '../lib/handlers/deactivate-rubric.js';

const ROUTES = { tile, rubric };

export default async function handler(req, res) {
  const fn = ROUTES[req.query?.__fn];
  if (!fn) {
    return res.status(404).json({ status: 'error', message: 'Not found', data: null, warnings: [] });
  }
  return fn(req, res);
}

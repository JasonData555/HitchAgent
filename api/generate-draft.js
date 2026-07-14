/**
 * Dispatcher — Claude synthesis (no Chromium).
 *
 * Serves, via vercel.json rewrites:
 *   POST /api/generate-tile-draft   -> ?__fn=tile-draft
 *   POST /api/generate-rubric-draft -> ?__fn=rubric-draft
 *   POST /api/generate-portal       -> ?__fn=portal
 *
 * maxDuration comes from vercel.json ("api/*.js": 60). The generate-portal
 * handler used to declare `export const config = { maxDuration: 60 }` itself;
 * that export is inert now that the handler lives under lib/, so the 60s budget
 * it needs is supplied here by that vercel.json rule.
 *
 * See CLAUDE.md for why dispatchers exist (Vercel Hobby 12-function cap).
 */

import tileDraft from '../lib/handlers/generate-tile-draft.js';
import rubricDraft from '../lib/handlers/generate-rubric-draft.js';
import portal from '../lib/handlers/generate-portal.js';

const ROUTES = {
  'tile-draft': tileDraft,
  'rubric-draft': rubricDraft,
  portal,
};

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const fn = ROUTES[req.query?.__fn];
  if (!fn) {
    return res.status(404).json({ status: 'error', message: 'Not found', data: null, warnings: [] });
  }
  return fn(req, res);
}

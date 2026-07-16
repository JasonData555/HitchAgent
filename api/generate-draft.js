/**
 * Dispatcher — Claude synthesis (no Chromium).
 *
 * Serves, via vercel.json rewrites:
 *   POST /api/generate-tile-draft   -> ?__fn=tile-draft
 *   POST /api/generate-rubric-draft -> ?__fn=rubric-draft
 *   POST /api/generate-portal       -> ?__fn=portal
 *
 * maxDuration is raised to 300s for this dispatcher (both here and via the
 * "api/generate-draft.js" override in vercel.json). The tile/rubric/portal
 * synthesis calls can generate large rubric-aware outputs that exceed the
 * default 60s Hobby budget; Vercel Pro allows up to 300s. Billing is by time
 * actually consumed, so the higher ceiling only affects genuinely long runs.
 * (Requires Vercel Pro — Hobby is hard-capped at 60s.)
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

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const fn = ROUTES[req.query?.__fn];
  if (!fn) {
    return res.status(404).json({ status: 'error', message: 'Not found', data: null, warnings: [] });
  }
  return fn(req, res);
}

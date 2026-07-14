/**
 * Dispatcher — client portal read/write routes.
 *
 * Serves, via vercel.json rewrites:
 *   GET  /api/portal-view     -> ?__fn=view
 *   GET  /api/portal-data     -> ?__fn=data
 *   POST /api/portal-feedback -> ?__fn=feedback
 *
 * NOT here: /api/portal-auth/login and /api/portal-auth/callback. Those stay as
 * real files under api/portal-auth/ and are served natively (Vercel resolves the
 * filesystem before rewrites). The callback path is registered as the redirect
 * URI inside the LinkedIn OAuth app and cannot be exercised on a preview
 * deployment — LinkedIn rejects any redirect_uri that is not the registered one
 * — so routing it through a rewrite would be a change we could not test before
 * production. Leave them alone.
 *
 * See CLAUDE.md for why dispatchers exist (Vercel Hobby 12-function cap).
 */

import view from '../lib/handlers/portal-view.js';
import data from '../lib/handlers/portal-data.js';
import feedback from '../lib/handlers/portal-feedback.js';

const ROUTES = { view, data, feedback };

export default async function handler(req, res) {
  const fn = ROUTES[req.query?.__fn];
  if (!fn) {
    return res.status(404).json({ status: 'error', message: 'Not found', data: null, warnings: [] });
  }
  return fn(req, res);
}

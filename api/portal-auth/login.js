/**
 * GET /api/portal-auth/login?slug=[portal_slug]
 *
 * Entry point for reviewer sign-in. Called when a reviewer clicks
 * "Sign in with LinkedIn" on the portal. Verifies the search is Live, then
 * redirects (302) to LinkedIn's OAuth authorization endpoint. The portal slug
 * is carried through the round-trip in the OAuth `state` parameter so the
 * callback knows which engagement the reviewer is authenticating for.
 *
 * This route CREATES nothing and validates no session — it only kicks off the
 * OAuth flow. (Session creation + cookie minting happen in callback.js.)
 *
 * Auth model: LinkedIn OAuth 2.0 (OpenID Connect). See CLAUDE.md — this governs
 * over the hitch-client-portal skill's magic-link model.
 */

import { getRecordsByFormula, getFieldValue } from '../../lib/airtable.js';
import { TABLES, SEARCHES_FIELDS } from '../../lib/airtableFields.js';
import { log } from '../../lib/logger.js';

const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';

/** Escape a value for safe interpolation into an Airtable filterByFormula string. */
function escapeFormulaValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ── Branded Access Denied page ───────────────────────────────────────────────
// TODO: swap for a shared renderAccessDenied() helper once it exists.
function accessDeniedPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Access Restricted</title>
  <style>
    body { margin: 0; font-family: 'DM Sans', Arial, Helvetica, sans-serif; background: #f1eee6; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #ffffff; border: 1px solid #e2ddd5; border-radius: 12px; padding: 48px 56px; max-width: 460px; text-align: center; }
    h1 { color: #1a3a2e; font-size: 22px; margin: 0 0 16px; }
    p { color: #5a6370; font-size: 15px; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Access restricted</h1>
    <p>This portal is not available. Please contact your Hitch Partners search team for assistance.</p>
  </div>
</body>
</html>`;
}

function sendAccessDenied(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(403).send(accessDeniedPage());
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).send('<h1>Method Not Allowed</h1>');
  }

  const { slug } = req.query || {};
  if (!slug) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).send('<h1>Bad Request: missing slug parameter</h1>');
  }

  log('request_received', { endpoint: 'portal-auth/login', slug });

  // ── Verify the search exists and is Live ───────────────────────────────────
  let records;
  try {
    const formula = `{${SEARCHES_FIELDS.PORTAL_SLUG}} = "${escapeFormulaValue(slug)}"`;
    records = await getRecordsByFormula(TABLES.SEARCHES, formula);
  } catch (err) {
    log('error', { endpoint: 'portal-auth/login', slug, error: err.message });
    return sendAccessDenied(res);
  }

  const search = records && records[0];
  const status = search ? getFieldValue(search.fields, SEARCHES_FIELDS.PORTAL_STATUS, '') : '';
  if (!search || status !== 'Live') {
    log('portal_login_denied', { slug, reason: !search ? 'no_search' : 'not_live', status });
    return sendAccessDenied(res);
  }

  // ── Build the LinkedIn authorization URL ───────────────────────────────────
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINKEDIN_CLIENT_ID || '',
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI || '',
    state: slug, // carries the portal slug through the OAuth round-trip
    scope: 'openid profile email',
  });
  const authUrl = `${LINKEDIN_AUTH_URL}?${params.toString()}`;

  log('portal_login_redirect', { slug });

  // ── Redirect to LinkedIn ───────────────────────────────────────────────────
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: authUrl });
  return res.end();
}

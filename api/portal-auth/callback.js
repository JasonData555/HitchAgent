/**
 * GET /api/portal-auth/callback?code=[auth_code]&state=[portal_slug]
 *
 * LinkedIn redirects here after the reviewer authorizes. This route:
 *   1. Exchanges the auth code for an access token
 *   2. Fetches the reviewer's OIDC profile (sub, name, email)
 *   3. Best-effort fetch of employer company (usually unavailable — non-blocking)
 *   4. Verifies access by EMAIL DOMAIN against the Searches `domain`
 *   5. Matches the reviewer to an ITI Input panel-member record for this search
 *   6. Creates a Portal Sessions record (writes only the `name` link + essentials;
 *      Interviewer Title/Company auto-populate via lookups)
 *   7. Sets a signed httpOnly session cookie and redirects to the portal
 *
 * Access control note: LinkedIn OIDC (openid/profile/email) returns no employer,
 * and /v2/positions requires partner access most apps lack. So the access gate is
 * an email-domain match; the company id, if obtainable, is logged as a secondary
 * signal only. See CLAUDE.md / the approved plan.
 *
 * All failures redirect back to the portal view with an `auth_error` param —
 * never a raw error page. This route CREATES the session; it does not validate
 * one (validatePortalSession is for downstream reviewer routes).
 */

import { getRecordsByFormula, getFieldValue, createRecord } from '../../lib/airtable.js';
import { setSessionCookie } from '../../lib/portalAuth.js';
import { TABLES, SEARCHES_FIELDS, SESSION_FIELDS, ITI_FIELDS } from '../../lib/airtableFields.js';
import { log } from '../../lib/logger.js';
import crypto from 'crypto';

const TOKEN_URL    = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const POSITIONS_URL = 'https://api.linkedin.com/v2/positions?q=members&projection=(elements*(title,company~(id,name)))&count=1';

/** Escape a value for safe interpolation into an Airtable filterByFormula string. */
function escapeFormulaValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Normalize a host/domain for comparison. Handles bare domains ("coursera.org")
 * and full URLs ("https://www.generalintuition.com/") alike: strips protocol,
 * any path/query, a leading "www.", lowercases, and trims.
 */
function normalizeDomain(value) {
  let v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // strip scheme (https://, http://)
  v = v.split('/')[0];                          // drop path/query/fragment
  v = v.replace(/^www\./, '');                  // drop leading www.
  return v;
}

/** Redirect back to the portal view with an auth_error param. */
function redirectError(res, slug, code) {
  const target = `/api/portal-view?slug=${encodeURIComponent(slug || '')}&auth_error=${code}`;
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: target });
  return res.end();
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).send('<h1>Method Not Allowed</h1>');
  }

  const { code, state } = req.query || {};
  const slug = state;
  log('request_received', { endpoint: 'portal-auth/callback', slug });

  if (!code || !slug) {
    log('portal_auth_failed', { reason: 'missing_code_or_state', slug });
    return redirectError(res, slug, 'true');
  }

  // ── Step 1: exchange code for an access token ──────────────────────────────
  let accessToken;
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.LINKEDIN_REDIRECT_URI || '',
      client_id: process.env.LINKEDIN_CLIENT_ID || '',
      client_secret: process.env.LINKEDIN_CLIENT_SECRET || '',
    });
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!r.ok) {
      log('portal_auth_failed', { reason: 'token_exchange', slug, status: r.status });
      return redirectError(res, slug, 'true');
    }
    accessToken = (await r.json()).access_token;
    if (!accessToken) {
      log('portal_auth_failed', { reason: 'no_access_token', slug });
      return redirectError(res, slug, 'true');
    }
  } catch (err) {
    log('portal_auth_failed', { reason: 'token_exchange_error', slug, error: err.message });
    return redirectError(res, slug, 'true');
  }

  // ── Step 2: fetch the reviewer's OIDC profile ──────────────────────────────
  let profile;
  try {
    const r = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) {
      log('portal_auth_failed', { reason: 'userinfo', slug, status: r.status });
      return redirectError(res, slug, 'true');
    }
    profile = await r.json();
  } catch (err) {
    log('portal_auth_failed', { reason: 'userinfo_error', slug, error: err.message });
    return redirectError(res, slug, 'true');
  }

  const linkedinId = profile.sub;
  const reviewerName = (profile.name || '').trim();
  const reviewerEmail = (profile.email || '').trim();
  if (!reviewerEmail) {
    log('portal_auth_failed', { reason: 'no_email', slug, linkedin_id: linkedinId });
    return redirectError(res, slug, 'true');
  }

  // ── Step 3: best-effort employer company (almost always unavailable) ───────
  let companyId = null;
  let companyName = '';
  try {
    const r = await fetch(POSITIONS_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (r.ok) {
      const data = await r.json();
      const pos = data?.elements?.[0];
      const comp = pos?.['company~'];
      if (comp?.id != null) companyId = comp.id;
      if (comp?.name) companyName = comp.name;
      log('linkedin_positions', { slug, method: 'positions_ok', has_company: companyId != null });
    } else {
      log('linkedin_positions', { slug, method: 'positions_failed', status: r.status });
    }
  } catch (err) {
    log('linkedin_positions', { slug, method: 'positions_failed', error: err.message });
  }

  // ── Step 4: fetch the Searches record for this slug ────────────────────────
  let search;
  try {
    const formula = `{${SEARCHES_FIELDS.PORTAL_SLUG}} = "${escapeFormulaValue(slug)}"`;
    const records = await getRecordsByFormula(TABLES.SEARCHES, formula);
    search = records && records[0];
  } catch (err) {
    log('portal_auth_failed', { reason: 'searches_fetch_error', slug, error: err.message });
    return redirectError(res, slug, 'true');
  }
  if (!search) {
    log('portal_auth_failed', { reason: 'no_search', slug });
    return redirectError(res, slug, 'true');
  }

  // ── Step 5: access check — email domain must match the Searches domain ─────
  const reviewerDomain = normalizeDomain(reviewerEmail.split('@')[1]);
  const rawDomain = search.fields[SEARCHES_FIELDS.DOMAIN];
  const expectedDomains = (Array.isArray(rawDomain) ? rawDomain : [rawDomain])
    .map(normalizeDomain)
    .filter(Boolean);
  const domainMatch = reviewerDomain && expectedDomains.includes(reviewerDomain);

  // Secondary, non-deciding signal — logged only.
  const expectedCompanyId = getFieldValue(search.fields, SEARCHES_FIELDS.LINKEDIN_COMPANY_ID, null);
  if (companyId != null && expectedCompanyId != null) {
    log('linkedin_company_signal', {
      slug,
      id_match: Number(companyId) === Number(expectedCompanyId),
    });
  }

  if (!domainMatch) {
    log('portal_auth_denied', {
      slug,
      linkedin_id: linkedinId,
      reviewer_email: reviewerEmail,
      expected_domain: expectedDomains.join(','),
    });
    return redirectError(res, slug, 'company_mismatch');
  }

  // ── Step 6: match the reviewer to an ITI Input panel-member record ─────────
  let itiId = null;
  try {
    const emailLower = escapeFormulaValue(reviewerEmail.toLowerCase());
    const nameLower = escapeFormulaValue(reviewerName.toLowerCase());
    const formula =
      `OR(LOWER({${ITI_FIELDS.PANEL_MEMBER_EMAIL}}) = "${emailLower}", ` +
      `LOWER({${ITI_FIELDS.PANEL_MEMBER}}) = "${nameLower}")`;
    const candidates = await getRecordsByFormula(TABLES.ITI_INPUT, formula);
    const match = (candidates || []).find((rec) => {
      const link = rec.fields[ITI_FIELDS.SEARCH_PROJECT_LINK];
      return Array.isArray(link) && link.includes(search.id);
    });
    if (match) itiId = match.id;
  } catch (err) {
    // Non-fatal — identity link is best-effort.
    log('iti_match_error', { slug, error: err.message });
  }
  if (!itiId) {
    log('iti_match_none', { slug, linkedin_id: linkedinId, reviewer_email: reviewerEmail });
  }

  // ── Step 7: create the Portal Sessions record ──────────────────────────────
  const sessionCookieId = crypto.randomUUID();
  const fields = {
    [SESSION_FIELDS.SESSION_ID]: sessionCookieId,
    [SESSION_FIELDS.EMAIL]: reviewerEmail,
    [SESSION_FIELDS.PORTAL_SLUG]: slug,
    [SESSION_FIELDS.DEACTIVATED]: false,
  };
  if (itiId) fields[SESSION_FIELDS.NAME_LINK] = [itiId]; // identity link → ITI Input

  try {
    await createRecord(TABLES.PORTAL_SESSIONS, fields);
  } catch (err) {
    log('portal_auth_failed', { reason: 'session_create_error', slug, error: err.message });
    return redirectError(res, slug, 'true');
  }

  log('portal_session_created', {
    slug,
    linkedin_id: linkedinId,
    reviewer_email: reviewerEmail,
    iti_linked: !!itiId,
    company_name: companyName || undefined,
  });

  // ── Step 8: set the signed session cookie and redirect to the portal ───────
  setSessionCookie(res, sessionCookieId);
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: `/api/portal-view?slug=${encodeURIComponent(slug)}` });
  return res.end();
}

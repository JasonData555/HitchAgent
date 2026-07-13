/**
 * Shared session validation for the Client Portal.
 *
 * Every portal route that handles reviewer data MUST call validatePortalSession
 * as its first action. No route may re-implement this logic inline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COOKIE MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 * The session token lives in an httpOnly cookie — never in localStorage.
 *
 *   cookie name:  'hitch_portal_session'
 *   cookie value: "<sessionId>.<hmac>"
 *                 hmac = HMAC_SHA256(sessionId, PORTAL_SESSION_SECRET) hex
 *
 * The HMAC binds the cookie to our secret, so a forged or tampered cookie cannot
 * be used to select an arbitrary Portal Sessions row. `sessionId` is the value
 * stored in the Portal Sessions `session_id` field (written at OAuth callback).
 *
 * Cookie attributes: HttpOnly; SameSite=Strict; Path=/; Secure (production only).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FAILURE OPACITY
 * ─────────────────────────────────────────────────────────────────────────────
 * The `reason` returned to callers is ALWAYS 'unauthorized'. The specific check
 * that failed is logged server-side only — never leaked to the client.
 */

import crypto from 'crypto';
import { getRecordsByFormula } from './airtable.js';
import { TABLES, SESSION_FIELDS } from './airtableFields.js';
import { log } from './logger.js';

const COOKIE_NAME = 'hitch_portal_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds

// Generic failure surfaced to all callers. Never indicates which check failed.
const UNAUTHORIZED = Object.freeze({ valid: false, reason: 'unauthorized' });

// ── Cookie signing helpers ──────────────────────────────────────────────────

function secret() {
  const s = process.env.PORTAL_SESSION_SECRET;
  if (!s) throw new Error('PORTAL_SESSION_SECRET is not set');
  return s;
}

/** HMAC-SHA256 of a sessionId, hex-encoded. */
function sign(sessionId) {
  return crypto.createHmac('sha256', secret()).update(sessionId).digest('hex');
}

/**
 * Verify a signature against a sessionId in constant time.
 * Returns false on any length/format mismatch rather than throwing.
 */
function verify(sessionId, signature) {
  if (typeof sessionId !== 'string' || typeof signature !== 'string') return false;
  const expected = sign(sessionId);
  // timingSafeEqual requires equal-length buffers; bail early if they differ.
  if (signature.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Parse a Cookie header into a plain object. Returns {} when absent. */
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** Escape a value for safe interpolation inside an Airtable filterByFormula string. */
function escapeFormulaValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate the reviewer session cookie for a given portal slug.
 *
 * All four checks must pass:
 *   1. Session cookie present and well-formed
 *   2. Cookie signature valid AND a Portal Sessions record exists with matching session_id
 *   3. session.deactivate_portal_link !== true
 *   4. session.portal_slug === slug
 *
 * @param {{ headers?: Record<string,string> }} req
 * @param {string} slug - portal_slug the route is scoped to
 * @returns {Promise<{ valid: false, reason: string } | { valid: true, session: object }>}
 */
export async function validatePortalSession(req, slug) {
  // 1. Cookie present
  const cookies = parseCookies(req?.headers?.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) {
    log('portal_auth_failed', { reason: 'no_cookie', slug });
    return UNAUTHORIZED;
  }

  // 2a. Well-formed "<sessionId>.<signature>" and valid signature
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) {
    log('portal_auth_failed', { reason: 'malformed_cookie', slug });
    return UNAUTHORIZED;
  }
  const sessionId = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!verify(sessionId, signature)) {
    log('portal_auth_failed', { reason: 'bad_signature', slug });
    return UNAUTHORIZED;
  }

  // 2b. Portal Sessions record exists with matching session_id
  let records;
  try {
    const formula = `{${SESSION_FIELDS.SESSION_ID}} = "${escapeFormulaValue(sessionId)}"`;
    records = await getRecordsByFormula(TABLES.PORTAL_SESSIONS, formula);
  } catch (err) {
    // Treat a lookup failure as unauthorized; log the detail server-side.
    log('portal_auth_failed', { reason: 'lookup_error', slug, error: err.message });
    return UNAUTHORIZED;
  }

  if (!records || records.length === 0) {
    log('portal_auth_failed', { reason: 'no_session_record', slug });
    return UNAUTHORIZED;
  }

  const session = records[0].fields;

  // 3. Not deactivated
  if (session[SESSION_FIELDS.DEACTIVATED] === true) {
    log('portal_auth_failed', { reason: 'deactivated', slug });
    return UNAUTHORIZED;
  }

  // 4. Slug scope matches
  if (session[SESSION_FIELDS.PORTAL_SLUG] !== slug) {
    log('portal_auth_failed', { reason: 'slug_mismatch', slug });
    return UNAUTHORIZED;
  }

  return { valid: true, session };
}

/**
 * Build the Set-Cookie header value for a signed session cookie.
 * @param {string} sessionCookieId - value stored in Portal Sessions.session_id
 * @param {{ maxAge?: number }} [opts]
 */
function buildCookie(sessionCookieId, { maxAge = COOKIE_MAX_AGE } = {}) {
  const value = sessionCookieId
    ? `${sessionCookieId}.${sign(sessionCookieId)}`
    : '';
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  return attrs.join('; ');
}

/**
 * Write the signed httpOnly session cookie to the response.
 * Used only by portal-auth/callback.js after a successful LinkedIn auth.
 * @param {import('http').ServerResponse} res
 * @param {string} sessionCookieId
 */
export function setSessionCookie(res, sessionCookieId) {
  res.setHeader('Set-Cookie', buildCookie(sessionCookieId));
}

/**
 * Clear the session cookie (logout). Writes an empty, immediately-expired cookie.
 * @param {import('http').ServerResponse} res
 */
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', buildCookie('', { maxAge: 0 }));
}

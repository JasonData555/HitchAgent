/**
 * POST /api/generate-tile-html
 *
 * Triggered by an Airtable automation or button webhook (after PM approves the
 * tile draft). Constructs a permanent record-ID-based URL pointing to the
 * /api/tile-view rendering endpoint, and saves it back to Airtable on first run.
 * Subsequent runs for the same record are idempotent — the URL is never overwritten.
 *
 * Required header: x-api-key
 * Body: { "tileId": "recXXXXXXXX" }
 * Requires: Tile Draft Status = "Approved"
 *
 * Writes to Airtable (first run only for tile_url):
 *   tile_url    — permanent URL: /api/tile-view?id=<tileId>
 *   Tile Status — "Active"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AIRTABLE AUTOMATION CONFIGURATION
 * ─────────────────────────────────────────────────────────────────────────────
 * Table:   Candidate Tile
 * Trigger: "Tile Draft Status" changes to "Approved"
 *   (or a button field — same trigger pattern as the PDF automation)
 *
 * Step 1 — Find record
 *   Find the Candidate Tile record that triggered the automation.
 *
 * Step 2 — Guard: stop if not Approved
 *   If "Tile Draft Status" is not "Approved", stop the automation.
 *
 * Step 3 — Call generate-tile-html endpoint
 *   Send an HTTP POST request to:
 *     https://<your-vercel-domain>/api/generate-tile-html
 *   Headers:
 *     Content-Type: application/json
 *     x-api-key: <INTERNAL_API_KEY>
 *   Body:
 *     { "tileId": "<record ID>" }
 *
 * Step 4 — On success (response.status === "success")
 *   No additional writes needed — endpoint sets tile_url and Tile Status.
 *   Optionally: show response.data.htmlUrl to the PM via a notification.
 *
 * Step 5 — On failure (response.status === "error")
 *   Write response.message to a "Tile Generation Log" field (Long text) for
 *   PM visibility.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEACTIVATION & REACTIVATION
 * ─────────────────────────────────────────────────────────────────────────────
 * Deactivation is enforced by the "Tile Status" field. Setting it to
 * "Deactivated" causes /api/tile-view to return the unavailable page immediately.
 * Reactivation is automatic — set "Tile Status" back to "Active" in Airtable.
 */

import { timingSafeEqual } from 'crypto';
import { getRecord, updateRecord, getFieldValue, getAttachmentUrl } from '../lib/airtable.js';
import { createCandidateTileWebHtml } from '../lib/html-tile-web.js';
import { imageToBase64, guessMimeType } from '../lib/fetch-image.js';
import { log } from '../lib/logger.js';

const TABLE = process.env.AIRTABLE_TABLE_ID || 'Candidate Tile';
const TILE_ID_RE = /^rec[A-Za-z0-9]{14}$/;

function errorResponse(res, status, message) {
  return res.status(status).json({
    status: 'error',
    message,
    data: null,
    warnings: [],
  });
}

function isValidApiKey(provided, expected) {
  if (!provided || !expected) return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return errorResponse(res, 405, 'Method not allowed');
  }

  if (!isValidApiKey(req.headers['x-api-key'], process.env.INTERNAL_API_KEY)) {
    return errorResponse(res, 401, 'Unauthorized');
  }

  const { tileId } = req.body || {};
  if (!tileId) {
    return errorResponse(res, 400, 'Missing required field: tileId');
  }
  if (!TILE_ID_RE.test(tileId)) {
    return errorResponse(res, 400, 'Invalid tileId format');
  }

  log('request_received', { endpoint: 'generate-tile-html', tileId });

  // ── Fetch Candidate Tile record ───────────────────────────────────────────
  let record;
  try {
    record = await getRecord(TABLE, tileId);
  } catch (err) {
    log('error', { error: err.message, tileId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 404, 'Candidate Tile not found');
  }

  const { fields } = record;

  // ── Validate: must be Approved ────────────────────────────────────────────
  const status = getFieldValue(fields, 'Tile Draft Status', 'Not Started');
  if (status !== 'Approved') {
    return errorResponse(
      res,
      400,
      `Cannot generate HTML: draft status is '${status}', must be 'Approved'`
    );
  }

  // ── Extract all fields ────────────────────────────────────────────────────
  const candidateName           = getFieldValue(fields, 'Candidate Name');
  const currentTitle            = getFieldValue(fields, 'Current Title');
  const currentCompany          = getFieldValue(fields, 'Current Company');
  const location                = getFieldValue(fields, 'Location');
  const education               = getFieldValue(fields, 'Education');
  const institution             = getFieldValue(fields, 'Institution');
  const email                   = getFieldValue(fields, 'Email');
  const linkedinUrl             = getFieldValue(fields, 'LinkedIn');
  const situation               = getFieldValue(fields, 'Situation');
  const relevantDomainExpertise = getFieldValue(fields, 'Relevant Domain Expertise');
  const rubricMatch              = getFieldValue(fields, 'Rubric Match');
  const cultureAdd              = getFieldValue(fields, 'Culture Add');
  const anticipatedConcerns     = getFieldValue(fields, 'Anticipated Concerns');
  const additionalInfo          = getFieldValue(fields, 'Additional Info');

  const photoUrl     = getAttachmentUrl(fields, 'Profile Pic');
  const hitchLogoUrl = process.env.HITCH_LOGO_URL || null;

  log('airtable_fetch_complete', { candidateName, tileId });

  // ── Pre-fetch images as base64 data URIs (non-fatal if unavailable) ───────
  const warnings = [];
  const [photoDataUri, hitchLogoDataUri] = await Promise.all([
    photoUrl
      ? imageToBase64(photoUrl, guessMimeType(photoUrl)).catch(() => {
          warnings.push('Profile photo could not be loaded; using placeholder');
          return null;
        })
      : Promise.resolve(null),
    hitchLogoUrl
      ? imageToBase64(hitchLogoUrl, 'image/png').catch(() => {
          warnings.push('Hitch logo could not be loaded; using text fallback');
          return null;
        })
      : Promise.resolve(null),
  ]);

  if (!photoUrl) warnings.push('No profile photo URL found');
  if (!hitchLogoUrl) warnings.push('HITCH_LOGO_URL not set; using text fallback');

  // ── Generate HTML ─────────────────────────────────────────────────────────
  let htmlString;
  try {
    htmlString = createCandidateTileWebHtml({
      candidateName,
      currentTitle,
      currentCompany,
      location,
      education,
      institution,
      email,
      linkedinUrl,
      situation,
      relevantDomainExpertise,
      rubricMatch,
      cultureAdd,
      anticipatedConcerns,
      additionalInfo,
      photoDataUri,
      hitchLogoDataUri,
    });
  } catch (err) {
    log('error', { error: err.message, tileId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, 'HTML generation failed');
  }

  log('tile_html_generated', { fileSize: htmlString.length, tileId });

  // ── Build permanent URL (record-ID-based, never changes) ────────────────────
  // The URL points to /api/tile-view which renders live content on every
  // request. It is written to Airtable only once — subsequent generation runs
  // for the same record are idempotent and do not overwrite the existing URL.
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const permanentUrl = `${proto}://${host}/api/tile-view?id=${tileId}`;

  // Only write tile_url if the field is not already populated.
  const existingUrl = getFieldValue(fields, 'tile_url', '');
  const htmlUrl = existingUrl || permanentUrl;

  log('tile_url_set', { tileId, htmlUrl, isNew: !existingUrl });

  // ── Write URL back to Airtable ────────────────────────────────────────────
  // Always set Tile Status to Active. Only write tile_url if not already set —
  // the permanent URL never changes across regenerations.
  const fieldsToWrite = { 'Tile Status': 'Active' };
  if (!existingUrl) fieldsToWrite.tile_url = permanentUrl;

  try {
    await updateRecord(TABLE, tileId, fieldsToWrite);
  } catch (err) {
    log('error', { error: err.message, htmlUrl, tileId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, `HTML generated but failed to save to Airtable: ${htmlUrl}`);
  }

  log('airtable_updated', { field: 'tile_url', tileId });

  return res.status(200).json({
    status: 'success',
    message: 'Candidate tile HTML generated',
    data: {
      tileId,
      candidateName,
      htmlUrl,
    },
    warnings,
  });
}

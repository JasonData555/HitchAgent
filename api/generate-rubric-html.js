/**
 * POST /api/generate-rubric-html
 *
 * Triggered by an Airtable automation or button webhook (after PM approves the rubric draft).
 * Generates a self-contained HTML role requirements brief, uploads it to Vercel Blob,
 * and saves the public URL back to the "rubric_url" field on the Rubric record.
 *
 * Required header: x-api-key
 * Body: { "rubricId": "recXXXXXXXX" }
 * Requires: Rubric Draft Status = "Approved"
 *
 * Environment variables (in addition to shared ones in CLAUDE.md):
 *   RUBRIC_TABLE_ID  — Airtable table name/ID for the Rubric table
 *   HITCH_LOGO_URL   — Public HTTPS URL for the Hitch Partners logo PNG
 */

import { randomUUID, timingSafeEqual } from 'crypto';
import { put } from '@vercel/blob';
import { getRecord, updateRecord, getFieldValue, getAttachmentUrl } from '../lib/airtable.js';
import { buildRubricDocument } from '../lib/pdf-rubric.js';
import { imageToBase64, guessMimeType } from '../lib/fetch-image.js';
import { log } from '../lib/logger.js';

const RUBRIC_TABLE = process.env.RUBRIC_TABLE_ID || 'Rubric';
const RUBRIC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const HTML_CONTENT_TYPE = 'text/html';

function errorResponse(res, status, message) {
  return res.status(status).json({
    status: 'error',
    message,
    data: null,
    warnings: [],
  });
}

/** Constant-time API key comparison to prevent timing attacks. */
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

  const { rubricId } = req.body || {};
  if (!rubricId) {
    return errorResponse(res, 400, 'Missing required field: rubricId');
  }
  if (!RUBRIC_ID_RE.test(rubricId)) {
    return errorResponse(res, 400, 'Invalid rubricId format');
  }

  log('request_received', { endpoint: 'generate-rubric-html', rubricId });

  // ── Fetch Rubric record ──────────────────────────────────────────────────
  let record;
  try {
    record = await getRecord(RUBRIC_TABLE, rubricId);
  } catch (err) {
    log('error', { error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 404, `Rubric not found: ${rubricId}`);
  }

  const { fields } = record;
  const clientName = getFieldValue(fields, 'client_name', '');
  const searchName = getFieldValue(fields, 'Search', '');

  // ── Validate status is Approved ───────────────────────────────────────────
  const currentStatus = getFieldValue(fields, 'Rubric Draft Status', '');
  if (currentStatus !== 'Approved') {
    return errorResponse(
      res,
      400,
      `Cannot generate HTML: rubric status is '${currentStatus}'. Approve the draft first.`
    );
  }

  // ── Extract content fields ────────────────────────────────────────────────
  const mustHave               = getFieldValue(fields, 'Must Have', '');
  const niceToHave             = getFieldValue(fields, 'Nice to Have', '');
  const redFlags               = getFieldValue(fields, 'Red Flags', '');
  const successInRole          = getFieldValue(fields, 'Success in the Role', '');
  const functionalResp         = getFieldValue(fields, 'Functional Responsibilities', '');
  const location               = getFieldValue(fields, 'Location', '');
  const currentTeamSize        = getFieldValue(fields, 'Current Team Size', '');
  const teamSize18Months       = getFieldValue(fields, 'Est. Team Size in 18-24 Months', '');
  const positionReportsTo      = getFieldValue(fields, 'Position Reports To', '');

  log('airtable_fetch_complete', { rubricId, clientName });

  // ── Download logos in parallel (non-fatal if unavailable) ───────────────────
  const warnings = [];
  const hitchLogoUrl  = process.env.HITCH_LOGO_URL;
  const clientLogoUrl = getAttachmentUrl(fields, 'client_logo');

  const [hitchLogoDataUri, clientLogoDataUri] = await Promise.all([
    hitchLogoUrl  ? imageToBase64(hitchLogoUrl,  guessMimeType(hitchLogoUrl)).catch(() => null)  : Promise.resolve(null),
    clientLogoUrl ? imageToBase64(clientLogoUrl, guessMimeType(clientLogoUrl)).catch(() => null) : Promise.resolve(null),
  ]);

  if (!hitchLogoDataUri)  warnings.push('Hitch logo could not be loaded; using text fallback');
  if (!clientLogoDataUri) warnings.push('Client logo could not be loaded; using text fallback');

  // ── Generate HTML ─────────────────────────────────────────────────────────
  let htmlString;
  try {
    htmlString = buildRubricDocument({
      clientName,
      searchName,
      location,
      currentTeamSize,
      teamSize18Months,
      positionReportsTo,
      mustHave,
      niceToHave,
      redFlags,
      successInRole,
      functionalResponsibility: functionalResp,
      hitchLogoDataUri,
      clientLogoDataUri,
    });
  } catch (err) {
    log('error', { error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, 'HTML generation failed');
  }

  // ── Upload to Vercel Blob ─────────────────────────────────────────────────
  let rubricUrl;
  try {
    const filename = `rubrics/${rubricId}-${Date.now()}.html`;
    const blob = await put(filename, htmlString, {
      access: 'public',
      contentType: HTML_CONTENT_TYPE,
    });
    // Serve via proxy so browser renders HTML inline (Vercel Blob CDN forces download)
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    rubricUrl = `${proto}://${host}/api/view?src=${encodeURIComponent(blob.url)}`;
  } catch (err) {
    log('error', { error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, 'Failed to upload HTML to storage');
  }

  log('rubric_pdf_generated', { rubricId, rubricUrl });

  // ── Write URL back to Airtable ────────────────────────────────────────────
  try {
    await updateRecord(RUBRIC_TABLE, rubricId, {
      rubric_url:          rubricUrl,
      'Rubric URL Status': 'Active',
    });
  } catch (err) {
    log('error', { error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, `HTML generated but failed to save to Airtable: ${rubricUrl}`);
  }

  log('airtable_updated', { rubricId, rubricUrl });

  return res.status(200).json({
    status: 'success',
    message: 'Rubric HTML generated',
    data: {
      rubricId,
      clientName,
      rubricUrl,
    },
    warnings,
  });
}

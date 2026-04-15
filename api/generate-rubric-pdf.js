/**
 * POST /api/generate-rubric-pdf
 *
 * Triggered by an Airtable automation or button webhook (after PM approves the rubric draft).
 * Generates a Role Requirements Alignment PDF via Puppeteer, uploads it to Vercel Blob,
 * and saves the URL as an attachment in the "Rubric PDF" field on the Rubric record.
 *
 * Required header: x-api-key
 * Body: { "rubricId": "recXXXXXXXX" }
 * Requires: Rubric Draft Status = "Approved"
 *
 * Airtable prerequisites:
 *   - "Rubric PDF" (Attachment) field on the Rubric table
 *
 * Environment variables (in addition to shared ones in CLAUDE.md):
 *   RUBRIC_TABLE_ID  — Airtable table name/ID for the Rubric table
 *   HITCH_LOGO_URL   — Public HTTPS URL for the Hitch Partners logo PNG
 */

import { timingSafeEqual } from 'crypto';
import { put } from '@vercel/blob';
import { getRecord, updateRecord, getFieldValue, getAttachmentUrl } from '../lib/airtable.js';
import { buildRubricDocument } from '../lib/pdf-rubric.js';
import { renderHtmlToPdf } from '../lib/pdf-render.js';
import { imageToBase64, guessMimeType } from '../lib/fetch-image.js';
import { log } from '../lib/logger.js';

const RUBRIC_TABLE = process.env.RUBRIC_TABLE_ID || 'Rubric';
const RUBRIC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

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

  log('request_received', { endpoint: 'generate-rubric-pdf', rubricId });

  // ── Fetch Rubric record ──────────────────────────────────────────────────
  let record;
  try {
    record = await getRecord(RUBRIC_TABLE, rubricId);
  } catch (err) {
    log('error', { step: 'airtable_fetch', error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
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
      `Cannot generate PDF: rubric status is '${currentStatus}'. Approve the draft first.`
    );
  }

  // ── Extract content fields ────────────────────────────────────────────────
  const mustHave          = getFieldValue(fields, 'Must Have', '');
  const niceToHave        = getFieldValue(fields, 'Nice to Have', '');
  const redFlags          = getFieldValue(fields, 'Red Flags', '');
  const successInRole     = getFieldValue(fields, 'Success in the Role', '');
  const functionalResp    = getFieldValue(fields, 'Functional Responsibilities', '');
  const location          = getFieldValue(fields, 'Location', '');
  const currentTeamSize   = getFieldValue(fields, 'Team Size Today', '');
  const teamSize18Months  = getFieldValue(fields, 'Est Team Size 18 - 24 mo', '');

  const hitchLogoUrl  = process.env.HITCH_LOGO_URL || null;
  const clientLogoUrl = getAttachmentUrl(fields, 'client_logo') || null;

  log('airtable_fetch_complete', { rubricId, clientName });

  // ── Fetch logos as base64 data URIs (non-fatal if unavailable) ────────────
  const warnings = [];
  const [hitchLogoDataUri, clientLogoDataUri] = await Promise.all([
    hitchLogoUrl
      ? imageToBase64(hitchLogoUrl, guessMimeType(hitchLogoUrl)).catch(() => null)
      : Promise.resolve(null),
    clientLogoUrl
      ? imageToBase64(clientLogoUrl, guessMimeType(clientLogoUrl)).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!hitchLogoDataUri)  warnings.push('Hitch logo unavailable; using text fallback');
  if (!clientLogoDataUri && clientLogoUrl) warnings.push('Client logo unavailable; using text fallback');

  // ── Build HTML document ───────────────────────────────────────────────────
  let htmlString;
  try {
    htmlString = buildRubricDocument({
      clientName,
      searchName,
      location,
      currentTeamSize,
      teamSize18Months,
      mustHave,
      niceToHave,
      redFlags,
      successInRole,
      functionalResponsibility: functionalResp,
      hitchLogoDataUri,
      clientLogoDataUri,
    });
  } catch (err) {
    log('error', { step: 'html_generation', error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, 'Rubric HTML generation failed');
  }

  // ── Render HTML → PDF via Puppeteer ───────────────────────────────────────
  let pdfBuffer;
  try {
    pdfBuffer = await renderHtmlToPdf(htmlString, { landscape: false, bottomMargin: '0.6in' });
  } catch (err) {
    log('error', { step: 'pdf_render', error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, 'Rubric PDF render failed');
  }

  log('rubric_pdf_generated', { fileSize: pdfBuffer.length, rubricId });

  // ── Upload PDF to Vercel Blob ─────────────────────────────────────────────
  let pdfUrl;
  try {
    const { url } = await put(
      `rubrics/${rubricId}-${Date.now()}.pdf`,
      pdfBuffer,
      {
        access: 'public',
        contentType: 'application/pdf',
      }
    );
    pdfUrl = url;
  } catch (err) {
    log('error', { step: 'pdf_upload', error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, 'Failed to upload rubric PDF to storage');
  }

  log('blob_uploaded', { type: 'pdf', url: pdfUrl, rubricId });

  // ── Write attachment to Airtable ──────────────────────────────────────────
  try {
    await updateRecord(RUBRIC_TABLE, rubricId, {
      'Rubric PDF': [{ url: pdfUrl, filename: `rubric-${rubricId}.pdf` }],
    });
  } catch (err) {
    log('error', { step: 'airtable_write_pdf', error: err.message, pdfUrl, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, `PDF generated but failed to save to Airtable: ${pdfUrl}`);
  }

  log('airtable_updated', { field: 'Rubric PDF', rubricId });

  return res.status(200).json({
    status: 'success',
    message: 'Rubric PDF generated',
    data: {
      rubricId,
      clientName,
      pdfUrl,
    },
    warnings,
  });
}

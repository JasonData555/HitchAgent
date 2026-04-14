/**
 * POST /api/generate-rubric-pdf
 *
 * Triggered by an Airtable automation or button webhook (after PM approves the rubric draft).
 * Generates a Role Requirements Brief PDF, uploads it to Vercel Blob,
 * and saves the URL back to the "Rubric PDF URL" field on the Rubric record.
 *
 * Required header: x-api-key
 * Body: { "rubricId": "recXXXXXXXX" }
 * Requires: Rubric Draft Status = "Approved"
 *
 * Airtable prerequisite: add a field named "Rubric PDF URL" (URL or Text type)
 * to the Rubric table before using this endpoint.
 *
 * Environment variables (in addition to shared ones in CLAUDE.md):
 *   RUBRIC_TABLE_ID  — Airtable table name/ID for the Rubric table
 *   HITCH_LOGO_URL   — Public HTTPS URL for the Hitch Partners logo PNG
 */

import { timingSafeEqual } from 'crypto';
import { put } from '@vercel/blob';
import { getRecord, updateRecord, getFieldValue, getAttachmentUrl } from '../lib/airtable.js';
import { createRubricPdf } from '../lib/pdf-rubric.js';
import { log } from '../lib/logger.js';

const RUBRIC_TABLE     = process.env.RUBRIC_TABLE_ID || 'Rubric';
const PDF_CONTENT_TYPE = 'application/pdf';
const RUBRIC_ID_RE     = /^rec[A-Za-z0-9]{14}$/;

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
  const currentTeamSize   = getFieldValue(fields, 'Current Team Size', '');
  const teamSize18Months  = getFieldValue(fields, 'Est. Team Size in 18-24 Months', '');
  const positionReportsTo = getFieldValue(fields, 'Position Reports To', '');

  const hitchLogoUrl  = process.env.HITCH_LOGO_URL || null;
  const clientLogoUrl = getAttachmentUrl(fields, 'client_logo') || null;

  log('airtable_fetch_complete', { rubricId, clientName });

  // ── Generate PDF ──────────────────────────────────────────────────────────
  let pdfBuffer;
  try {
    pdfBuffer = await createRubricPdf({
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
      hitchLogoUrl,
      clientLogoUrl,
    });
  } catch (err) {
    log('error', { error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, 'Rubric PDF generation failed');
  }

  log('rubric_pdf_generated', { fileSize: pdfBuffer.length, rubricId });

  // ── Upload to Vercel Blob ─────────────────────────────────────────────────
  let blobUrl;
  try {
    const { url } = await put(
      `rubrics/${rubricId}-${Date.now()}.pdf`,
      pdfBuffer,
      {
        access: 'public',
        contentType: PDF_CONTENT_TYPE,
      }
    );
    blobUrl = url;
  } catch (err) {
    log('error', { error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, 'Failed to upload rubric PDF to storage');
  }

  log('blob_uploaded', { url: blobUrl, rubricId });

  // ── Write URL back to Airtable ────────────────────────────────────────────
  try {
    await updateRecord(RUBRIC_TABLE, rubricId, {
      'Rubric PDF URL': blobUrl,
    });
  } catch (err) {
    log('error', { error: err.message, blobUrl, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, `PDF generated but failed to save to Airtable: ${blobUrl}`);
  }

  log('airtable_updated', { field: 'Rubric PDF URL', rubricId });

  return res.status(200).json({
    status: 'success',
    message: 'Rubric PDF generated',
    data: {
      rubricId,
      clientName,
      pdfUrl: blobUrl,
    },
    warnings: [],
  });
}

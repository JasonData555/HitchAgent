/**
 * POST /api/generate-rubric-pdf
 *
 * Triggered by an Airtable automation or button webhook (after PM approves the draft).
 * Reads the Rubric Matrix JSON and Conflict Narrative from Airtable, generates a
 * branded Requirements Alignment PDF, uploads it to Vercel Blob, and saves the
 * attachment URL back to Airtable.
 *
 * Required header: x-api-key
 * Body: { "rubricId": "recXXXXXXXX" }
 * Requires: Rubric Status = "Approved"
 *
 * Environment variables (in addition to shared ones in CLAUDE.md):
 *   RUBRIC_TABLE_ID  — Airtable table name/ID for the Rubric table
 */

import { randomUUID, timingSafeEqual } from 'crypto';
import { put } from '@vercel/blob';
import {
  getRecord,
  updateRecord,
  getFieldValue,
  getAttachmentUrl,
} from '../lib/airtable.js';
import { createRubricPdf } from '../lib/pdf-rubric.js';
import { log } from '../lib/logger.js';

const RUBRIC_TABLE    = process.env.RUBRIC_TABLE_ID || 'Rubric';
const PDF_CONTENT_TYPE = 'application/pdf';
const RUBRIC_ID_RE    = /^rec[A-Za-z0-9]{14}$/;

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

  // ── Validate: must be Approved ────────────────────────────────────────────
  const status = getFieldValue(fields, 'Rubric Draft Status', 'Not Started');
  if (status !== 'Approved') {
    return errorResponse(
      res,
      400,
      `Cannot generate PDF: status is '${status}', must be 'Approved'`
    );
  }

  // ── Extract fields ────────────────────────────────────────────────────────
  const rawMatrixJson = getFieldValue(fields, 'Rubric Matrix JSON', '');
  const clientName    = getFieldValue(fields, 'client_name', '');

  let matrixJson;
  try {
    matrixJson = JSON.parse(rawMatrixJson);
  } catch (err) {
    log('error', { error: 'Invalid Rubric Matrix JSON', rubricId });
    return errorResponse(res, 500, 'Rubric Matrix JSON is missing or invalid — regenerate the draft first');
  }

  const conflictNarrative = getFieldValue(fields, 'Conflict Narrative', '');
  const clientLogoUrl     = getAttachmentUrl(fields, 'client_logo');
  const hitchLogoUrl      = process.env.HITCH_LOGO_URL || null;

  log('airtable_fetch_complete', { rubricId, clientName });

  // ── Generate PDF ──────────────────────────────────────────────────────────
  let pdfBuffer;
  try {
    pdfBuffer = await createRubricPdf({
      clientName:        matrixJson.clientName || clientName,
      searchName:        matrixJson.searchName || '',
      contextRows:       matrixJson.contextRows || [],
      panelMembers:      matrixJson.panelMembers || [],
      domains:           matrixJson.domains || [],
      conflicts:         matrixJson.conflicts || [],
      conflictNarrative,
      hitchLogoUrl,
      clientLogoUrl,
    });
  } catch (err) {
    log('error', { error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, 'PDF generation failed');
  }

  log('pdf_generated', { fileSize: pdfBuffer.length, rubricId });

  // ── Upload to Vercel Blob ─────────────────────────────────────────────────
  let blobUrl;
  try {
    const { url } = await put(
      `rubrics/${rubricId}-${Date.now()}.pdf`,
      pdfBuffer,
      {
        access:      'public',
        contentType: PDF_CONTENT_TYPE,
      }
    );
    blobUrl = url;
  } catch (err) {
    log('error', { error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, 'Failed to upload PDF to storage');
  }

  log('blob_uploaded', { url: blobUrl, rubricId });

  // ── Update Airtable attachment field ──────────────────────────────────────
  try {
    await updateRecord(RUBRIC_TABLE, rubricId, {
      'Rubric PDF': [{ url: blobUrl }],
    });
  } catch (err) {
    log('error', { error: err.message, blobUrl, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(
      res,
      500,
      'PDF generated but failed to save to Airtable'
    );
  }

  log('airtable_updated', { field: 'Rubric PDF', rubricId });

  return res.status(200).json({
    status:  'success',
    message: 'Rubric PDF generated',
    data: {
      rubricId,
      clientName: matrixJson.clientName || clientName,
      pdfUrl: blobUrl,
    },
    warnings: [],
  });
}

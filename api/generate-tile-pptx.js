/**
 * POST /api/generate-tile-pptx
 *
 * Triggered by an Airtable button webhook (after PM approves the draft).
 * Generates a branded Candidate Tile PowerPoint, uploads it to Vercel Blob,
 * and saves the attachment URL back to Airtable.
 *
 * Required header: x-api-key
 * Body: { "tileId": "recXXXXXXXX" }
 * Requires: Tile Draft Status = "Approved"
 */

import { put } from '@vercel/blob';
import { getRecord, updateRecord, getFieldValue, getAttachmentUrl } from '../lib/airtable.js';
import { createCandidateTilePresentation } from '../lib/pptx-tile.js';
import { log } from '../lib/logger.js';

const TABLE = 'Candidate Tile';
const PPTX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function errorResponse(res, status, message) {
  return res.status(status).json({
    status: 'error',
    message,
    data: null,
    warnings: [],
  });
}

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return errorResponse(res, 405, 'Method not allowed');
  }

  // Authenticate
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return errorResponse(res, 401, 'Unauthorized');
  }

  const { tileId } = req.body || {};
  if (!tileId) {
    return errorResponse(res, 400, 'Missing required field: tileId');
  }

  log('request_received', { endpoint: 'generate-tile-pptx', tileId });

  // ── Fetch Candidate Tile record ──────────────────────────────────────────
  let record;
  try {
    record = await getRecord(TABLE, tileId);
  } catch (err) {
    log('error', { error: err.message, tileId });
    return errorResponse(res, 404, `Candidate Tile not found: ${tileId}`);
  }

  const { fields } = record;

  // ── Validate: must be Approved ────────────────────────────────────────────
  const status = getFieldValue(fields, 'Tile Draft Status', 'Not Started');
  if (status !== 'Approved') {
    return errorResponse(
      res,
      400,
      `Cannot generate PowerPoint: draft status is '${status}', must be 'Approved'`
    );
  }

  // ── Extract all fields ────────────────────────────────────────────────────
  const candidateName    = getFieldValue(fields, 'Candidate Name');
  const currentTitle     = getFieldValue(fields, 'Current Title');
  const currentCompany   = getFieldValue(fields, 'Current Company');
  const location         = getFieldValue(fields, 'Location');
  const education        = getFieldValue(fields, 'Education');
  const email            = getFieldValue(fields, 'Email');
  const phone            = getFieldValue(fields, 'Phone');
  const relevantExperience = getFieldValue(fields, 'Relevant Security Experience');
  const currentSituation   = getFieldValue(fields, 'Current Situation');
  const anticipatedConcerns = getFieldValue(fields, 'Anticipated Concerns');
  const roleTitle        = getFieldValue(fields, 'Role Title');
  const clientName       = getFieldValue(fields, 'Client');

  const photoUrl      = getAttachmentUrl(fields, 'Photo');
  const hitchLogoUrl  = process.env.HITCH_LOGO_URL || null;

  log('airtable_fetch_complete', { candidateName, tileId });

  // ── Generate PPTX ─────────────────────────────────────────────────────────
  let pptxBuffer;
  try {
    pptxBuffer = await createCandidateTilePresentation({
      candidateName,
      currentTitle,
      currentCompany,
      location,
      education,
      email,
      phone,
      relevantExperience,
      currentSituation,
      anticipatedConcerns,
      roleTitle,
      clientName,
      photoUrl,
      hitchLogoUrl,
    });
  } catch (err) {
    log('error', { error: err.message, stack: err.stack, tileId });
    return errorResponse(res, 500, `PPTX generation failed: ${err.message}`);
  }

  log('pptx_generated', { fileSize: pptxBuffer.length, tileId });

  // ── Upload to Vercel Blob ─────────────────────────────────────────────────
  let blobUrl;
  try {
    const { url } = await put(
      `tiles/${tileId}-${Date.now()}.pptx`,
      pptxBuffer,
      {
        access: 'public',
        contentType: PPTX_CONTENT_TYPE,
      }
    );
    blobUrl = url;
  } catch (err) {
    log('error', { error: err.message, stack: err.stack, tileId });
    return errorResponse(res, 500, `Failed to upload PPTX to storage: ${err.message}`);
  }

  log('blob_uploaded', { url: blobUrl, tileId });

  // ── Update Airtable attachment field ──────────────────────────────────────
  try {
    await updateRecord(TABLE, tileId, {
      'Candidate Tile PowerPoint': [{ url: blobUrl }],
    });
  } catch (err) {
    log('error', { error: err.message, stack: err.stack, tileId });
    return errorResponse(
      res,
      500,
      `PPTX generated but failed to save to Airtable: ${err.message}. File URL: ${blobUrl}`
    );
  }

  log('airtable_updated', { field: 'Candidate Tile PowerPoint', tileId });

  return res.status(200).json({
    status: 'success',
    message: 'Candidate tile PowerPoint generated',
    data: {
      tileId,
      candidateName,
      pptxUrl: blobUrl,
    },
    warnings: [],
  });
}

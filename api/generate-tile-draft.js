/**
 * POST /api/generate-tile-draft
 *
 * Triggered by an Airtable button webhook.
 * Fetches a Candidate Tile record, synthesizes content with Claude,
 * and writes the draft back to Airtable.
 *
 * Required header: x-api-key
 * Body: { "tileId": "recXXXXXXXX" }
 */

import { getRecord, updateRecord, getFieldValue, getAttachmentUrl } from '../lib/airtable.js';
import { extractTextFromPdf } from '../lib/pdf-extract.js';
import { synthesizeCandidateContent } from '../lib/anthropic.js';
import { log } from '../lib/logger.js';

const TABLE = process.env.AIRTABLE_TABLE_ID || 'Candidate Tile';
const MAX_GENERATIONS = 5;

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

  log('request_received', { endpoint: 'generate-tile-draft', tileId });

  // ── Fetch Candidate Tile record ──────────────────────────────────────────
  let record;
  try {
    record = await getRecord(TABLE, tileId);
  } catch (err) {
    log('error', { error: err.message, tileId });
    return errorResponse(res, 404, `Candidate Tile not found: ${tileId} — ${err.message}`);
  }

  const { fields } = record;

  // ── Validations ──────────────────────────────────────────────────────────
  const candidateName = getFieldValue(fields, 'Candidate Name');
  if (!candidateName) {
    return errorResponse(res, 400, 'Candidate Tile must be linked to a Person record');
  }

  const currentStatus = getFieldValue(fields, 'Tile Draft Status', 'Not Started');
  if (currentStatus === 'Approved') {
    return errorResponse(
      res,
      400,
      "Cannot overwrite approved content. Reset status to 'Not Started' to regenerate."
    );
  }

  const generationCount = fields['Tile Generation Count'] ?? 0;
  if (generationCount >= MAX_GENERATIONS) {
    return errorResponse(
      res,
      400,
      `Generation limit reached (${MAX_GENERATIONS}). Contact admin to reset.`
    );
  }

  // ── Extract candidate data ───────────────────────────────────────────────
  const candidateData = {
    name: candidateName,
    title: getFieldValue(fields, 'Current Title', 'Unknown Title'),
    company: getFieldValue(fields, 'Current Company', 'Unknown Company'),
  };

  const roleContext = {
    roleTitle: getFieldValue(fields, 'Role Title', 'the role'),
    clientName: getFieldValue(fields, 'Client', 'the client'),
  };

  const notes = getFieldValue(fields, 'Notes', '');

  // ── Resume extraction ────────────────────────────────────────────────────
  const warnings = [];
  let resumeText = '';
  let resumeParseStatus = 'No Resume';

  const resumeUrl = getAttachmentUrl(fields, 'Resume');
  if (resumeUrl) {
    const pdfResult = await extractTextFromPdf(resumeUrl);
    if (pdfResult.success) {
      resumeText = pdfResult.text;
      resumeParseStatus = 'Success';
      log('pdf_parse_complete', { characterCount: resumeText.length, tileId });
    } else {
      resumeParseStatus = 'Failed';
      warnings.push(`Resume could not be parsed: ${pdfResult.error}`);
      log('pdf_parse_failed', { error: pdfResult.error, tileId });
    }
  }

  log('airtable_fetch_complete', { candidateName, tileId, resumeParseStatus });

  // ── Claude synthesis ─────────────────────────────────────────────────────
  let synthesized;
  log('claude_api_called', { model: 'claude-haiku-4-5-20251001', tileId });

  try {
    synthesized = await synthesizeCandidateContent(
      candidateData,
      roleContext,
      resumeText,
      notes
    );
  } catch (err) {
    log('error', { error: err.message, stack: err.stack, tileId });
    // Write error status to Airtable so PM sees it
    await updateRecord(TABLE, tileId, {
      'Tile Draft Status': 'Draft Error',
      'Tile Draft Error': err.message,
    }).catch(() => {});
    return errorResponse(res, 500, `Content synthesis failed: ${err.message}`);
  }

  log('claude_api_complete', { tileId });

  // ── Write draft back to Airtable ─────────────────────────────────────────
  try {
    await updateRecord(TABLE, tileId, {
      'Relevant Security Experience': synthesized.relevantExperience,
      'Current Situation': synthesized.currentSituation,
      'Anticipated Concerns': synthesized.anticipatedConcerns,
      'Tile Draft Status': 'Draft Ready',
      'Resume Parse Status': resumeParseStatus,
      'Tile Generation Count': generationCount + 1,
      'Tile Draft Error': '',
    });
  } catch (err) {
    log('error', { error: err.message, stack: err.stack, tileId });
    return errorResponse(res, 500, `Failed to save draft to Airtable: ${err.message}`);
  }

  log('airtable_updated', { tileId, candidateName });

  return res.status(200).json({
    status: 'success',
    message: 'Candidate tile draft generated',
    data: {
      tileId,
      candidateName,
      generationCount: generationCount + 1,
    },
    warnings,
  });
}

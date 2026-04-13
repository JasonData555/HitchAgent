/**
 * POST /api/generate-rubric-draft
 *
 * Triggered by an Airtable automation or button webhook.
 * Fetches a Rubric record and its linked ITI Input records, collects
 * free-text Notes per interviewer, calls Claude to synthesize five
 * structured fields, and writes them back to the Rubric record.
 *
 * Required header: x-api-key
 * Body: { "rubricId": "recXXXXXXXX" }
 *
 * Environment variables (in addition to shared ones in CLAUDE.md):
 *   RUBRIC_TABLE_ID  — Airtable table name/ID for the Rubric table
 *   ITI_TABLE_ID     — Airtable table name/ID for the ITI Input table
 */

import { timingSafeEqual } from 'crypto';
import {
  getRecord,
  updateRecord,
  getFieldValue,
  getRecordsByFormula,
} from '../lib/airtable.js';
import { synthesizeRubricFields } from '../lib/anthropic.js';
import { log } from '../lib/logger.js';

const RUBRIC_TABLE = process.env.RUBRIC_TABLE_ID || 'Rubric';
const ITI_TABLE    = process.env.ITI_TABLE_ID    || 'ITI Input';
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

/**
 * Escape double-quotes and backslashes in a value to be used inside an
 * Airtable formula string surrounded by double-quotes.
 */
function escapeFormulaValue(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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

  log('request_received', { endpoint: 'generate-rubric-draft', rubricId });

  // ── Fetch Rubric record ──────────────────────────────────────────────────
  let record;
  try {
    record = await getRecord(RUBRIC_TABLE, rubricId);
  } catch (err) {
    log('error', { error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 404, `Rubric not found: ${rubricId}`);
  }

  const { fields } = record;
  const clientName = getFieldValue(fields, 'client_name', 'the client');
  const searchName = getFieldValue(fields, 'Search', '');

  // ── Validate status is not Approved ──────────────────────────────────────
  const currentStatus = getFieldValue(fields, 'Rubric Draft Status', 'Not Started');
  if (currentStatus === 'Approved') {
    return errorResponse(
      res,
      400,
      'Cannot overwrite approved content. Reset status to regenerate.'
    );
  }

  // ── Fetch ITI Input records linked by search_project ─────────────────────
  let itiRecords;
  try {
    const formula = `{search_project} = "${escapeFormulaValue(searchName)}"`;
    itiRecords = await getRecordsByFormula(ITI_TABLE, formula);
  } catch (err) {
    log('error', { error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, 'Failed to fetch panel member inputs');
  }

  if (itiRecords.length < 1) {
    return errorResponse(res, 400, 'Rubric must have at least 1 panel member input');
  }

  log('iti_records_fetched', { rubricId, panelMemberCount: itiRecords.length });

  // ── Extract interviewer name + notes only ─────────────────────────────────
  const interviewerNotes = itiRecords.map((r) => ({
    name:  getFieldValue(r.fields, 'panel_member', ''),
    notes: getFieldValue(r.fields, 'Notes', ''),
  }));

  // ── Claude: synthesize five structured fields from interviewer notes ───────
  log('claude_api_called', { model: 'claude-haiku-4-5-20251001', rubricId });
  let synthesized;
  try {
    synthesized = await synthesizeRubricFields(clientName, searchName, interviewerNotes);
  } catch (err) {
    log('error', { error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    await updateRecord(RUBRIC_TABLE, rubricId, { 'Rubric Draft Status': 'Draft Error' }).catch(() => {});
    return errorResponse(res, 500, 'Content synthesis failed');
  }

  log('rubric_narrative_complete', { rubricId });

  // ── Write back to Airtable ────────────────────────────────────────────────
  try {
    await updateRecord(RUBRIC_TABLE, rubricId, {
      'Must Have':                synthesized.mustHave,
      'Nice to Have':             synthesized.niceToHave,
      'Red Flags':                synthesized.redFlags,
      'Success in Role':          synthesized.successInRole,
      'Functional Responsibility': synthesized.functionalResponsibility,
      'Rubric Draft Status':      'Draft Ready',
    });
  } catch (err) {
    log('error', { error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 500, 'Failed to save draft');
  }

  log('airtable_updated', { rubricId, clientName });

  return res.status(200).json({
    status:  'success',
    message: 'Rubric draft generated',
    data: {
      rubricId,
      clientName,
      panelMemberCount: itiRecords.length,
      fieldsWritten: ['Must Have', 'Nice to Have', 'Red Flags', 'Success in Role', 'Functional Responsibility'],
    },
    warnings: [],
  });
}

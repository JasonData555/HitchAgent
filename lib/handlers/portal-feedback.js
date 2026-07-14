/**
 * POST /api/portal-feedback
 *
 * Records an interview panel member's verdict + notes onto their own Interview
 * Schedule record. Authenticated by the httpOnly session cookie (no x-api-key —
 * this is reviewer-facing, not an automation webhook).
 *
 * Body: { slug, schedule_record_id, verdict, notes }
 *
 * Security model (in order):
 *   1. validatePortalSession — the first action; no DB access happens before it.
 *   2. Onboarding gate — the session must carry a linked identity (name + title).
 *   3. Verdict enum — validated server-side; never trusted from the client.
 *   4. IDOR — three checks bind the target record to THIS reviewer's session and
 *      portal. A reviewer cannot write to another reviewer's record by tampering
 *      with schedule_record_id. Every IDOR/auth failure returns an identical opaque
 *      403; the specific reason is logged server-side only.
 */

import {
  getRecord,
  getRecordsByFormula,
  updateRecord,
  getFieldValue,
} from '../airtable.js';
import { validatePortalSession } from '../portalAuth.js';
import {
  TABLES,
  SCHEDULE_FIELDS,
  SEARCHES_FIELDS,
  SESSION_FIELDS,
} from '../airtableFields.js';
import { log } from '../logger.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const VALID_VERDICTS = ['Yes', 'Soft Yes', 'Soft No', 'No'];

/** Escape a value for safe interpolation into an Airtable filterByFormula string. */
function escapeFormulaValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** True when a multipleRecordLinks field array contains the given record id. */
function linkIncludes(value, recordId) {
  return Array.isArray(value) && value.includes(recordId);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // ── Step 1: method ──────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // ── Step 2: read body (only `slug` is needed pre-auth, to scope the session) ──
  const body = req.body || {};
  const { slug, schedule_record_id: scheduleRecordId, verdict, notes } = body;

  // ── Step 3: authenticate (first DB access) ───────────────────────────────────
  const auth = await validatePortalSession(req, slug);
  if (!auth.valid) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const session = auth.session;

  // ── Step 4: onboarding gate (enforced server-side, not just in the UI) ───────
  const fullName = getFieldValue(session, SESSION_FIELDS.FULL_NAME, '');
  const interviewerTitle = getFieldValue(session, SESSION_FIELDS.INTERVIEWER_TITLE, '');
  if (!String(fullName).trim() || !String(interviewerTitle).trim()) {
    log('portal_feedback_rejected', { reason: 'onboarding_incomplete', slug });
    return res.status(403).json({ error: 'onboarding_incomplete' });
  }

  // ── Step 5: verdict enum ─────────────────────────────────────────────────────
  if (!VALID_VERDICTS.includes(verdict)) {
    log('portal_feedback_rejected', { reason: 'invalid_verdict', slug });
    return res.status(400).json({ error: 'invalid_verdict' });
  }

  // ── Step 6: IDOR — all three checks; every failure → opaque 403 ──────────────
  const denyIdor = (reason) => {
    log('portal_feedback_rejected', { reason, slug });
    return res.status(403).json({ error: 'unauthorized' });
  };

  if (!REC_ID_RE.test(String(scheduleRecordId || ''))) {
    return denyIdor('bad_id_format');
  }

  // Check 3 (cheapest): the record must be the one bound to this session.
  if (scheduleRecordId !== getFieldValue(session, SESSION_FIELDS.SCHEDULE_RECORD_ID, '')) {
    return denyIdor('session_record_mismatch');
  }

  // Check 1: the record exists.
  let scheduleRecord;
  try {
    scheduleRecord = await getRecord(TABLES.INTERVIEW_SCHEDULE, scheduleRecordId);
  } catch (err) {
    log('portal_feedback_rejected', { reason: 'record_not_found', slug, error: err.message });
    return res.status(403).json({ error: 'unauthorized' });
  }

  // Check 2: the record's linked search resolves to THIS portal slug.
  let searchRecord;
  try {
    const formula = `{${SEARCHES_FIELDS.PORTAL_SLUG}} = "${escapeFormulaValue(slug)}"`;
    const records = await getRecordsByFormula(TABLES.SEARCHES, formula);
    searchRecord = records && records[0];
  } catch (err) {
    log('portal_feedback_rejected', { reason: 'search_lookup_error', slug, error: err.message });
    return res.status(403).json({ error: 'unauthorized' });
  }
  if (!searchRecord || !linkIncludes(scheduleRecord.fields[SCHEDULE_FIELDS.PROJECT], searchRecord.id)) {
    return denyIdor('slug_mismatch');
  }

  // ── Step 7: write the verdict + notes + session token ────────────────────────
  // INTERVIEWER_TITLE is intentionally NOT written — it is a read-only lookup on
  // Interview Schedule (auto-derived from the linked Interviewer record); PATCHing it
  // would 422 and fail the whole submission.
  try {
    await updateRecord(TABLES.INTERVIEW_SCHEDULE, scheduleRecordId, {
      [SCHEDULE_FIELDS.VERDICT]: verdict,
      [SCHEDULE_FIELDS.NOTES]: notes || '',
      [SCHEDULE_FIELDS.SESSION_TOKEN]: getFieldValue(session, SESSION_FIELDS.SESSION_ID, ''),
    });
  } catch (err) {
    log('error', { endpoint: 'portal-feedback', slug, error: `write_failed: ${err.message}` });
    return res.status(500).json({ error: 'write_failed' });
  }

  log('portal_feedback_recorded', { slug, scheduleRecordId, verdict });
  return res.status(200).json({ success: true });
}

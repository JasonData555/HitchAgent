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

import { timingSafeEqual } from 'crypto';
import { getRecord, updateRecord, getFieldValue, getAttachmentUrl, getRecordsByFormula } from '../lib/airtable.js';
import { extractTextFromPdf } from '../lib/pdf-extract.js';
import { synthesizeCandidateContent } from '../lib/anthropic.js';
import { fetchLinkedInProfile } from '../lib/apify-linkedin.js';
import { log } from '../lib/logger.js';

const TABLE        = process.env.AIRTABLE_TABLE_ID || 'Candidate Tile';
const RUBRIC_TABLE = process.env.RUBRIC_TABLE_ID   || 'Rubric';
const ITI_TABLE    = process.env.ITI_TABLE_ID      || 'ITI Input';
const TILE_ID_RE = /^rec[A-Za-z0-9]{14}$/;

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
  // Only accept POST
  if (req.method !== 'POST') {
    return errorResponse(res, 405, 'Method not allowed');
  }

  // Authenticate
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

  log('request_received', { endpoint: 'generate-tile-draft', tileId });

  // ── Fetch Candidate Tile record ──────────────────────────────────────────
  let record;
  try {
    record = await getRecord(TABLE, tileId);
  } catch (err) {
    log('error', { error: err.message, tileId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return errorResponse(res, 404, 'Candidate Tile not found');
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

  // ── LinkedIn enrichment + Resume extraction (started in parallel) ─────────
  // Both tasks are kicked off before the Rubric/ITI lookups so their wait
  // times overlap with those sequential Airtable calls.  Max combined wait
  // is max(10s Apify, ~2s PDF) instead of 30s + 2s in series.
  // AIRTABLE PREREQUISITE: Add "LinkedIn Scraped" (Checkbox) field to the
  // Candidate Tile table. Without it the guard is skipped but the feature still works.
  const linkedInUrl  = getFieldValue(fields, 'LinkedIn', '');
  const alreadyScraped = fields['LinkedIn Scraped'] === true;

  const linkedInTask = (linkedInUrl && !alreadyScraped)
    ? fetchLinkedInProfile(linkedInUrl, tileId).catch(err => {
        log('error', { event: 'linkedin_scrape_unexpected_error', detail: err.message, tileId });
        return '';
      })
    : Promise.resolve('');

  if (!linkedInUrl) {
    log('info', { event: 'linkedin_scrape_skipped', reason: 'no_linkedin_url', tileId });
  } else if (alreadyScraped) {
    log('linkedin_scrape_skipped', { reason: 'already_scraped', tileId });
  } else {
    log('linkedin_scrape_started', { tileId });
  }

  const warnings = [];
  const resumeUrl = getAttachmentUrl(fields, 'Resume');
  const resumeTask = resumeUrl
    ? extractTextFromPdf(resumeUrl)
    : Promise.resolve({ success: false, text: '', error: 'No resume attached' });

  // ── Rubric Matrix JSON + priority fields lookup (optional) ───────────────
  // Follows the Project → Rubric join: Candidate Tile.Project (linked record)
  // is the same Search record linked from Rubric.Client.
  // Falls back gracefully if the tile has no Project, no linked Rubric, or
  // fields are absent — tile draft is still generated without Rubric context.
  let rubricMatrixJson = null;
  let rubricPriorities = { mustHave: '', niceToHave: '', redFlags: '' };
  let interviewerNotes = '';
  try {
    const projectRecordId = Array.isArray(fields['Project'])
      ? fields['Project'][0]
      : fields['Project'];

    if (projectRecordId) {
      const rubricRecords = await getRecordsByFormula(
        RUBRIC_TABLE,
        `FIND("${projectRecordId}", ARRAYJOIN({Client}, ",")) > 0`
      );
      const rubricFields = rubricRecords[0]?.fields;
      if (rubricFields) {
        const rawJson = rubricFields['Rubric Matrix JSON'];
        if (rawJson) {
          rubricMatrixJson = JSON.parse(rawJson);
        }
        rubricPriorities = {
          mustHave:   rubricFields['Must Have']   || '',
          niceToHave: rubricFields['Nice to Have'] || '',
          redFlags:   rubricFields['Red Flags']   || '',
        };
      }
    }
  } catch {
    // Non-fatal: proceed without Rubric context if lookup or parse fails
    rubricMatrixJson = null;
    rubricPriorities = { mustHave: '', niceToHave: '', redFlags: '' };
  }

  // ── ITI interviewer notes lookup (optional) ───────────────────────────────
  // Uses the searchName from the Rubric Matrix JSON to find linked ITI Input
  // records and collect attributed panel member notes for Culture Add calibration.
  if (rubricMatrixJson?.searchName) {
    try {
      const searchName = rubricMatrixJson.searchName.replace(/"/g, '\\"');
      const itiRecords = await getRecordsByFormula(
        ITI_TABLE,
        `{search_project} = "${searchName}"`
      );
      const noteLines = [];
      for (const rec of itiRecords) {
        const memberNotes = rec.fields?.['Notes'];
        if (memberNotes && memberNotes.trim()) {
          const memberName  = rec.fields?.['panel_member'] || 'Interviewer';
          const memberTitle = rec.fields?.['panel_member_title'] || '';
          const label = memberTitle ? `${memberName} (${memberTitle})` : memberName;
          noteLines.push(`${label}:\n${memberNotes.trim()}`);
        }
      }
      interviewerNotes = noteLines.join('\n\n');
    } catch {
      // Non-fatal: proceed without interviewer notes
      interviewerNotes = '';
    }
  }

  // ── Await LinkedIn + Resume (both started above) ─────────────────────────
  const [linkedInData, resumeResult] = await Promise.all([linkedInTask, resumeTask]);

  if (linkedInData) {
    log('linkedin_scrape_complete', { tileId });
  }

  let resumeText = '';
  let resumeParseStatus = 'No Resume';
  if (resumeUrl) {
    if (resumeResult.success) {
      resumeText = resumeResult.text;
      resumeParseStatus = 'Success';
      log('pdf_parse_complete', { characterCount: resumeText.length, tileId });
    } else {
      resumeParseStatus = 'Failed';
      warnings.push(`Resume could not be parsed: ${resumeResult.error}`);
      log('pdf_parse_failed', { error: resumeResult.error, tileId });
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
      notes,
      rubricMatrixJson,
      rubricPriorities,
      interviewerNotes,
      linkedInData
    );
  } catch (err) {
    log('error', { error: err.message, tileId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    // Write error status to Airtable so PM sees it
    await updateRecord(TABLE, tileId, {
      'Tile Draft Status': 'Draft Error',
    }).catch(() => {});
    return errorResponse(res, 500, 'Content synthesis failed');
  }

  log('claude_api_complete', { tileId });

  // ── Write draft back to Airtable ─────────────────────────────────────────
  try {
    await updateRecord(TABLE, tileId, {
      'Situation': synthesized.situation,
      'Relevant Domain Expertise': synthesized.relevantDomainExpertise,
      'Reasons to Consider': synthesized.reasonsToConsider,
      'Culture Add': synthesized.cultureAdd,
      'Anticipated Concerns': synthesized.anticipatedConcerns,
      'Tile Draft Status': 'Draft Ready',
      ...(linkedInData ? { 'LinkedIn Scraped': true } : {}),
    });
  } catch (err) {
    log('error', { event: 'airtable_update_failed', error: err.message, tileId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    await updateRecord(TABLE, tileId, { 'Tile Draft Status': 'Draft Error' }).catch(() => {});
    return errorResponse(res, 500, 'Failed to save draft');
  }

  log('airtable_updated', { tileId, candidateName });

  return res.status(200).json({
    status: 'success',
    message: 'Candidate tile draft generated',
    data: {
      tileId,
      candidateName,
    },
    warnings,
  });
}

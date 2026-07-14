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
import { getRecord, updateRecord, getFieldValue, getAttachmentUrl, getRecordsByFormula } from '../airtable.js';
import { extractTextFromPdf } from '../pdf-extract.js';
import { synthesizeCandidateContent, extractRubricItemTitles } from '../anthropic.js';
import { fetchLinkedInProfile } from '../apify-linkedin.js';
import { TABLES, SEARCHES_FIELDS } from '../airtableFields.js';
import { log } from '../logger.js';

const TABLE         = process.env.AIRTABLE_TABLE_ID || 'Candidate Tile';
const RUBRIC_TABLE  = process.env.RUBRIC_TABLE_ID   || 'Rubric';
const ITI_TABLE     = process.env.ITI_TABLE_ID      || 'ITI Input';
const SEARCH_TABLE  = TABLES.SEARCHES;
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

  // ── Rubric lookup via direct link traversal (optional) ───────────────────
  // The tile's Project link IS the Searches record, and Searches links to its
  // Rubric — so two getRecord() calls resolve it.
  //
  // Do NOT reintroduce a filterByFormula here. An Airtable formula sees a
  // linked-record field as its DISPLAY NAME, never the record id, so the old
  // `FIND(recId, ARRAYJOIN({Client}))` predicate always matched zero rows and
  // silently disabled every rubric-aware branch of the Claude prompt.
  let rubricMatrixJson = null;
  let rubricPriorities = { mustHave: '', niceToHave: '', redFlags: '' };
  let interviewerNotes = '';
  let searchName = '';

  const projectRecordId = Array.isArray(fields['Project'])
    ? fields['Project'][0]
    : fields['Project'];

  try {
    if (!projectRecordId) {
      log('rubric_lookup_skipped', { reason: 'tile has no Project link', tileId });
    } else {
      const searchRecord = await getRecord(SEARCH_TABLE, projectRecordId);
      const searchFields = searchRecord?.fields || {};
      searchName = getFieldValue(searchFields, SEARCHES_FIELDS.NAME, '');

      const rubricLink = searchFields[SEARCHES_FIELDS.RUBRIC_LINK];
      const rubricId   = Array.isArray(rubricLink) ? rubricLink[0] : rubricLink;

      if (!rubricId) {
        log('rubric_lookup_empty', { reason: 'Search has no linked Rubric', searchName, tileId });
      } else {
        const rubricFields = (await getRecord(RUBRIC_TABLE, rubricId))?.fields || {};

        const rawJson = rubricFields['Rubric Matrix JSON'];
        if (rawJson) {
          try {
            rubricMatrixJson = JSON.parse(rawJson);
          } catch {
            rubricMatrixJson = null; // malformed matrix is non-fatal
          }
        }

        rubricPriorities = {
          mustHave:   rubricFields['Must Have']    || '',
          niceToHave: rubricFields['Nice to Have'] || '',
          redFlags:   rubricFields['Red Flags']    || '',
        };

        log('rubric_fetch_complete', {
          tileId,
          rubricId,
          searchName,
          hasMustHave:   Boolean(rubricPriorities.mustHave),
          hasNiceToHave: Boolean(rubricPriorities.niceToHave),
          hasRedFlags:   Boolean(rubricPriorities.redFlags),
        });
      }
    }
  } catch (err) {
    // Non-fatal: proceed without Rubric context, but never silently.
    log('rubric_lookup_failed', { error: err.message, tileId });
    rubricMatrixJson = null;
    rubricPriorities = { mustHave: '', niceToHave: '', redFlags: '' };
  }

  // ── Extract Rubric item titles for Rubric Match table generation ─────────
  // Calls extractRubricItemTitles() on each priority field to get short item titles.
  // Combined ordered array: must_have first / nice_to_have second / red_flag last.
  // Formatted as pipe-delimited placeholder lines to inject into the Claude prompt.
  // Non-fatal — if no items are found the table is omitted and rubricMatch is empty.
  //
  // AIRTABLE PREREQUISITE: Add "Rubric Match" (Long Text, plain text, rich text disabled)
  // to the Candidate Tile table before running this endpoint for the first time.
  let rubricItemsBlock = null;
  {
    const { mustHave, niceToHave, redFlags } = rubricPriorities;
    if (mustHave || niceToHave || redFlags) {
      const items = [
        ...extractRubricItemTitles(mustHave,   'must_have'),
        ...extractRubricItemTitles(niceToHave, 'nice_to_have'),
        ...extractRubricItemTitles(redFlags,   'red_flag'),
      ];
      if (items.length > 0) {
        rubricItemsBlock = items
          .map(i => `${i.title} | ${i.priority} | (assign verdict) | (write note)`)
          .join('\n');
      }
    }
  }

  // ── ITI interviewer notes lookup (optional) ───────────────────────────────
  // Keyed off the Searches record name, not the Rubric Matrix JSON — most
  // Rubrics have no matrix JSON, and gating on it meant panel notes never loaded.
  const itiSearchName = rubricMatrixJson?.searchName || searchName;
  if (itiSearchName) {
    try {
      const escaped = itiSearchName.replace(/"/g, '\\"');
      const itiRecords = await getRecordsByFormula(
        ITI_TABLE,
        `{search_project} = "${escaped}"`
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

  // With neither a parsed resume nor a LinkedIn profile, the work history can only
  // be inferred from prose recruiter notes — tenures get dropped and no dates exist
  // in any source. The draft still generates, but the PM needs to know it is thin.
  if (!resumeText && !linkedInData) {
    warnings.push(
      'No resume and no LinkedIn data — work history was synthesized from recruiter notes only; tenures and dates may be incomplete.'
    );
    log('no_work_history_source', { tileId, resumeParseStatus });
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
      linkedInData,
      rubricItemsBlock
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
      'Rubric Match': synthesized.rubricMatch,
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

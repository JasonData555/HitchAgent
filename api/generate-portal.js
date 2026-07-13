/**
 * POST /api/generate-portal
 *
 * Webhook receiver fired by an Airtable automation when a PM sets a Rubric's
 * status to "Shared with Client". Generates Market Intelligence + Job Description
 * content via Claude (governed by the hitch-jd-generation skill), writes it to the
 * linked Rubric record, and activates the portal by setting the Searches record's
 * portal_status to "Live".
 *
 * Required header: x-api-key (constant-time vs INTERNAL_API_KEY)
 * Body: { "searchRecordId": "recXXXXXXXXXXXXXX" }  (a Searches record id)
 *
 * Idempotent: re-firing after the portal is Live (or finalized) skips generation.
 * PM edits in Airtable are the source of truth — populated fields are never
 * overwritten by a new Claude generation.
 */

import { timingSafeEqual } from 'crypto';
import { getRecord, updateRecord, getFieldValue, getRecordsByFormula } from '../lib/airtable.js';
import {
  generatePortalMarketIntelligence,
  generatePortalJobDescription,
} from '../lib/anthropic.js';
import {
  TABLES,
  SEARCHES_FIELDS,
  RUBRIC_FIELDS,
} from '../lib/airtableFields.js';
import { log } from '../lib/logger.js';

export const config = { maxDuration: 60 };

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const PORTAL_BASE_URL = 'https://hitch-agent.vercel.app/api/portal-view';

/** Escape a value for safe interpolation into an Airtable filterByFormula string. */
function escapeFormulaValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Derive a URL-safe slug from a search name.
 * "Coursera - CIO / CISO" → "coursera-cio-ciso"
 */
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric runs → single hyphen
    .replace(/^-+|-+$/g, '');    // trim leading/trailing hyphens
}

/**
 * Return a portal_slug unique across the Searches table. If `base` is already
 * used by another record, append -2, -3, … until free.
 */
async function ensureUniqueSlug(base, selfId) {
  let candidate = base;
  for (let n = 2; n <= 50; n++) {
    const formula = `{${SEARCHES_FIELDS.PORTAL_SLUG}} = "${escapeFormulaValue(candidate)}"`;
    const matches = await getRecordsByFormula(TABLES.SEARCHES, formula);
    const conflict = matches.some((r) => r.id !== selfId);
    if (!conflict) return candidate;
    candidate = `${base}-${n}`;
  }
  // Extremely unlikely fallback — keep it deterministic and unique.
  return `${base}-${selfId.slice(-6).toLowerCase()}`;
}

/** Constant-time API key comparison to prevent timing attacks. */
function isValidApiKey(provided, expected) {
  if (!provided || !expected) return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Record a generation failure on the Searches record and mark the portal Errored.
 * Best-effort — wrapped so a secondary write failure can't mask the original error.
 */
async function writeGenerationError(searchRecordId, message) {
  try {
    await updateRecord(
      TABLES.SEARCHES,
      searchRecordId,
      {
        [SEARCHES_FIELDS.GENERATION_ERROR]: `[${new Date().toISOString()}] ${message}`,
        [SEARCHES_FIELDS.PORTAL_STATUS]: 'Error',
      },
      { typecast: true }, // auto-create the 'Error' select option if absent
    );
  } catch (err) {
    log('error', { endpoint: 'generate-portal', searchRecordId, error: `failed to write generation_error: ${err.message}` });
  }
}

/** Assemble the final rubric content (the document rendered at rubric_url) for JD input. */
function assembleRubricContent(fields) {
  const sections = [
    ['Location', getFieldValue(fields, RUBRIC_FIELDS.LOCATION, '')],
    ['Team Size Today', getFieldValue(fields, RUBRIC_FIELDS.TEAM_SIZE_TODAY, '')],
    ['Estimated Team Size (18-24 mo)', getFieldValue(fields, RUBRIC_FIELDS.TEAM_SIZE_18_24, '')],
    ['Functional Responsibilities', getFieldValue(fields, RUBRIC_FIELDS.FUNCTIONAL_RESPONSIBILITIES, '')],
    ['Success in the Role', getFieldValue(fields, RUBRIC_FIELDS.SUCCESS_IN_ROLE, '')],
    ['Must Have', getFieldValue(fields, RUBRIC_FIELDS.MUST_HAVE, '')],
    ['Nice to Have', getFieldValue(fields, RUBRIC_FIELDS.NICE_TO_HAVE, '')],
    ['Red Flags', getFieldValue(fields, RUBRIC_FIELDS.RED_FLAGS, '')],
  ];
  return sections
    .filter(([, value]) => String(value).trim())
    .map(([label, value]) => `## ${label}\n${String(value).trim()}`)
    .join('\n\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isValidApiKey(req.headers['x-api-key'], process.env.INTERNAL_API_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { searchRecordId } = req.body || {};
  if (!searchRecordId) {
    return res.status(400).json({ error: 'Missing required field: searchRecordId' });
  }
  if (!REC_ID_RE.test(searchRecordId)) {
    return res.status(400).json({ error: 'Invalid searchRecordId format' });
  }

  log('request_received', { endpoint: 'generate-portal', searchRecordId });

  // ── Step 2: idempotency gate ───────────────────────────────────────────────
  let searchRecord;
  try {
    searchRecord = await getRecord(TABLES.SEARCHES, searchRecordId);
  } catch (err) {
    log('error', { endpoint: 'generate-portal', searchRecordId, error: err.message });
    return res.status(404).json({ error: `Searches record not found: ${searchRecordId}` });
  }

  const sFields = searchRecord.fields;
  const portalFinalized = sFields[SEARCHES_FIELDS.PORTAL_FINALIZED] === true;
  const portalStatus = getFieldValue(sFields, SEARCHES_FIELDS.PORTAL_STATUS, '');

  if (portalFinalized) {
    log('portal_generation_skipped', { searchRecordId, reason: 'finalized' });
    return res.status(200).json({ skipped: true, reason: 'Portal is finalized.' });
  }
  if (portalStatus === 'Live') {
    log('portal_generation_skipped', { searchRecordId, reason: 'already_live' });
    return res.status(200).json({ skipped: true, reason: 'Already live. Edit fields directly in Airtable.' });
  }

  // ── Step 3: fetch source data ──────────────────────────────────────────────
  const domain = getFieldValue(sFields, SEARCHES_FIELDS.DOMAIN, '');
  const rubricId = getFieldValue(sFields, SEARCHES_FIELDS.RUBRIC_LINK, '');

  // Auto-generate portal_slug from the search name if it isn't set yet.
  let portalSlug = String(getFieldValue(sFields, SEARCHES_FIELDS.PORTAL_SLUG, '')).trim();
  let slugGenerated = false;
  if (!portalSlug) {
    const base = slugify(getFieldValue(sFields, SEARCHES_FIELDS.NAME, '')) || 'search';
    portalSlug = await ensureUniqueSlug(base, searchRecordId);
    slugGenerated = true;
    log('portal_slug_generated', { searchRecordId, portalSlug });
  }

  if (!rubricId) {
    await writeGenerationError(searchRecordId, 'No linked Rubric record on the Searches record.');
    return res.status(500).json({ error: 'No linked Rubric record.' });
  }

  let rubricRecord;
  try {
    rubricRecord = await getRecord(TABLES.RUBRIC, rubricId);
  } catch (err) {
    await writeGenerationError(searchRecordId, `Failed to fetch Rubric ${rubricId}: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch linked Rubric record.' });
  }

  const rFields = rubricRecord.fields;

  // Guard: only generate from the final rubric (status "Shared with Client").
  const draftStatus = getFieldValue(rFields, RUBRIC_FIELDS.DRAFT_STATUS, '');
  if (draftStatus !== 'Shared with Client') {
    await writeGenerationError(searchRecordId, `Linked Rubric is not final (Rubric Draft Status = "${draftStatus}", expected "Shared with Client").`);
    return res.status(500).json({ error: 'Linked Rubric is not in "Shared with Client" status.' });
  }

  const searchProjectName = getFieldValue(rFields, RUBRIC_FIELDS.SEARCH, '');
  const existingMI = getFieldValue(rFields, RUBRIC_FIELDS.MARKET_INTELLIGENCE, '');
  const existingJD = getFieldValue(rFields, RUBRIC_FIELDS.JOB_DESCRIPTION, '');

  // ── Step 4: Market Intelligence (skip if already populated) ────────────────
  const rubricUpdates = {};
  let miGenerated = false;
  if (!String(existingMI).trim()) {
    try {
      const mi = await generatePortalMarketIntelligence(domain, getFieldValue(sFields, SEARCHES_FIELDS.CLIENT_NAME, ''));
      // Store the FULL MI object as a JSON string — portal-data.js JSON.parse()s it.
      rubricUpdates[RUBRIC_FIELDS.MARKET_INTELLIGENCE] = JSON.stringify(mi);
      miGenerated = true;
      log('claude_api_complete', { endpoint: 'generate-portal', step: 'market_intelligence', searchRecordId });
    } catch (err) {
      await writeGenerationError(searchRecordId, `MI generation failed: ${err.message}`);
      return res.status(500).json({ error: 'Market Intelligence generation failed.' });
    }
  }

  // ── Step 5: Job Description (skip if already populated) ─────────────────────
  let jdGenerated = false;
  if (!String(existingJD).trim()) {
    try {
      const rubricContent = assembleRubricContent(rFields);
      const jd = await generatePortalJobDescription(searchProjectName, rubricContent);
      rubricUpdates[RUBRIC_FIELDS.JOB_DESCRIPTION] = jd.role_narrative;
      rubricUpdates[RUBRIC_FIELDS.MANDATE_BULLETS] = Array.isArray(jd.mandate_bullets)
        ? jd.mandate_bullets.join('\n')
        : String(jd.mandate_bullets || '');
      rubricUpdates[RUBRIC_FIELDS.REPORTING_STRUCTURE] = jd.reporting_structure;
      // Store success_milestones as a JSON string — portal-data.js JSON.parse()s it.
      rubricUpdates[RUBRIC_FIELDS.SUCCESS_MILESTONES] = JSON.stringify(jd.success_milestones);
      jdGenerated = true;
      log('claude_api_complete', { endpoint: 'generate-portal', step: 'job_description', searchRecordId });
    } catch (err) {
      await writeGenerationError(searchRecordId, `JD generation failed: ${err.message}`);
      return res.status(500).json({ error: 'Job Description generation failed.' });
    }
  }

  // ── Step 6: write generated content back to the Rubric record ──────────────
  if (Object.keys(rubricUpdates).length > 0) {
    try {
      await updateRecord(TABLES.RUBRIC, rubricId, rubricUpdates);
      log('airtable_updated', { endpoint: 'generate-portal', record: 'Rubric', rubricId, fields: Object.keys(rubricUpdates) });
    } catch (err) {
      await writeGenerationError(searchRecordId, `Failed to write Rubric fields [${Object.keys(rubricUpdates).join(', ')}]: ${err.message}`);
      return res.status(500).json({ error: 'Failed to write generated content to Rubric.' });
    }
  }

  // ── Step 7: activate the portal (and persist the slug if we generated it) ──
  const activation = { [SEARCHES_FIELDS.PORTAL_STATUS]: 'Live' };
  if (slugGenerated) activation[SEARCHES_FIELDS.PORTAL_SLUG] = portalSlug;
  try {
    await updateRecord(TABLES.SEARCHES, searchRecordId, activation);
    log('airtable_updated', { endpoint: 'generate-portal', record: 'Searches', searchRecordId, fields: Object.keys(activation) });
  } catch (err) {
    await writeGenerationError(searchRecordId, `Failed to set portal_status = Live: ${err.message}`);
    return res.status(500).json({ error: 'Failed to activate portal.' });
  }

  // ── Step 8: success ────────────────────────────────────────────────────────
  return res.status(200).json({
    success: true,
    portalSlug,
    portalUrl: `${PORTAL_BASE_URL}?slug=${encodeURIComponent(portalSlug)}`,
    contentGenerated: true,
    miGenerated,
    jdGenerated,
  });
}

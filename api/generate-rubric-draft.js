/**
 * POST /api/generate-rubric-draft
 *
 * Triggered by an Airtable automation or button webhook.
 * Fetches a Rubric record and its linked ITI Input records, computes panel
 * alignment and conflicts, calls Claude for a narrative summary, and writes
 * the matrix JSON + narrative back to Airtable.
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
import { generateRubricNarrative } from '../lib/anthropic.js';
import { log } from '../lib/logger.js';

const RUBRIC_TABLE = process.env.RUBRIC_TABLE_ID || 'Rubric';
const ITI_TABLE    = process.env.ITI_TABLE_ID    || 'ITI Input';
const RUBRIC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

// All 12 security leadership domain field names (exact Airtable field names)
const DOMAIN_FIELDS = [
  'Manage IT',
  'ProdSec_AppSec',
  'AI Security',
  'GRC',
  'Security Architecture',
  'Network and Infrastructure Security',
  'TPRM',
  'Data Protection and Privacy',
  'IAM',
  'Cloud Security',
  'Security Operations',
  'External Communication',
];

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
 * Parse numeric score from an Airtable domain field value.
 * Returns null for N/A, empty, or unrecognised values.
 * e.g. "5 - Must have" → 5, "N/A" → null
 */
function parseScore(value) {
  if (!value || value === 'N/A') return null;
  const n = parseInt(String(value), 10);
  return isNaN(n) ? null : n;
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
      "Cannot overwrite approved content. Reset status to regenerate."
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

  if (itiRecords.length < 2) {
    return errorResponse(res, 400, 'Rubric must have at least 2 panel member inputs');
  }

  log('airtable_fetch_complete', { rubricId, panelMemberCount: itiRecords.length });

  // ── Extract panel member data ─────────────────────────────────────────────
  const panelMembers = itiRecords.map((r) => {
    const f = r.fields;
    const scores = {};
    for (const domain of DOMAIN_FIELDS) {
      scores[domain] = getFieldValue(f, domain, '');
    }
    return {
      name:             getFieldValue(f, 'panel_member', ''),
      title:            getFieldValue(f, 'panel_member_title', ''),
      reportsTo:        getFieldValue(f, 'Reports To', ''),
      teamSizeToday:    getFieldValue(f, 'team_size_today', ''),
      teamSize18Months: getFieldValue(f, 'team_size_18months', ''),
      location:         getFieldValue(f, 'Location Requirement', ''),
      notes:            getFieldValue(f, 'Notes', ''),
      scores,
    };
  });

  // ── Determine active domains (≥1 non-null score across all panel members) ─
  const activeDomains = DOMAIN_FIELDS.filter((domain) =>
    panelMembers.some((pm) => parseScore(pm.scores[domain]) !== null)
  );

  // ── Identify conflicts: max spread ≥ 2 among non-null scores ─────────────
  const conflictDomains = [];
  for (const domain of activeDomains) {
    const scores = panelMembers
      .map((pm) => parseScore(pm.scores[domain]))
      .filter((s) => s !== null);
    if (scores.length >= 2) {
      const spread = Math.max(...scores) - Math.min(...scores);
      if (spread >= 2) conflictDomains.push(domain);
    }
  }

  // Build conflict detail objects for Claude
  const conflictDetails = conflictDomains.map((domain) => ({
    domain,
    panelScores: panelMembers
      .filter((pm) => parseScore(pm.scores[domain]) !== null)
      .map((pm) => ({ name: pm.name, title: pm.title, score: pm.scores[domain] })),
  }));

  // Notes attributed per panel member (for Claude context)
  const attributedNotes = panelMembers
    .filter((pm) => pm.notes)
    .map((pm) => `${pm.name}:\n${pm.notes}`)
    .join('\n\n');

  // Panel data for Claude (active domains only, no internal notes field)
  const panelDataForClaude = panelMembers.map((pm) => ({
    name:      pm.name,
    title:     pm.title,
    reportsTo: pm.reportsTo,
    scores:    Object.fromEntries(activeDomains.map((d) => [d, pm.scores[d] || ''])),
  }));

  // ── Claude: generate conflict narrative ───────────────────────────────────
  log('claude_api_called', { model: 'claude-haiku-4-5-20251001', rubricId });
  let narrative;
  try {
    narrative = await generateRubricNarrative(
      clientName,
      panelDataForClaude,
      conflictDetails,
      attributedNotes
    );
  } catch (err) {
    log('error', { error: err.message, rubricId, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    await updateRecord(RUBRIC_TABLE, rubricId, { 'Rubric Draft Status': 'Draft Error' }).catch(() => {});
    return errorResponse(res, 500, 'Content synthesis failed');
  }

  log('claude_api_complete', { rubricId });

  // ── Build matrix JSON ─────────────────────────────────────────────────────
  const matrixJson = {
    clientName,
    searchName,
    contextRows: [
      { label: 'Position reports to',         field: 'reportsTo'        },
      { label: 'Current team size',           field: 'teamSizeToday'    },
      { label: 'Est. team size in 18 months', field: 'teamSize18Months' },
      { label: 'Location',                    field: 'location'         },
    ],
    panelMembers: panelMembers.map((pm) => ({
      name:             pm.name,
      title:            pm.title,
      reportsTo:        pm.reportsTo,
      teamSizeToday:    pm.teamSizeToday,
      teamSize18Months: pm.teamSize18Months,
      location:         pm.location,
      scores:           Object.fromEntries(activeDomains.map((d) => [d, pm.scores[d] || ''])),
    })),
    domains:   activeDomains,
    conflicts: conflictDomains,
  };

  // ── Write back to Airtable ────────────────────────────────────────────────
  try {
    await updateRecord(RUBRIC_TABLE, rubricId, {
      'Rubric Matrix JSON': JSON.stringify(matrixJson, null, 2),
      'Conflict Narrative': narrative,
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
      panelMemberCount: panelMembers.length,
      domainsIncluded:  activeDomains.length,
      conflictsFound:   conflictDomains.length,
    },
    warnings: [],
  });
}

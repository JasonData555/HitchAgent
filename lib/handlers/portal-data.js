/**
 * GET /api/portal-data?slug=[portal_slug]
 *
 * Authenticated JSON API that feeds the portal's client-side renderer. The
 * portal-view HTML shell calls this after the reviewer's LinkedIn session is
 * confirmed. ALL security validation happens here — the shell only renders what
 * this route returns.
 *
 * Auth: httpOnly session cookie (hitch_portal_session), validated via
 * validatePortalSession. Returns { session, portal, pipeline, interviews,
 * organizations } from live Airtable reads on every request (no cache).
 *
 * Security: no raw Airtable record IDs for other records, no base id / api key,
 * no session cookie id ever appear in the response. tile_url is an opaque URL;
 * the reviewer's own schedule_record_id is returned (re-validated by portal-feedback).
 */

import {
  getRecord,
  getRecordsByFormula,
  getFieldValue,
  getAttachmentUrl,
} from '../airtable.js';
import { validatePortalSession } from '../portalAuth.js';
import {
  TABLES,
  SEARCHES_FIELDS,
  RUBRIC_FIELDS,
  PROJECTS_FIELDS,
  SCHEDULE_FIELDS,
  SESSION_FIELDS,
  ORGANIZATIONS_FIELDS,
  PEOPLE_FIELDS,
} from '../airtableFields.js';
import { log } from '../logger.js';

const PORTAL_HOST = 'https://hitch-agent.vercel.app';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Escape a value for safe interpolation into an Airtable filterByFormula string. */
function escapeFormulaValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** First letter of the first + last word, uppercased. */
function computeInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return (first + last).toUpperCase();
}

/** True when a multipleRecordLinks field array contains the given record id. */
function linkIncludes(value, recordId) {
  return Array.isArray(value) && value.includes(recordId);
}

/** Safe JSON.parse with a fallback for stored JSON-string fields. */
function parseJsonField(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Resolve linked-record ids → a name string from `nameField`, in one chunked pass
 * (`OR(RECORD_ID()=…)`, ≤50 ids/query). Used to turn People/Organizations link ids
 * into display names without per-record fetches.
 */
async function resolveNames(table, nameField, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map();
  const CHUNK = 50;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const formula = `OR(${slice.map((id) => `RECORD_ID()="${escapeFormulaValue(id)}"`).join(',')})`;
    const recs = await getRecordsByFormula(table, formula);
    for (const r of recs) map.set(r.id, getFieldValue(r.fields, nameField, ''));
  }
  return map;
}

// ── Per-section fetchers ─────────────────────────────────────────────────────

async function fetchRubric(rubricId) {
  if (!rubricId) return null;
  const rec = await getRecord(TABLES.RUBRIC, rubricId);
  const f = rec.fields;
  return {
    search_project_name: getFieldValue(f, RUBRIC_FIELDS.SEARCH, ''),
    market_intelligence: parseJsonField(getFieldValue(f, RUBRIC_FIELDS.MARKET_INTELLIGENCE, ''), {}),
    role_narrative: getFieldValue(f, RUBRIC_FIELDS.JOB_DESCRIPTION, ''),
    mandate_bullets: String(getFieldValue(f, RUBRIC_FIELDS.MANDATE_BULLETS, ''))
      .split('\n')
      .filter(Boolean),
    reporting_structure: getFieldValue(f, RUBRIC_FIELDS.REPORTING_STRUCTURE, ''),
    success_milestones: parseJsonField(getFieldValue(f, RUBRIC_FIELDS.SUCCESS_MILESTONES, ''), {}),
  };
}

async function fetchPipeline(searchName, searchId) {
  const formula =
    `AND({${PROJECTS_FIELDS.DISPLAY}}=1, ` +
    `FIND("${escapeFormulaValue(searchName)}", ARRAYJOIN({${PROJECTS_FIELDS.PROJECT_NAME}})))`;
  const records = (await getRecordsByFormula(TABLES.PROJECTS, formula)).filter((r) =>
    linkIncludes(r.fields[PROJECTS_FIELDS.PROJECT_NAME], searchId),
  );

  // Company is an Organizations link (returns ids) — resolve to names in one pass.
  const companyIds = records.map((r) => (r.fields[PROJECTS_FIELDS.COMPANY] || [])[0]).filter(Boolean);
  const companyNames = await resolveNames(TABLES.ORGANIZATIONS, ORGANIZATIONS_FIELDS.NAME, companyIds);

  return records.map((r) => {
    const f = r.fields;
    const name = getFieldValue(f, PROJECTS_FIELDS.NAME, '');
    const tileId = Array.isArray(f[PROJECTS_FIELDS.TILE_LINK]) ? f[PROJECTS_FIELDS.TILE_LINK][0] : null;
    const companyId = (f[PROJECTS_FIELDS.COMPANY] || [])[0];
    return {
      name,
      title: getFieldValue(f, PROJECTS_FIELDS.TITLE, ''),
      company: (companyId && companyNames.get(companyId)) || '',
      initials: computeInitials(name),
      tile_url: tileId ? `${PORTAL_HOST}/api/tile-view?id=${tileId}` : null,
      feedback_unlocked: f[PROJECTS_FIELDS.FEEDBACK_UNLOCKED] === true,
    };
  });
}

async function fetchInterviews(searchName, searchId, session) {
  const scheduleRecordId = getFieldValue(session, SESSION_FIELDS.SCHEDULE_RECORD_ID, '');
  if (!scheduleRecordId) return [];

  let record;
  try {
    record = await getRecord(TABLES.INTERVIEW_SCHEDULE, scheduleRecordId);
  } catch {
    return []; // stale schedule id — treat as no interview
  }
  const f = record.fields;

  // Resolve candidate name via the linked ProjStat (Candidate-Project → Name).
  const candidateProjectId = Array.isArray(f[SCHEDULE_FIELDS.CANDIDATE_PROJECT])
    ? f[SCHEDULE_FIELDS.CANDIDATE_PROJECT][0]
    : null;
  let candidateName = '';
  let feedbackUnlocked = false;
  if (candidateProjectId) {
    try {
      const proj = await getRecord(TABLES.PROJECTS, candidateProjectId);
      candidateName = getFieldValue(proj.fields, PROJECTS_FIELDS.NAME, '');
      feedbackUnlocked = proj.fields[PROJECTS_FIELDS.FEEDBACK_UNLOCKED] === true;
    } catch {
      /* non-fatal */
    }
  }

  const verdict = getFieldValue(f, SCHEDULE_FIELDS.VERDICT, '') || null;
  const sessionId = getFieldValue(session, SESSION_FIELDS.SESSION_ID, '');

  const interview = {
    schedule_record_id: record.id,
    candidate_name: candidateName,
    date: getFieldValue(f, SCHEDULE_FIELDS.DATE, ''),
    time: getFieldValue(f, SCHEDULE_FIELDS.TIME, ''),
    verdict,
    notes: getFieldValue(f, SCHEDULE_FIELDS.NOTES, ''),
    is_submitted: !!verdict,
    token_matches: getFieldValue(f, SCHEDULE_FIELDS.SESSION_TOKEN, '') === sessionId,
    panel_summary: [],
  };

  // Panel summary only when feedback is unlocked for this candidate.
  if (feedbackUnlocked && candidateProjectId) {
    const formula = `FIND("${escapeFormulaValue(searchName)}", ARRAYJOIN({${SCHEDULE_FIELDS.PROJECT}}))`;
    const rows = await getRecordsByFormula(TABLES.INTERVIEW_SCHEDULE, formula);
    interview.panel_summary = rows
      .filter((row) => linkIncludes(row.fields[SCHEDULE_FIELDS.CANDIDATE_PROJECT], candidateProjectId))
      .map((row) => getFieldValue(row.fields, SCHEDULE_FIELDS.VERDICT, ''))
      .filter(Boolean);
  }

  return [interview];
}

async function fetchOrganizations(searchName, searchId) {
  const formula = `FIND("${escapeFormulaValue(searchName)}", ARRAYJOIN({${ORGANIZATIONS_FIELDS.SEARCH_LINK}}))`;
  const records = (await getRecordsByFormula(TABLES.ORGANIZATIONS, formula)).filter((r) =>
    linkIncludes(r.fields[ORGANIZATIONS_FIELDS.SEARCH_LINK], searchId),
  );
  if (records.length === 0) return [];

  // Resolve all security-leader People ids → names in one chunked pass.
  const leaderIds = [];
  for (const r of records) {
    for (const v of r.fields[ORGANIZATIONS_FIELDS.CURRENT_SECURITY_LEADERS] || []) leaderIds.push(v);
    for (const v of r.fields[ORGANIZATIONS_FIELDS.PREVIOUS_SECURITY_LEADERS] || []) leaderIds.push(v);
  }
  const nameMap = await resolveNames(TABLES.PEOPLE, PEOPLE_FIELDS.FULL_NAME, leaderIds);
  const names = (ids) => (ids || []).map((id) => nameMap.get(id)).filter(Boolean);

  return records.map((r) => {
    const f = r.fields;
    return {
      name: getFieldValue(f, ORGANIZATIONS_FIELDS.NAME, ''),
      description: getFieldValue(f, ORGANIZATIONS_FIELDS.DESCRIPTION, ''),
      city: getFieldValue(f, ORGANIZATIONS_FIELDS.CITY, ''),
      employee_count: getFieldValue(f, ORGANIZATIONS_FIELDS.EMPLOYEE_COUNT, ''),
      current_security_leaders: names(f[ORGANIZATIONS_FIELDS.CURRENT_SECURITY_LEADERS]),
      previous_security_leaders: names(f[ORGANIZATIONS_FIELDS.PREVIOUS_SECURITY_LEADERS]),
    };
  });
}

/**
 * Defensive final check: the response must never leak the base id, api key, the
 * session cookie id, or stray raw Airtable record ids. `tile_url` (opaque URL) and
 * the reviewer's own `schedule_record_id` are the only intentionally id-bearing
 * values, so they are removed before the stray-id scan. Returns the offending
 * label or null.
 */
function findLeakedSecret(response, sessionId) {
  const serialized = JSON.stringify(response);
  if (process.env.AIRTABLE_BASE_ID && serialized.includes(process.env.AIRTABLE_BASE_ID)) return 'base_id';
  if (process.env.AIRTABLE_API_KEY && serialized.includes(process.env.AIRTABLE_API_KEY)) return 'api_key';
  if (sessionId && serialized.includes(sessionId)) return 'session_id';

  // Scan for stray record ids after removing the two allowed id-bearing fields.
  const clone = JSON.parse(serialized);
  for (const c of clone.pipeline || []) delete c.tile_url;
  for (const iv of clone.interviews || []) delete iv.schedule_record_id;
  if (clone.session) delete clone.session.schedule_record_id;
  if (/\brec[A-Za-z0-9]{14}\b/.test(JSON.stringify(clone))) return 'record_id';

  return null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slug } = req.query || {};
  if (!slug) {
    return res.status(400).json({ error: 'Missing slug parameter' });
  }

  // ── Step 1: authenticate ───────────────────────────────────────────────────
  const auth = await validatePortalSession(req, slug);
  if (!auth.valid) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const session = auth.session;

  // ── Step 2: fetch the Searches record by slug ──────────────────────────────
  let searchRecord;
  try {
    const formula = `{${SEARCHES_FIELDS.PORTAL_SLUG}} = "${escapeFormulaValue(slug)}"`;
    const records = await getRecordsByFormula(TABLES.SEARCHES, formula);
    searchRecord = records && records[0];
  } catch (err) {
    log('error', { endpoint: 'portal-data', slug, error: err.message });
    return res.status(500).json({ error: 'fetch_failed' });
  }
  if (!searchRecord) {
    return res.status(404).json({ error: 'not_found' });
  }

  const searchId = searchRecord.id;
  const sFields = searchRecord.fields;
  const searchName = getFieldValue(sFields, SEARCHES_FIELDS.NAME, '');
  const rubricId = getFieldValue(sFields, SEARCHES_FIELDS.RUBRIC_LINK, '');
  const clientLogoUrl = getAttachmentUrl(sFields, SEARCHES_FIELDS.CLIENT_LOGO);

  // ── Step 3: parallel data fetch ────────────────────────────────────────────
  let rubric, pipeline, interviews, organizations;
  try {
    [rubric, pipeline, interviews, organizations] = await Promise.all([
      fetchRubric(rubricId),
      fetchPipeline(searchName, searchId),
      fetchInterviews(searchName, searchId, session),
      fetchOrganizations(searchName, searchId),
    ]);
  } catch (err) {
    log('error', { endpoint: 'portal-data', slug, error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'fetch_failed' });
  }

  // ── Step 4: compose response ───────────────────────────────────────────────
  const fullName = getFieldValue(session, SESSION_FIELDS.FULL_NAME, '');
  const interviewerName = String(fullName).split(' - ')[0].trim();

  const response = {
    session: {
      interviewer_name: interviewerName,
      interviewer_title: getFieldValue(session, SESSION_FIELDS.INTERVIEWER_TITLE, ''),
      linkedin_company: getFieldValue(session, SESSION_FIELDS.INTERVIEWER_COMPANY, ''),
      schedule_record_id: getFieldValue(session, SESSION_FIELDS.SCHEDULE_RECORD_ID, ''),
    },
    portal: {
      search_project_name: (rubric && rubric.search_project_name) || searchName,
      client_logo_url: clientLogoUrl || '',
      market_intelligence: (rubric && rubric.market_intelligence) || {},
      role_narrative: (rubric && rubric.role_narrative) || '',
      mandate_bullets: (rubric && rubric.mandate_bullets) || [],
      reporting_structure: (rubric && rubric.reporting_structure) || '',
      success_milestones: (rubric && rubric.success_milestones) || {},
    },
    pipeline,
    interviews,
    organizations,
  };

  // ── Step 5: security strip (defensive) ─────────────────────────────────────
  const leaked = findLeakedSecret(response, getFieldValue(session, SESSION_FIELDS.SESSION_ID, ''));
  if (leaked) {
    log('error', { endpoint: 'portal-data', slug, error: `response leaked ${leaked}` });
    return res.status(500).json({ error: 'internal_error' });
  }

  log('portal_data_served', { slug, pipeline: pipeline.length, interviews: interviews.length, organizations: organizations.length });
  return res.status(200).json(response);
}

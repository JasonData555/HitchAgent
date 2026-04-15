/**
 * GET /api/rubric-view?id=[rubricId]
 *
 * Permanent server-side rendering endpoint for Rubric documents.
 * Fetches the current Rubric record from Airtable on every request and
 * renders the HTML document live — content always reflects the latest
 * state of the Airtable record.
 *
 * No API key required (public-facing GET endpoint).
 * No HTML is stored anywhere — rendered and returned directly in the response.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEACTIVATION & REACTIVATION
 * ─────────────────────────────────────────────────────────────────────────────
 * Deactivation is controlled by the "Rubric URL Status" field on the Rubric
 * record. When set to "Deactivated", this endpoint returns the unavailable
 * page on every request — no blob deletion required.
 *
 * Reactivation is automatic: changing "Rubric URL Status" back to "Active"
 * (or any value other than "Deactivated") immediately re-enables serving
 * because the status check runs fresh on every request.
 */

import { getRecord, getFieldValue, getAttachmentUrl } from '../lib/airtable.js';
import { buildRubricDocument } from '../lib/pdf-rubric.js';
import { imageToBase64, guessMimeType } from '../lib/fetch-image.js';
import { log } from '../lib/logger.js';

const RUBRIC_TABLE = process.env.RUBRIC_TABLE_ID || 'Rubric';
const RUBRIC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

// ── Branded status pages ──────────────────────────────────────────────────────

function unavailablePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Link Unavailable</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f8f9fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 8px; padding: 48px 56px; max-width: 480px; text-align: center; box-shadow: 0 2px 16px rgba(0,0,0,0.08); }
    h1 { color: #1B365D; font-size: 22px; margin: 0 0 16px; }
    p { color: #64748B; font-size: 15px; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Link Unavailable</h1>
    <p>This document is no longer available. Please contact Hitch Partners for assistance.</p>
  </div>
</body>
</html>`;
}

function temporarilyUnavailablePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Temporarily Unavailable</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f8f9fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 8px; padding: 48px 56px; max-width: 480px; text-align: center; box-shadow: 0 2px 16px rgba(0,0,0,0.08); }
    h1 { color: #1B365D; font-size: 22px; margin: 0 0 16px; }
    p { color: #64748B; font-size: 15px; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Temporarily Unavailable</h1>
    <p>This document is temporarily unavailable. Please try again in a few moments.</p>
  </div>
</body>
</html>`;
}

function notFoundPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Not Found</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f8f9fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 8px; padding: 48px 56px; max-width: 480px; text-align: center; box-shadow: 0 2px 16px rgba(0,0,0,0.08); }
    h1 { color: #1B365D; font-size: 22px; margin: 0 0 16px; }
    p { color: #64748B; font-size: 15px; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Not Found</h1>
    <p>This document could not be found. Please contact Hitch Partners for assistance.</p>
  </div>
</body>
</html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).setHeader('Content-Type', 'text/html').send('<h1>Method Not Allowed</h1>');
    return;
  }

  // ── Parse record ID from query string ───────────────────────────────────────
  const { id: rubricId } = req.query || {};

  if (!rubricId || !RUBRIC_ID_RE.test(rubricId)) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send('<h1>Bad Request: missing or invalid id parameter</h1>');
  }

  log('request_received', { endpoint: 'rubric-view', rubricId });

  // ── Fetch Rubric record from Airtable ────────────────────────────────────────
  let record;
  try {
    record = await getRecord(RUBRIC_TABLE, rubricId);
  } catch (err) {
    // Could be 404 (record not found) or a transient Airtable failure.
    // Distinguish by checking the error message for a 404 indicator.
    const isNotFound = err.message && (err.message.includes('NOT_FOUND') || err.message.includes('404') || err.message.includes('not found'));
    if (isNotFound) {
      log('error', { error: 'Rubric record not found', rubricId });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/html');
      return res.status(404).send(notFoundPage());
    }
    // Transient failure — do not expose internal details
    log('error', { error: err.message, rubricId, stack: err.stack });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html');
    return res.status(503).send(temporarilyUnavailablePage());
  }

  const { fields } = record;

  // ── Check deactivation status ─────────────────────────────────────────────
  const urlStatus = getFieldValue(fields, 'Rubric URL Status', '');
  if (urlStatus === 'Deactivated') {
    log('request_received', { endpoint: 'rubric-view', rubricId, status: 'deactivated' });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(unavailablePage());
  }

  // ── Extract content fields ────────────────────────────────────────────────
  const clientName         = getFieldValue(fields, 'client_name', '');
  const searchName         = getFieldValue(fields, 'Search', '');
  const mustHave           = getFieldValue(fields, 'Must Have', '');
  const niceToHave         = getFieldValue(fields, 'Nice to Have', '');
  const redFlags           = getFieldValue(fields, 'Red Flags', '');
  const successInRole      = getFieldValue(fields, 'Success in the Role', '');
  const functionalResp     = getFieldValue(fields, 'Functional Responsibilities', '');
  const location           = getFieldValue(fields, 'Location', '');
  const currentTeamSize    = getFieldValue(fields, 'Team Size Today', '');
  const teamSize18Months   = getFieldValue(fields, 'Est Team Size 18 - 24 mo', '');

  log('airtable_fetch_complete', { rubricId, clientName });

  // ── Download logos in parallel (non-fatal if unavailable) ────────────────
  const hitchLogoUrl  = process.env.HITCH_LOGO_URL;
  const clientLogoUrl = getAttachmentUrl(fields, 'client_logo');

  const [hitchLogoDataUri, clientLogoDataUri] = await Promise.all([
    hitchLogoUrl  ? imageToBase64(hitchLogoUrl,  guessMimeType(hitchLogoUrl)).catch(() => null)  : Promise.resolve(null),
    clientLogoUrl ? imageToBase64(clientLogoUrl, guessMimeType(clientLogoUrl)).catch(() => null) : Promise.resolve(null),
  ]);

  // ── Render HTML ───────────────────────────────────────────────────────────
  let htmlString;
  try {
    htmlString = buildRubricDocument({
      clientName,
      searchName,
      location,
      currentTeamSize,
      teamSize18Months,
      mustHave,
      niceToHave,
      redFlags,
      successInRole,
      functionalResponsibility: functionalResp,
      hitchLogoDataUri,
      clientLogoDataUri,
    });
  } catch (err) {
    log('error', { error: err.message, rubricId, stack: err.stack });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html');
    return res.status(503).send(temporarilyUnavailablePage());
  }

  log('rubric_html_rendered', { rubricId, clientName });

  // ── Return rendered HTML — never cached ───────────────────────────────────
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(htmlString);
}

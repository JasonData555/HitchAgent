/**
 * GET /api/tile-view?id=[tileId]
 *
 * Permanent server-side rendering endpoint for Candidate Tile documents.
 * Fetches the current Candidate Tile record from Airtable on every request
 * and renders the HTML document live — content always reflects the latest
 * state of the Airtable record.
 *
 * No API key required (public-facing GET endpoint).
 * No HTML is stored anywhere — rendered and returned directly in the response.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEACTIVATION & REACTIVATION
 * ─────────────────────────────────────────────────────────────────────────────
 * Deactivation is controlled by the "Tile Status" field on the Candidate Tile
 * record. When set to "Deactivated", this endpoint returns the unavailable
 * page on every request — no blob deletion required.
 *
 * Reactivation is automatic: changing "Tile Status" back to "Active"
 * (or any value other than "Deactivated") immediately re-enables serving
 * because the status check runs fresh on every request.
 */

import { getRecord, getFieldValue, getAttachmentUrl } from '../lib/airtable.js';
import { createCandidateTileWebHtml } from '../lib/html-tile-web.js';
import { imageToBase64, guessMimeType } from '../lib/fetch-image.js';
import { log } from '../lib/logger.js';

const TABLE = process.env.AIRTABLE_TABLE_ID || 'Candidate Tile';
const TILE_ID_RE = /^rec[A-Za-z0-9]{14}$/;

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
  const { id: tileId } = req.query || {};

  if (!tileId || !TILE_ID_RE.test(tileId)) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send('<h1>Bad Request: missing or invalid id parameter</h1>');
  }

  log('request_received', { endpoint: 'tile-view', tileId });

  // ── Fetch Candidate Tile record from Airtable ────────────────────────────────
  let record;
  try {
    record = await getRecord(TABLE, tileId);
  } catch (err) {
    // Distinguish 404 (record not found) from transient Airtable failures.
    const isNotFound = err.message && (err.message.includes('NOT_FOUND') || err.message.includes('404') || err.message.includes('not found'));
    if (isNotFound) {
      log('error', { error: 'Candidate Tile record not found', tileId });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/html');
      return res.status(404).send(notFoundPage());
    }
    // Transient failure — do not expose internal details
    log('error', { error: err.message, tileId, stack: err.stack });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html');
    return res.status(503).send(temporarilyUnavailablePage());
  }

  const { fields } = record;

  // ── Check deactivation status ─────────────────────────────────────────────
  const tileStatus = getFieldValue(fields, 'Tile Status', '');
  if (tileStatus === 'Deactivated') {
    log('request_received', { endpoint: 'tile-view', tileId, status: 'deactivated' });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(unavailablePage());
  }

  // ── Extract content fields ────────────────────────────────────────────────
  const candidateName           = getFieldValue(fields, 'Candidate Name');
  const currentTitle            = getFieldValue(fields, 'Current Title');
  const currentCompany          = getFieldValue(fields, 'Current Company');
  const location                = getFieldValue(fields, 'Location');
  const education               = getFieldValue(fields, 'Education');
  const institution             = getFieldValue(fields, 'Institution');
  const email                   = getFieldValue(fields, 'Email');
  const linkedinUrl             = getFieldValue(fields, 'LinkedIn');
  const situation               = getFieldValue(fields, 'Situation');
  const relevantDomainExpertise = getFieldValue(fields, 'Relevant Domain Expertise');
  const reasonsToConsider       = getFieldValue(fields, 'Reasons to Consider');
  const cultureAdd              = getFieldValue(fields, 'Culture Add');
  const anticipatedConcerns     = getFieldValue(fields, 'Anticipated Concerns');
  const additionalInfo          = getFieldValue(fields, 'Additional Info');

  const photoUrl     = getAttachmentUrl(fields, 'Profile Pic');
  const hitchLogoUrl = process.env.HITCH_LOGO_URL || null;

  log('airtable_fetch_complete', { candidateName, tileId });

  // ── Pre-fetch images as base64 data URIs (non-fatal if unavailable) ───────
  const [photoDataUri, hitchLogoDataUri] = await Promise.all([
    photoUrl
      ? imageToBase64(photoUrl, guessMimeType(photoUrl)).catch(() => null)
      : Promise.resolve(null),
    hitchLogoUrl
      ? imageToBase64(hitchLogoUrl, 'image/png').catch(() => null)
      : Promise.resolve(null),
  ]);

  // ── Render HTML ───────────────────────────────────────────────────────────
  let htmlString;
  try {
    htmlString = createCandidateTileWebHtml({
      candidateName,
      currentTitle,
      currentCompany,
      location,
      education,
      institution,
      email,
      linkedinUrl,
      situation,
      relevantDomainExpertise,
      reasonsToConsider,
      cultureAdd,
      anticipatedConcerns,
      additionalInfo,
      photoDataUri,
      hitchLogoDataUri,
    });
  } catch (err) {
    log('error', { error: err.message, tileId, stack: err.stack });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html');
    return res.status(503).send(temporarilyUnavailablePage());
  }

  log('tile_html_rendered', { tileId, candidateName });

  // ── Return rendered HTML — never cached ───────────────────────────────────
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(htmlString);
}

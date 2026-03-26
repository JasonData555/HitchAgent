/**
 * POST /api/deactivate-tile
 *
 * Permanently deletes a Candidate Tile from Vercel Blob Storage, immediately
 * invalidating the URL. Called by an Airtable automation when a Program Manager
 * checks the "Deactivate Tile" checkbox on a Tiles record.
 *
 * Required header: x-api-key
 * Body: { "blobUrl": "https://..." }
 *
 * Response (always HTTP 200 so Airtable receives a parseable body):
 *   Success: { "success": true, "message": "Tile deactivated" }
 *   Failure: { "success": false, "error": "<description>" }
 *
 * Auth errors return HTTP 401. Missing/invalid body returns HTTP 400.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AIRTABLE AUTOMATION CONFIGURATION
 * ─────────────────────────────────────────────────────────────────────────────
 * Table:   Tiles
 * Trigger: "Deactivate Tile" checkbox field is checked
 *
 * Step 1 — Find record
 *   Find the Tiles record that triggered the automation.
 *
 * Step 2 — Retrieve tile URL
 *   Read the "tile_url" field value from that record.
 *
 * Step 3 — Guard: stop if no URL
 *   If "tile_url" is empty, stop the automation — there is nothing to delete.
 *
 * Step 4 — Call deactivate-tile endpoint
 *   Send an HTTP POST request to:
 *     https://<your-vercel-domain>/api/deactivate-tile
 *   Headers:
 *     Content-Type: application/json
 *     x-api-key: <INTERNAL_API_KEY>
 *   Body:
 *     { "blobUrl": "<tile_url field value>" }
 *
 * Step 5 — On success (response.success === true)
 *   Set "Tile Status" to "Deactivated" on the Tiles record.
 *   Do NOT clear or modify "tile_url" — preserve it for audit purposes.
 *
 * Step 6 — On failure (response.success === false)
 *   Write response.error to the "Tile Deactivation Log" field on the Tiles
 *   record so the Program Manager is aware the deactivation did not complete.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { timingSafeEqual } from 'crypto';
import { del } from '@vercel/blob';
import { assertSafeUrl } from '../lib/url-validate.js';
import { log } from '../lib/logger.js';

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
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!isValidApiKey(req.headers['x-api-key'], process.env.INTERNAL_API_KEY)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { blobUrl } = req.body || {};

  if (!blobUrl) {
    return res.status(400).json({ success: false, error: 'Missing required field: blobUrl' });
  }

  try {
    assertSafeUrl(blobUrl);
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }

  log('request_received', { endpoint: 'deactivate-tile', blobUrl });

  try {
    await del(blobUrl);
  } catch (err) {
    // del() is idempotent — it does not throw if the blob is already gone.
    // Any error here is unexpected (auth failure, network error, etc.).
    log('error', { error: err.message, blobUrl, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
    return res.status(200).json({ success: false, error: err.message });
  }

  log('blob_deleted', { blobUrl });

  return res.status(200).json({ success: true, message: 'Tile deactivated' });
}

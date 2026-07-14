/**
 * POST /api/deactivate-rubric
 *
 * Deactivates a Rubric document. Called by an Airtable automation when a
 * Program Manager checks the "Deactivate Rubric" checkbox on a Rubric record.
 *
 * Required header: x-api-key
 * Body: (none required — retained for backward compatibility with existing automations)
 *
 * Response (always HTTP 200 so Airtable receives a parseable body):
 *   Success: { "success": true, "message": "Rubric deactivated" }
 *
 * Auth errors return HTTP 401.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NEW ARCHITECTURE (permanent URL / server-side rendering)
 * ─────────────────────────────────────────────────────────────────────────────
 * Deactivation is now enforced by the "Rubric URL Status" field on the Rubric
 * record. The /api/rubric-view rendering endpoint checks this field on every
 * request and returns the unavailable page when it equals "Deactivated".
 *
 * Blob deletion is no longer required — there is no stored HTML blob to delete.
 * This endpoint now acts as a lightweight acknowledgment so the existing
 * Airtable automation continues to work without changes.
 *
 * The Airtable automation for deactivation can optionally be simplified:
 * the HTTP call to this endpoint can be removed, and the automation can set
 * "Rubric URL Status" to "Deactivated" directly. This endpoint is retained
 * for backward compatibility.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REACTIVATION
 * ─────────────────────────────────────────────────────────────────────────────
 * Reactivation requires no API call — simply change "Rubric URL Status" back
 * to "Active" in Airtable. The rendering endpoint will immediately serve
 * content again on the next request.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { timingSafeEqual } from 'crypto';
import { log } from '../logger.js';

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

  log('request_received', { endpoint: 'deactivate-rubric' });

  // Deactivation is now enforced by the Rubric URL Status field check in /api/rubric-view.
  // No blob deletion is required under the permanent URL architecture.
  return res.status(200).json({ success: true, message: 'Rubric deactivated' });
}

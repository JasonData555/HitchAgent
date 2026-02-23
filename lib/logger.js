/**
 * Structured JSON logger for Vercel serverless functions.
 * All output goes to stdout so Vercel captures it in function logs.
 *
 * Standard events:
 *   request_received, airtable_fetch_complete, pdf_parse_complete,
 *   pdf_parse_failed, claude_api_called, claude_api_complete,
 *   pptx_generated, blob_uploaded, airtable_updated, error
 */
export function log(event, data = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...data,
  }));
}

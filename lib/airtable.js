/**
 * Airtable REST API client.
 *
 * Implements:
 *   - getRecord(table, recordId)   — fetch a single record
 *   - updateRecord(table, recordId, fields) — patch a record
 *   - getFieldValue(fields, fieldName, defaultValue) — safely extract lookup values (arrays)
 *   - getAttachmentUrl(fields, fieldName)  — first attachment URL or null
 *
 * Rate limiting: Airtable allows 5 req/s per base.
 * Exponential backoff on 429: 1s → 2s → 4s → fail.
 */

const BASE_URL = () =>
  `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;

const headers = () => ({
  Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
  'Content-Type': 'application/json',
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Internal fetch wrapper with exponential backoff on 429 responses.
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<Response>}
 */
async function fetchWithBackoff(url, options) {
  const delays = [1000, 2000, 4000];
  let lastError;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(url, options);

    if (res.status === 429) {
      if (attempt < delays.length) {
        await sleep(delays[attempt]);
        lastError = new Error('Airtable rate limit exceeded');
        continue;
      }
      throw new Error('Airtable rate limit exceeded after 4 attempts');
    }

    return res;
  }

  throw lastError;
}

/**
 * Fetch a single Airtable record by ID.
 * @param {string} table - Table name (e.g. "Candidate Tile")
 * @param {string} recordId - Airtable record ID (e.g. "recXXXXXXXX")
 * @returns {Promise<{ id: string, fields: object, createdTime: string }>}
 */
export async function getRecord(table, recordId) {
  const url = `${BASE_URL()}/${encodeURIComponent(table)}/${recordId}`;
  const res = await fetchWithBackoff(url, { headers: headers() });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable getRecord failed (${res.status}): ${body}`);
  }

  return res.json();
}

/**
 * Update (PATCH) specific fields on a record.
 * @param {string} table
 * @param {string} recordId
 * @param {object} fields - Key/value pairs to update
 * @returns {Promise<{ id: string, fields: object, createdTime: string }>}
 */
export async function updateRecord(table, recordId, fields) {
  const url = `${BASE_URL()}/${encodeURIComponent(table)}/${recordId}`;
  const res = await fetchWithBackoff(url, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable updateRecord failed (${res.status}): ${body}`);
  }

  return res.json();
}

/**
 * Safely extract a value from an Airtable lookup field.
 * Lookup fields always return arrays; regular fields return scalars.
 * @param {object} fields - Record fields object
 * @param {string} fieldName
 * @param {string} defaultValue
 * @returns {string}
 */
export function getFieldValue(fields, fieldName, defaultValue = '') {
  const val = fields[fieldName];
  if (Array.isArray(val)) return val[0] ?? defaultValue;
  return val ?? defaultValue;
}

/**
 * Fetch all records matching an Airtable filterByFormula expression.
 * Paginates automatically using Airtable's offset cursor.
 *
 * The caller is responsible for sanitising any user-supplied values inside
 * the formula string (escape double-quotes and backslashes).
 *
 * @param {string} table - Table name or ID
 * @param {string} formula - Airtable filterByFormula string
 * @returns {Promise<Array<{ id: string, fields: object, createdTime: string }>>}
 */
export async function getRecordsByFormula(table, formula) {
  const baseUrl = `${BASE_URL()}/${encodeURIComponent(table)}`;
  const records = [];
  let offset;

  do {
    const params = new URLSearchParams({ filterByFormula: formula });
    if (offset) params.set('offset', offset);

    const res = await fetchWithBackoff(`${baseUrl}?${params.toString()}`, {
      headers: headers(),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable getRecordsByFormula failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return records;
}

/**
 * Get the URL of the first attachment in an attachment/lookup field.
 * @param {object} fields
 * @param {string} fieldName
 * @returns {string|null}
 */
export function getAttachmentUrl(fields, fieldName) {
  const attachments = fields[fieldName];
  // Attachment lookup fields return an array of arrays: [[{url, ...}], ...]
  // Direct attachment fields return an array of objects: [{url, ...}, ...]
  if (!Array.isArray(attachments) || attachments.length === 0) return null;

  const first = attachments[0];
  // Unwrap nested array (lookup of attachment)
  if (Array.isArray(first)) {
    return first[0]?.url ?? null;
  }
  // Direct attachment object
  return first?.url ?? null;
}

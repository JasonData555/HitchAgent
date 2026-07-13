/**
 * Apify + draft-flow diagnostic script.
 * Run: node test-apify-diag.mjs
 *
 * Tests:
 *  1. APIFY_API_TOKEN is readable from .env.local
 *  2. Direct Apify actor call with a known LinkedIn URL
 *  3. Full fetchLinkedInProfile() integration via lib/apify-linkedin.js
 *  4. Fetches a real Airtable record and reports LinkedIn URL + scrape-guard state
 */

import { readFileSync } from 'fs';

// ── Load .env.local ────────────────────────────────────────────────────────
const env = readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const clean = line.split('#')[0].trim();
  const match = clean.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/);
  if (match) process.env[match[1]] = match[2].trim();
}

const TOKEN       = process.env.APIFY_API_TOKEN;
const BASE_ID     = process.env.AIRTABLE_BASE_ID;
const TABLE_ID    = process.env.AIRTABLE_TABLE_ID || 'Candidate Tile';
const AT_KEY      = process.env.AIRTABLE_API_KEY;

// ── Change this to a "Not Started" candidate record you want to test ───────
const TEST_TILE_ID  = 'recWUlqAgB44c78I3';  // Philip Martin (Approved — for LinkedIn URL check only)
// Use a LinkedIn URL you know works for the raw actor test:
const TEST_LINKEDIN = 'https://www.linkedin.com/in/philip-martin/';

// ──────────────────────────────────────────────────────────────────────────
console.log('\n=== APIFY DIAGNOSTIC ===\n');

// 1. Token check
console.log(`[1] APIFY_API_TOKEN: ${TOKEN ? `✓ set (${TOKEN.slice(0, 18)}...)` : '✗ NOT SET'}`);
if (!TOKEN) {
  console.error('    Cannot proceed without token.');
  process.exit(1);
}

// 2. Airtable record — what LinkedIn URL and LinkedIn Scraped flag does it have?
console.log(`\n[2] Fetching Airtable record ${TEST_TILE_ID}...`);
try {
  const atRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_ID)}/${TEST_TILE_ID}`,
    { headers: { Authorization: `Bearer ${AT_KEY}` } }
  );
  const atJson = await atRes.json();
  if (!atRes.ok) {
    console.error(`    Airtable error ${atRes.status}:`, JSON.stringify(atJson));
  } else {
    const f = atJson.fields;
    const linkedIn = Array.isArray(f['LinkedIn']) ? f['LinkedIn'][0] : (f['LinkedIn'] || '');
    const scraped  = f['LinkedIn Scraped'];
    const status   = Array.isArray(f['Tile Draft Status']) ? f['Tile Draft Status'][0] : (f['Tile Draft Status'] || '');
    console.log(`    Candidate: ${Array.isArray(f['Candidate Name']) ? f['Candidate Name'][0] : f['Candidate Name']}`);
    console.log(`    LinkedIn URL: ${linkedIn || '(not set — Apify will be skipped)'}`);
    console.log(`    LinkedIn Scraped: ${scraped ?? '(field not present)'}`);
    console.log(`    Tile Draft Status: ${status}`);
    if (!linkedIn) {
      console.log('\n    ⚠  No LinkedIn URL on this record — Apify will not be called.');
      console.log('    To test Apify, add a LinkedIn URL to this record or edit TEST_LINKEDIN below.');
    }
  }
} catch (err) {
  console.error('    Airtable fetch failed:', err.message);
}

// 3. Raw Apify actor call (direct HTTP, bypasses lib/apify-linkedin.js)
console.log(`\n[3] Raw Apify actor call for: ${TEST_LINKEDIN}`);
const ACTOR         = 'harvestapi~linkedin-profile-scraper';
const APIFY_TIMEOUT = 25;
const CLIENT_ABORT  = 30000;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), CLIENT_ABORT);
const t0 = Date.now();

try {
  const endpoint =
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(TOKEN)}&timeout=${APIFY_TIMEOUT}`;

  console.log(`    POST ${endpoint.replace(TOKEN, '<token>')}`);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profileScraperMode: 'Profile details no email ($4 per 1k)',
      queries: [TEST_LINKEDIN],
    }),
    signal: controller.signal,
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`    Response: HTTP ${res.status} (${elapsed}s)`);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`    Actor error body: ${body.slice(0, 600)}`);
  } else {
    let items;
    try {
      items = await res.json();
    } catch (e) {
      console.error('    Failed to parse JSON response:', e.message);
      items = null;
    }
    if (!Array.isArray(items) || items.length === 0) {
      console.warn('    ⚠  Empty dataset returned — actor ran but found no results.');
      console.warn('    Possible causes: LinkedIn URL invalid, anti-scrape block, or timeout too short.');
    } else {
      const p = items[0];
      console.log(`    ✓ Got ${items.length} item(s). Sample:`);
      console.log(`      headline : ${p.headline ?? p.title ?? '(none)'}`);
      console.log(`      positions: ${(p.positions ?? p.experience ?? []).length} entries`);
      console.log(`      skills   : ${(p.skills ?? []).length} entries`);
    }
  }
} catch (err) {
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const isTimeout = err.name === 'AbortError' || err.message?.includes('timeout');
  console.error(`    ✗ ${isTimeout ? 'TIMEOUT' : 'NETWORK ERROR'} after ${elapsed}s: ${err.message}`);
} finally {
  clearTimeout(timer);
}

// 4. Full lib/apify-linkedin.js integration test
console.log(`\n[4] fetchLinkedInProfile() integration test for: ${TEST_LINKEDIN}`);
try {
  const { fetchLinkedInProfile } = await import('./lib/apify-linkedin.js');
  const t1 = Date.now();
  const result = await fetchLinkedInProfile(TEST_LINKEDIN, 'diagnostic-run');
  const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
  if (result) {
    console.log(`    ✓ Got ${result.length} chars in ${elapsed}s`);
    console.log('    First 200 chars:', result.slice(0, 200));
  } else {
    console.warn(`    ⚠  Returned empty string after ${elapsed}s — fallback triggered`);
  }
} catch (err) {
  console.error('    ✗ Unexpected error from fetchLinkedInProfile:', err.message);
}

console.log('\n=== DONE ===\n');

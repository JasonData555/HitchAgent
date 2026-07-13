/**
 * Quick local test for createCandidateTilePresentation.
 * Fetches the Philip Martin Approved record from Airtable and writes the PPTX locally.
 * Run: node test-pptx.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { createCandidateTilePresentation } from './lib/pptx-tile.js';

// ── Load .env.local ────────────────────────────────────────────────────────
const env = readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const clean = line.split('#')[0].trim();
  const match = clean.match(/^([A-Z_]+)=(.+)$/);
  if (match) process.env[match[1]] = match[2].trim();
}

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_TABLE_ID;
const HITCH_LOGO_URL = process.env.HITCH_LOGO_URL;
const TILE_ID = 'recWUlqAgB44c78I3'; // Philip Martin — Approved

// ── Fetch Airtable record ──────────────────────────────────────────────────
console.log(`Fetching record ${TILE_ID}...`);
const res = await fetch(
  `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${TILE_ID}`,
  { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
);
const record = await res.json();
const f = record.fields;

function fv(fields, name, fallback = '') {
  return fields[name] ?? fallback;
}
function attachmentUrl(fields, name) {
  const att = fields[name];
  return Array.isArray(att) && att.length > 0 ? att[0].url : null;
}

const data = {
  candidateName:      fv(f, 'Candidate Name'),
  currentTitle:       fv(f, 'Current Title'),
  currentCompany:     fv(f, 'Current Company'),
  location:           fv(f, 'Location'),
  education:          fv(f, 'Education'),
  email:              fv(f, 'Email'),
  phone:              fv(f, 'Phone'),
  relevantExperience: fv(f, 'Relevant Security Experience'),
  currentSituation:   fv(f, 'Current Situation'),
  anticipatedConcerns:fv(f, 'Anticipated Concerns'),
  roleTitle:          fv(f, 'Role Title'),
  clientName:         fv(f, 'Client'),
  photoUrl:           attachmentUrl(f, 'Profile Pic'),
  hitchLogoUrl:       HITCH_LOGO_URL,
};

console.log(`Candidate: ${data.candidateName}`);
console.log(`Role: ${data.roleTitle} | ${data.clientName}`);
console.log(`Photo URL: ${data.photoUrl || '(none)'}`);

// ── Generate PPTX ──────────────────────────────────────────────────────────
console.log('Generating PPTX...');
const pptxBuffer = await createCandidateTilePresentation(data);

const outPath = '/tmp/test-tile-output.pptx';
writeFileSync(outPath, pptxBuffer);
console.log(`\nSuccess! PPTX written to: ${outPath}`);
console.log(`File size: ${(pptxBuffer.length / 1024).toFixed(1)} KB`);
console.log('\nOpen with: open /tmp/test-tile-output.pptx');

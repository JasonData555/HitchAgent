# Hitch Talent Agent — CLAUDE.md

Internal tool for Hitch Partners. Generates branded candidate tile PowerPoint decks from Airtable data using Claude AI.

---

## Project Structure

```
api/
  generate-tile-draft.js   POST /api/generate-tile-draft  — Claude synthesis → Airtable
  generate-tile-pptx.js    POST /api/generate-tile-pptx   — PPTX generation → Vercel Blob → Airtable
lib/
  airtable.js              Airtable REST client (getRecord, updateRecord, getFieldValue, getAttachmentUrl)
  anthropic.js             Claude wrapper — builds prompt, calls API, parses JSON response
  pdf-extract.js           Downloads a PDF URL and extracts text (pdf-parse)
  pptx-tile.js             Builds the one-slide PowerPoint (pptxgenjs)
  url-validate.js          SSRF guard — assertSafeUrl() allowlist validator
  logger.js                Structured JSON logger (stdout → Vercel function logs)
dev-server.mjs             Local dev HTTP server (no Vercel CLI needed)
vercel.json                maxDuration: 60s for all api/*.js functions
```

---

## Runtime & Dependencies

- **Node.js 20.x**, **ES modules** (`"type": "module"` in package.json)
- **Vercel** serverless functions (v2 runtime)
- `@anthropic-ai/sdk ^0.20.0` — Claude API
- `@vercel/blob ^0.22.0` — PPTX file storage
- `pdf-parse ^1.1.1` — resume text extraction (CommonJS; dynamic-imported in ESM via `pdf-parse/lib/pdf-parse.js`)
- `pptxgenjs ^3.12.0` — PowerPoint generation
- `node-fetch ^3.3.2`

---

## Environment Variables

| Variable | Description |
|---|---|
| `AIRTABLE_API_KEY` | Personal Access Token (scopes: `data.records:read`, `data.records:write`, `schema.bases:read`) |
| `AIRTABLE_BASE_ID` | Base ID from Airtable URL (e.g. `appXXXXXXXX`) |
| `AIRTABLE_TABLE_ID` | Table name or ID; falls back to `"Candidate Tile"` if unset |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token (auto-injected when Blob store is linked) |
| `INTERNAL_API_KEY` | Shared secret; must match the `x-api-key` header sent by Airtable automations |
| `HITCH_LOGO_URL` | Public HTTPS URL for the Hitch Partners logo PNG |

---

## Airtable Schema — "Candidate Tile" Table

Fields read by the app (lookup fields return arrays; `getFieldValue` unwraps them):

| Field | Type | Used by |
|---|---|---|
| `Candidate Name` | Lookup (Person) | Both endpoints |
| `Current Title` | Lookup (Person) | Both endpoints |
| `Current Company` | Lookup (Person) | Both endpoints |
| `Location` | Lookup (Person) | PPTX endpoint |
| `Education` | Lookup (Person) | PPTX endpoint |
| `Email` | Lookup (Person) | PPTX endpoint |
| `LinkedIn` | Lookup (Person → LinkedIn URL) | PPTX endpoint |
| `Profile Pic` | Attachment lookup (Person) | PPTX endpoint |
| `Resume` | Attachment | Draft endpoint |
| `Notes` | Long text | Draft endpoint |
| `Role Title` | Text | Draft endpoint (Claude context) |
| `Client` | Text | Draft endpoint (Claude context) |
| `Tile Draft Status` | Single select | Both endpoints (read + write) |

Fields **written** by the app:

| Field | Written by |
|---|---|
| `Situation` | Draft endpoint (Claude output) |
| `Relevant Domain Expertise` | Draft endpoint (Claude output) |
| `Reasons to Consider` | Draft endpoint (Claude output) |
| `Culture Add` | Draft endpoint (Claude output) |
| `Anticipated Concerns` | Draft endpoint (Claude output) |
| `Tile Draft Status` | Draft endpoint (`Draft Ready` / `Draft Error`) |
| `Candidate Tile PowerPoint` | PPTX endpoint (attachment URL array) |

**Airtable schema prerequisites** (must be configured in Airtable UI before deploying):
- Rename `Current Situation` → `Situation` in Candidate Tile table
- Add `Relevant Domain Expertise` (Long text) to Candidate Tile table
- Add `Culture Add` (Long text) to Candidate Tile table
- Verify/add `Reasons to Consider` (Long text) to Candidate Tile table
- Add `LinkedIn` (URL) to People table; add Lookup to Candidate Tile table

**Tile Draft Status lifecycle:** `Not Started` → `Draft Ready` → `Approved` (PM approves in Airtable) → PPTX generated.

---

## API Endpoints

Both endpoints require:
- Method: `POST`
- Header: `x-api-key: <INTERNAL_API_KEY>` (constant-time comparison via `timingSafeEqual`)
- Body: `{ "tileId": "recXXXXXXXXXXXXXX" }` (validated against `/^rec[A-Za-z0-9]{14}$/`)

### POST /api/generate-tile-draft

1. Fetches the Candidate Tile record from Airtable
2. Validates status is not `Approved` (prevents overwriting)
3. Downloads and parses the resume PDF (truncated to 8,000 chars)
4. Calls Claude (`claude-haiku-4-5-20251001`, max 2,000 tokens) to generate five content sections
5. Writes `Situation`, `Relevant Domain Expertise`, `Reasons to Consider`, `Culture Add`, `Anticipated Concerns`, and `Tile Draft Status: Draft Ready` back to Airtable
6. Returns `{ status, message, data: { tileId, candidateName }, warnings }`

Resume parse failures are non-fatal — draft is still generated with a warning in the response.

### POST /api/generate-tile-pptx

1. Fetches the Candidate Tile record
2. Validates `Tile Draft Status === 'Approved'`
3. Downloads logo + profile photo as base64 in parallel (10s timeout each; SSRF-guarded)
4. Builds a one-slide PPTX (16:9, 13.333" × 7.5") via pptxgenjs
5. Uploads to Vercel Blob (`tiles/<uuid>.pptx`, public access)
6. Updates Airtable `Candidate Tile PowerPoint` attachment field with the blob URL
7. Returns `{ status, message, data: { tileId, candidateName, pptxUrl }, warnings }`

---

## Claude Integration

**Model:** `claude-haiku-4-5-20251001`
**Max tokens:** 2,000
**Retry:** Once on timeout or HTTP 5xx.

**Security in prompts:**
- Short fields (`name`, `title`, `company`, `notes`, `roleTitle`, `clientName`) are sanitized with `sanitizeField()` — strips `\r\n\t` and control characters
- Long-form content (`resumeText`, `notes`) is escaped with `escapeXmlClose()` to prevent XML tag breakout
- All user data is wrapped in XML delimiters and the system prompt explicitly labels them as untrusted data

**Response format:** JSON with keys `situation`, `relevantDomainExpertise`, `reasonsToConsider`, `cultureAdd`, `anticipatedConcerns` (all strings). Markdown code fences are stripped before parsing.

---

## PPTX Layout

One slide, 16:9 (13.333" × 7.5"), white background, Calibri font throughout.

**Color palette:**
- `NAVY #1B365D` — headings, candidate name
- `SLATE #64748B` — body text, contact info
- `ACCENT #0EA5E9` — accent line, footer bar, company names in expertise section
- `GRAY #D4D4D8` — photo placeholder fill
- `WHITE #FFFFFF` — slide background, footer text

**Header (y: 0.2"–0.7"):**
- Candidate name (28pt bold, Navy) at x:0.4, y:0.25
- Current title | company (18pt, Slate) at x:3.5, y:0.35
- Hitch logo top-right at x:11.5, y:0.2 (max-width 1.5")
- Blue accent line (full width, 3pt) at y:0.7

**Left column (x=0.4, w=3.2"):**
- Photo 2"×2" at y:0.9 (or gray placeholder)
- LinkedIn Bio hyperlink (11pt, ACCENT, underlined) at y:3.0 — omitted if no URL
- SITUATION header + body at y:3.4 / y:3.6
- CONTACT INFO header + email at y:4.4 / y:4.6
- Location: {city, state} at y:5.0
- EDUCATION header + content at y:5.4 / y:5.6

**Right column (x=3.8, w=9.0"):**
- RELEVANT DOMAIN EXPERTISE (12pt bold) at y:0.9; content at y:1.15 with blue/bold company headers
- REASONS TO CONSIDER (10pt bold) at y:5.0; bullet content at y:5.2
- CULTURE ADD: {val} (inline bold label + regular value) at y:5.8
- ANTICIPATED CONCERNS: {val} (inline bold label + regular value) at y:6.1

**Footer (y: 7.1"–7.45"):**
- Blue bar (full width, ACCENT)
- "Hitch Partners <> Confidential & Proprietary" — 10pt, white, italic, centered

---

## Security

- **Authentication:** `x-api-key` header, constant-time comparison (`crypto.timingSafeEqual`)
- **SSRF protection:** `assertSafeUrl()` enforces HTTPS and an allowlist of permitted hosts:
  - `airtable.com`, `airtableusercontent.com` (Airtable API and CDN)
  - `raw.githubusercontent.com` (Hitch logo)
  - `blob.vercel-storage.com` (Vercel Blob)
- **Prompt injection:** XML delimiters, field sanitization, explicit untrusted-data labeling
- **Input validation:** tileId regex, method check, body presence check
- **Error responses:** Production stack traces suppressed (`NODE_ENV !== 'production'`)
- **PDF size limit:** 25 MB max before buffering

---

## Local Development

```bash
node dev-server.mjs
```

Loads `.env.local`, serves both endpoints at `http://localhost:3000`. No Vercel CLI required.

**Test draft generation:**
```bash
curl -X POST http://localhost:3000/api/generate-tile-draft \
  -H "Content-Type: application/json" \
  -H "x-api-key: <INTERNAL_API_KEY>" \
  -d '{"tileId": "recXXXXXXXXXXXXXX"}'
```

**Test PPTX generation** (tile must be `Approved` first):
```bash
curl -X POST http://localhost:3000/api/generate-tile-pptx \
  -H "Content-Type: application/json" \
  -H "x-api-key: <INTERNAL_API_KEY>" \
  -d '{"tileId": "recXXXXXXXXXXXXXX"}'
```

---

## Deployment

```bash
vercel deploy          # preview
vercel deploy --prod   # production
```

Vercel Blob store must be linked to the project (auto-injects `BLOB_READ_WRITE_TOKEN`).

---

## Logging

`lib/logger.js` emits structured JSON to stdout (captured by Vercel function logs).

Standard event names: `request_received`, `airtable_fetch_complete`, `pdf_parse_complete`, `pdf_parse_failed`, `claude_api_called`, `claude_api_complete`, `pptx_generated`, `blob_uploaded`, `airtable_updated`, `error`.

---

## Airtable Rate Limits

The `airtable.js` client retries on HTTP 429 with exponential backoff: 1s → 2s → 4s → fail (4 attempts total).

---

## Error Reference

| Scenario | HTTP | Message |
|---|---|---|
| Wrong/missing API key | 401 | Unauthorized |
| Invalid tileId format | 400 | Invalid tileId format |
| Tile not found | 404 | Candidate Tile not found |
| No linked Person (no Candidate Name) | 400 | Candidate Tile must be linked to a Person record |
| Status = Approved (draft endpoint) | 400 | Cannot overwrite approved content... |
| Status ≠ Approved (PPTX endpoint) | 400 | Cannot generate PowerPoint: draft status is '...' |
| Claude API failure | 500 | Content synthesis failed |
| PPTX generation failure | 500 | PPTX generation failed |
| Blob upload failure | 500 | Failed to upload PPTX to storage |
| Airtable save failure | 500 | Failed to save draft / PPTX generated but failed to save to Airtable |
| Resume parse failure | 200 + warning | Draft still generated; warning in response |

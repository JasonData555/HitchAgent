# Hitch Talent Agent — CLAUDE.md

Internal tool for Hitch Partners. Generates branded candidate tile documents (PowerPoint and PDF) from Airtable data using Claude AI.

---

## Project Structure

```
api/
  generate-tile-draft.js   POST /api/generate-tile-draft   — Claude synthesis → Airtable
  generate-tile-pptx.js    POST /api/generate-tile-pptx    — PPTX generation → Vercel Blob → Airtable
  generate-tile-pdf.js     POST /api/generate-tile-pdf     — PDF generation → Vercel Blob → Airtable
  generate-rubric-draft.js POST /api/generate-rubric-draft — Rubric matrix + conflict narrative → Airtable
  generate-rubric-pdf.js   POST /api/generate-rubric-pdf   — Rubric PDF → Vercel Blob → Airtable
lib/
  airtable.js              Airtable REST client (getRecord, updateRecord, getFieldValue, getAttachmentUrl, getRecordsByFormula)
  anthropic.js             Claude wrapper — builds prompt, calls API, parses JSON response; also generateRubricNarrative()
  fetch-image.js           Shared SSRF-guarded image fetcher (imageToBase64, guessMimeType)
  html-tile.js             Builds the HTML/CSS candidate tile document (for PDF rendering)
  pdf-extract.js           Downloads a PDF URL and extracts text (pdf-parse)
  pdf-render.js            Puppeteer wrapper — renders HTML string → PDF buffer; accepts { landscape, bottomMargin } options
  pdf-rubric.js            Builds the HTML/CSS rubric alignment document (for PDF rendering)
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
- `@sparticuz/chromium ^143.0.0` — pre-compiled Chromium for Lambda/Vercel (PDF generation)
- `@vercel/blob ^0.22.0` — file storage (PPTX and PDF)
- `pdf-parse ^1.1.1` — resume text extraction (CommonJS; dynamic-imported in ESM via `pdf-parse/lib/pdf-parse.js`)
- `pptxgenjs ^3.12.0` — PowerPoint generation
- `puppeteer-core ^24.0.0` — headless Chrome for HTML→PDF rendering
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
| `CHROME_EXECUTABLE_PATH` | **Local dev only** — path to local Chrome binary (e.g. `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`). Omit in production; Vercel uses `@sparticuz/chromium`. |
| `RUBRIC_TABLE_ID` | Airtable table name or ID for the Rubric table; falls back to `"Rubric"` if unset |
| `ITI_TABLE_ID` | Airtable table name or ID for the ITI Input table; falls back to `"ITI Input"` if unset |

---

## Airtable Schema — "Candidate Tile" Table

Fields read by the app (lookup fields return arrays; `getFieldValue` unwraps them):

| Field | Type | Used by |
|---|---|---|
| `Candidate Name` | Lookup (Person) | All endpoints |
| `Current Title` | Lookup (Person) | All endpoints |
| `Current Company` | Lookup (Person) | All endpoints |
| `Location` | Lookup (Person) | PPTX + PDF endpoints |
| `Education` | Lookup (Person) | PPTX + PDF endpoints |
| `Email` | Lookup (Person) | PPTX + PDF endpoints |
| `LinkedIn` | Lookup (Person → LinkedIn URL) | PPTX + PDF endpoints |
| `Profile Pic` | Attachment lookup (Person) | PPTX + PDF endpoints |
| `Resume` | Attachment | Draft endpoint |
| `Notes` | Long text | Draft endpoint |
| `Role Title` | Text | Draft endpoint (Claude context) |
| `Client` | Text | Draft endpoint (Claude context) |
| `Tile Draft Status` | Single select | All endpoints (read + write) |

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
| `Candidate Tile PDF` | PDF endpoint (attachment URL array) |

**Airtable schema prerequisites** (must be configured in Airtable UI before deploying):
- Rename `Current Situation` → `Situation` in Candidate Tile table
- Add `Relevant Domain Expertise` (Long text) to Candidate Tile table
- Add `Culture Add` (Long text) to Candidate Tile table
- Verify/add `Reasons to Consider` (Long text) to Candidate Tile table
- Add `LinkedIn` (URL) to People table; add Lookup to Candidate Tile table
- Add `Candidate Tile PDF` (Attachment) to Candidate Tile table

**Tile Draft Status lifecycle:** `Not Started` → `Draft Ready` → `Approved` (PM approves in Airtable) → PPTX and/or PDF generated.

---

## Airtable Schema — "Rubric" Table

Fields read by the rubric endpoints:

| Field | Type | Used by |
|---|---|---|
| `client_name` | Text | Draft + PDF endpoints |
| `Search` | Text | Draft endpoint (links to ITI Input records) |
| `Rubric Matrix JSON` | Long text | PDF endpoint (parsed from draft output) |
| `Rubric Draft Status` | Single select | Both endpoints (read + write) |

Fields **written** by the rubric endpoints:

| Field | Written by |
|---|---|
| `Rubric Matrix JSON` | Draft endpoint (nested JSON: active domains, panel members, scores, conflicts) |
| `Conflict Narrative` | Draft endpoint (Claude-generated 2–3 sentence summary) |
| `Rubric Draft Status` | Draft endpoint (`Draft Ready` / `Draft Error`) |
| `Rubric PDF` | PDF endpoint (attachment URL array) |

**Rubric Draft Status lifecycle:** `Not Started` → `Draft Ready` → `Approved` (PM approves in Airtable) → PDF generated.

---

## Airtable Schema — "ITI Input" Table

Fields read by the rubric draft endpoint (fetched via `filterByFormula` matching the Rubric's `Search` field):

| Field | Type | Notes |
|---|---|---|
| `search_project` | Text | Used as link key to the parent Rubric record |
| `panel_member` | Text | Panel member full name |
| `panel_member_title` | Text | Panel member job title |
| `Reports To` | Text | Used as role label in narrative (e.g., "the CEO") |
| `Notes` | Long text | Optional panel member notes fed to Claude |
| `Manage IT` | Number/Text | Domain score |
| `ProdSec_AppSec` | Number/Text | Domain score |
| `GRC` | Number/Text | Domain score |
| `Security Architecture` | Number/Text | Domain score |
| `Network and Infrastructure Security` | Number/Text | Domain score |
| `TPRM` | Number/Text | Domain score |
| `Data Protection and Privacy` | Number/Text | Domain score |
| `IAM` | Number/Text | Domain score |
| `Cloud Security` | Number/Text | Domain score |
| `Security Operations` | Number/Text | Domain score |
| `External Communication` | Number/Text | Domain score |
| `Location` | Text | Panel member location (displayed in top data block of rubric PDF) |

Scores are numeric 1–5 (or text labels: "Must have"=5, "Important to have"=4, "Nice to have"=3, "Low Priority"=2, "Not important to have"=1, or N/A). A domain is a **conflict** when ≥2 panel members scored it and the spread (max − min) is ≥ 2.

---

## API Endpoints

All endpoints require:
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

### POST /api/generate-tile-pdf

1. Fetches the Candidate Tile record
2. Validates `Tile Draft Status === 'Approved'`
3. Downloads logo + profile photo as base64 in parallel (10s timeout each; SSRF-guarded)
4. Generates a complete HTML document via `lib/html-tile.js` (inline CSS, flexbox layout, data URI images)
5. Renders HTML → PDF buffer via Puppeteer (`lib/pdf-render.js`) — Letter landscape, 0.5in margins
6. Uploads to Vercel Blob (`tiles/<uuid>.pdf`, public access)
7. Updates Airtable `Candidate Tile PDF` attachment field with the blob URL
8. Returns `{ status, message, data: { tileId, candidateName, pdfUrl }, warnings }`

The PPTX and PDF endpoints are independent — either or both can be triggered for any Approved tile.

### POST /api/generate-rubric-draft

1. Fetches the Rubric record from Airtable
2. Validates status is not `Approved` (prevents overwriting)
3. Fetches all linked ITI Input records via formula query: `{search_project} = "<searchName>"`; requires ≥ 2 panel members
4. Parses scores for all 12 security leadership domains per panel member
5. Identifies conflicts: domains where ≥ 2 panel members scored it and max − min spread ≥ 2
6. Calls Claude (`claude-sonnet-4-6`, max 800 tokens) to generate a 3–5 sentence senior-recruiter conflict narrative (names interviewers for disagreements, surfaces note themes, flags score/commentary tension)
7. Writes `Rubric Matrix JSON`, `Conflict Narrative`, and `Rubric Draft Status: Draft Ready` back to Airtable
8. Returns `{ status, message, data: { rubricId, clientName, panelMemberCount, domainsIncluded, conflictsFound }, warnings }`

### POST /api/generate-rubric-pdf

1. Fetches the Rubric record from Airtable
2. Validates `Rubric Draft Status === 'Approved'`
3. Parses `Rubric Matrix JSON` (must be valid JSON)
4. Downloads Hitch logo + optional client logo as base64 in parallel (10s timeout each; SSRF-guarded); missing logos fall back silently to text labels
5. Generates HTML document via `lib/pdf-rubric.js` (inline CSS, dynamic column/font sizing, data URI images, conflict indicators)
6. Renders HTML → PDF buffer via Puppeteer (`lib/pdf-render.js`) — Letter landscape, 0.5in top/sides, 0.1in bottom margin
7. Uploads to Vercel Blob (`rubrics/<rubricId>-<timestamp>.pdf`, public access)
8. Updates Airtable `Rubric PDF` attachment field with the blob URL
9. Returns `{ status, message, data: { rubricId, clientName, pdfUrl }, warnings }`

---

## Claude Integration

**Model:** `claude-haiku-4-5-20251001`
**Max tokens:** 2,000
**Retry:** Once on timeout or HTTP 5xx.

**Security in prompts:**
- Short fields (`name`, `title`, `company`, `notes`, `roleTitle`, `clientName`) are sanitized with `sanitizeField()` — strips `\r\n\t` and control characters
- Long-form content (`resumeText`, `notes`) is escaped with `escapeXmlClose()` to prevent XML tag breakout
- All user data is wrapped in XML delimiters and the system prompt explicitly labels them as untrusted data

**Response format (tile draft):** JSON with keys `situation`, `relevantDomainExpertise`, `reasonsToConsider`, `cultureAdd`, `anticipatedConcerns` (all strings). Markdown code fences are stripped before parsing.

**Rubric narrative generation:** Separate `generateRubricNarrative()` export in `lib/anthropic.js`. Uses `claude-sonnet-4-6`, max 800 tokens. Calls `callClaudeForText()` (plain-text, no JSON). Returns a 3–5 sentence paragraph. Prompt instructions:
- Write for a **senior recruiter** audience preparing for a client debrief
- Describe where interviewers were in strong alignment (scores + note themes)
- Name interviewers when describing meaningful disagreement or specific perspectives
- Surface themes appearing across multiple interviewers' notes
- Flag tension between high scores and qualifying commentary
- Notes passed to Claude are attributed per interviewer (`Name:\nnotes`)

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

## PDF Layout

Letter landscape (11" × 8.5"), 0.5in margins, Arial/Helvetica font throughout. Generated by Puppeteer (`puppeteer-core` + `@sparticuz/chromium`).

**Key implementation details (`lib/pdf-render.js`):**
- `renderHtmlToPdf(htmlString, { landscape = false, bottomMargin = '0.5in' } = {})` — `bottomMargin` defaults to `'0.5in'`; rubric passes `'0.1in'`
- `page.emulateMediaType('print')` called before `setContent()` so `@media print` rules apply during layout (prevents `min-height: 100vh` inflation)
- Puppeteer `defaultViewport`: landscape → `{ width: 1056, height: 816 }`, portrait → `{ width: 816, height: 1056 }` (Letter at 96dpi)
- All images (photo, logo) embedded as base64 data URIs — no external network requests from Chromium
- Request interception blocks all non-`data:` URLs for security isolation
- Local dev: `CHROME_EXECUTABLE_PATH` env var points to system Chrome; uses `LOCAL_CHROME_ARGS` (no Lambda flags)
- Production: `@sparticuz/chromium` provides the binary and args
- **Fixed positioning note:** `position: fixed; bottom: Xpx` in Puppeteer print mode is relative to the content area (physical height − top margin − bottom margin), not the full viewport. This matters for footer placement calculations.

**Color palette** (matches PPTX):
- `NAVY #1B365D` — headings, candidate name, footer background
- `SLATE #64748B` — body text, contact info
- `ACCENT #0EA5E9` — header divider line
- `WHITE #FFFFFF` — background, footer text

**Structure** (flexbox, no fixed heights):
```
.page-wrapper  (flex column)
  .header      (54px, flex row: name | title/company | logo)
  .body        (flex row, flex:1)
    .sidebar   (260px fixed width: photo, LinkedIn, Situation, Contact Info, Education)
    .main      (flex:1: Domain Expertise, Reasons to Consider, Culture Add, Anticipated Concerns)
  .footer      (30px, position:fixed in print, navy bar + italic text)
```

**Typography:** 11px body, 1.35 line-height, 10px section labels (uppercase, letter-spaced), 21px candidate name in header.

**Domain Expertise rendering (`expertiseToHtml()`):** Company header lines (e.g. `Coinbase (2016 - present): ...`) render bold navy. Claude emits `Role:`, `Scope:`, `Accomplishments:` as bullet lines (`• Role: ...`); the parser detects these inside the bullet branch (after stripping the bullet prefix) and renders them as `<p><strong>Label:</strong> rest</p>`. Accomplishment bullets (`○ ...`) following an `Accomplishments:` label get class `accomplishments-list` for deeper indent (28px vs 16px).

**Culture Add** renders inline (label + value on same line) via `.inline-section.inline-row` flex modifier. **Anticipated Concerns** renders as a bulleted list (semicolon-delimited items → `<ul class="concerns-list"><li>`).

**Print CSS:** `@page { size: Letter landscape; margin: 0.5in; }`. Footer uses `position: fixed; bottom: 10px` to pin to page bottom. Columns have `padding-bottom: 46px` to prevent content rendering behind the fixed footer.

---

## Rubric PDF Layout

Letter **landscape** (11" × 8.5"), 0.5in top/sides + 0.1in bottom margin. Generated by Puppeteer. Defined in `lib/pdf-rubric.js`. Calls `renderHtmlToPdf(html, { landscape: true, bottomMargin: '0.1in' })`.

**Color palette** (matches Candidate Tile):
- `NAVY #1B365D` — headings, domain names, table headers
- `SLATE #64748B` — body text, narrative
- `ACCENT #0EA5E9` — header divider line, footer bar
- `WHITE #FFFFFF` — background, footer text
- `RED #DC2626` — conflict indicator circle ("!")
- Score cells: teal/cyan/gray/red gradient (5 = Must Have → 1 = Not Important)

**Dynamic sizing** based on panel member count (n):

| n | Header font | Score font | Title font | Domain col (left) |
|---|---|---|---|---|
| ≤ 3 | 11px | 10px | 9px | 150px |
| 4 | 10px | 9px | 8px | 150px |
| ≥ 5 | 9px | 8px | 7.5px | 130px |

**HTML structure (landscape two-column):**
```
Section A: .header        (flex row: Hitch logo | "Role Requirements Alignment" | client logo)
           .accent-line   (3px blue)
Section B: .top-data-table (full width, 960px)
             - Panel member columns (B_LABEL_W=180px, B_PANEL_W=floor((960-180)/n))
             - Context rows: Position reports to, Current team size,
               Est. team size in 18 months, Location
Section C: .two-col        (flex row, gap 10px)
  .col-left  (62%, ~595px):
    .matrix-table  (DOMAIN_W + n×PANEL_W + CONFLICT_W=30px)
    .legend        (conflict icon note + score color key)
  .col-right (38%):
    .priority-section × 3 (Must Have avg≥4.0 / Nice to Have 3.0–3.9 / Not Important <3.0)
      - Domains sorted descending by average score within each tier
Section D: .divider + .summary-title "CONFLICT NARRATIVE" + .narrative
Footer:    position:fixed; bottom:10px; height:26px; blue ACCENT bar
```

**Column width formulas:**
- Section B: `B_LABEL_W=180`, `B_PANEL_W=floor((960-180)/n)`
- Section C left (595px): `DOMAIN_W=n>=5?130:150`, `CONFLICT_W=30`, `PANEL_W=floor((595-DOMAIN_W-30)/n)`

**Footer positioning:** `position: fixed; bottom: 10px` is content-area-relative. With 0.1in bottom margin, content area = 758px; footer sits at y: 722–748px. `padding-bottom: 36px` on `.page-wrapper` ensures content ends at 722px (no overlap). White space below footer ≈ 10px (the bottom margin).

**Key implementation details:**
- `parseScoreNum()` handles both numeric strings ("5 - Must have") and plain text labels via `TEXT_SCORE_MAP`
- `calcDomainAverages()` drives the priority section tiers
- `Rubric Matrix JSON` structure: `{ activeDomains, panelMembers[{name,title,reportsTo,teamSizeToday,teamSize18Months,location,scores}], contextRows, conflicts }`
- Panel member column headers use "First L." format
- Logos embedded as base64; missing logos fall back to text labels (soft failure)
- Same Puppeteer request-interception security model as Candidate Tile PDF

---

## Security

- **Authentication:** `x-api-key` header, constant-time comparison (`crypto.timingSafeEqual`)
- **SSRF protection:** `assertSafeUrl()` enforces HTTPS and an allowlist of permitted hosts:
  - `airtable.com`, `airtableusercontent.com` (Airtable API and CDN)
  - `raw.githubusercontent.com` (Hitch logo)
  - `blob.vercel-storage.com` (Vercel Blob)
- **Prompt injection:** XML delimiters, field sanitization, explicit untrusted-data labeling
- **HTML injection / XSS:** `escapeHtml()` applied to all Airtable field values before insertion into the HTML template in `lib/html-tile.js`
- **Puppeteer network isolation:** Request interception blocks all external URLs; only `data:` URIs and `about:blank` pass through
- **Input validation:** tileId regex, method check, body presence check
- **Error responses:** Production stack traces suppressed (`NODE_ENV !== 'production'`)
- **PDF size limit:** 25 MB max before buffering

---

## Local Development

```bash
node dev-server.mjs
```

Loads `.env.local`, serves all five endpoints at `http://localhost:3000`. No Vercel CLI required.

**Required `.env.local` entry for PDF generation:**
```
CHROME_EXECUTABLE_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

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

**Test PDF generation** (tile must be `Approved` first):
```bash
curl -X POST http://localhost:3000/api/generate-tile-pdf \
  -H "Content-Type: application/json" \
  -H "x-api-key: <INTERNAL_API_KEY>" \
  -d '{"tileId": "recXXXXXXXXXXXXXX"}'
```

**Test rubric draft generation** (requires ≥ 2 linked ITI Input records):
```bash
curl -X POST http://localhost:3000/api/generate-rubric-draft \
  -H "Content-Type: application/json" \
  -H "x-api-key: <INTERNAL_API_KEY>" \
  -d '{"rubricId": "recXXXXXXXXXXXXXX"}'
```

**Test rubric PDF generation** (rubric must be `Approved` first):
```bash
curl -X POST http://localhost:3000/api/generate-rubric-pdf \
  -H "Content-Type: application/json" \
  -H "x-api-key: <INTERNAL_API_KEY>" \
  -d '{"rubricId": "recXXXXXXXXXXXXXX"}'
```

---

## Deployment

```bash
vercel deploy          # preview
vercel deploy --prod   # production
```

Vercel Blob store must be linked to the project (auto-injects `BLOB_READ_WRITE_TOKEN`).

**Bundle size note:** `@sparticuz/chromium` is ~50MB compressed (~180MB unzipped). Total `node_modules` is ~164MB, within Vercel's 250MB function limit.

---

## Logging

`lib/logger.js` emits structured JSON to stdout (captured by Vercel function logs).

Standard event names: `request_received`, `airtable_fetch_complete`, `pdf_parse_complete`, `pdf_parse_failed`, `claude_api_called`, `claude_api_complete`, `pptx_generated`, `pdf_generated`, `blob_uploaded`, `airtable_updated`, `error`.

Rubric-specific events: `rubric_fetch_complete`, `iti_records_fetched`, `rubric_matrix_built`, `rubric_narrative_complete`, `rubric_pdf_generated`.

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
| Status ≠ Approved (PPTX/PDF endpoint) | 400 | Cannot generate PowerPoint/PDF: draft status is '...' |
| Claude API failure | 500 | Content synthesis failed |
| HTML generation failure | 500 | HTML generation failed |
| PPTX generation failure | 500 | PPTX generation failed |
| PDF generation failure | 500 | PDF generation failed |
| Blob upload failure | 500 | Failed to upload PPTX/PDF to storage |
| Airtable save failure | 500 | Failed to save draft / PPTX/PDF generated but failed to save to Airtable |
| Resume parse failure | 200 + warning | Draft still generated; warning in response |
| Rubric not found | 404 | Rubric record not found |
| Fewer than 2 ITI Input records | 400 | At least 2 panel members required |
| Invalid Rubric Matrix JSON | 400 | Invalid or missing Rubric Matrix JSON |
| Status = Approved (rubric draft endpoint) | 400 | Cannot overwrite approved rubric content... |
| Status ≠ Approved (rubric PDF endpoint) | 400 | Cannot generate PDF: rubric status is '...' |
| Claude rubric narrative failure | 500 | Rubric narrative generation failed |
| Rubric PDF generation failure | 500 | Rubric PDF generation failed |
| Rubric blob upload failure | 500 | Failed to upload rubric PDF to storage |
| Airtable rubric save failure | 500 | Failed to save rubric draft / PDF generated but failed to save to Airtable |

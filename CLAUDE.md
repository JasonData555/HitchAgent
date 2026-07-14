# Hitch Talent Agent — CLAUDE.md

Internal tool for Hitch Partners. Generates branded candidate tile documents (PowerPoint and PDF) from Airtable data using Claude AI.

---

## ⚠️ The 12-Function Cap — READ BEFORE ADDING AN ENDPOINT

**Vercel's Hobby plan allows a maximum of 12 Serverless Functions per deployment, and Vercel creates one function per file under `api/` (including nested files).** The project currently uses **10 of 12**.

**Adding a new `api/*.js` file consumes a slot. Adding three breaks every deployment.** This already happened once: the client-portal subsystem took the count from 12 to 18 and wedged `main` — no commit could deploy until it was fixed.

To add an endpoint, **do not create a new file under `api/`**. Instead:
1. Put the handler in `lib/handlers/<name>.js` (standard `export default async function handler(req, res)`).
2. Register it in the `ROUTES` table of the appropriate dispatcher in `api/`.
3. Add a `rewrite` in `vercel.json` mapping the public path to `<dispatcher>?__fn=<key>`.
4. Add the public path to the `ROUTES` map in `dev-server.mjs`.

Public URLs are **immutable** — Airtable stores `tile_url`/`rubric_url` inside records, Airtable automations POST to the `/api/generate-*` paths, and `/api/portal-auth/callback` is the registered redirect URI in the LinkedIn OAuth app. The rewrite layer exists precisely so these paths never change.

**Vercel resolves the filesystem before rewrites**, so a real file under `api/` always wins over a rewrite for the same path.

## Project Structure

```
api/                       ── 10 Serverless Functions (max 12; see cap warning above)
  generate-draft.js        DISPATCHER → generate-tile-draft | generate-rubric-draft | generate-portal
  generate-doc.js          DISPATCHER → generate-tile-pptx | generate-tile-html | generate-rubric-html
  generate-pdf.js          DISPATCHER → generate-tile-pdf | generate-rubric-pdf   [Chromium isolated HERE]
  portal.js                DISPATCHER → portal-view | portal-data | portal-feedback
  deactivate.js            DISPATCHER → deactivate-tile | deactivate-rubric
  portal-auth/login.js     GET  /api/portal-auth/login     — real file; initiates LinkedIn OAuth
  portal-auth/callback.js  GET  /api/portal-auth/callback  — real file; NEVER route through a rewrite (see below)
  tile-view.js             GET  /api/tile-view             — Live server-side rendering of candidate tile
  rubric-view.js           GET  /api/rubric-view           — Live server-side rendering of rubric document
  view.js                  GET  /api/view                  — Proxy blob URL for inline browser rendering (legacy)
lib/handlers/              ── the real endpoint logic; NOT functions (outside api/)
  generate-tile-draft.js   POST /api/generate-tile-draft   — Claude synthesis → Airtable
  generate-tile-html.js    POST /api/generate-tile-html    — Permanent URL registration → Airtable
  generate-tile-pptx.js    POST /api/generate-tile-pptx    — PPTX generation → Vercel Blob → Airtable
  generate-tile-pdf.js     POST /api/generate-tile-pdf     — PDF generation → Vercel Blob → Airtable
  generate-rubric-draft.js POST /api/generate-rubric-draft — Rubric note synthesis → Airtable
  generate-rubric-html.js  POST /api/generate-rubric-html  — Permanent URL registration → Airtable
  generate-rubric-pdf.js   POST /api/generate-rubric-pdf   — Rubric PDF → Vercel Blob → Airtable
  generate-portal.js       POST /api/generate-portal       — Portal MI/JD generation → Airtable
  portal-view.js           GET  /api/portal-view           — Portal HTML shell
  portal-data.js           GET  /api/portal-data           — Authenticated portal JSON
  portal-feedback.js       POST /api/portal-feedback       — Interviewer verdict submission
  deactivate-tile.js       POST /api/deactivate-tile       — Delete tile blob, clear tile_url
  deactivate-rubric.js     POST /api/deactivate-rubric     — Set Rubric URL Status: Deactivated (no blob deletion)
lib/
  airtable.js              Airtable REST client (getRecord, updateRecord, getFieldValue, getAttachmentUrl, getRecordsByFormula)
  anthropic.js             Claude wrapper — builds prompt, calls API, parses JSON response; synthesizeRubricFields()
  fetch-image.js           Shared SSRF-guarded image fetcher (imageToBase64, guessMimeType)
  html-tile.js             Builds the HTML/CSS candidate tile document (for PDF rendering)
  html-tile-web.js         Builds the self-contained interactive HTML candidate tile (for hosted page)
  pdf-extract.js           Downloads a PDF URL and extracts text (pdf-parse)
  pdf-render.js            Puppeteer wrapper — renders HTML string → PDF buffer; accepts { landscape, bottomMargin } options
  pdf-rubric.js            Builds the HTML/CSS rubric alignment document (for PDF and HTML rendering)
  pptx-tile.js             Builds the one-slide PowerPoint (pptxgenjs)
  url-validate.js          SSRF guard — assertSafeUrl() allowlist validator
  logger.js                Structured JSON logger (stdout → Vercel function logs)
dev-server.mjs             Local dev HTTP server (no Vercel CLI needed)
vercel.json                maxDuration 60s + the `rewrites` that map public paths → dispatchers
```

**Dispatcher contract.** Each dispatcher holds a `ROUTES` table keyed by a `__fn` value and delegates to a `lib/handlers/` module. `vercel.json` supplies `__fn` via the rewrite destination (e.g. `/api/generate-tile-pdf` → `/api/generate-pdf?__fn=tile-pdf`). Rewrites are internal — the browser URL never changes, and the method, body, and headers are preserved, so Airtable's POST + `x-api-key` automations are unaffected.

**Chromium isolation.** `puppeteer-core` + `@sparticuz/chromium` (~180MB unzipped) is reachable **only** from `api/generate-pdf.js`. Grouping both PDF handlers alone keeps that bundle out of every other lambda's cold start — the portal path carries no heavy dependencies at all. **Do not add a non-PDF handler to `generate-pdf.js`, and do not import `lib/pdf-render.js` from a handler in any other dispatcher.**

**Why `portal-auth/` is not consolidated.** `/api/portal-auth/callback` is the redirect URI registered inside the LinkedIn OAuth app. LinkedIn rejects any `redirect_uri` that isn't the registered one, so this route **cannot be exercised on a preview deployment** — a bug there would only surface in production. Both OAuth files therefore stay as real files under `api/` and are served natively. Leave them alone.

**Local dev diverges from production by design.** `dev-server.mjs` maps public paths straight to `lib/handlers/` and bypasses the dispatchers and rewrites entirely. Its `ROUTES` keys are the real public URLs and must stay in lockstep with the `rewrites` block in `vercel.json`.

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
| `APIFY_API_TOKEN` | Apify API token for the `harvestapi/linkedin-profile-scraper` Actor (LinkedIn profile enrichment during tile draft generation; non-fatal if absent) |

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
| `Institution` | Lookup (Person) | PPTX + PDF endpoints |
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
| `tile_url` | HTML endpoint (plain text URL string) |
| `Tile Status` | HTML endpoint (`Active`) |

**Airtable schema prerequisites** (must be configured in Airtable UI before deploying):
- Rename `Current Situation` → `Situation` in Candidate Tile table
- Add `Relevant Domain Expertise` (Long text) to Candidate Tile table
- Add `Culture Add` (Long text) to Candidate Tile table
- Verify/add `Reasons to Consider` (Long text) to Candidate Tile table
- Add `LinkedIn` (URL) to People table; add Lookup to Candidate Tile table
- Add `Institution` (Text) to People table; add Lookup to Candidate Tile table
- Add `Candidate Tile PDF` (Attachment) to Candidate Tile table
- Add `tile_url` (URL or Text) to Candidate Tile table

**Tile Draft Status lifecycle:** `Not Started` → `Draft Ready` → `Approved` (PM approves in Airtable) → HTML, PPTX, and/or PDF generated.

**Rubric-aware tile drafts:** The draft endpoint optionally fetches the linked Rubric Matrix JSON and priority fields (`Must Have`, `Nice to Have`, `Red Flags`) for the associated Search. The join path is `Candidate Tile.Project` (linked record) → Search record ← `Rubric.Client` (linked record). When priority fields are present, Claude performs a structured evaluation before generating output (see Claude Integration). If no linked Rubric exists or fields are empty, the draft is generated from candidate data alone (graceful degradation, no error).

---

## Airtable Schema — "Rubric" Table

Fields read by the rubric endpoints:

| Field | Type | Used by |
|---|---|---|
| `client_name` | Text | Draft + HTML + PDF endpoints |
| `Search` | Text | Draft endpoint (links to ITI Input records) |
| `Rubric Draft Status` | Single select | All endpoints (read + write) |
| `Must Have` | Long text | HTML + PDF endpoints |
| `Nice to Have` | Long text | HTML + PDF endpoints |
| `Red Flags` | Long text | HTML + PDF endpoints |
| `Success in the Role` | Long text | HTML + PDF endpoints |
| `Functional Responsibilities` | Long text | HTML + PDF endpoints |
| `Location` | Text | HTML + PDF endpoints |
| `Team Size Today` | Text | HTML + PDF endpoints |
| `Est Team Size 18 - 24 mo` | Text | HTML + PDF endpoints |
| `client_logo` | Attachment | HTML + PDF endpoints |

Fields **written** by the rubric endpoints:

| Field | Written by |
|---|---|
| `Must Have` | Draft endpoint (Claude synthesis output) |
| `Nice to Have` | Draft endpoint (Claude synthesis output) |
| `Red Flags` | Draft endpoint (Claude synthesis output) |
| `Success in the Role` | Draft endpoint (Claude synthesis output) |
| `Functional Responsibilities` | Draft endpoint (Claude synthesis output) |
| `Rubric Draft Status` | Draft endpoint (`Draft Ready` / `Draft Error`) |
| `Rubric PDF` | PDF endpoint (attachment URL array) |
| `rubric_url` | HTML endpoint (plain text URL string) |
| `Rubric URL Status` | HTML endpoint (`Active`) |

**Rubric Draft Status lifecycle:** `Not Started` → `Draft Ready` → `Approved` (PM approves in Airtable) → HTML and/or PDF generated.

**Rubric schema prerequisites** (must be configured in Airtable UI):
- Add `Must Have`, `Nice to Have`, `Red Flags`, `Success in the Role`, `Functional Responsibilities` (Long text) to Rubric table
- Add `Location`, `Team Size Today`, `Est Team Size 18 - 24 mo` (Text) to Rubric table
- Add `client_logo` (Attachment) to Rubric table
- Add `rubric_url` (URL or Text) and `Rubric URL Status` (Single select) to Rubric table

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
| `Location Requirement` | Text | Panel member location requirement (displayed in top data block of rubric PDF) |

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
5. Renders HTML → PDF buffer via Puppeteer (`lib/pdf-render.js`) — Letter portrait, 0.5in top/sides, 0.1in bottom margin
6. Uploads to Vercel Blob (`tiles/<uuid>.pdf`, public access)
7. Updates Airtable `Candidate Tile PDF` attachment field and `tile_url` plain-text field with the blob URL
8. Returns `{ status, message, data: { tileId, candidateName, pdfUrl }, warnings }`

The PPTX and PDF endpoints are independent — either or both can be triggered for any Approved tile.

### POST /api/generate-tile-html

1. Fetches the Candidate Tile record from Airtable
2. Validates `Tile Draft Status === 'Approved'`
3. Downloads logo + profile photo as base64 data URIs in parallel (non-fatal if unavailable)
4. Generates a self-contained interactive HTML page via `lib/html-tile-web.js` (expandable sections, modal viewer, print CSS)
5. Uploads to Vercel Blob (`tiles/<recordId>-<timestamp>.html`, public access)
6. Proxies the URL through `/api/view` so the browser renders HTML inline
7. Updates Airtable `tile_url` (proxy URL) and sets `Tile Status: Active`
8. Returns `{ status, message, data: { tileId, candidateName, htmlUrl }, warnings }`

### POST /api/generate-rubric-draft

1. Fetches the Rubric record from Airtable
2. Validates status is not `Approved` (prevents overwriting)
3. Fetches all linked ITI Input records via formula query: `{search_project} = "<searchName>"`; requires ≥ 1 panel member
4. Collects `panel_member` and `Notes` per ITI Input record
5. Calls Claude (`claude-haiku-4-5-20251001`, max 2,000 tokens) via `synthesizeRubricFields()` to synthesize five structured fields from interviewer notes (handles 1 or more interviewers)
6. Writes `Must Have`, `Nice to Have`, `Red Flags`, `Success in the Role`, `Functional Responsibilities`, and `Rubric Draft Status: Draft Ready` back to Airtable
7. Returns `{ status, message, data: { rubricId, clientName, panelMemberCount, fieldsWritten }, warnings }`

### POST /api/generate-rubric-html

1. Fetches the Rubric record from Airtable
2. Validates `Rubric Draft Status === 'Approved'`
3. Constructs a permanent URL: `<proto>://<host>/api/rubric-view?id=<rubricId>`
4. Writes `rubric_url` to Airtable only if the field is not already set (idempotent across re-runs); always sets `Rubric URL Status: Active`
5. Returns `{ status, message, data: { rubricId, clientName, rubricUrl } }`

No HTML is generated or stored. `/api/rubric-view` fetches Airtable and renders the document live on every request, so the stored URL always reflects current content.

### POST /api/generate-rubric-pdf

1. Fetches the Rubric record from Airtable
2. Validates `Rubric Draft Status === 'Approved'`
3. Reads all five content fields plus context fields from the fresh fetch
4. Downloads Hitch logo + optional client logo as base64 in parallel (10s timeout each; SSRF-guarded); missing logos fall back silently to text labels
5. Generates HTML document via `lib/pdf-rubric.js`
6. Renders HTML → PDF buffer via Puppeteer (`lib/pdf-render.js`) — Letter portrait, 0.5in top/sides, 0.6in bottom margin
7. Uploads to Vercel Blob (`rubrics/<rubricId>-<timestamp>.pdf`, public access)
8. Updates Airtable `Rubric PDF` attachment field with the blob URL
9. Returns `{ status, message, data: { rubricId, clientName, pdfUrl }, warnings }`

---

## Claude Integration

**Model:** `claude-haiku-4-5-20251001`
**Max tokens:** 4,000
**Retry:** Once on timeout or HTTP 5xx.

**Security in prompts:**
- Short fields (`name`, `title`, `company`, `notes`, `roleTitle`, `clientName`) are sanitized with `sanitizeField()` — strips `\r\n\t` and control characters
- Long-form content (`resumeText`, `notes`) is escaped with `escapeXmlClose()` to prevent XML tag breakout
- All user data is wrapped in XML delimiters and the system prompt explicitly labels them as untrusted data

**Response format (tile draft):** JSON with keys `situation`, `relevantDomainExpertise`, `reasonsToConsider`, `cultureAdd`, `anticipatedConcerns` (all strings). Markdown code fences are stripped before parsing.

**Reasons to Consider format:** Exactly 4 bullets. Each bullet: bold 3–5-word differentiator label (e.g. `**Enterprise security leadership:**`) followed by 1–2 substantiating sentences. Max 200 words total. Bold `**markers**` are stripped by `stripMarkdown()` before HTML rendering — output is plain text in the PDF.

**Structured rubric evaluation (when `mustHave`/`niceToHave`/`redFlags` are present):**
The prompt instructs Claude to complete a 3-step internal evaluation before writing any section output:
1. **EVALUATE MUST HAVE ITEMS** — classify each item as `EVIDENCE FOUND` (named company, role context, concrete outcome) or `NO EVIDENCE FOUND` against resume + notes
2. **EVALUATE NICE TO HAVE ITEMS** — same classification
3. **EVALUATE RED FLAG ITEMS** — classify each flag as `EVIDENCE FOUND` (specific observation) or `NO EVIDENCE FOUND`

Evidence quality standard (applied in steps 1–2):
- **Strong** (EVIDENCE FOUND for Reasons to Consider): named company + specific role context, quantified outcome, or explicit reference/recruiter observation
- **Weak** (not used for Reasons to Consider): generic mention, implied experience, single passing reference
- **None** (use for Anticipated Concerns gaps): absent from resume and notes, or only tangentially related

**Reasons to Consider calibration (rubric-aware):** Draws exclusively from Must Have / Nice to Have `EVIDENCE FOUND` items with strong evidence. Each bullet must name the company and include a concrete detail. Must Have items fill top bullets; Nice to Have fills remaining slots. Items with no/weak evidence are excluded.

**Anticipated Concerns calibration (rubric-aware):**
- *Input A — gaps:* Must Have `NO EVIDENCE FOUND` → `"No evidence of [item] in the candidate's background."` Nice to Have gaps (secondary) → `"Limited evidence of [item] — worth exploring in interview."`
- *Input B — red flags:* Red Flag `EVIDENCE FOUND` → `"Evidence of [specific observation] noted — aligns with [red flag category]."`
- Ordering: Must Have gaps → Nice to Have gaps → Red Flag evidence
- If no Must Have gaps and no Red Flag evidence, note minor interview probes rather than manufacturing concerns

All three calibration blocks gate on `hasPriorities`/`mustHave`/`redFlags` being truthy — graceful degradation to generic instructions when Rubric data is absent.

**Rubric field synthesis:** `synthesizeRubricFields()` export in `lib/anthropic.js`. Uses `claude-haiku-4-5-20251001`, max 2,000 tokens. Accepts `clientName`, `searchName`, and an array of `{ name, notes }` objects (one per ITI Input record). Explicitly handles 1 or more interviewers — if only one is provided, synthesis is based entirely on that input. Returns `{ mustHave, niceToHave, redFlags, successInRole, functionalResponsibility }` as hyphen-bulleted plain text strings. Notes are attributed per interviewer (`Name:\nnotes`) and passed inside `<interviewer_notes>` XML delimiters. `generateRubricPriorityText()` (deprecated) and `generateRubricNarrative()` remain in the file but are no longer called by active endpoints.

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
- CULTURE ADD: {val} (inline bold label + regular value) at y:5.8 — PPTX only; PDF renders Culture Add in the sidebar
- ANTICIPATED CONCERNS: {val} (inline bold label + regular value) at y:6.1

**Footer (y: 7.1"–7.45"):**
- Blue bar (full width, ACCENT)
- "Hitch Partners <> Confidential & Proprietary" — 10pt, white, italic, centered

---

## PDF Layout

Letter portrait (8.5" × 11"), 0.5in top/sides + 0.1in bottom margin, Arial/Helvetica font throughout. Generated by Puppeteer (`puppeteer-core` + `@sparticuz/chromium`).

**Key implementation details (`lib/pdf-render.js`):**
- `renderHtmlToPdf(htmlString, { landscape = false, bottomMargin = '0.5in' } = {})` — `bottomMargin` defaults to `'0.5in'`; both tile PDF and rubric pass `'0.1in'`
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
    .sidebar   (240px fixed width: photo, LinkedIn, Situation, Culture Add, Contact Info, Education + Institution)
    .main      (flex:1: Domain Expertise, Reasons to Consider, Anticipated Concerns)
  .footer      (30px, position:fixed in print, navy bar + italic text)
```

**Typography:** 11px body, 1.35 line-height, 10px section labels (uppercase, letter-spaced), 21px candidate name in header.

**Domain Expertise rendering (`expertiseToHtml()`):** Company header lines (e.g. `Coinbase (2016 - present): ...`) render bold navy. Claude emits `Role:`, `Scope:`, `Accomplishments:` as bullet lines (`• Role: ...`); the parser detects these inside the bullet branch (after stripping the bullet prefix) and renders them as `<p><strong>Label:</strong> rest</p>`. Accomplishment bullets (`○ ...`) following an `Accomplishments:` label get class `accomplishments-list` for deeper indent (28px vs 16px).

**Culture Add** renders in the sidebar as a standard `.section` block (label + body), directly below Situation. **Anticipated Concerns** renders in the main column as a bulleted list (semicolon-delimited items → `<ul class="concerns-list"><li>`), directly below Reasons to Consider.

**Unicode arrows** (`→`, `←`, `↑`, `↓`) in Claude-generated text are replaced with word equivalents (`to`, `from`, `up`, `down`) via `replaceArrows()` before HTML encoding — the Lambda Chromium bundle lacks full Unicode Arrows block font coverage.

**Print CSS:** `@page { size: Letter portrait; margin: 0.5in 0.5in 0.1in 0.5in; }` (must match `page.pdf()` margins in `pdf-render.js`). Footer uses `position: fixed; bottom: 10px` to pin near page bottom. Columns have `padding-bottom: 46px` to prevent content rendering behind the fixed footer. Reasons to Consider and Anticipated Concerns sections have `break-inside: avoid` to prevent them from splitting across a page boundary (entire section moves to page 2 if it would overlap the footer zone).

---

## Rubric HTML/PDF Layout

Letter **portrait** (8.5" × 11"), 0.5in top/sides + 0.6in bottom margin. HTML and PDF share the same `lib/pdf-rubric.js` template (`buildRubricDocument()`). PDF calls `renderHtmlToPdf(html, { landscape: false, bottomMargin: '0.6in' })`.

**Color palette** (matches Candidate Tile):
- `NAVY #1B365D` — headings, domain names, table headers
- `SLATE #64748B` — body text, narrative
- `ACCENT #0EA5E9` — header divider line, footer bar
- `WHITE #FFFFFF` — background, footer text


**HTML structure:**
```
.header         (flex row: Hitch logo | title | client logo)
.accent-line    (3px blue)
.context-bar    (Position | Location | Team Size Today | Est Team Size 18 - 24 mo)
.content        (five sections: Must Have, Nice to Have, Red Flags, Success in Role, Functional Responsibilities)
.footer         (position:fixed; bottom:10px; navy bar + italic text)
```

**Key implementation details:**
- `buildRubricDocument({ clientName, searchName, location, currentTeamSize, teamSize18Months, mustHave, niceToHave, redFlags, successInRole, functionalResponsibility, hitchLogoDataUri, clientLogoDataUri })` — all content sourced from fresh Airtable fetch at generation time
- Content fields rendered as hyphen-bulleted lists with `**bold**` labels converted to `<strong>`
- Logos embedded as base64 data URIs; missing logos fall back to text labels (soft failure)
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

**Test tile HTML generation** (tile must be `Approved` first):
```bash
curl -X POST http://localhost:3000/api/generate-tile-html \
  -H "Content-Type: application/json" \
  -H "x-api-key: <INTERNAL_API_KEY>" \
  -d '{"tileId": "recXXXXXXXXXXXXXX"}'
```

**Test rubric draft generation** (requires ≥ 1 linked ITI Input record):
```bash
curl -X POST http://localhost:3000/api/generate-rubric-draft \
  -H "Content-Type: application/json" \
  -H "x-api-key: <INTERNAL_API_KEY>" \
  -d '{"rubricId": "recXXXXXXXXXXXXXX"}'
```

**Test rubric HTML generation** (rubric must be `Approved` first):
```bash
curl -X POST http://localhost:3000/api/generate-rubric-html \
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

Tile HTML events: `tile_html_generated`.

Rubric-specific events: `rubric_fetch_complete`, `iti_records_fetched`, `rubric_narrative_complete`, `rubric_pdf_generated`.

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
| No ITI Input records (0 found) | 400 | Rubric must have at least 1 panel member input |
| Status = Approved (rubric draft endpoint) | 400 | Cannot overwrite approved rubric content... |
| Status ≠ Approved (rubric PDF endpoint) | 400 | Cannot generate PDF: rubric status is '...' |
| Claude rubric narrative failure | 500 | Rubric narrative generation failed |
| Rubric PDF generation failure | 500 | Rubric PDF generation failed |
| Rubric blob upload failure | 500 | Failed to upload rubric PDF to storage |
| Airtable rubric save failure | 500 | Failed to save rubric draft / PDF generated but failed to save to Airtable |

---
---

# Client Portal (subsystem 2)

> Everything above documents **subsystem 1** — the candidate-tile and rubric
> document generator. Everything below documents **subsystem 2** — the
> **client portal**, the primary client-facing surface for a search engagement.
> The two subsystems share the same repo, Airtable base, Vercel project, and
> security primitives, but are otherwise independent.

## Project Identity

This repository hosts two subsystems:

1. **Tile / Rubric generator** (documented above) — generates branded candidate
   tile and rubric documents (PPTX, PDF, hosted HTML) from Airtable data.
2. **Client Portal** (documented below) — a per-search, client-facing web portal
   that surfaces Market Intelligence, the Job Description, the candidate pipeline,
   target companies, and an interviewer feedback workflow.

The portal is **activated per search** when a PM sets the linked Rubric's status
to **"Shared with Client"** in Airtable. That triggers an automation which POSTs
to `/api/generate-portal`, generating content and bringing the portal live.

> **Not Next.js.** Despite some upstream specs describing this as a "Next.js
> project," this repo is a **plain Vercel serverless-functions** project — ES
> modules under `api/*.js`, served locally by `dev-server.mjs`. There is no
> `pages/`, `app/`, or `next.config.*`. Portal routes follow the same
> serverless-function + live-Airtable-render pattern as `rubric-view.js` and
> `tile-view.js`.

## The Non-Negotiables (portal)

- **Never modify `rubric-view.js` or `tile-view.js`.**
- **Never add npm packages without explicit instruction.** Use built-in `fetch`
  for HTTP and `crypto` for token/signature work.
- **Never hardcode Airtable table or field names** — always import them from
  `/lib/airtableFields.js`.
- **Never expose `AIRTABLE_BASE_ID`, `AIRTABLE_API_KEY`, or raw Airtable record
  IDs** in client-rendered HTML or JavaScript. `tile_url` and similar values are
  constructed server-side and returned as opaque strings.
- **Never store auth tokens in `localStorage`.** Use **httpOnly cookies** for the
  LinkedIn session token; use `sessionStorage` only for ephemeral UI state.
- **All portal routes must import `validatePortalSession` from `/lib/portalAuth.js`**
  — never re-implement auth logic inline.
- **The rendering pattern is live Airtable reads on every request** — no static
  file generation, no response caching. (Exception: Claude-generated MI/JD content
  is generated once and stored in Rubric fields.)

## Stack (portal)

- **Framework:** Vercel serverless functions (ES modules) — **not** Next.js.
- **Deployment:** Vercel.
- **Database:** Airtable via REST API (`AIRTABLE_API_KEY`).
- **Auth:** **LinkedIn OAuth 2.0 (OpenID Connect)** — reviewers sign in with
  LinkedIn; the callback's deciding access gate is an **email-domain match** against
  the Searches `domain` (OIDC `openid profile email` returns no employer, so the
  LinkedIn company id is only a logged secondary signal), then it issues a signed,
  httpOnly session cookie.
- **Email:** Resend — retained for non-auth transactional email if needed (the
  portal sends no emails as part of the auth flow; reviewers receive the portal URL
  from their Hitch search team directly).
- **AI:** Anthropic Claude API (`claude-sonnet-4-6`) for Market Intelligence + JD
  generation.
- **Styling:** Inline styles + `<style>` blocks in HTML-rendering routes (same
  pattern as `rubric-view` / `tile-view` — no CSS framework). See `design.md`.

## Environment Variables (portal — supplements the table above)

The portal requires these **in addition to** all existing variables documented in
the [Environment Variables](#environment-variables) table above (`AIRTABLE_API_KEY`,
`AIRTABLE_BASE_ID`, `ANTHROPIC_API_KEY`, `INTERNAL_API_KEY`, `BLOB_READ_WRITE_TOKEN`,
`HITCH_LOGO_URL`, `APIFY_API_TOKEN`, `CHROME_EXECUTABLE_PATH`, `*_TABLE_ID`, etc.).
**None of the existing variables are removed.**

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | Resend API key — reserved; **no code path currently sends email** |
| `LINKEDIN_CLIENT_ID` | LinkedIn OAuth app client ID |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth app client secret |
| `LINKEDIN_REDIRECT_URI` | `https://hitch-agent.vercel.app/api/portal-auth/callback` — the code reads `LINKEDIN_REDIRECT_URI` exactly (login.js + callback.js); `.env.local` must use this name (not `…_URL`) or OAuth breaks |
| `PORTAL_SESSION_SECRET` | Secret for signing session cookies (HMAC-SHA256) |

## File Structure (portal)

```
lib/
  airtableFields.js        ALL portal table/field name constants (single source)
  portalAuth.js            validatePortalSession + setSessionCookie/clearSessionCookie
  anthropic.js             generatePortalMarketIntelligence + generatePortalJobDescription
api/
  portal-auth/
    login.js               GET  — initiates LinkedIn OAuth (verifies search is Live)
    callback.js            GET  — OAuth return + email-domain gate, creates session, sets cookie
  generate-portal.js       POST — webhook receiver + Claude MI/JD generation (x-api-key)
  portal-view.js           GET  — HTML shell (liveness-gated; bootstraps client JS)
  portal-data.js           GET  — authenticated JSON data endpoint (cookie)
  portal-feedback.js       POST — interviewer verdict + notes submission (cookie)
```

All of these files are **implemented** and registered in `dev-server.mjs` (manual
ROUTES map; Vercel auto-routes by filename in prod). `rubric-view.js` and
`tile-view.js` are existing files and must not be touched.

## Airtable Architecture (portal)

Core tables and their roles:

- **Searches** — one record per engagement. Source of truth for `portal_slug`,
  `client_logo_url`, `domain`, `linkedin_company_id`, `portal_status`,
  `portal_finalized`, `generation_error`.
- **Rubric** — one record per search. Stores `rubric_content` (input) and all
  Claude-generated JD/MI fields (output). Linked to Searches. (This is the same
  Rubric table used by subsystem 1, with additional portal fields.)
- **Projects** — junction table, one record per candidate per search. The
  `Display` checkbox controls pipeline visibility; `feedback_unlocked` controls
  panel-summary reveal.
- **Interview Schedule** — one record per scheduled meeting. Stores verdict, notes,
  interviewer identity, and the session linkage for feedback.
- **Portal Sessions** — one record per authenticated reviewer session, created at
  the LinkedIn OAuth callback. Scoped to one `portal_slug`.
- **Organizations** — target companies, linked to Searches. Drives the **Target
  Companies** tab when records exist for a search.

## Portal Activation Workflow

The portal activates automatically when a PM sets the Rubric status to
**"Shared with Client"** in Airtable. An Airtable automation POSTs to
`/api/generate-portal`, which:

1. Checks idempotency (`portal_finalized` gate; `portal_status` gate).
2. Calls the Claude API to generate Market Intelligence + Job Description content.
3. Writes the generated content back to Rubric table fields.
4. Sets `portal_status = "Live"` on the Searches record.

After this, the portal is live at:
`https://hitch-agent.vercel.app/api/portal-view?slug=[portal_slug]`

Reviewers authenticate via **LinkedIn OAuth**. The system sends no emails as part
of auth — reviewers receive the portal URL from their Hitch search team directly.

## API Endpoints (portal)

All portal routes set `Cache-Control: no-store` and read Airtable live. Auth differs
by route: `generate-portal` uses the `x-api-key` automation secret; `portal-data` and
`portal-feedback` use the session cookie; `portal-view` and `portal-auth/*` are
unauthenticated entry points.

### GET /api/portal-auth/login?slug=
Verify a Searches record exists for the slug and `portal_status === 'Live'` (else a
branded "Access restricted" page, 403). Then 302-redirect to LinkedIn's authorize
endpoint with `state=slug` and scope `openid profile email`. Creates nothing.

### GET /api/portal-auth/callback?code=&state=
1. Exchange `code` for an access token; fetch the OIDC userinfo (`sub`, `name`, `email`).
2. Best-effort employer lookup (usually unavailable → logged only).
3. Fetch the Searches record for `slug` (= `state`).
4. **Access gate:** reviewer's email domain must match the Searches `domain`
   (normalized). Mismatch → 302 back with `auth_error=company_mismatch`.
5. Match the reviewer to an ITI Input panel-member for this search (by email or name).
6. Create a Portal Sessions record (writes `session_id`, `email`, `portal_slug`,
   `deactivate_portal_link=false`, and the `name` link when matched; Title/Company
   auto-populate via lookups).
7. `setSessionCookie` (signed httpOnly) and 302 to `/api/portal-view?slug=`.

All failures 302 back to portal-view with `auth_error` (`company_mismatch` | `true`) —
never a raw error page.

### POST /api/generate-portal
`x-api-key`; body `{ searchRecordId }`. Idempotency gates (`portal_finalized`,
`portal_status === 'Live'`). Generates MI + JD via Claude (`claude-sonnet-4-6`),
writes the Rubric output fields, then sets `portal_status = 'Live'` on Searches.
`export const config = { maxDuration: 60 }`. Failures write `generation_error` and set
`portal_status = 'Error'`.

### GET /api/portal-view?slug=
**Liveness gate** (not auth): looks up Searches by slug; missing record, non-`Live`
status, or any Airtable error → standalone "Access restricted" HTML. Otherwise returns
a self-contained shell (all CSS/JS inline, `noindex`, **no record IDs / base id / api
key** in the markup; `<title>` = search name only). Client JS boots →
`fetch('/api/portal-data', {credentials:'include'})` → renders one of four states
(Loading / Sign-in / Auth-error / Portal) and populates the four tabs. Sign-in button
points at `/api/portal-auth/login?slug=`.

### GET /api/portal-data?slug=
`validatePortalSession(req, slug)` first (only `slug` is read pre-auth; no DB access
before auth). Live reads compose `{ session, portal, pipeline, interviews,
organizations }` (see Response Contract below). A defensive final scan rejects the
response if it would leak the base id, api key, session id, or any stray `rec…` id
(only `tile_url` and the reviewer's own `schedule_record_id` are allowed). 401 when
unauthenticated.

### POST /api/portal-feedback
Body `{ slug, schedule_record_id, verdict, notes }`. Steps:
1. `validatePortalSession` (first DB touch) — fail → 401 `unauthorized`.
2. **Onboarding gate:** session must carry `Full Name` + `Interviewer Title`, else 403
   `onboarding_incomplete` (server-enforced; the UI gate is not a security control).
3. **Verdict enum:** `['Yes','Soft Yes','Soft No','No']`, else 400 `invalid_verdict`.
4. **IDOR — all required, every failure an opaque 403 `unauthorized`** (specific reason
   logged server-side only): id format `^rec[A-Za-z0-9]{14}$`; `schedule_record_id`
   === session `interview_schedule_record_id`; record exists; the record's `Project`
   link resolves to this slug's Searches record.
5. Write `Interviewer Feedback` (verdict), `Feedback Details` (notes),
   `portal_session_token` (= session `session_id`). **`Interviewer Title` is NOT
   written** — it is a read-only lookup; PATCHing it would 422 and fail the write.
   Airtable failure → 500 `write_failed`. Success → 200 `{ success: true }`.

> The My Interviews / feedback features depend on the session's
> `interview_schedule_record_id` being populated (it binds a reviewer to their
> meeting). The OAuth callback does not set it — it must be provided by the
> schedule/session linkage upstream.

## Auth & Session Model (portal)

Session token lives in an httpOnly cookie — never `localStorage`.

```
cookie name:  hitch_portal_session
cookie value: "<sessionId>.<hmac>"   hmac = HMAC_SHA256(sessionId, PORTAL_SESSION_SECRET) hex
attributes:   HttpOnly; SameSite=Strict; Path=/; Max-Age=7d; Secure (production)
```

`sessionId` is the Portal Sessions `session_id`. Minted by `callback.js` via
`setSessionCookie`; cleared by `clearSessionCookie`. `validatePortalSession(req, slug)`
(in `lib/portalAuth.js`) checks, in order: cookie present → signature valid (constant
-time) → Portal Sessions row exists with that `session_id` → `deactivate_portal_link
!== true` → `portal_slug === slug`. It returns `{ valid:true, session }` where
`session` is the **raw Airtable fields object** (read via `getFieldValue`). Every
failure returns the same opaque `{ valid:false, reason:'unauthorized' }`; the specific
check is logged server-side only. A reviewer is revoked by checking
`deactivate_portal_link` in Airtable — no token rotation, no expiry beyond Max-Age.

## portal-data Response Contract

The JSON the shell consumes (stable shape; all content from live reads):

```
session:       { interviewer_name, interviewer_title, linkedin_company, schedule_record_id }
portal:        { search_project_name, client_logo_url,
                 market_intelligence: { company_overview, quick_facts{…}, recent_developments },
                 role_narrative, mandate_bullets[], reporting_structure,
                 success_milestones: { first_90_days[], six_months[], twelve_to_eighteen_months[] } }
pipeline[]:    { name, title, company, initials, tile_url, feedback_unlocked }
interviews[]:  { schedule_record_id, candidate_name, date, time, verdict, notes,
                 is_submitted, token_matches, panel_summary[] }
organizations[]:{ name, description, city, employee_count,
                  current_security_leaders[], previous_security_leaders[] }
```

There is **no `company_name`** field — the Overview Display heading and header logo
fallback are derived from `search_project_name` (split on the first dash variant).
`quick_facts` keys: `founded, headquarters, structure, stage, funding_or_market_cap,
investors, revenue, headcount, key_customers, key_executives` (render non-empty only).
`panel_summary` is populated only when the candidate's `feedback_unlocked` is true.

## Airtable Field Constants (portal)

`lib/airtableFields.js` is the single source for every portal table/field name
(verified via the Airtable MCP `describe_table` against base `app8IuY5nHuUvrri4`).
Never hardcode names in route files. Non-obvious / footgun names:

- **ProjStat** (`TABLES.PROJECTS`): `DISPLAY = 'Display ?'` (trailing space **and** `?`);
  `PROJECT_NAME = 'Project Name'` (link → Searches); `FEEDBACK_UNLOCKED = 'feedback_unlocked'`.
- **Interview Schedule**: `VERDICT = 'Interviewer Feedback'`, `NOTES = 'Feedback Details'`,
  `SESSION_TOKEN = 'portal_session_token'`, `PROJECT = 'Project'` (link → Searches),
  `INTERVIEWER_TITLE = 'Interviewer Title'` (**read-only lookup — never write**).
- **Portal Sessions**: `SESSION_ID = 'session_id'`, `SCHEDULE_RECORD_ID =
  'interview_schedule_record_id'`, `NAME_LINK = 'name'` (link → ITI Input, the only
  written identity field), `FULL_NAME = 'Full Name'` (formula), Title/Company are lookups.
- **Searches**: `NAME = 'Client&Search'`, `PORTAL_SLUG`, `PORTAL_STATUS`, `DOMAIN`,
  `CLIENT_LOGO` (attachment → `getAttachmentUrl`), `RUBRIC_LINK = 'Rubric'`.
- **Rubric** (portal output written by generate-portal): `market_intelligence_narrative`
  (JSON string), `job_description_narrative`, `mandate_bullets` (newline-joined),
  `success_milestones` (JSON string), `reporting_structure`.

## Portal Tabs

Four tabs, in order: **Overview · Pipeline · Target Companies · My Interviews**.
The **Target Companies** tab is hidden entirely when zero Organization records
exist for the search.

## Skills (portal)

Two skills govern the portal domain — read them at the start of any session that
touches it:

- `~/.claude/skills/hitch-jd-generation/SKILL.md` — **all content generation.**
  Applies unchanged: the Hitch voice, banned phrases, MI/JD prompts, field
  routing, idempotency, and calibration examples are authoritative.
- `~/.claude/skills/hitch-client-portal/SKILL.md` — portal architecture and design
  system.

> **⚠️ Override note — CLAUDE.md governs over the `hitch-client-portal` skill on
> these points.** This project intentionally diverges from that skill's auth and
> navigation model. Where they differ, **follow CLAUDE.md / `design.md`:**
>
> | Topic | `hitch-client-portal` skill says | **This project uses** |
> |---|---|---|
> | Auth | Magic-link UUID token in URL hash, looked up in Portal Sessions | **LinkedIn OAuth 2.0** + signed httpOnly cookie |
> | Auth utility | `validatePortalToken(token, slug)` | **`validatePortalSession`** |
> | Auth routes | `portal-onboard.js` | **`portal-auth/login.js` + `portal-auth/callback.js`** |
> | Tabs | 3 (Overview / Pipeline / My Interviews) | **4** (adds **Target Companies**) |
> | Header wordmark | DM Sans 14px/500 | per `design.md` |
>
> All non-auth, non-nav guidance in the skill (live-render principle,
> `airtableFields.js` discipline, IDOR protection on feedback, onboarding gate,
> no-internal-IDs-in-HTML, empty states, mobile rules, design tokens) **still
> applies.** The content-generation skill applies in full.

## Quality Standards (portal)

- Every portal rendered must be **visually identical across search engagements** —
  same layout, typography, component patterns, and spacing.
- **Design reference:** [`design.md`](design.md) in the project root — every color,
  font, spacing, and component decision derives from it.
- **Aesthetic:** Vanta + Rippling — dark header over a warm off-white body, clean
  data density, generous whitespace, no decorative elements.

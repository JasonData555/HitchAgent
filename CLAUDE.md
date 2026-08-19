# Hitch Talent Agent — CLAUDE.md

Internal tool for Hitch Partners. Two subsystems in one repo / Airtable base / Vercel project:
1. **Tile / Rubric generator** — branded candidate tile + rubric documents (PPTX, PDF, hosted HTML) from Airtable via Claude.
2. **Client Portal** — per-search client-facing portal (Market Intelligence, JD, pipeline, target companies, interviewer feedback).

**Not Next.js** — plain Vercel serverless functions, ES modules under `api/*.js`, served locally by `dev-server.mjs`. No `pages/`, `app/`, `next.config.*`.

---

## ⚠️ The 12-Function Cap — READ BEFORE ADDING AN ENDPOINT

Vercel Hobby allows **max 12 Serverless Functions**; Vercel creates one per file under `api/` (nested included). Currently **10 of 12**. Adding an `api/*.js` file consumes a slot; the client-portal work once took it 12→18 and wedged `main`.

**To add an endpoint, do NOT create a file under `api/`.** Instead:
1. Put the handler in `lib/handlers/<name>.js` (`export default async function handler(req, res)`).
2. Register it in the `ROUTES` table of the appropriate `api/` dispatcher.
3. Add a `rewrite` in `vercel.json` mapping the public path → `<dispatcher>?__fn=<key>`.
4. Add the public path to the `ROUTES` map in `dev-server.mjs`.

Public URLs are **immutable** (Airtable stores `tile_url`/`rubric_url`; automations POST to `/api/generate-*`; `/api/portal-auth/callback` is the registered LinkedIn redirect URI). Rewrites exist so paths never change. **Vercel resolves the filesystem before rewrites** — a real file under `api/` always beats a rewrite for the same path.

---

## Project Structure

```
api/                       ── 10 Serverless Functions (dispatchers + real OAuth/view files)
  generate-draft.js        DISPATCHER → tile-draft | rubric-draft | portal   [maxDuration 300 — see below]
  generate-doc.js          DISPATCHER → tile-pptx | tile-html | rubric-html
  generate-pdf.js          DISPATCHER → tile-pdf | rubric-pdf                 [Chromium isolated HERE]
  portal.js                DISPATCHER → portal-view | portal-data | portal-feedback
  deactivate.js            DISPATCHER → deactivate-tile | deactivate-rubric
  portal-auth/login.js     GET  real file — initiates LinkedIn OAuth
  portal-auth/callback.js  GET  real file — OAuth return; NEVER route via a rewrite
  tile-view.js             GET  live server-side render of candidate tile
  rubric-view.js           GET  live server-side render of rubric document
  view.js                  GET  proxy blob URL for inline rendering (legacy)
lib/handlers/              ── real endpoint logic; NOT functions (outside api/)
  generate-tile-draft.js   Claude synthesis → Airtable
  generate-tile-html.js    permanent URL registration → Airtable
  generate-tile-pptx.js    PPTX → Vercel Blob → Airtable
  generate-tile-pdf.js     PDF → Vercel Blob → Airtable
  generate-rubric-draft.js rubric note synthesis → Airtable
  generate-rubric-html.js  permanent URL registration → Airtable
  generate-rubric-pdf.js   rubric PDF → Vercel Blob → Airtable
  generate-portal.js       portal MI/JD generation → Airtable
  portal-view.js portal-data.js portal-feedback.js   portal shell / JSON / feedback
  deactivate-tile.js       delete tile blob, clear tile_url
  deactivate-rubric.js     set Rubric URL Status: Deactivated (no blob deletion)
lib/
  airtable.js              REST client (getRecord, updateRecord, getFieldValue, getAttachmentUrl, getRecordsByFormula)
  airtableFields.js        ALL portal table/field name constants (single source — never hardcode)
  anthropic.js             Claude wrapper: tile/rubric/portal prompts + synthesizeRubricFields()
  apify-linkedin.js        LinkedIn enrichment (harvestapi actor); all failures non-fatal
  portalAuth.js            validatePortalSession + set/clearSessionCookie
  fetch-image.js           SSRF-guarded image fetcher
  html-tile.js             HTML/CSS tile for PDF render
  html-tile-web.js         self-contained interactive HTML tile (hosted page)
  pdf-extract.js pdf-render.js pdf-rubric.js   resume text / Puppeteer HTML→PDF / rubric doc
  pptx-tile.js url-validate.js logger.js
dev-server.mjs             local dev server (maps public paths straight to lib/handlers; bypasses dispatchers)
vercel.json                function maxDuration + rewrites (public path → dispatcher)
```

**Dispatcher contract.** Each dispatcher holds a `ROUTES` table keyed by `__fn` and delegates to a `lib/handlers/` module. `vercel.json` supplies `__fn` via the rewrite destination. Rewrites are internal — URL/method/body/headers preserved, so Airtable POST + `x-api-key` automations are unaffected. Local dev's `ROUTES` keys must stay in lockstep with the `vercel.json` rewrites.

**Chromium isolation.** `puppeteer-core` + `@sparticuz/chromium` (~180MB) is reachable **only** from `api/generate-pdf.js`. Do not add a non-PDF handler there, and do not import `lib/pdf-render.js` from any other dispatcher.

**portal-auth stays as real files** — LinkedIn rejects any `redirect_uri` that isn't the registered `/api/portal-auth/callback`, so it can't run on a preview deploy. Leave both OAuth files alone.

---

## ⚠️ maxDuration & the Claude timeout guardrail

`vercel.json` scopes `api/generate-draft.js` to **`maxDuration: 300`** (Vercel Pro); all other routes stay at 60s. `api/generate-draft.js` also exports `config = { maxDuration: 300 }` — keep the two in agreement.

**Why:** rubric-aware Claude generation (six sections + the internal Rubric Match verdict table, `TILE_MAX_TOKENS: 24000`) can run past 60s. When the platform hard-kills a lambda at the timeout, the kill is external, so the handler's `catch` never runs — the record is left silently at **`Not Started`** with no fields and **no `Draft Error`**. The 300s budget gives generation room to finish.

**Guardrail:** `callClaude()` passes a **135s per-request timeout** (`CLAUDE_TIMEOUT_MS`, `lib/anthropic.js`). A genuinely stuck call now throws a catchable error *inside* the 300s budget → writes `Draft Error` instead of dying silently. 135s keeps 2 attempts (retry-once-on-timeout) under 300s (270s + ~30s for fetches and the Airtable write) — **do not raise past ~145s** without revisiting `maxDuration`.

**⚠️ Tile output budget is separate — `TILE_MAX_TOKENS: 24000`, not the shared `MAX_TOKENS: 10000`.** The tile is the only prompt whose output scales on two axes at once: the candidate's career length *and* the linked Rubric's item count (the internal Rubric Match table emits one row per rubric bullet). A 53-item Kraken rubric plus an eight-company tenure list needs ~7–8k tokens and truncated at 6000 — surfacing only as `Unterminated string in JSON at position N`, because `stop_reason` was never checked. `callClaude()` now checks `stop_reason === 'max_tokens'` first and throws a **non-`SyntaxError`**, so the retry guard skips it: truncation is deterministic, and retrying only burned a second full generation to fail identically. Watch for the `claude_truncated` log event. **Thinking tokens consume `max_tokens`, not just billing** — that is why both ceilings rose again when the tile/rubric paths moved to thinking models. Every Claude call now passes `CLAUDE_TIMEOUT_MS` explicitly; the rubric and portal calls previously passed none and inherited the SDK's 10-minute default, which outlives the 300s lambda and invites a silent platform hard-kill.

**⚠️ Response parsing must narrow by block type — never `content[0].text`.** Thinking-capable models emit a `thinking` block first whenever adaptive thinking engages, which on a tile-sized prompt is essentially always. `extractText()` in `lib/anthropic.js` filters to `type === 'text'` and joins; all four `messages.create` sites use it. Reading `content[0].text` returns `undefined` and dies as a misleading `SyntaxError` on 100% of drafts.

**⚠️ The portal is pinned to `claude-sonnet-4-6` — deliberate, not stale.** `callPortalClaudeWebSearch()` concatenates every text block and `JSON.parse`s the result with no extraction or repair. Measured against the Market Intelligence prompt: `claude-opus-5` prefixes a conversational preamble ("I'll research…") before the searches, and `claude-sonnet-5` emits a raw control character inside a JSON string — both fail to parse; Sonnet 4.6 is clean. Harden the parser to extract the JSON document from surrounding prose before attempting an upgrade. Keep `web_search_20250305`: the newer `web_search_20260209` runs code execution under the hood and returns interleaved text/`code_execution_tool_result` blocks that break the same parse.

---

## Runtime & Dependencies

Node 20.x, ES modules. `@anthropic-ai/sdk ^0.20.0`, `@sparticuz/chromium ^143`, `@vercel/blob ^0.22`, `pdf-parse ^1.1.1` (CJS, dynamic-imported), `pptxgenjs ^3.12`, `puppeteer-core ^24`, `node-fetch ^3.3`.

## Environment Variables

| Variable | Description |
|---|---|
| `AIRTABLE_API_KEY` / `AIRTABLE_BASE_ID` | PAT (records r/w, schema read) / base id |
| `AIRTABLE_TABLE_ID` `RUBRIC_TABLE_ID` `ITI_TABLE_ID` | table names/ids (fallbacks: "Candidate Tile", "Rubric", "ITI Input") |
| `ANTHROPIC_API_KEY` `BLOB_READ_WRITE_TOKEN` `INTERNAL_API_KEY` | Claude / Vercel Blob / shared `x-api-key` secret |
| `HITCH_LOGO_URL` | public HTTPS Hitch logo PNG |
| `CHROME_EXECUTABLE_PATH` | **local dev only** — system Chrome path; omit in prod |
| `APIFY_API_TOKEN` | Apify token for LinkedIn scraper (non-fatal if absent) |
| `LINKEDIN_CLIENT_ID` / `_SECRET` / `LINKEDIN_REDIRECT_URI` | OAuth app; code reads `LINKEDIN_REDIRECT_URI` **exactly** (not `…_URL`) |
| `PORTAL_SESSION_SECRET` | HMAC-SHA256 signing for session cookies |
| `RESEND_API_KEY` | reserved — no code path sends email |

---

## Subsystem 1 — Tile / Rubric

### API contract
All generate endpoints: `POST`, header `x-api-key: <INTERNAL_API_KEY>` (constant-time), body `{ "tileId" | "rubricId": "recXXXXXXXXXXXXXX" }` (regex `^rec[A-Za-z0-9]{14}$`).

**Status lifecycles** (single-select): `Tile Draft Status` and `Rubric Draft Status` both go `Not Started → Draft Ready → Approved` (PM approves in Airtable) → HTML/PPTX/PDF generated. Draft endpoints refuse to overwrite `Approved`; doc endpoints require `Approved`.

- **generate-tile-draft** — fetch record; in parallel parse resume PDF + scrape LinkedIn; resolve linked Rubric + ITI panel notes; Claude (`claude-sonnet-5`, effort `medium`, 24000 tok) → writes `Situation`, `Relevant Domain Expertise`, `Reasons to Consider`, `Culture Add`, `Anticipated Concerns`, status. Resume/LinkedIn failures non-fatal (warning). No source at all → still generates, warns tenures/dates are incomplete.
- **generate-tile-pptx / -pdf** — require `Approved`; download logo+photo base64 (SSRF-guarded); build one-slide 16:9 PPTX / Letter-portrait PDF; upload to Blob; write attachment field (PDF also writes `tile_url`). Independent — either/both.
- **generate-tile-html** — require `Approved`; set `tile_url` = `<proto>://<host>/api/tile-view?id=<tileId>` + `Tile Status: Active`. **No HTML stored** — `/api/tile-view` renders live per request.
- **generate-rubric-draft** — fetch Rubric; query ITI Input via `{search_project} = "<searchName>"` (≥1 required); `synthesizeRubricFields()` (`claude-opus-5`, 10000 tok) → writes `Must Have`, `Nice to Have`, `Red Flags`, `Success in the Role`, `Functional Responsibilities`, status.
- **generate-rubric-html / -pdf** — require `Approved`; html sets `rubric_url` (idempotent) + `Rubric URL Status: Active`, renders live; pdf builds via `lib/pdf-rubric.js`, uploads to Blob, writes `Rubric PDF`.

**⚠️ Rubric join — NOT a `filterByFormula`.** A formula sees a linked field as its display name, never the record id, so `FIND(recId, …)` matched zero rows. The join is a link traversal: tile's `Project` link **is** the Searches record → read its `Rubric` link → `getRecord()`. The Searches `Client&Search` name drives the ITI panel-notes lookup.

**⚠️ HTML idempotency guard migrates legacy URLs — do not narrow to `if (!existingUrl)`.** It rewrites any `tile_url` not already a `/api/tile-view` link (early records had frozen Blob snapshots predating live render / Reasons to Consider). A canonical link is never rewritten.

### LinkedIn enrichment (`lib/apify-linkedin.js`)
`harvestapi/linkedin-profile-scraper`. **All failures non-fatal** → returns `''`, draft proceeds on Resume + Notes.
- Schema: `experience[]` with `position`, `companyName`, `startDate`/`endDate` as `{month,year,text}` (current role `endDate` = `{text:'Present'}`). **Read `.text` first.** Wrong key names silently degrade to `Unknown`.
- Actor returns **HTTP 201 with an error OBJECT** on quota exhaustion (`{"error":"Free users are limited to 20 runs…"}`) — treated as a scrape failure. **⚠️ The free 20-run cap is currently exhausted** (actor-imposed, NOT Apify credit), so enrichment is effectively OFF for all candidates until the actor moves to a paid tier; drafts run on Resume + Notes.
- `LinkedIn Scraped` (checkbox) set **only on success** and hard-skips re-scrape; a bogus set means the profile never re-fetches until cleared. `apify_4b_raw_item_sample` logs the raw payload for schema/quota visibility.

### Claude integration (`lib/anthropic.js`)
Tile `claude-sonnet-5` (`TILE_MODEL`, effort `medium`); rubric `claude-opus-5` (`RUBRIC_MODEL`); portal `claude-sonnet-4-6` (`PORTAL_MODEL`). Tile `max_tokens 24000` (`TILE_MAX_TOKENS`); rubric/portal `10000` (`MAX_TOKENS`) — thinking tokens consume `max_tokens`, not just billing. Retry once on `SyntaxError` / "timeout" / "Missing or invalid field" / HTTP 5xx — but **never on a `max_tokens` truncation**, which is deterministic and is thrown as a plain `Error`.

**Security:** short fields via `sanitizeField()`; long-form (`resumeText`, `notes`) via `escapeXmlClose()`; all user data wrapped in XML delimiters labeled untrusted.

**Tile response JSON:** `situation`, `relevantDomainExpertise`, `rubricMatch`, `reasonsToConsider`, `cultureAdd`, `anticipatedConcerns` (all strings; code fences stripped; missing key → retry). `rubricMatch` may be an empty string when the Search has no linked Rubric.

**Rubric Match table — INTERNAL working step, never stored or rendered.** Claude still returns `rubricMatch` and assigns a verdict per rubric item because **Reasons to Consider and Anticipated Concerns are built from those verdicts**. Do **not** reintroduce a write or renderer for it, and do not remove the verdict step. `extractRubricItemTitles()` parses `Must Have`/`Nice to Have`/`Red Flags` (accepts `- `, `* `, `1. `; reduces `**Bold:**` to the label). Verdicts: `evidenced` / `inferred` / `not_found` — **meaning is REVERSED for `red_flag` rows** (`evidenced` = concern present).

**Reasons to Consider** — bulleted alignment summary under `**Must Have**` (≤5 bullets) and `**Nice to Have**` (≤3, heading omitted if none); each bullet ONE sentence ≤25 words, bold 2–4-word theme label. No rubric → 4 unheaded bullets. **Caps are the enforcement** (word cap alone was ignored); synthesize into themes, not rows. Lists **matches only** (evidenced/inferred); `not_found` gaps and `red_flag` rows belong to Anticipated Concerns. Banned from bullet text: `rubric/panel/interviewer/score/priority/not_found` and any source naming ("the notes say"); "Must Have"/"Nice to Have" allowed only as headings.

**⚠️ `parseFormattedText()` strips `**` from a standalone bold line** → `**Must Have**` becomes `<p class="block-heading">Must Have</p>` with no `<strong>`. The bold comes from the `.block-heading` CSS rule defined in **both** `html-tile-web.js` and `html-tile.js` — delete either and headings render as plain text. The web tile renders this section in full on load (preview == full → static).

**Anticipated Concerns** — Must Have/Nice to Have `not_found` gaps + `red_flag` `evidenced` concerns; order gaps → red-flag evidence; no real concerns → minor interview probes (never manufactured). Compensation excluded.

**Source harness:** before writing, Claude builds a tenure list as the **union** of Resume + Notes, supplemented (never overridden) by LinkedIn. A company named only in prose notes still counts. No date in any source → `(dates not available)`; never dropped or merged. All rubric-aware calibration degrades gracefully when Rubric data is absent.

**`synthesizeRubricFields()`** — haiku, 2000 tok. Takes `clientName`, `searchName`, `[{name, notes}]` (1+ interviewers), returns the five hyphen-bulleted fields; notes attributed per interviewer inside `<interviewer_notes>`. `generateRubricPriorityText()` / `generateRubricNarrative()` remain but are unused.

### Airtable schema (essentials)
- **Candidate Tile** — reads Person lookups (`Candidate Name`, `Current Title/Company`, `Location`, `Education`, `Institution`, `Email`, `LinkedIn`, `Profile Pic`), `Resume`, `Notes`, `Role Title`, `Client`; writes the five content fields + `Tile Draft Status`, plus `Candidate Tile PowerPoint/PDF`, `tile_url`, `Tile Status`.
- **Rubric** — `client_name`, `Search`, `Rubric Draft Status`, five content fields, context (`Location`, `Team Size Today`, `Est Team Size 18 - 24 mo`), `client_logo`, `Rubric PDF`, `rubric_url`, `Rubric URL Status`.
- **ITI Input** — matched via `{search_project}`; `panel_member(_title)`, `Reports To`, `Notes`, `Location Requirement`, 11 numeric domain scores (1–5 or labels). A domain is a **conflict** when ≥2 members scored it and max−min ≥ 2.

### Layouts (shared palette: NAVY `#1B365D`, SLATE `#64748B`, ACCENT `#0EA5E9`, WHITE)
- **PPTX** — one 16:9 slide, Calibri. Carries Domain Expertise, Culture Add, Anticipated Concerns; does **not** render Reasons to Consider (Y-positions packed against footer).
- **Tile PDF** — Letter portrait, margins `0.5in` sides/top + `0.66in` bottom. Flexbox: header / sidebar (photo, LinkedIn, Situation, Culture Add, Contact, Education) / main (Domain Expertise, Reasons to Consider, Anticipated Concerns). `expertiseToHtml()` renders `Role:/Scope:/Accomplishments:` labels bold; `replaceArrows()` swaps `→←↑↓` for words (Chromium font gap). `break-inside: avoid` on RtC + Concerns, and on main-column `li`/`p` + concerns bullets so no bullet or `Role:/Scope:` paragraph is sliced at a page break; `break-after: avoid` on `.company-header`.
  **⚠️ Footer is a page-margin template, NOT an in-document element.** `.footer` is `display:none` in print; `TILE_PDF_FOOTER_TEMPLATE` + `TILE_PDF_BOTTOM_MARGIN` (exported from `html-tile.js`) are passed to `renderHtmlToPdf()`. A `position:fixed` footer repeats on every page but **reserves no layout space**, so body text rendered straight through it at every page break — the margin band is the only clearance the paginator honors. Chromium anchors the footer box ~20px above the paper edge and does **not** move it when `bottomMargin` changes: the bar occupies 20–50px, and `0.66in` (63.4px) leaves ~13px of clearance. The two values are coupled — re-measure if either changes, and never give the footer a negative `bottom` (Chromium drops it from page 1 entirely).
- **Rubric PDF/HTML** — Letter portrait, bottom margin `0.6in`. `buildRubricDocument()` shared by HTML + PDF; five sections; `**bold**` labels → `<strong>`; logos base64 with text fallback.
- **`pdf-render.js`** — `renderHtmlToPdf(html, {landscape=false, bottomMargin='0.5in', footerTemplate=null})`; tile/rubric pass `'0.66in'`/`'0.6in'`; `emulateMediaType('print')` before `setContent`; request interception blocks all non-`data:` URLs; `@page` margins must match `page.pdf()`. `footerTemplate` (opt-in — only the tile passes it) renders HTML in the bottom page margin on every page via `displayHeaderFooter`; `headerTemplate` is set to a non-empty stub or Chromium injects its own title/date header. Templates are isolated from the document stylesheet: inline styles only, explicit `font-size` (defaults to 0), full paper width (re-create side margins with padding). Rubric output is byte-identical when `footerTemplate` is omitted.

---

## Subsystem 2 — Client Portal

**Non-negotiables:** never modify `rubric-view.js` / `tile-view.js`; never add npm packages without instruction (use built-in `fetch`/`crypto`); never hardcode Airtable names (import from `lib/airtableFields.js`); never expose base id / api key / raw `rec…` ids in client HTML/JS; never store auth tokens in `localStorage` (httpOnly cookie only); all portal routes import `validatePortalSession` from `lib/portalAuth.js`; live Airtable reads every request, `Cache-Control: no-store` (only Claude MI/JD content is generated once and stored).

**Activation:** PM sets the linked Rubric to **"Shared with Client"** → Airtable automation POSTs `/api/generate-portal` → generates MI + JD (`claude-sonnet-4-6` — see the portal-model hold below), writes Rubric output fields, sets Searches `portal_status = 'Live'`. Portal lives at `/api/portal-view?slug=<portal_slug>`.

**Auth = LinkedIn OAuth 2.0 (OIDC)** + signed httpOnly cookie (**overrides the `hitch-client-portal` skill's magic-link model**).
- `portal-auth/login?slug=` — verify Searches exists and `portal_status==='Live'` (else 403 "Access restricted"); 302 to LinkedIn authorize, `state=slug`, scope `openid profile email`.
- `portal-auth/callback?code=&state=` — exchange code → OIDC userinfo; **access gate = email-domain match** vs Searches `domain` (OIDC returns no employer; company id logged only); mismatch → 302 `auth_error=company_mismatch`; match reviewer to an ITI panel member; create Portal Sessions row; `setSessionCookie`; 302 to portal-view. All failures 302 back with `auth_error`, never a raw error page.
- Cookie `hitch_portal_session = "<sessionId>.<hmac>"`, HMAC-SHA256 w/ `PORTAL_SESSION_SECRET`; `HttpOnly; SameSite=Strict; Path=/; Max-Age=7d; Secure`. Revoke by setting `deactivate_portal_link` in Airtable.
- `validatePortalSession(req, slug)` checks: cookie → signature (constant-time) → session row exists → `deactivate_portal_link !== true` → `portal_slug === slug`. Returns `{valid, session}` (raw fields object); every failure opaque `{valid:false, reason:'unauthorized'}`.

**Routes:**
- `portal-view?slug=` — liveness gate (missing/non-Live → "Access restricted"); self-contained shell (inline CSS/JS, `noindex`, no ids in markup); client JS → `portal-data`.
- `portal-data?slug=` — `validatePortalSession` first (only slug read pre-auth); composes `{session, portal, pipeline, interviews, organizations}`; final scan rejects any leaked base id / api key / session id / stray `rec…` (only `tile_url` + own `schedule_record_id` allowed); 401 unauth.
- `portal-feedback` — body `{slug, schedule_record_id, verdict, notes}`: `validatePortalSession` → onboarding gate (session needs `Full Name` + `Interviewer Title`, else 403) → verdict ∈ `['Yes','Soft Yes','Soft No','No']` → **IDOR checks** (id regex; `schedule_record_id === session.interview_schedule_record_id`; record exists; its `Project` resolves to this slug's Searches) each opaque 403 → write `Interviewer Feedback`, `Feedback Details`, `portal_session_token`. **Never write `Interviewer Title`** (read-only lookup → 422). Feedback needs the session's `interview_schedule_record_id` (set by schedule/session linkage upstream, not the OAuth callback).

**Tables:** Searches (`Client&Search`, `portal_slug`, `PORTAL_STATUS`, `DOMAIN`, `CLIENT_LOGO`, `Rubric` link), Rubric (portal output: `market_intelligence_narrative` JSON, `job_description_narrative`, `mandate_bullets`, `success_milestones` JSON, `reporting_structure`), Projects/ProjStat (`Display ?` trailing-space+`?`, `Project Name` link, `feedback_unlocked`), Interview Schedule (`Interviewer Feedback`, `Feedback Details`, `portal_session_token`, `Project` link, `Interviewer Title` read-only), Portal Sessions (`session_id`, `interview_schedule_record_id`, `name` link → ITI, `Full Name` formula), Organizations (target companies).

**Tabs (4):** Overview · Pipeline · Target Companies · My Interviews. Target Companies hidden when zero Organizations. `portal-data` contract has **no `company_name`** — Overview heading/logo fallback derives from `search_project_name` split on first dash. `panel_summary` only when `feedback_unlocked`.

**Skills:** `~/.claude/skills/hitch-jd-generation/SKILL.md` (all content generation — authoritative) and `~/.claude/skills/hitch-client-portal/SKILL.md` (architecture/design). **CLAUDE.md + `design.md` override the portal skill on auth (LinkedIn OAuth, not magic-link), auth util (`validatePortalSession`), routes (`portal-auth/*`), and tabs (4, adds Target Companies).** All other skill guidance applies. Aesthetic: Vanta + Rippling; portals visually identical across engagements; see `design.md`.

---

## Security
`x-api-key` constant-time (`timingSafeEqual`). SSRF `assertSafeUrl()` allowlist (HTTPS only): `airtable.com`, `airtableusercontent.com`, `raw.githubusercontent.com`, `blob.vercel-storage.com`. Prompt injection: XML delimiters + sanitization + untrusted labeling. XSS: `escapeHtml()` on all field values in `html-tile.js`. Puppeteer: request interception blocks all non-`data:`/`about:blank`. tileId regex; production stack traces suppressed; PDF 25 MB max.

## Logging
`lib/logger.js` — structured JSON to stdout. Events: `request_received`, `airtable_fetch_complete`, `pdf_parse_complete/_failed`, `claude_api_called/_complete`, `pptx_generated`, `pdf_generated`, `blob_uploaded`, `airtable_updated`, `tile_html_generated`, `rubric_fetch_complete`, `iti_records_fetched`, `rubric_pdf_generated`, `error`, `claude_truncated`, plus `apify_*` scrape trace. Airtable client retries 429 with backoff (1→2→4s, 4 attempts).

## Local Dev & Deploy
```bash
node dev-server.mjs        # loads .env.local, serves all endpoints at :3000 (needs CHROME_EXECUTABLE_PATH for PDF)
vercel deploy              # preview
vercel deploy --prod       # production (or push to main → auto-deploy)
```
Test any endpoint: `curl -X POST http://localhost:3000/api/<name> -H "Content-Type: application/json" -H "x-api-key: <INTERNAL_API_KEY>" -d '{"tileId":"recXXXXXXXXXXXXXX"}'` (rubric endpoints use `rubricId`; drafts need not be Approved, doc/pdf/html endpoints do). Vercel Blob store must be linked (auto-injects `BLOB_READ_WRITE_TOKEN`).

## Error Reference (selected)
401 Unauthorized · 400 Invalid tileId format / not linked to Person / cannot overwrite Approved / draft not Approved · 404 record not found · 500 Content synthesis / HTML / PPTX / PDF / Blob upload / Airtable save failed. Resume parse failure → 200 + warning. Rubric with 0 ITI records → 400.

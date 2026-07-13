# HitchAgent — Project Progress

> Living status doc. Newest update at the top of the **Update Log**. Keep the
> **Current State**, **Open Items**, and **Next Steps** sections current; append a
> dated entry to the log each working session.

**Last updated:** 2026-06-19
**Overall status:** Client Portal (subsystem 2) is code-complete and validated in
isolation. Content generation (JD + web-grounded Market Intelligence) is working and
populated for the General Intuition test search. **Not yet deployed/live**; a few
integration items remain before a real portal can go end-to-end.

---

## Current State

### Subsystem 1 — Tile / Rubric generator
- Stable, in production use. Not the focus of recent work. Untouched core: `rubric-view.js`, `tile-view.js`.

### Subsystem 2 — Client Portal
**Built & in repo (all uncommitted):**
- Routes: `api/portal-auth/login.js`, `api/portal-auth/callback.js`, `api/generate-portal.js`,
  `api/portal-view.js`, `api/portal-data.js`, `api/portal-feedback.js`
- Libs: `lib/airtableFields.js` (field constants), `lib/portalAuth.js` (session auth),
  `lib/anthropic.js` (portal MI/JD generators)
- Local routing: all portal routes registered in `dev-server.mjs`
- Docs: portal section of `CLAUDE.md` updated; `PORTAL-DEPLOYMENT.md` runbook created (PM activation guide)

**Validated:**
- Auth/feedback routes return correct status codes (401/403/405/enum/IDOR) under local tests; failure-opacity confirmed.
- Portal-view shell renders all 4 states + 4 tabs; emitted client JS passes syntax check; no record IDs/secrets leaked in HTML.
- **Content generation tested live against General Intuition:**
  - JD path (grounded in rubric) → accurate `job_description_narrative`, `mandate_bullets`, `reporting_structure`, `success_milestones`.
  - **MI path fixed:** was hallucinating (wrong company); now grounded with Anthropic server-side `web_search`. Re-test produced an accurate profile (Medal spin-out, spatial-temporal AI, $133.7M seed, Khosla/General Catalyst, CEO Pim de Witte).
  - All 5 portal content fields populated on the GI Rubric `recVzTv3hWPmquyrd`.

**Configured by user (per their report):**
- `LINKEDIN_REDIRECT_URI` added to Vercel env + LinkedIn app authorized redirect URL.
- New Anthropic API key in `.env.local` (validated, working); new Airtable PAT in `.env.local` (unverified against base).

---

## Open Items / Blockers

| # | Item | Impact | Owner |
|---|------|--------|-------|
| 1 | **Uncommitted work** — all portal code + `lib/anthropic.js` MI fix are uncommitted | Risk of loss; no review trail | Eng |
| 2 | **Enable Anthropic web search on the production org** (the key that Vercel uses) | MI generation errors in prod without it | PM/Eng |
| 3 | **`Portal Sessions.interview_schedule_record_id` is never set by the OAuth callback** | My Interviews tab empty; feedback submission returns 403 | Eng (design) |
| 4 | **Airtable automation "Generate Client Portal" not yet created** | Portals never auto-activate | PM (runbook §2) |
| 5 | **Production `AIRTABLE_API_KEY` base access unconfirmed** — local PAT 404'd against `app8IuY5nHuUvrri4` (user since rotated it locally; not re-tested) | All portal Airtable reads/writes fail if key lacks base access | PM/Eng |
| 6 | **Not deployed to Vercel prod**; no Live search exercised end-to-end | Can't validate full reviewer flow | Eng |
| 7 | **LinkedIn app product/scopes** ("Sign In with LinkedIn using OpenID Connect"; `openid profile email`) not confirmed | OAuth token/userinfo calls fail without the product | PM |
| 8 | **Local `.env.local` still uses `LINKEDIN_REDIRECT_URL`** (code reads `…_URI`) | Local-only OAuth testing breaks (prod unaffected) | Eng |

---

## Best Next Steps (recommended order)

1. **Commit the portal work** to a branch (preserve + enable review). Covers blocker #1.
2. **Enable web search** on the production Anthropic org; confirm with one prod MI generation. (#2)
3. **Resolve `interview_schedule_record_id` linkage** — decide the mechanism (Airtable automation linking a Portal Session → that reviewer's Interview Schedule row, or set at OAuth callback). This unblocks the entire feedback feature. (#3)
4. **Create + test the "Generate Client Portal" Airtable automation** per `PORTAL-DEPLOYMENT.md` §2 (Run-a-script action: resolve Rubric `Client` → Searches id, POST with `x-api-key`). (#4)
5. **Confirm prod env**: `AIRTABLE_API_KEY` has access to `app8IuY5nHuUvrri4`; LinkedIn product/scopes added; `LINKEDIN_REDIRECT_URI` set. (#5, #7)
6. **Deploy to Vercel prod**, then run the runbook smoke tests (Tests 1–4) on a test search → first real Live portal. (#6)
7. **Establish a per-client MI accuracy review step** before client delivery (web grounding is strong but not a substitute for human verification).

---

## Key References

- **Runbook:** `PORTAL-DEPLOYMENT.md` (env checklist, automation, LinkedIn, smoke tests, finalization)
- **Architecture/spec:** `CLAUDE.md` → "Client Portal (subsystem 2)"; design system in `design.md`
- **Airtable base:** `app8IuY5nHuUvrri4` (HITCHBASE)
- **Test records (General Intuition – CISO):** Searches `rece4NSTXnOCqzx8j` (slug `general-intuition-ciso`, `portal_status` not yet Live); Rubric `recVzTv3hWPmquyrd` (all 5 portal fields populated)
- **Portal URL pattern:** `https://hitch-agent.vercel.app/api/portal-view?slug=<portal_slug>`

---

## Update Log

<!-- Template for new entries (add ABOVE this comment, newest first):
### YYYY-MM-DD — <short title>
- **Done:** …
- **Decisions:** …
- **Findings/issues:** …
- **Next:** …
-->

### 2026-06-19 — MI web-search fix + progress doc
- **Done:** Fixed the Market Intelligence hallucination by grounding `generatePortalMarketIntelligence` with Anthropic's server-side `web_search` tool (direct REST call in `lib/anthropic.js`, no SDK upgrade, no SSRF change); passed `client_name` for disambiguation from `api/generate-portal.js`. Re-tested against General Intuition → accurate. Wrote the corrected MI to Rubric `recVzTv3hWPmquyrd`. Created this `progress.md`.
- **Decisions:** Chose web-search grounding over context-only or SDK upgrade; isolated to the MI path so subsystem 1 and the JD path are untouched.
- **Findings/issues:** Web search must be enabled on the prod Anthropic org. MI quality still depends on a company's public web presence (stealth cos → more "Not disclosed").
- **Next:** Commit the work; enable prod web search; resolve `interview_schedule_record_id`.

### 2026-06-18 — Live content workflow test (General Intuition)
- **Done:** Ran the real MI/JD generators against the GI rubric via a local harness; wrote the 4 accurate JD-derived fields to the GI Rubric via the Airtable MCP. Walked through the Airtable automation setup against current Airtable docs.
- **Findings/issues:** Local `ANTHROPIC_API_KEY` and app `AIRTABLE_API_KEY` were invalid/404 (later rotated by user). Discovered MI hallucination (fixed next day). Confirmed the automation must pass the Rubric's linked **Searches** id (via `Client`) + `x-api-key`, not the Rubric's own `{{recordId}}`.
- **Next:** Fix MI grounding (done 06-19).

### 2026-06-17 — Portal build-out (Prompts 5–7)
- **Done:** Built `portal-view.js` (HTML shell, 4 states/4 tabs) and `portal-feedback.js` (auth + onboarding + verdict enum + 3-check IDOR). Updated `CLAUDE.md` portal docs. Produced `PORTAL-DEPLOYMENT.md` and the build-readiness verification.
- **Findings/issues:** Identified `LINKEDIN_REDIRECT_URI` env name mismatch, missing `INTERNAL_API_KEY` in the prompt's env list, and the `interview_schedule_record_id` feedback gap.
- **Next:** Configure automation + LinkedIn; deploy; smoke test.

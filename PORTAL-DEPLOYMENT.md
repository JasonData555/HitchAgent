# Hitch Client Portal — Deployment & Activation Runbook

This is the operator/PM guide to take the Client Portal (subsystem 2) live. It pairs
with the **Client Portal** section of [CLAUDE.md](CLAUDE.md). The portal is a set of
plain Vercel serverless functions that read Airtable live on every request.

Portal URL pattern:

```
https://hitch-agent.vercel.app/api/portal-view?slug=<portal_slug>
```

---

## 1. Deployment readiness

### 1a. Code checklist (verified ✓)

| Check | Status |
|---|---|
| All 10 portal files exist and non-empty | ✓ |
| `portalAuth.js` imports `airtableFields.js` | ✓ |
| `portal-data.js` imports `airtableFields.js` + `portalAuth.js` | ✓ |
| `portal-feedback.js` imports `airtableFields.js` + `portalAuth.js` | ✓ |
| `generate-portal.js` imports `airtableFields.js` | ✓ |
| No hardcoded Airtable table/field names in any route (all via constants) | ✓ |
| `api/rubric-view.js` unchanged | ✓ |
| `api/tile-view.js` unchanged | ✓ |
| Airtable base `app8IuY5nHuUvrri4` (HITCHBASE) contains all portal tables | ✓ |
| `Searches.portal_status` has a `Live` option (activation write) | ✓ |

### 1b. Environment variables (set in Vercel → Settings → Environment Variables)

Confirm each is present for the **Production** environment. (These cannot be read
from the repo — verify them in the Vercel dashboard.)

| Variable | Required | Notes |
|---|---|---|
| `AIRTABLE_API_KEY` | ✅ | PAT must have `data.records:read/write` **and access to base `app8IuY5nHuUvrri4`** |
| `AIRTABLE_BASE_ID` | ✅ | `app8IuY5nHuUvrri4` |
| `ANTHROPIC_API_KEY` | ✅ | MI/JD generation (`claude-sonnet-4-6` — pinned; see CLAUDE.md) |
| `INTERNAL_API_KEY` | ✅ | Shared secret the Airtable automation sends as `x-api-key` to `generate-portal` |
| `LINKEDIN_CLIENT_ID` | ✅ | LinkedIn OAuth app |
| `LINKEDIN_CLIENT_SECRET` | ✅ | LinkedIn OAuth app |
| `LINKEDIN_REDIRECT_URI` | ✅ | **Exact name `…_URI`** — must equal the LinkedIn redirect URL, no trailing slash |
| `PORTAL_SESSION_SECRET` | ✅ | Signs the session cookie (HMAC-SHA256) |
| `RESEND_API_KEY` | ⚪ optional | Reserved — no code path currently sends email |

> ⚠️ **MUST-FIX — env name mismatch.** `.env.local` currently defines
> `LINKEDIN_REDIRECT_URL` (…URL), but the code reads `LINKEDIN_REDIRECT_URI` (…URI).
> With the wrong name the OAuth `redirect_uri` is sent empty and sign-in fails.
> Rename it to `LINKEDIN_REDIRECT_URI` locally **and** ensure Vercel uses `…_URI`.

> ⚠️ Note: `INTERNAL_API_KEY` is required for portal activation even though it is not
> a "LinkedIn/portal" variable — the Airtable automation cannot call `generate-portal`
> without it.

---

## 2. Airtable automation — "Generate Client Portal"

**Goal:** when a PM sets a Rubric to `Shared with Client`, POST the **linked Searches
record id** to `generate-portal`, which generates MI/JD content and flips the portal
to `Live`.

> Why a script (not the no-code "Send webhook" action): the trigger record is a
> **Rubric**, but `generate-portal` needs the **Searches** record id. The Rubric links
> to its Search via the **`Client`** field. A script is needed to read that linked id
> and to attach the `x-api-key` header.

### Trigger

- **Table:** `Rubric`
- **Trigger type:** *When a record matches conditions*
- **Condition:** `Rubric Draft Status` **is** `Shared with Client`

### Action: Run a script

Add input variable:

- **Name:** `rubricRecordId` → **Value:** the trigger record's *Airtable record ID*.

Paste this script (replace `PASTE_INTERNAL_API_KEY` with the `INTERNAL_API_KEY` value):

```js
const { rubricRecordId } = input.config();

// Resolve the Searches record id from the Rubric's "Client" link.
const rubricTable = base.getTable('Rubric');
const rubric = await rubricTable.selectRecordAsync(rubricRecordId);
const clientLink = rubric ? rubric.getCellValue('Client') : null;
if (!clientLink || clientLink.length === 0) {
  throw new Error('Rubric has no linked Search (Client) — cannot generate portal.');
}
const searchRecordId = clientLink[0].id;

const res = await fetch('https://hitch-agent.vercel.app/api/generate-portal', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'PASTE_INTERNAL_API_KEY',
  },
  body: JSON.stringify({ searchRecordId }),
});

const text = await res.text();
console.log('generate-portal status:', res.status, text);
if (!res.ok) throw new Error(`generate-portal failed: ${res.status} ${text}`);
```

> The secret is pasted directly into the script (Airtable automations have no secret
> store). Keep the automation private; rotate `INTERNAL_API_KEY` if exposed.

### Confirmation test

After saving, set a non-client test Rubric's status to `Shared with Client` and watch:

- `Searches.portal_status` → **`Live`**
- Rubric fields populate: `market_intelligence_narrative` (JSON string),
  `job_description_narrative`, `mandate_bullets`, `success_milestones` (JSON string),
  `reporting_structure`
- `Searches.generation_error` stays **empty**

Re-firing after `portal_status = Live` (or with `portal_finalized` checked) is a
no-op — content is generated once. PM edits to Rubric fields are the source of truth
thereafter.

---

## 3. LinkedIn OAuth app verification

In the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps):

- [ ] App created.
- [ ] **OAuth 2.0 → Authorized redirect URLs** includes **exactly**:
      `https://hitch-agent.vercel.app/api/portal-auth/callback`
      (must equal `LINKEDIN_REDIRECT_URI` — **no trailing slash**).
- [ ] Product added: **Sign In with LinkedIn using OpenID Connect**.
- [ ] Scopes approved: `openid`, `profile`, `email`.
- [ ] Client ID → `LINKEDIN_CLIENT_ID` (Vercel).
- [ ] Client Secret → `LINKEDIN_CLIENT_SECRET` (Vercel).

> **Access control reality:** the deciding gate is an **email-domain match** between
> the reviewer's LinkedIn email and the `Searches.domain` value. LinkedIn OIDC returns
> no employer, so the LinkedIn company id is only a logged secondary signal. A reviewer
> whose email domain doesn't match is bounced with `auth_error=company_mismatch`.

---

## 4. End-to-end smoke test

### Test 1 — Portal generation

1. Create a test Searches record:
   - `portal_slug`: `test-smoke-<date>`
   - `domain`: a real company domain (note: `domain` is a **lookup** on Searches —
     set it via the linked source record, not by typing into Searches directly)
   - `linkedin_company_id`: your company's LinkedIn id (optional; logged only)
   - Linked **Rubric** with the content fields populated: `Must Have`, `Nice to Have`,
     `Red Flags`, `Success in the Role`, `Functional Responsibilities`, `Location`,
     `Team Size Today`, `Est Team Size 18 - 24 mo`. (There is no single `rubric_content`
     field — the JD generator assembles these.)
2. Set the Rubric `Rubric Draft Status` → `Shared with Client`.
3. Wait 30–60s (Claude runs two calls; `generate-portal` has `maxDuration = 60`).
4. Check `Searches.portal_status = Live`; `market_intelligence_narrative` populated;
   `Searches.generation_error` empty.

### Test 2 — Portal access + LinkedIn auth

1. Visit `https://hitch-agent.vercel.app/api/portal-view?slug=test-smoke-<date>`.
2. Expect the **Sign in with LinkedIn** screen with the search project name shown.
3. Click sign-in → authorize on LinkedIn → redirected back; portal content loads.
4. Verify: Overview shows MI + JD; Pipeline shows the empty state; Target Companies tab
   hidden (no Organizations linked); My Interviews shows the empty state.

### Test 3 — Feedback submission

> **Prerequisite (known gap):** feedback requires the reviewer's **Portal Sessions**
> record to have `interview_schedule_record_id` set, binding them to a specific
> Interview Schedule row. The OAuth callback does **not** set this field, so until it
> is populated (manually, or by a separate automation), My Interviews is empty and a
> submission returns `403`. Populate it before running this test.

1. Add an Interview Schedule record linked (via `Project`) to the test search.
2. Set the reviewer's Portal Sessions `interview_schedule_record_id` to that record id.
3. On My Interviews: pick a verdict, add notes, Submit.
4. Expect the card to flip to the submitted state.
5. Airtable check: the Interview Schedule record now has `Interviewer Feedback` (verdict),
   `Feedback Details` (notes), and `portal_session_token` set.

### Test 4 — Access control

1. With the current session, try a **different** search's portal → denied (sessions are
   scoped to one `portal_slug`; `portal-data` returns 401 → sign-in shown).
2. Clear cookies → revisit the portal → Sign in with LinkedIn screen.

---

## 5. Finalization & operations

**Lock a portal (prevent regeneration):** check `portal_finalized` on the Searches
record. Re-setting the Rubric status to `Shared with Client` will no longer regenerate
content; the portal keeps serving live Airtable data (PM can still edit fields directly).

**Regenerate content after finalization:**
1. Uncheck `portal_finalized` on the Searches record.
2. Clear only the Rubric field(s) you want regenerated (populated fields are never
   overwritten).
3. Set `Rubric Draft Status` back to `Shared with Client`.
4. Only the empty fields regenerate.

**Deactivate a reviewer's access:** in the **Portal Sessions** table, find the
reviewer's record and check `deactivate_portal_link`. Their next page load or API call
returns 401 and shows the sign-in page. (No token rotation/expiry beyond the 7-day
cookie Max-Age; this checkbox is the revocation control.)

---

## Open items before "done"

1. **Fix `LINKEDIN_REDIRECT_URI`** name (currently `…_URL` in `.env.local`); set the
   `…_URI` name in Vercel.
2. **Populate `Portal Sessions.interview_schedule_record_id`** (manual or new
   automation) so the My Interviews / feedback flow works end-to-end.
3. Confirm the production `AIRTABLE_API_KEY` PAT has access to base `app8IuY5nHuUvrri4`.
4. `vercel deploy --prod`.

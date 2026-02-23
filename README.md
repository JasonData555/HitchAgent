# Hitch Talent Agent — Candidate Tile Generator

Internal tool for Hitch Partners that generates client-facing Candidate Tile PowerPoint documents from Airtable data using Claude AI.

## How It Works

1. PM creates a **Candidate Tile** record in Airtable, linking to a Person and a Search
2. PM clicks the **"Generate Draft"** Airtable button → POSTs to `/api/generate-tile-draft`
3. Claude synthesizes three content sections from the resume and recruiter notes
4. PM reviews and edits the draft fields directly in Airtable
5. PM sets **Tile Draft Status** → `Approved`
6. PM clicks **"Generate PowerPoint"** → POSTs to `/api/generate-tile-pptx`
7. A branded PPTX is generated and attached to the Airtable record

---

## Setup

### 1. Prerequisites

- [Node.js 20+](https://nodejs.org)
- [Vercel CLI](https://vercel.com/cli): `npm i -g vercel`
- An Airtable base with the schema described in `Claude.md.pdf`
- An Anthropic API key

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in:

| Variable | Description |
|---|---|
| `AIRTABLE_API_KEY` | Airtable Personal Access Token |
| `AIRTABLE_BASE_ID` | Base ID from the Airtable URL (starts with `app`) |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `BLOB_READ_WRITE_TOKEN` | Auto-injected by Vercel when Blob store is linked |
| `INTERNAL_API_KEY` | Secret key used to authenticate webhook requests |
| `HITCH_LOGO_URL` | Public URL of the Hitch Partners logo image |

**Airtable Personal Access Token scopes required:**
- `data.records:read`
- `data.records:write`
- `schema.bases:read`

Grant access to the **specific base only** (not all bases).

### 4. Link Vercel Blob store

In the Vercel dashboard: Storage → Create → Blob Store → link to this project.
This auto-injects `BLOB_READ_WRITE_TOKEN`.

For local dev, pull env vars:
```bash
vercel env pull .env.local
```

### 5. Run locally

```bash
vercel dev
```

Endpoints available at `http://localhost:3000`.

---

## Deployment

```bash
# Deploy preview
vercel deploy

# Deploy production
vercel deploy --prod
```

Add environment variables to Vercel via dashboard or:
```bash
vercel env add AIRTABLE_API_KEY production
vercel env add ANTHROPIC_API_KEY production
vercel env add INTERNAL_API_KEY production
vercel env add HITCH_LOGO_URL production
```

---

## Airtable Button Setup

For each button, use the **"Run script"** or **"Open URL"** action to POST to the endpoint.

The simplest approach is using Airtable's **Automations** (Webhook action):

**Generate Draft button:**
- URL: `https://your-deployment.vercel.app/api/generate-tile-draft`
- Method: POST
- Headers: `x-api-key: <INTERNAL_API_KEY>`, `Content-Type: application/json`
- Body: `{ "tileId": "{{recordId}}" }`

**Generate PowerPoint button:**
- URL: `https://your-deployment.vercel.app/api/generate-tile-pptx`
- (same headers/body format)

---

## Testing

### Test draft generation

```bash
curl -X POST http://localhost:3000/api/generate-tile-draft \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-key" \
  -d '{"tileId": "recXXXXXXXXXXXXXX"}'
```

Expected: `200 { "status": "success", ... }`

### Test PPTX generation (tile must be Approved first)

```bash
curl -X POST http://localhost:3000/api/generate-tile-pptx \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-key" \
  -d '{"tileId": "recXXXXXXXXXXXXXX"}'
```

Expected: `200 { "status": "success", "data": { "pptxUrl": "https://..." } }`

---

## Error Reference

| Scenario | HTTP | Message |
|---|---|---|
| Wrong/missing API key | 401 | Unauthorized |
| Tile not found | 404 | Candidate Tile not found: {tileId} |
| No linked Person | 400 | Candidate Tile must be linked to a Person record |
| Status = Approved (draft endpoint) | 400 | Cannot overwrite approved content... |
| Generation count ≥ 5 | 400 | Generation limit reached (5)... |
| Status ≠ Approved (pptx endpoint) | 400 | Cannot generate PowerPoint: draft status is '{status}'... |
| Resume parse failure | 200 + warning | Draft still generated; warning in response |

/**
 * GET /api/portal-view?slug=[portal_slug]
 *
 * Returns the self-contained HTML shell for the Hitch Client Portal — all CSS in a
 * <style> block, all JS inline before </body>, same live-render pattern as
 * rubric-view.js / tile-view.js.
 *
 * The shell is UNAUTHENTICATED at the server level: it renders for anyone with the
 * URL. Authentication state is resolved client-side — the browser sends the
 * httpOnly session cookie to /api/portal-data, which performs ALL validation. The
 * shell embeds no record IDs, base id, api key, or field data; it only needs the
 * <title>.
 *
 * The single server-side Airtable read here is a LIVENESS gate (not auth): if the
 * slug has no Searches record, or portal_status !== 'Live', we return a standalone
 * "Access restricted" page instead of the shell. No error codes, no detail leak.
 */

import { getRecordsByFormula, getFieldValue } from '../airtable.js';
import { TABLES, SEARCHES_FIELDS } from '../airtableFields.js';
import { log } from '../logger.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Escape a value for safe interpolation into an Airtable filterByFormula string. */
function escapeFormulaValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escape a value for safe interpolation into server-rendered HTML. */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CONTACTS = {
  piacenteEmail: 'michael.piacente@hitchpartners.com',
  starrEmail: 'starr@hitchpartners.com',
};

// ── Standalone Access Denied page ──────────────────────────────────────────────

function accessRestrictedPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Access restricted — Hitch Partners</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,600&family=DM+Sans:wght@300;400;500&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-primary:#f1eee6; --brand-dark:#1a3a2e; --brand-accent:#2db87a;
    --text-secondary:#5a6370;
  }
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; }
  body {
    background: var(--bg-primary); min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    font-family: 'DM Sans', sans-serif; padding: 24px 16px;
  }
  .restricted-card { text-align: center; max-width: 440px; }
  .wordmark {
    font-family: 'IBM Plex Mono', monospace; font-size: 11px;
    letter-spacing: 0.1em; color: var(--brand-accent); margin-bottom: 24px;
  }
  .restricted-card h1 {
    font-family: 'Cormorant Garamond', serif; font-size: 40px; font-weight: 600;
    color: var(--brand-dark); margin: 0 0 16px; line-height: 1.1;
  }
  .restricted-card p {
    font-family: 'DM Sans', sans-serif; font-size: 15px; line-height: 1.6;
    color: var(--text-secondary); margin: 0 0 28px;
  }
  .contacts a {
    display: block; color: var(--brand-accent); text-decoration: none;
    font-size: 14px; margin: 6px 0; min-height: 44px; line-height: 44px;
  }
</style>
</head>
<body>
  <div class="restricted-card">
    <div class="wordmark">HITCH PARTNERS</div>
    <h1>Access restricted</h1>
    <p>This portal isn't available. If you believe you should have access,
    please reach out to your Hitch Partners search team.</p>
    <div class="contacts">
      <a href="mailto:${CONTACTS.piacenteEmail}">${CONTACTS.piacenteEmail}</a>
      <a href="mailto:${CONTACTS.starrEmail}">${CONTACTS.starrEmail}</a>
    </div>
  </div>
</body>
</html>`;
}

// ── Portal shell ────────────────────────────────────────────────────────────

function portalShell(title) {
  const safeTitle = escapeHtml(title || 'Interview Portal');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${safeTitle} — Hitch Partners</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,600&family=DM+Sans:wght@300;400;500&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  /* Backgrounds */
  --bg-primary:#f1eee6; --bg-surface:#ffffff; --bg-surface-alt:#f7f5f0;
  /* Brand */
  --header-bg:#1a3a2e; --brand-dark:#1a3a2e; --brand-accent:#2db87a;
  /* Text */
  --text-primary:#1a1a1a; --text-secondary:#5a6370; --text-on-dark:#ffffff;
  /* Borders */
  --border:#e2ddd5; --border-subtle:#ece9e1;
  /* Verdict */
  --verdict-yes:#2db87a;      --verdict-yes-bg:#e8f8f1;
  --verdict-soft-yes:#5ab88a; --verdict-soft-yes-bg:#eef7f3;
  --verdict-soft-no:#d4874a;  --verdict-soft-no-bg:#fdf0e6;
  --verdict-no:#c94f4f;       --verdict-no-bg:#fdf0f0;
}
* { box-sizing: border-box; }
html, body { margin:0; padding:0; }
body { background: var(--bg-primary); color: var(--text-primary); font-family: 'DM Sans', sans-serif; }

/* ── Header ── */
#portal-header {
  position: sticky; top: 0; z-index: 100;
  background: var(--header-bg); height: 60px; padding: 0 32px;
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
#header-logo {
  background: rgba(255,255,255,0.12); border-radius: 6px;
  padding: 6px 10px; display: flex; align-items: center;
}
#client-logo-img { max-height: 36px; display: none; }
#client-logo-fallback { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.9); }
#header-project-name {
  font-family: 'Cormorant Garamond', serif; font-size: 16px;
  color: rgba(255,255,255,0.7); letter-spacing: 0.02em;
  position: absolute; left: 50%; transform: translateX(-50%);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40%;
}
.header-wordmark { font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.1em; color: rgba(255,255,255,0.9); }

/* ── Confidentiality banner ── */
#conf-banner {
  background: var(--brand-dark); padding: 0 32px; height: 36px;
  display: flex; align-items: center; justify-content: space-between;
}
#conf-banner .conf-text { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.06em; color: rgba(255,255,255,0.75); }
#conf-banner button { background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 18px; padding: 0 0 0 16px; line-height: 1; }

/* ── Nav tabs ── */
#portal-nav {
  position: sticky; top: 60px; z-index: 99;
  background: var(--bg-surface); border-bottom: 1px solid var(--border);
  display: flex; height: 48px; align-items: stretch; overflow-x: auto;
}
.tab-btn {
  background: none; border: none; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 400;
  color: var(--text-secondary); padding: 0 24px;
  display: inline-flex; align-items: center; white-space: nowrap;
  border-bottom: 2px solid transparent; transition: color 150ms; min-height: 44px;
}
.tab-btn:hover { color: var(--brand-dark); }
.tab-btn.active { color: var(--brand-dark); font-weight: 500; border-bottom: 2px solid var(--brand-accent); }
.tab-badge {
  display: none; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; border-radius: 9px; padding: 0 5px;
  background: var(--brand-accent); color: #fff;
  font-family: 'IBM Plex Mono', monospace; font-size: 11px; margin-left: 6px;
}

/* ── Shared atoms ── */
.eyebrow {
  font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--brand-accent); margin-bottom: 12px; display: block;
}
.card {
  background: var(--bg-surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 24px; transition: border-color 150ms;
}
.card:hover { border-color: var(--brand-accent); }
.btn-primary {
  background: var(--brand-dark); color: #fff; border: none; border-radius: 4px;
  padding: 10px 28px; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 500;
  cursor: pointer; transition: background 150ms; min-height: 44px;
}
.btn-primary:hover { background: var(--brand-accent); }
.btn-outline {
  background: transparent; color: var(--brand-accent); border: 1px solid var(--brand-accent);
  border-radius: 4px; padding: 8px 18px; font-family: 'DM Sans', sans-serif; font-size: 13px;
  font-weight: 500; text-decoration: none; cursor: pointer; transition: all 150ms;
  display: inline-flex; align-items: center; min-height: 44px;
}
.btn-outline:hover { background: var(--brand-accent); color: #fff; }
.initials-avatar {
  width: 52px; height: 52px; border-radius: 50%; background: var(--brand-dark);
  color: #fff; font-family: 'Cormorant Garamond', serif; font-size: 20px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.empty-state { text-align: center; padding: 80px 0; }
.empty-state .placeholder-circle {
  width: 64px; height: 64px; border-radius: 50%;
  border: 2px dashed var(--border); margin: 0 auto 24px;
}
.empty-state h3 { font-family: 'Cormorant Garamond', serif; font-size: 24px; font-weight: 500; color: var(--text-secondary); margin: 0 0 12px; }
.empty-state p { font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--text-secondary); max-width: 320px; margin: 0 auto; line-height: 1.6; }

/* ── Layout ── */
.tab-panel { max-width: 1100px; margin: 0 auto; padding: 48px 32px; }
.section { margin-bottom: 56px; }
.section:last-child { margin-bottom: 0; }

/* ── Overview: Market Intelligence ── */
.mi-grid { display: grid; grid-template-columns: 62% 38%; gap: 48px; align-items: start; }
.display-heading { font-family: 'Cormorant Garamond', serif; font-size: 42px; font-weight: 600; line-height: 1.1; color: var(--brand-dark); margin: 0 0 20px; }
.body-large p { font-family: 'DM Sans', sans-serif; font-size: 16px; font-weight: 300; line-height: 1.75; margin: 0 0 16px; }
.quick-facts { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 24px; }
.qf-row { padding: 10px 0; border-bottom: 1px solid var(--border-subtle); }
.qf-row:last-child { border-bottom: none; }
.qf-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 4px; }
.qf-value-tier1 { font-family: 'IBM Plex Mono', monospace; font-size: 16px; font-weight: 500; color: var(--text-primary); }
.qf-value-tier2 { font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 400; color: var(--text-primary); }

/* ── Overview: The Role ── */
.role-narrative {
  font-family: 'Cormorant Garamond', serif; font-size: 22px; font-weight: 500; font-style: italic;
  line-height: 1.4; color: var(--brand-dark); border-left: 3px solid var(--brand-accent); padding-left: 28px; margin: 0;
}

/* ── Overview: Core Mandate ── */
.mandate-list { list-style: none; margin: 0; padding: 0; }
.mandate-list li {
  border-left: 2px solid var(--brand-accent); padding: 4px 0 4px 16px; margin-bottom: 16px;
  font-family: 'DM Sans', sans-serif; font-size: 15px; line-height: 1.65;
}
.mandate-list li strong { font-weight: 500; color: var(--brand-dark); }

/* ── Overview: Reporting Structure ── */
.reporting-card { background: var(--bg-surface-alt); border: 1px solid var(--border); border-radius: 8px; padding: 24px; font-family: 'DM Sans', sans-serif; font-size: 15px; line-height: 1.65; }

/* ── Overview: Success Profile ── */
.success-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.success-card { background: var(--bg-surface); border: 1px solid var(--border); border-top: 3px solid var(--brand-accent); border-radius: 8px; padding: 24px; }
.success-card h4 { font-family: 'Cormorant Garamond', serif; font-size: 18px; font-weight: 500; color: var(--brand-dark); margin: 0 0 16px; }
.success-card ul { list-style: none; margin: 0; padding: 0; }
.success-card li { font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.6; color: var(--text-primary); padding-left: 16px; position: relative; margin-bottom: 12px; }
.success-card li:before { content: ''; position: absolute; left: 0; top: 9px; width: 5px; height: 5px; border-radius: 50%; background: var(--brand-accent); }

/* ── Overview: About Hitch ── */
.about-hitch { background: var(--brand-dark); color: var(--text-on-dark); padding: 56px 32px; }
.about-inner { max-width: 1100px; margin: 0 auto; }
.about-hitch .eyebrow { color: var(--brand-accent); }
.about-hitch h3 { font-family: 'Cormorant Garamond', serif; font-size: 28px; font-weight: 500; margin: 0 0 24px; color: #fff; }
.about-contacts { display: flex; gap: 48px; flex-wrap: wrap; margin-bottom: 28px; }
.about-contact .name { font-family: 'Cormorant Garamond', serif; font-size: 18px; color: #fff; }
.about-contact .title { font-family: 'DM Sans', sans-serif; font-size: 13px; color: rgba(255,255,255,0.7); margin: 2px 0 6px; }
.about-contact a { font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: var(--brand-accent); text-decoration: none; }
.about-conf { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.06em; color: rgba(255,255,255,0.55); border-top: 1px solid rgba(255,255,255,0.12); padding-top: 24px; }

/* ── Pipeline ── */
.count-line { font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--text-secondary); margin-bottom: 24px; }
.card-stack > * { margin-bottom: 12px; }
.candidate-name { font-family: 'Cormorant Garamond', serif; font-size: 18px; font-weight: 500; color: var(--brand-dark); }
.candidate-meta { font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--text-secondary); }

/* ── Target Companies ── */
.subtext { font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--text-secondary); margin-bottom: 24px; }
.org-name { font-family: 'Cormorant Garamond', serif; font-size: 18px; font-weight: 500; color: var(--brand-dark); }
.org-meta { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--text-secondary); margin: 4px 0 14px; }
.org-desc {
  font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.6; color: var(--text-primary);
  overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3;
}
.desc-toggle { background: none; border: none; color: var(--brand-accent); cursor: pointer; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 6px 0 0; }
.leader-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-top: 14px; }
.leader-row .leader-label { font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--text-secondary); margin-right: 4px; }
.leader-current { background: var(--verdict-yes-bg); color: var(--verdict-yes); border: 1px solid var(--verdict-yes); border-radius: 20px; padding: 3px 12px; font-family: 'DM Sans', sans-serif; font-size: 13px; }
.leader-previous { background: var(--bg-surface-alt); color: var(--text-secondary); border: 1px solid var(--border); border-radius: 20px; padding: 3px 12px; font-family: 'DM Sans', sans-serif; font-size: 13px; }

/* ── My Interviews ── */
.meeting-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 28px; margin-bottom: 12px; }
.meeting-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.meeting-candidate { font-family: 'Cormorant Garamond', serif; font-size: 20px; font-weight: 500; color: var(--brand-dark); }
.meeting-datetime { font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: var(--text-secondary); }
.meeting-divider { border: none; border-top: 1px solid var(--border-subtle); margin: 18px 0; }
.verdict-row { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
.verdict-pill {
  border-radius: 20px; padding: 8px 20px; font-family: 'DM Sans', sans-serif; font-size: 14px;
  background: transparent; cursor: pointer; transition: all 150ms; min-height: 44px;
}
.verdict-pill.readonly { cursor: default; }
.feedback-notes {
  width: 100%; min-height: 90px; border: 1px solid var(--border); border-radius: 6px;
  padding: 12px; font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.6;
  resize: vertical; margin-bottom: 16px; color: var(--text-primary);
}
.feedback-notes:focus { outline: none; border-color: var(--brand-accent); box-shadow: 0 0 0 3px rgba(45,184,122,0.12); }
.recorded-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.recorded-label { font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--brand-accent); }
.edit-response { background: none; border: none; color: var(--brand-accent); cursor: pointer; font-family: 'DM Sans', sans-serif; font-size: 14px; text-decoration: underline; }
.notes-block { background: var(--bg-surface-alt); border-radius: 6px; padding: 16px; font-family: 'DM Sans', sans-serif; font-size: 14px; font-style: italic; line-height: 1.6; color: var(--text-primary); margin-top: 14px; }
.panel-summary { margin-top: 18px; }
.submit-error { color: var(--verdict-no); font-family: 'DM Sans', sans-serif; font-size: 13px; margin-top: 10px; }

/* ── Loading skeleton ── */
#state-loading { max-width: 1100px; margin: 0 auto; padding: 48px 32px; }
.skeleton { background: linear-gradient(90deg, #eceae3 25%, #f4f2ec 37%, #eceae3 63%); background-size: 400% 100%; animation: shimmer 1.4s ease infinite; border-radius: 6px; }
@keyframes shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
.spinner { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--brand-accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 24px; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Responsive ── */
@media (max-width: 768px) {
  .tab-panel { padding: 24px 16px; }
  .mi-grid { grid-template-columns: 1fr; gap: 32px; }
  .success-grid { grid-template-columns: 1fr; }
  #portal-header, #conf-banner { padding: 0 16px; }
  .about-hitch { padding: 40px 16px; }
}
@media (max-width: 480px) {
  #header-logo { display: none; }
  #header-project-name { position: static; transform: none; max-width: 70%; }
}
</style>
</head>
<body>
<div id="page-root" style="position:relative; min-height:100vh; background: var(--bg-primary);">

  <!-- HEADER -->
  <header id="portal-header">
    <div id="header-logo">
      <img id="client-logo-img" src="" alt="">
      <span id="client-logo-fallback"></span>
    </div>
    <span id="header-project-name"></span>
    <span class="header-wordmark">HITCH PARTNERS</span>
  </header>

  <!-- CONFIDENTIALITY BANNER -->
  <div id="conf-banner" style="display:none">
    <span class="conf-text">STRICTLY PRIVATE &amp; CONFIDENTIAL — Authorized interview panel members only.</span>
    <button type="button" onclick="dismissBanner()" aria-label="Dismiss">×</button>
  </div>

  <!-- NAV TABS -->
  <nav id="portal-nav" style="display:none">
    <button class="tab-btn active" data-tab="overview" onclick="switchTab('overview')">Overview</button>
    <button class="tab-btn" data-tab="pipeline" onclick="switchTab('pipeline')">
      Pipeline <span id="pipeline-badge" class="tab-badge"></span>
    </button>
    <button class="tab-btn" data-tab="companies" id="companies-tab-btn" onclick="switchTab('companies')" style="display:none">
      Target Companies <span id="companies-badge" class="tab-badge"></span>
    </button>
    <button class="tab-btn" data-tab="interviews" onclick="switchTab('interviews')">
      My Interviews <span id="interviews-badge" class="tab-badge"></span>
    </button>
  </nav>

  <!-- LOADING STATE -->
  <div id="state-loading">
    <div class="spinner"></div>
    <div class="skeleton" style="height:42px; width:55%; margin:0 auto 28px;"></div>
    <div class="skeleton" style="height:16px; width:90%; margin:0 auto 12px;"></div>
    <div class="skeleton" style="height:16px; width:80%; margin:0 auto 12px;"></div>
    <div class="skeleton" style="height:16px; width:85%; margin:0 auto;"></div>
  </div>

  <!-- SIGN IN STATE -->
  <div id="state-signin" style="display:none; min-height: calc(100vh - 60px); align-items:center; justify-content:center; background: var(--bg-primary);">
    <div style="text-align:center; max-width:400px; padding:48px 24px;">
      <p style="font-family:'IBM Plex Mono', monospace; font-size:11px; letter-spacing:0.1em; color:var(--brand-accent); margin-bottom:24px;">HITCH PARTNERS</p>
      <h1 style="font-family:'Cormorant Garamond', serif; font-size:32px; font-weight:600; color:var(--brand-dark); margin-bottom:12px;">Interview Portal</h1>
      <p id="signin-project-name" style="font-family:'DM Sans', sans-serif; font-size:15px; color:var(--text-secondary); margin-bottom:8px; line-height:1.6;"></p>
      <p style="font-family:'DM Sans', sans-serif; font-size:14px; color:var(--text-secondary); margin-bottom:32px; line-height:1.6;">Sign in with your LinkedIn account to access candidate materials and submit your interview assessment.</p>
      <div id="auth-error-msg" style="display:none; background:var(--verdict-no-bg); border:1px solid var(--verdict-no); border-radius:6px; padding:12px 16px; margin-bottom:20px; font-family:'DM Sans', sans-serif; font-size:14px; color:var(--verdict-no); text-align:left;"></div>
      <a id="linkedin-signin-btn" href="#" style="display:inline-flex; align-items:center; gap:10px; background:#0A66C2; color:white; text-decoration:none; border-radius:4px; padding:12px 24px; font-family:'DM Sans', sans-serif; font-size:15px; font-weight:500; min-height:44px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
        </svg>
        Sign in with LinkedIn
      </a>
    </div>
  </div>

  <!-- PORTAL CONTENT -->
  <main id="state-portal" style="display:none">
    <div id="tab-overview" class="tab-panel"></div>
    <div id="tab-pipeline" class="tab-panel" style="display:none"></div>
    <div id="tab-companies" class="tab-panel" style="display:none"></div>
    <div id="tab-interviews" class="tab-panel" style="display:none"></div>
  </main>

</div>

<script>
(function () {
  'use strict';

  var CONTACTS = {
    piacente: { name: 'Michael Piacente', title: 'Managing Partner', email: '${CONTACTS.piacenteEmail}' },
    starr: { name: 'Brett Starr', title: 'Managing Partner', email: '${CONTACTS.starrEmail}' }
  };

  var slug = new URLSearchParams(window.location.search).get('slug');
  var authError = new URLSearchParams(window.location.search).get('auth_error');
  var STATE = null; // last loaded data

  // ── Utilities ──
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function el(id) { return document.getElementById(id); }
  function paragraphs(text) {
    return String(text || '').split(/\\n\\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
  }
  function companyFromProjectName(name) {
    return String(name || '').split(/—|–| - /)[0].trim();
  }
  function boldBeforeDelimiter(text) {
    var s = String(text || '');
    var m = s.match(/^(.*?)([:—])([\\s\\S]*)$/);
    if (!m) return escapeHtml(s);
    return '<strong>' + escapeHtml(m[1].trim()) + '</strong>' +
      (m[2] === '—' ? ' — ' : ': ') + escapeHtml(m[3].trim());
  }

  // ── State switching ──
  function hideAll() {
    el('state-loading').style.display = 'none';
    el('state-signin').style.display = 'none';
    el('state-portal').style.display = 'none';
  }
  function showLoadingState() { hideAll(); el('state-loading').style.display = 'block'; }
  function showSignInState() {
    hideAll();
    el('conf-banner').style.display = 'none';
    el('portal-nav').style.display = 'none';
    el('state-signin').style.display = 'flex';
  }
  function showPortalState() {
    hideAll();
    if (!sessionStorage.getItem('banner_dismissed')) el('conf-banner').style.display = 'flex';
    el('portal-nav').style.display = 'flex';
    el('state-portal').style.display = 'block';
  }

  function showAuthError(errorCode) {
    var messages = {
      'company_mismatch': 'This portal is restricted to team members of the client company. Please sign in with your company LinkedIn account.',
      'true': 'Authentication failed. Please try again.'
    };
    var node = el('auth-error-msg');
    node.textContent = messages[errorCode] || messages['true'];
    node.style.display = 'block';
  }

  // ── Banner / tabs ──
  window.dismissBanner = function () {
    el('conf-banner').style.display = 'none';
    sessionStorage.setItem('banner_dismissed', '1');
  };
  window.switchTab = function (tabName) {
    var panels = document.querySelectorAll('.tab-panel');
    for (var i = 0; i < panels.length; i++) panels[i].style.display = 'none';
    var btns = document.querySelectorAll('.tab-btn');
    for (var j = 0; j < btns.length; j++) btns[j].classList.remove('active');
    el('tab-' + tabName).style.display = 'block';
    document.querySelector('[data-tab="' + tabName + '"]').classList.add('active');
    // About Hitch is a full-width sibling rendered once; only show it on Overview.
    var about = el('about-hitch');
    if (about) about.style.display = (tabName === 'overview') ? 'block' : 'none';
  };

  function updateBadges(data) {
    var pCount = data.pipeline.length, oCount = data.organizations.length, iCount = data.interviews.length;
    if (pCount > 0) { var pb = el('pipeline-badge'); pb.textContent = pCount; pb.style.display = 'inline-flex'; }
    if (oCount > 0) {
      el('companies-tab-btn').style.display = 'flex';
      var ob = el('companies-badge'); ob.textContent = oCount; ob.style.display = 'inline-flex';
    }
    if (iCount > 0) { var ib = el('interviews-badge'); ib.textContent = iCount; ib.style.display = 'inline-flex'; }
  }

  // ── Header ──
  function populateHeader(data) {
    el('header-project-name').textContent = data.portal.search_project_name || '';
    if (data.portal.client_logo_url) {
      var img = el('client-logo-img');
      img.src = data.portal.client_logo_url;
      img.alt = companyFromProjectName(data.portal.search_project_name);
      img.style.display = 'block';
    } else {
      el('client-logo-fallback').textContent = companyFromProjectName(data.portal.search_project_name);
    }
  }

  // ── Quick Facts (Market Intelligence) ──
  var QF_TIER1 = { structure: 1, funding_or_market_cap: 1, headcount: 1 };
  var QF_LABELS = {
    founded: 'Founded', headquarters: 'Headquarters', structure: 'Structure',
    stage: 'Stage', funding_or_market_cap: 'Funding / Market Cap', investors: 'Investors',
    revenue: 'Revenue', headcount: 'Headcount', key_customers: 'Key Customers', key_executives: 'Key Executives'
  };
  var QF_ORDER = ['structure', 'funding_or_market_cap', 'headcount', 'founded', 'headquarters', 'stage', 'investors', 'revenue', 'key_customers', 'key_executives'];

  function renderQuickFacts(facts) {
    facts = facts || {};
    var rows = QF_ORDER.filter(function (k) { return String(facts[k] || '').trim(); }).map(function (k) {
      var cls = QF_TIER1[k] ? 'qf-value-tier1' : 'qf-value-tier2';
      return '<div class="qf-row"><div class="qf-label">' + escapeHtml(QF_LABELS[k] || k) +
        '</div><div class="' + cls + '">' + escapeHtml(facts[k]) + '</div></div>';
    }).join('');
    if (!rows) return '';
    return '<div class="quick-facts">' + rows + '</div>';
  }

  // ── Overview tab ──
  function renderOverview(data) {
    var p = data.portal;
    var mi = p.market_intelligence || {};
    var company = companyFromProjectName(p.search_project_name);
    var html = '';

    // Market Intelligence
    var overviewParas = paragraphs(mi.company_overview).map(function (para) { return '<p>' + escapeHtml(para) + '</p>'; }).join('');
    html += '<div class="section">' +
      '<div class="mi-grid">' +
        '<div>' +
          '<span class="eyebrow">Market Intelligence</span>' +
          '<h1 class="display-heading">' + escapeHtml(company) + '</h1>' +
          '<div class="body-large">' + (overviewParas || '') + '</div>' +
        '</div>' +
        '<div>' + renderQuickFacts(mi.quick_facts) + '</div>' +
      '</div>';
    var devParas = paragraphs(mi.recent_developments).map(function (para) { return '<p>' + escapeHtml(para) + '</p>'; }).join('');
    if (devParas) {
      html += '<div style="margin-top:48px;"><span class="eyebrow">Recent Developments</span><div class="body-large">' + devParas + '</div></div>';
    }
    html += '</div>';

    // The Role
    if (String(p.role_narrative || '').trim()) {
      html += '<div class="section"><span class="eyebrow">The Role</span>' +
        '<p class="role-narrative">' + escapeHtml(p.role_narrative) + '</p></div>';
    }

    // Core Mandate
    var bullets = (p.mandate_bullets || []).filter(function (b) { return String(b || '').trim(); });
    if (bullets.length) {
      html += '<div class="section"><span class="eyebrow">Core Mandate</span><ul class="mandate-list">' +
        bullets.map(function (b) { return '<li>' + boldBeforeDelimiter(b) + '</li>'; }).join('') +
        '</ul></div>';
    }

    // Reporting Structure
    if (String(p.reporting_structure || '').trim()) {
      html += '<div class="section"><span class="eyebrow">Reporting Structure</span>' +
        '<div class="reporting-card">' + escapeHtml(p.reporting_structure) + '</div></div>';
    }

    // Success Profile
    var sm = p.success_milestones || {};
    var cards = [
      ['First 90 Days', sm.first_90_days],
      ['6 Months', sm.six_months],
      ['12–18 Months', sm.twelve_to_eighteen_months]
    ];
    var hasMilestones = cards.some(function (c) { return Array.isArray(c[1]) && c[1].length; });
    if (hasMilestones) {
      html += '<div class="section"><span class="eyebrow">Success Profile</span><div class="success-grid">' +
        cards.map(function (c) {
          var items = (c[1] || []).filter(function (i) { return String(i || '').trim(); });
          return '<div class="success-card"><h4>' + escapeHtml(c[0]) + '</h4><ul>' +
            items.map(function (i) { return '<li>' + escapeHtml(i) + '</li>'; }).join('') +
            '</ul></div>';
        }).join('') +
        '</div></div>';
    }

    el('tab-overview').innerHTML = html;

    // About Hitch — appended full-width below the constrained panel.
    var existing = document.getElementById('about-hitch');
    if (existing) existing.remove();
    var about = document.createElement('div');
    about.id = 'about-hitch';
    about.className = 'about-hitch';
    about.innerHTML = '<div class="about-inner">' +
      '<span class="eyebrow">About Hitch Partners</span>' +
      '<h3>Your search team</h3>' +
      '<div class="about-contacts">' +
        ['piacente', 'starr'].map(function (key) {
          var c = CONTACTS[key];
          return '<div class="about-contact"><div class="name">' + escapeHtml(c.name) + '</div>' +
            '<div class="title">' + escapeHtml(c.title) + '</div>' +
            '<a href="mailto:' + escapeHtml(c.email) + '">' + escapeHtml(c.email) + '</a></div>';
        }).join('') +
      '</div>' +
      '<div class="about-conf">Strictly private &amp; confidential. This portal and its contents are intended solely for authorized interview panel members.</div>' +
    '</div>';
    el('state-portal').appendChild(about);
  }

  // ── Pipeline tab ──
  function renderCandidateCard(candidate) {
    var profileBtn = candidate.tile_url
      ? '<a href="' + escapeHtml(candidate.tile_url) + '" target="_blank" rel="noopener" class="btn-outline">View Profile →</a>'
      : '';
    return '<div class="card" style="display:flex; align-items:center; gap:20px;">' +
      '<div class="initials-avatar">' + escapeHtml(candidate.initials) + '</div>' +
      '<div style="flex:1;">' +
        '<div class="candidate-name">' + escapeHtml(candidate.name) + '</div>' +
        '<div class="candidate-meta">' + escapeHtml(candidate.title) + ' &nbsp;·&nbsp; ' + escapeHtml(candidate.company) + '</div>' +
      '</div>' + profileBtn +
    '</div>';
  }
  function renderPipeline(data) {
    var list = data.pipeline || [];
    var html = '<div class="section"><span class="eyebrow">Candidate Pipeline</span>';
    if (list.length === 0) {
      html += emptyState('No candidates selected yet', 'Your search team will select candidates for your review as the process advances.');
    } else {
      html += '<div class="count-line">' + list.length + ' selected for your review</div>' +
        '<div class="card-stack">' + list.map(renderCandidateCard).join('') + '</div>';
    }
    html += '</div>';
    el('tab-pipeline').innerHTML = html;
  }

  // ── Target Companies tab ──
  function renderOrgCard(org, idx) {
    var meta = [org.city, org.employee_count].filter(function (v) { return String(v || '').trim(); }).join(' · ');
    var current = (org.current_security_leaders || []).filter(Boolean);
    var previous = (org.previous_security_leaders || []).filter(Boolean);
    var html = '<div class="card" style="margin-bottom:12px;">' +
      '<div class="org-name">' + escapeHtml(org.name) + '</div>' +
      (meta ? '<div class="org-meta">' + escapeHtml(meta) + '</div>' : '<div style="height:8px"></div>');
    if (String(org.description || '').trim()) {
      html += '<div class="org-desc" id="desc-' + idx + '">' + escapeHtml(org.description) + '</div>' +
        '<button type="button" class="desc-toggle" id="desc-btn-' + idx + '" onclick="toggleDescription(' + idx + ')">Show more ↓</button>';
    }
    if (current.length) {
      html += '<div class="leader-row"><span class="leader-label">Current Security Leader:</span>' +
        current.map(function (n) { return '<span class="leader-current">' + escapeHtml(n) + '</span>'; }).join('') + '</div>';
    }
    if (previous.length) {
      html += '<div class="leader-row"><span class="leader-label">Previous:</span>' +
        previous.map(function (n) { return '<span class="leader-previous">' + escapeHtml(n) + '</span>'; }).join('') + '</div>';
    }
    html += '</div>';
    return html;
  }
  function renderCompanies(data) {
    var list = data.organizations || [];
    var html = '<div class="section"><span class="eyebrow">Target Companies</span>' +
      '<div class="subtext">Companies identified as priority sourcing targets for this search</div>' +
      list.map(renderOrgCard).join('') + '</div>';
    el('tab-companies').innerHTML = html;
  }
  window.toggleDescription = function (id) {
    var node = el('desc-' + id), btn = el('desc-btn-' + id);
    if (node.style.webkitLineClamp === 'unset') {
      node.style.webkitLineClamp = '3'; btn.textContent = 'Show more ↓';
    } else {
      node.style.webkitLineClamp = 'unset'; btn.textContent = 'Show less ↑';
    }
  };

  // ── My Interviews tab ──
  var VERDICTS = [
    { value: 'Yes', color: 'var(--verdict-yes)', bg: 'var(--verdict-yes-bg)' },
    { value: 'Soft Yes', color: 'var(--verdict-soft-yes)', bg: 'var(--verdict-soft-yes-bg)' },
    { value: 'Soft No', color: 'var(--verdict-soft-no)', bg: 'var(--verdict-soft-no-bg)' },
    { value: 'No', color: 'var(--verdict-no)', bg: 'var(--verdict-no-bg)' }
  ];
  function verdictMeta(value) {
    for (var i = 0; i < VERDICTS.length; i++) if (VERDICTS[i].value === value) return VERDICTS[i];
    return VERDICTS[0];
  }
  function verdictPillSelectable(v, idx, selected, sid) {
    var isSel = selected === v.value;
    var style = isSel
      ? 'background:' + v.color + '; color:#fff; font-weight:500; border:2px solid ' + v.color + ';'
      : 'border:1.5px solid ' + v.color + '; color:' + v.color + ';';
    var prefix = isSel ? '✓ ' : '';
    var cls = isSel ? 'verdict-pill sel' : 'verdict-pill';
    return '<button type="button" class="' + cls + '"' +
      (isSel ? ' data-sel="1"' : '') +
      ' data-sid="' + escapeHtml(sid) + '" data-verdict="' + escapeHtml(v.value) + '" ' +
      'style="' + style + '" onmouseover="if(!this.classList.contains(\\'sel\\'))this.style.background=\\'' + v.bg + '\\'" ' +
      'onmouseout="if(!this.classList.contains(\\'sel\\'))this.style.background=\\'transparent\\'" ' +
      'onclick="selectVerdict(this)">' + prefix + escapeHtml(v.value) + '</button>';
  }
  function verdictPillReadonly(value) {
    var v = verdictMeta(value);
    return '<span class="verdict-pill readonly" style="background:' + v.color + '; color:#fff; font-weight:500; border:2px solid ' + v.color + ';">✓ ' + escapeHtml(value) + '</span>';
  }
  function renderMeetingCard(iv) {
    var sid = iv.schedule_record_id;
    var head = '<div class="meeting-head"><div class="meeting-candidate">' + escapeHtml(iv.candidate_name) + '</div>' +
      '<div class="meeting-datetime">' + escapeHtml([iv.date, iv.time].filter(Boolean).join(' · ')) + '</div></div><hr class="meeting-divider">';

    if (iv.is_submitted && iv.token_matches) {
      // State B — submitted
      var panel = '';
      if (iv.panel_summary && iv.panel_summary.length) {
        panel = '<div class="panel-summary"><span class="eyebrow">Panel Summary</span><div class="verdict-row">' +
          iv.panel_summary.map(verdictPillReadonly).join('') + '</div></div>';
      }
      var notes = String(iv.notes || '').trim() ? '<div class="notes-block">' + escapeHtml(iv.notes) + '</div>' : '';
      return '<div class="meeting-card" id="card-' + escapeHtml(sid) + '">' + head +
        '<div class="recorded-row"><span class="recorded-label">✓ Feedback recorded</span>' +
        '<button type="button" class="edit-response" onclick="editResponse(\\'' + escapeHtml(sid) + '\\')">Edit response</button></div>' +
        '<div style="margin-top:14px;">' + verdictPillReadonly(iv.verdict) + '</div>' +
        notes + panel + '</div>';
    }

    // State A — not submitted (or editing)
    var pills = VERDICTS.map(function (v, i) { return verdictPillSelectable(v, i, iv.verdict, sid); }).join('');
    return '<div class="meeting-card" id="card-' + escapeHtml(sid) + '">' + head +
      '<span class="eyebrow">Your Assessment</span>' +
      '<div class="verdict-row">' + pills + '</div>' +
      '<textarea class="feedback-notes" id="notes-' + escapeHtml(sid) + '" placeholder="Additional context for the search team...">' + escapeHtml(iv.notes || '') + '</textarea>' +
      '<div><button type="button" class="btn-primary" onclick="submitFeedback(\\'' + escapeHtml(sid) + '\\')">Submit Assessment</button></div>' +
      '<div class="submit-error" id="err-' + escapeHtml(sid) + '" style="display:none">Something went wrong submitting your assessment. Please try again.</div>' +
    '</div>';
  }
  function renderInterviews(data) {
    var list = data.interviews || [];
    var first = String((data.session && data.session.interviewer_name) || '').split(/\\s+/)[0] || 'Your';
    var html = '<div class="section"><span class="eyebrow">My Interviews</span>';
    if (list.length === 0) {
      html += emptyState('No interviews scheduled yet', 'Your meetings will appear here once scheduled by the search team.');
    } else {
      html += '<div class="subtext">' + escapeHtml(first) + (first === 'Your' ? ' scheduled meetings' : '\\u2019s scheduled meetings') + '</div>' +
        list.map(renderMeetingCard).join('');
    }
    html += '</div>';
    el('tab-interviews').innerHTML = html;
  }

  window.selectVerdict = function (btn) {
    var sid = btn.getAttribute('data-sid');
    var pills = document.querySelectorAll('.verdict-pill[data-sid="' + sid + '"]');
    for (var i = 0; i < pills.length; i++) {
      var p = pills[i];
      var v = verdictMeta(p.getAttribute('data-verdict'));
      p.classList.remove('sel'); p.removeAttribute('data-sel');
      p.style.background = 'transparent'; p.style.color = v.color;
      p.style.fontWeight = '400'; p.style.border = '1.5px solid ' + v.color;
      p.textContent = p.getAttribute('data-verdict');
    }
    var vm = verdictMeta(btn.getAttribute('data-verdict'));
    btn.classList.add('sel'); btn.setAttribute('data-sel', '1');
    btn.style.background = vm.color; btn.style.color = '#fff';
    btn.style.fontWeight = '500'; btn.style.border = '2px solid ' + vm.color;
    btn.textContent = '✓ ' + btn.getAttribute('data-verdict');
  };

  window.editResponse = function (sid) {
    // Re-render the single card in State A using the stored interview data.
    var iv = (STATE.interviews || []).filter(function (x) { return x.schedule_record_id === sid; })[0];
    if (!iv) return;
    var clone = JSON.parse(JSON.stringify(iv));
    clone.is_submitted = false; // force State A while keeping existing verdict/notes
    var card = el('card-' + sid);
    if (card) card.outerHTML = renderMeetingCard(clone);
  };

  window.submitFeedback = function (sid) {
    var selected = document.querySelector('.verdict-pill.sel[data-sid="' + sid + '"]');
    var verdict = selected ? selected.getAttribute('data-verdict') : '';
    var notesNode = el('notes-' + sid);
    var notes = notesNode ? notesNode.value : '';
    var errNode = el('err-' + sid);
    if (errNode) errNode.style.display = 'none';
    if (!verdict) {
      if (errNode) { errNode.textContent = 'Please choose an assessment before submitting.'; errNode.style.display = 'block'; }
      return;
    }
    fetch('/api/portal-feedback', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: slug, schedule_record_id: sid, verdict: verdict, notes: notes })
    }).then(function (res) {
      if (!res.ok) throw new Error('submit_failed');
      // Update local state + transition to State B (optimistic).
      var ivs = STATE.interviews || [];
      for (var i = 0; i < ivs.length; i++) {
        if (ivs[i].schedule_record_id === sid) {
          ivs[i].verdict = verdict; ivs[i].notes = notes;
          ivs[i].is_submitted = true; ivs[i].token_matches = true;
          var card = el('card-' + sid);
          if (card) card.outerHTML = renderMeetingCard(ivs[i]);
          break;
        }
      }
    }).catch(function () {
      if (errNode) { errNode.textContent = 'Something went wrong submitting your assessment. Please try again.'; errNode.style.display = 'block'; }
    });
  };

  function emptyState(headline, body) {
    return '<div class="empty-state"><div class="placeholder-circle"></div>' +
      '<h3>' + escapeHtml(headline) + '</h3><p>' + escapeHtml(body) + '</p></div>';
  }

  // ── Orchestration ──
  function populatePortal(data) {
    STATE = data;
    populateHeader(data);
    updateBadges(data);
    renderOverview(data);
    renderPipeline(data);
    renderCompanies(data);
    renderInterviews(data);
  }

  function boot() {
    if (authError) showAuthError(authError);

    if (el('signin-project-name')) el('signin-project-name').textContent = '';
    el('linkedin-signin-btn').href = '/api/portal-auth/login?slug=' + encodeURIComponent(slug || '');

    showLoadingState();

    fetch('/api/portal-data?slug=' + encodeURIComponent(slug || ''), { credentials: 'include' })
      .then(function (res) {
        if (res.status === 401) { showSignInState(); return null; }
        if (!res.ok) { showSignInState(); return null; }
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        if (el('signin-project-name')) el('signin-project-name').textContent = data.portal.search_project_name || '';
        populatePortal(data);
        showPortalState();
      })
      .catch(function () { showSignInState(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
</script>
</body>
</html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(405).send('<h1>Method Not Allowed</h1>');
  }

  const { slug } = req.query || {};

  const sendAccessRestricted = () => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(accessRestrictedPage());
  };

  if (!slug) {
    return sendAccessRestricted();
  }

  // Liveness gate (not authentication): the portal renders only when a Searches
  // record exists for the slug and its portal_status is "Live".
  let searchRecord;
  try {
    const formula = `{${SEARCHES_FIELDS.PORTAL_SLUG}} = "${escapeFormulaValue(slug)}"`;
    const records = await getRecordsByFormula(TABLES.SEARCHES, formula);
    searchRecord = records && records[0];
  } catch (err) {
    log('error', { endpoint: 'portal-view', slug, error: err.message });
    return sendAccessRestricted();
  }

  if (!searchRecord) {
    return sendAccessRestricted();
  }

  const status = getFieldValue(searchRecord.fields, SEARCHES_FIELDS.PORTAL_STATUS, '');
  if (status !== 'Live') {
    return sendAccessRestricted();
  }

  const title = getFieldValue(searchRecord.fields, SEARCHES_FIELDS.NAME, '');

  log('portal_view_served', { slug });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(portalShell(title));
}

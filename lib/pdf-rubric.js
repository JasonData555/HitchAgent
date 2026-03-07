/**
 * Rubric PDF generator.
 *
 * createRubricPdf(data) → Promise<Buffer>  (complete PDF binary)
 *
 * Builds an HTML document representing the Requirements Alignment matrix
 * and renders it to a Letter Portrait PDF via Puppeteer (pdf-render.js).
 *
 * All images are embedded as base64 data URIs before rendering so
 * Puppeteer's network-isolation mode can block all external URLs.
 *
 * Color palette (matches PPTX):
 *   NAVY   #1B365D  — headings, domain names
 *   SLATE  #64748B  — body text, narrative
 *   ACCENT #0EA5E9  — accent line, footer bar
 *   WHITE  #FFFFFF  — slide background, footer text
 *   AMBER  #F59E0B  — conflict indicator
 */

import { imageToBase64, guessMimeType } from './fetch-image.js';
import { renderHtmlToPdf } from './pdf-render.js';

// ── Domain display label map ──────────────────────────────────────────────────
// Maps Airtable field names to human-readable display strings.
const DOMAIN_DISPLAY = {
  'Manage IT':                          'Manage IT',
  'ProdSec_AppSec':                     'ProdSec / AppSec',
  'GRC':                                'GRC',
  'Security Architecture':              'Security Architecture',
  'Network and Infrastructure Security': 'Network & Infra Security',
  'TPRM':                               'TPRM',
  'Data Protection and Privacy':        'Data Protection & Privacy',
  'IAM':                                'IAM',
  'Cloud Security':                     'Cloud Security',
  'Security Operations':                'Security Operations',
  'External Communication':             'External Communications',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Text-label fallback for Airtable single-select score values (e.g. "Must have")
const TEXT_SCORE_MAP = {
  'must have': 5,
  'important to have': 4,
  'nice to have': 3,
  'low priority': 2,
  'not important to have': 1,
};

/**
 * Parse a score value to a number.
 * Handles "5 - Must have" (numeric prefix) and plain text labels.
 * Returns null for N/A, empty, or unrecognised values.
 */
function parseScoreNum(value) {
  if (!value || value === 'N/A') return null;
  const n = parseInt(String(value), 10);
  if (!isNaN(n)) return n;
  return TEXT_SCORE_MAP[String(value).toLowerCase().trim()] ?? null;
}

/**
 * Calculate the mean score per domain across all panel members.
 * Returns an object keyed by domain name with rounded averages.
 * Domains where no panel member has a numeric score are omitted.
 */
function calcDomainAverages(panelMembers, domains) {
  const avgs = {};
  for (const domain of domains) {
    const scores = panelMembers
      .map((pm) => parseScoreNum(pm.scores[domain]))
      .filter((s) => s !== null);
    if (scores.length > 0) {
      avgs[domain] = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10;
    }
  }
  return avgs;
}

/** CSS class name for a score value's background colour. */
function scoreToClass(value) {
  const n = parseScoreNum(value);
  return n !== null ? `score-${n}` : '';
}

/** Short display label for a score value. */
function scoreToLabel(value) {
  const n = parseScoreNum(value);
  const labels = {
    5: 'Must Have',
    4: 'Very Imp.',
    3: 'Nice to Have',
    2: 'Low Priority',
    1: 'Not Imp.',
  };
  return n !== null && labels[n] ? labels[n] : '&mdash;';
}

/**
 * Format a panel member's display name as "First L." (first name + last initial).
 * Falls back to full name if only one word, or "Panel Member" if empty.
 */
function formatPanelName(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Panel Member';
  if (parts.length === 1) return escapeHtml(parts[0]);
  const firstName   = parts[0];
  const lastInitial = parts[parts.length - 1][0].toUpperCase();
  return escapeHtml(`${firstName} ${lastInitial}.`);
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildRubricHtml({
  clientName,
  panelMembers,
  domains,
  conflictSet,    // Set<string>
  conflictNarrative,
  hitchLogoData,
  clientLogoData,
  contextRows,    // Array<{ label, field }> — context rows for top data block
}) {
  const n = panelMembers.length;

  // Font sizes — same tiers as portrait, floored at spec minimums (8px matrix, 9px body)
  const headerFontSize = n >= 5 ? '9px'   : n >= 4 ? '10px' : '11px';
  const scoreFontSize  = n >= 5 ? '8px'   : n >= 4 ? '9px'  : '10px';
  const titleFontSize  = n >= 5 ? '7.5px' : n >= 4 ? '8px'  : '9px';
  const cellPadding    = n >= 5 ? '5px 3px' : '7px 5px';

  // Column widths for landscape (960px content width = 10" at 96dpi with 0.5" margins)
  // Section B — full-width top data table
  const B_LABEL_W = 180;
  const B_PANEL_W = Math.floor((960 - B_LABEL_W) / n);

  // Section C left column (62% of 960px ≈ 595px)
  const LEFT_W    = 595;
  const DOMAIN_W  = n >= 5 ? 130 : 150;
  const CONFLICT_W = 30;
  const PANEL_W   = Math.floor((LEFT_W - DOMAIN_W - CONFLICT_W) / n);

  // ── Logo markup ────────────────────────────────────────────────────────────
  const hitchLogoHtml = hitchLogoData
    ? `<img class="header-logo" src="${hitchLogoData}" alt="Hitch Partners">`
    : `<span class="header-logo-text">Hitch Partners</span>`;

  const clientLogoHtml = clientLogoData
    ? `<img class="header-logo" src="${clientLogoData}" alt="${escapeHtml(clientName || '')}">`
    : `<div class="header-logo-placeholder"></div>`;

  // ── Section B: top data block (full-width context rows) ───────────────────
  // contextRowDefs from matrix JSON; fall back to canonical list for backward compat.
  const contextRowDefs = Array.isArray(contextRows) && contextRows.length > 0
    ? contextRows
    : [
        { label: 'Position reports to',         field: 'reportsTo'        },
        { label: 'Current team size',           field: 'teamSizeToday'    },
        { label: 'Est. team size in 18 months', field: 'teamSize18Months' },
        { label: 'Location',                    field: 'location'         },
      ];

  const topColDefs = [
    `<col style="width:${B_LABEL_W}px">`,
    ...panelMembers.map(() => `<col style="width:${B_PANEL_W}px">`),
  ].join('');

  const topPanelHeaders = panelMembers.map((pm) =>
    `<th><div>${formatPanelName(pm.name)}</div>` +
    `<div class="pm-subtitle">(${escapeHtml(pm.title || '')})</div></th>`
  ).join('');

  const topDataRowsHtml = contextRowDefs.map(({ label, field }) => {
    const cells = panelMembers.map((pm) => {
      const rawVal = pm[field];
      const displayVal = rawVal ? escapeHtml(String(rawVal)) : '&mdash;';
      return `<td>${displayVal}</td>`;
    }).join('');
    return `<tr class="context-row">
      <td class="row-label-cell">${escapeHtml(label)}</td>
      ${cells}
    </tr>`;
  }).join('');

  // ── Section C left: domain matrix ─────────────────────────────────────────
  const matrixColDefs = [
    `<col style="width:${DOMAIN_W}px">`,
    ...panelMembers.map(() => `<col style="width:${PANEL_W}px">`),
    `<col style="width:${CONFLICT_W}px">`,
  ].join('');

  const matrixPanelHeaders = panelMembers.map((pm) =>
    `<th><div>${formatPanelName(pm.name)}</div>` +
    `<div class="pm-subtitle">(${escapeHtml(pm.title || '')})</div></th>`
  ).join('');

  const domainRows = domains.map((domain) => {
    const displayName = DOMAIN_DISPLAY[domain] || domain;
    const isConflict  = conflictSet.has(domain);

    const scoreCells = panelMembers.map((pm) => {
      const score = pm.scores[domain] || '';
      const cls   = scoreToClass(score);
      const label = scoreToLabel(score);
      return `<td class="${cls}">${label}</td>`;
    }).join('');

    const conflictCell = isConflict
      ? `<td class="conflict-cell"><span class="conflict-icon">!</span></td>`
      : `<td class="conflict-cell"></td>`;

    return `<tr>
      <td class="domain-cell">${escapeHtml(displayName)}</td>
      ${scoreCells}
      ${conflictCell}
    </tr>`;
  }).join('');

  // ── Section C right: priority sections ────────────────────────────────────
  const domainAverages = calcDomainAverages(panelMembers, domains);

  const mustHave = domains
    .filter((d) => (domainAverages[d] ?? -1) >= 4.0)
    .sort((a, b) => (domainAverages[b] ?? 0) - (domainAverages[a] ?? 0));

  const niceToHave = domains
    .filter((d) => (domainAverages[d] ?? -1) >= 3.0 && (domainAverages[d] ?? -1) < 4.0)
    .sort((a, b) => (domainAverages[b] ?? 0) - (domainAverages[a] ?? 0));

  const notImportant = domains
    .filter((d) => domainAverages[d] !== undefined && (domainAverages[d] ?? -1) < 3.0)
    .sort((a, b) => (domainAverages[b] ?? 0) - (domainAverages[a] ?? 0));

  function priorityList(domainList) {
    if (domainList.length === 0) {
      return '<p class="priority-empty">No domains scored in this range.</p>';
    }
    return '<ul class="priority-list">' +
      domainList.map((d) => `<li>${escapeHtml(DOMAIN_DISPLAY[d] || d)}</li>`).join('') +
      '</ul>';
  }

  // ── Full HTML document ─────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Role Requirements Alignment — ${escapeHtml(clientName || '')}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 9px;
      line-height: 1.35;
      color: #374151;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* Page wrapper — padding-bottom reserves space for the fixed footer */
    .page-wrapper {
      padding-bottom: 40px;
    }

    /* ── Section A: Header ───────────────────────────────────────────────── */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 6px;
    }

    .header-logo {
      height: 48px;
      max-width: 140px;
      object-fit: contain;
      flex-shrink: 0;
    }

    .header-logo-text {
      font-size: 11px;
      font-weight: 700;
      color: #1B365D;
      min-width: 80px;
      flex-shrink: 0;
    }

    .header-logo-placeholder {
      min-width: 80px;
      flex-shrink: 0;
    }

    .header-title-block {
      flex: 1;
      text-align: center;
    }

    .header-main-title {
      font-size: 18px;
      font-weight: 700;
      color: #1B365D;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .accent-line {
      height: 3px;
      background: #0EA5E9;
      margin: 0 0 8px;
    }

    /* ── Section B: Top data table (full width) ──────────────────────────── */
    .top-data-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: ${scoreFontSize};
      margin-bottom: 8px;
    }

    .top-data-table thead th {
      background: #1B365D;
      color: #ffffff;
      font-weight: 700;
      font-size: ${headerFontSize};
      border: 1px solid #1B365D;
      padding: ${cellPadding};
      text-align: center;
      vertical-align: middle;
      line-height: 1.3;
    }

    .top-data-table td {
      border: 1px solid #E5E7EB;
      padding: ${cellPadding};
      text-align: center;
      vertical-align: middle;
    }

    .top-data-table .context-row td {
      background-color: #F8FAFC;
      color: #1B365D;
    }

    .row-label-cell {
      text-align: left !important;
      font-weight: 600;
      color: #1B365D;
    }

    /* ── Section C: Two-column layout ───────────────────────────────────── */
    .two-col {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      margin-bottom: 8px;
    }

    .col-left {
      width: 62%;
      flex-shrink: 0;
    }

    .col-right {
      flex: 1;
      min-width: 0;
    }

    /* ── Matrix table (left column) ──────────────────────────────────────── */
    .matrix-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: ${scoreFontSize};
      margin-bottom: 6px;
    }

    .matrix-table th,
    .matrix-table td {
      border: 1px solid #E5E7EB;
      padding: ${cellPadding};
      text-align: center;
      vertical-align: middle;
      word-break: break-word;
    }

    .matrix-table thead th {
      background: #1B365D;
      color: #ffffff;
      font-weight: 700;
      font-size: ${headerFontSize};
      border-color: #1B365D;
      line-height: 1.3;
    }

    .pm-subtitle {
      font-weight: normal;
      font-size: ${titleFontSize};
      margin-top: 1px;
    }

    .domain-cell {
      text-align: left;
      color: #1B365D;
      font-weight: 500;
      font-size: ${headerFontSize};
      padding-left: 5px;
    }

    .conflict-cell {
      width: ${CONFLICT_W}px;
      text-align: center;
    }

    .conflict-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #DC2626;
      color: #ffffff;
      font-size: 13px;
      font-weight: bold;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      line-height: 1;
    }

    /* Score cell background colours */
    .score-5 { background-color: #0D9488; color: #ffffff; }
    .score-4 { background-color: #5EEAD4; color: #1B365D; }
    .score-3 { background-color: #A5F3FC; color: #1B365D; }
    .score-2 { background-color: #D4D4D8; color: #374151; }
    .score-1 { background-color: #F87171; color: #ffffff; }

    /* ── Legend (inside left column) ─────────────────────────────────────── */
    .legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      font-size: 9px;
      margin-bottom: 6px;
    }

    .legend-conflict-note {
      display: flex;
      align-items: center;
      gap: 3px;
    }

    .legend-scores {
      display: flex;
      gap: 5px;
      align-items: center;
      flex-wrap: wrap;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .legend-swatch {
      display: inline-block;
      width: 8px;
      height: 8px;
      border: 1px solid #E5E7EB;
      flex-shrink: 0;
    }

    /* ── Priority sections (right column) ────────────────────────────────── */
    .priority-section {
      margin-bottom: 8px;
    }

    .priority-header {
      font-size: 10px;
      font-weight: 700;
      padding: 5px 8px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .must-have-header     { background-color: #0D9488; color: #ffffff; }
    .nice-to-have-header  { background-color: #A5F3FC; color: #1B365D; }
    .not-important-header { background-color: #E5E7EB; color: #374151; }

    .priority-list {
      list-style-type: disc;
      padding-left: 14px;
      margin: 0;
    }

    .priority-list li {
      font-size: 9px;
      line-height: 1.5;
      color: #374151;
      padding: 1px 0;
    }

    .priority-empty {
      font-size: 9px;
      color: #9CA3AF;
      font-style: italic;
      padding-left: 4px;
    }

    /* ── Section D: Conflict Narrative ───────────────────────────────────── */
    .divider {
      height: 1px;
      background: #E5E7EB;
      margin: 6px 0 6px;
    }

    .summary-title {
      font-size: 13px;
      font-weight: 700;
      color: #1B365D;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .narrative {
      font-size: 9px;
      color: #64748B;
      line-height: 1.5;
    }

    /* ── Footer ──────────────────────────────────────────────────────────── */
    .footer {
      height: 26px;
      background: #0EA5E9;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .footer-text {
      color: #ffffff;
      font-size: 9px;
      font-style: italic;
    }

    /* ── Print rules ─────────────────────────────────────────────────────── */
    @media print {
      @page {
        size: Letter landscape;
        margin: 0.5in;   /* must match page.pdf() margin in pdf-render.js */
      }

      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .footer {
        position: fixed;
        bottom: 10px;
        left: 0;
        right: 0;
        width: 100%;
      }

      .page-wrapper {
        min-height: unset;
        padding-bottom: 10px;
      }
    }
  </style>
</head>
<body>
<div class="page-wrapper">

  <!-- Section A: Header -->
  <div class="header">
    ${hitchLogoHtml}
    <div class="header-title-block">
      <div class="header-main-title">Role Requirements Alignment</div>
    </div>
    ${clientLogoHtml}
  </div>

  <div class="accent-line"></div>

  <!-- Section B: Top data block (full width) -->
  <table class="top-data-table">
    <colgroup>${topColDefs}</colgroup>
    <thead>
      <tr>
        <th class="row-label-cell"></th>
        ${topPanelHeaders}
      </tr>
    </thead>
    <tbody>
      ${topDataRowsHtml}
    </tbody>
  </table>

  <!-- Section C: Two-column layout -->
  <div class="two-col">

    <!-- Left column: Rubric matrix + legend -->
    <div class="col-left">
      <table class="matrix-table">
        <colgroup>${matrixColDefs}</colgroup>
        <thead>
          <tr>
            <th class="domain-cell">DOMAIN</th>
            ${matrixPanelHeaders}
            <th class="conflict-cell"></th>
          </tr>
        </thead>
        <tbody>
          ${domainRows}
        </tbody>
      </table>
      <div class="legend">
        <span class="legend-conflict-note"><span class="conflict-icon">!</span>&nbsp;= Conflict (2+ point spread)</span>
        <div class="legend-scores">
          <div class="legend-item"><span class="legend-swatch score-5"></span>&nbsp;Must Have</div>
          <div class="legend-item"><span class="legend-swatch score-4"></span>&nbsp;Very Imp.</div>
          <div class="legend-item"><span class="legend-swatch score-3"></span>&nbsp;Nice to Have</div>
          <div class="legend-item"><span class="legend-swatch score-2"></span>&nbsp;Low Priority</div>
          <div class="legend-item"><span class="legend-swatch score-1"></span>&nbsp;Not Imp.</div>
        </div>
      </div>
    </div>

    <!-- Right column: Priority sections -->
    <div class="col-right">
      <div class="priority-section">
        <div class="priority-header must-have-header">Must Have</div>
        ${priorityList(mustHave)}
      </div>
      <div class="priority-section">
        <div class="priority-header nice-to-have-header">Nice to Have</div>
        ${priorityList(niceToHave)}
      </div>
      <div class="priority-section">
        <div class="priority-header not-important-header">Not Important</div>
        ${priorityList(notImportant)}
      </div>
    </div>

  </div>

  <!-- Section D: Conflict Narrative -->
  <div class="divider"></div>
  <p class="summary-title">Conflict Narrative</p>
  <p class="narrative">${escapeHtml(conflictNarrative || '')}</p>

</div>

<!-- Footer -->
<footer class="footer">
  <span class="footer-text">Hitch Partners &lt;&gt; Confidential &amp; Proprietary</span>
</footer>

</body>
</html>`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate the Requirements Alignment PDF.
 *
 * @param {{
 *   clientName: string,
 *   searchName: string,
 *   contextRows: Array<{ label: string, field: string }>,
 *   panelMembers: Array<{ name: string, title: string, reportsTo: string, teamSizeToday: string, teamSize18Months: string, scores: object }>,
 *   domains: string[],
 *   conflicts: string[],
 *   conflictNarrative: string,
 *   hitchLogoUrl: string | null,
 *   clientLogoUrl: string | null
 * }} data
 * @returns {Promise<Buffer>} PDF binary
 */
export async function createRubricPdf({
  clientName,
  searchName,
  contextRows,
  panelMembers,
  domains,
  conflicts,
  conflictNarrative,
  hitchLogoUrl,
  clientLogoUrl,
}) {
  // Download both logos as base64 data URIs in parallel (silent failures are OK)
  const [hitchLogoData, clientLogoData] = await Promise.all([
    hitchLogoUrl  ? imageToBase64(hitchLogoUrl,  guessMimeType(hitchLogoUrl))  : Promise.resolve(null),
    clientLogoUrl ? imageToBase64(clientLogoUrl, guessMimeType(clientLogoUrl)) : Promise.resolve(null),
  ]);

  const html = buildRubricHtml({
    clientName,
    panelMembers,
    domains,
    conflictSet: new Set(conflicts),
    conflictNarrative,
    hitchLogoData,
    clientLogoData,
    contextRows,
  });

  return renderHtmlToPdf(html, { landscape: true });
}

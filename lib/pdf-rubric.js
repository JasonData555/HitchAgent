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

/**
 * Parse the leading digit from a score value like "5 - Must have".
 * Returns null for N/A, empty, or unrecognised values.
 */
function parseScoreNum(value) {
  if (!value || value === 'N/A') return null;
  const n = parseInt(String(value), 10);
  return isNaN(n) ? null : n;
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
  contextRows,    // Array<{ label, field }> — context rows above domain rows
}) {
  const n = panelMembers.length;

  // Header/domain font: 11px → 10px → 9px (3/4/5 panel members)
  const headerFontSize = n >= 5 ? '9px'   : n >= 4 ? '10px' : '11px';
  // Score cells: one step smaller than header
  const scoreFontSize  = n >= 5 ? '8px'   : n >= 4 ? '9px'  : '10px';
  // Panel member subtitle (title row under name)
  const titleFontSize  = n >= 5 ? '7.5px' : n >= 4 ? '8px'  : '9px';
  // Cell padding: generous at 3–4 members, tighter at 5
  const cellPadding    = n >= 5 ? '6px 4px' : '10px 8px';

  // Column widths (pixels, at 96 dpi on 720px usable width)
  // Domain column narrows at 5 members to reclaim space for panel columns
  const DOMAIN_W   = n >= 5 ? 140 : 160;
  const CONFLICT_W = 36;
  const PANEL_W    = Math.floor((720 - DOMAIN_W - CONFLICT_W) / n);

  // ── Logo markup ────────────────────────────────────────────────────────────
  const hitchLogoHtml = hitchLogoData
    ? `<img class="header-logo" src="${hitchLogoData}" alt="Hitch Partners">`
    : `<span class="header-logo-text">Hitch Partners</span>`;

  const clientLogoHtml = clientLogoData
    ? `<img class="header-logo" src="${clientLogoData}" alt="${escapeHtml(clientName || '')}">`
    : `<div class="header-logo-placeholder"></div>`;

  // ── Table column definitions ───────────────────────────────────────────────
  const colDefs = [
    `<col style="width:${DOMAIN_W}px">`,
    ...panelMembers.map(() => `<col style="width:${PANEL_W}px">`),
    `<col style="width:${CONFLICT_W}px">`,
  ].join('');

  // ── Panel member header cells ──────────────────────────────────────────────
  const panelHeaders = panelMembers.map((pm) =>
    `<th><div>${formatPanelName(pm.name)}</div>` +
    `<div class="pm-subtitle">(${escapeHtml(pm.title || '')})</div></th>`
  ).join('');

  // ── Context rows (position reports to, team size) ─────────────────────────
  // contextRowDefs comes from the parsed matrix JSON; fall back to the canonical
  // list so that rubrics approved before this change still render correctly.
  const contextRowDefs = Array.isArray(contextRows) && contextRows.length > 0
    ? contextRows
    : [
        { label: 'Position reports to',         field: 'reportsTo'        },
        { label: 'Current team size',           field: 'teamSizeToday'    },
        { label: 'Est. team size in 18 months', field: 'teamSize18Months' },
      ];

  const contextRowsHtml = contextRowDefs.map(({ label, field }) => {
    const cells = panelMembers.map((pm) => {
      const rawVal = pm[field];
      const displayVal = rawVal ? escapeHtml(String(rawVal)) : '&mdash;';
      return `<td>${displayVal}</td>`;
    }).join('');
    return `<tr class="context-row">
      <td class="domain-cell">${escapeHtml(label)}</td>
      ${cells}
      <td class="conflict-cell"></td>
    </tr>`;
  }).join('');

  const separatorRow = `<tr class="separator-row">
    <td colspan="${panelMembers.length + 2}"></td>
  </tr>`;

  // ── Domain data rows ───────────────────────────────────────────────────────
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
      font-size: 11px;
      line-height: 1.35;
      color: #374151;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* Page wrapper — padding-bottom reserves space for the fixed footer */
    .page-wrapper {
      padding-bottom: 46px;
    }

    /* ── Header ──────────────────────────────────────────────────────────── */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 6px;
    }

    .header-logo {
      height: 52px;
      max-width: 155px;
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
      font-size: 20px;
      font-weight: 700;
      color: #1B365D;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .accent-line {
      height: 3px;
      background: #0EA5E9;
      margin: 0 0 10px;
    }

    /* ── Matrix table ────────────────────────────────────────────────────── */
    .matrix-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: ${scoreFontSize};
      margin-bottom: 8px;
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

    /* Conflict column */
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
      font-size: 16px;
      font-weight: bold;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      line-height: 1;
    }

    /* Context rows (position reports to, team size) */
    .context-row td {
      background-color: #F8FAFC;
      font-size: ${scoreFontSize};
      text-align: center;
      padding: ${cellPadding};
      color: #1B365D;
      font-weight: 500;
    }
    .context-row td.domain-cell {
      text-align: left;
      font-weight: 600;
    }

    /* Separator between context rows and domain rows */
    .separator-row td {
      padding: 0;
      height: 3px;
      background-color: #0EA5E9;
      border: none;
    }

    /* Score cell background colours */
    .score-5 { background-color: #0D9488; color: #ffffff; }
    .score-4 { background-color: #5EEAD4; color: #1B365D; }
    .score-3 { background-color: #A5F3FC; color: #1B365D; }
    .score-2 { background-color: #D4D4D8; color: #374151; }
    .score-1 { background-color: #F87171; color: #ffffff; }

    /* ── Legend ──────────────────────────────────────────────────────────── */
    .legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      margin-bottom: 10px;
    }

    .legend-conflict-note {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .legend-scores {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 3px;
    }

    .legend-swatch {
      display: inline-block;
      width: 10px;
      height: 10px;
      border: 1px solid #E5E7EB;
      flex-shrink: 0;
    }

    /* ── Alignment Summary ───────────────────────────────────────────────── */
    .divider {
      height: 1px;
      background: #E5E7EB;
      margin: 6px 0 8px;
    }

    .summary-title {
      font-size: 18px;
      font-weight: 700;
      color: #1B365D;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 5px;
    }

    .narrative {
      font-size: 13px;
      color: #64748B;
      line-height: 1.5;
    }

    /* ── Footer ──────────────────────────────────────────────────────────── */
    .footer {
      height: 28px;
      background: #0EA5E9;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: auto;
    }

    .footer-text {
      color: #ffffff;
      font-size: 9px;
      font-style: italic;
    }

    /* ── Print rules ─────────────────────────────────────────────────────── */
    @media print {
      @page {
        size: Letter portrait;
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
        padding-bottom: 46px;   /* footer height (28) + offset (10) + 8px buffer */
      }
    }
  </style>
</head>
<body>
<div class="page-wrapper">

  <!-- Header -->
  <div class="header">
    ${hitchLogoHtml}
    <div class="header-title-block">
      <div class="header-main-title">Role Requirements Alignment</div>
    </div>
    ${clientLogoHtml}
  </div>

  <div class="accent-line"></div>

  <!-- Matrix table -->
  <table class="matrix-table">
    <colgroup>${colDefs}</colgroup>
    <thead>
      <tr>
        <th class="domain-cell">DOMAIN</th>
        ${panelHeaders}
        <th class="conflict-cell"></th>
      </tr>
    </thead>
    <tbody>
      ${contextRowsHtml}
      ${separatorRow}
      ${domainRows}
    </tbody>
  </table>

  <!-- Legend -->
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

  <!-- Alignment Summary -->
  <div class="divider"></div>
  <p class="summary-title">Alignment Summary</p>
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

  return renderHtmlToPdf(html);
}

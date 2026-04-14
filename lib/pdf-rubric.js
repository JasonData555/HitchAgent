/**
 * Rubric PDF generator — current data model (role requirements brief format).
 *
 * createRubricPdf(data) → Promise<Buffer>  (PDF bytes)
 *
 * Renders a Letter-portrait PDF with:
 *   - Header (Hitch logo, title, client info)
 *   - Role context bar (Location, Team Size, Est. Team Size, Reports To)
 *   - Section cards: Functional Responsibility, Success in Role,
 *     Must Have, Nice to Have, Red Flags
 *   - Fixed footer (navy, "Hitch Partners <> Confidential & Proprietary")
 *
 * Color palette matches the Candidate Tile PDF:
 *   NAVY   #1B365D  — headings, header background, footer background
 *   SLATE  #64748B  — body text
 *   ACCENT #0EA5E9  — header divider line
 *   WHITE  #FFFFFF  — background, footer text
 */

import { imageToBase64, guessMimeType } from './fetch-image.js';
import { renderHtmlToPdf } from './pdf-render.js';

// ── HTML escaping ──────────────────────────────────────────────────────────────
function esc(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Text helpers ───────────────────────────────────────────────────────────────

/** Replace Unicode arrow characters with ASCII equivalents. */
function replaceArrows(text) {
  if (!text) return '';
  return text
    .replace(/→/g, 'to')
    .replace(/←/g, 'from')
    .replace(/↑/g, 'up')
    .replace(/↓/g, 'down');
}

/**
 * Convert **text** markdown spans to <strong>text</strong> HTML.
 */
function inlineBold(text) {
  return (text || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/**
 * Parse a field's plain-text content into an HTML block for PDF rendering.
 *
 * Rules:
 *   - Lines trimmed to "**text**" only (full-line bold, no "-" prefix) →
 *     <p class="bold-line"><strong>text</strong></p>  (no bullet)
 *   - Lines starting with "- " → <li> bullet items in <ul>
 *   - Inline **..** within any line → <strong>
 *   - Empty lines → ignored
 *   - All text HTML-escaped; Unicode arrows replaced
 */
function fieldToHtml(text) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const parts = [];
  let inList = false;

  for (const rawLine of lines) {
    const trimmed = replaceArrows(rawLine.trim());
    if (!trimmed) {
      if (inList) { parts.push('</ul>'); inList = false; }
      continue;
    }

    // Full-line bold: "**label**" or "**label: something**"
    if (/^\*\*.+\*\*$/.test(trimmed)) {
      if (inList) { parts.push('</ul>'); inList = false; }
      const inner = esc(trimmed.replace(/^\*\*|\*\*$/g, ''));
      parts.push(`<p class="bold-line"><strong>${inner}</strong></p>`);
      continue;
    }

    // Bullet line: starts with "- "
    if (trimmed.startsWith('- ') || trimmed === '-') {
      if (!inList) { parts.push('<ul>'); inList = true; }
      const content = inlineBold(esc(trimmed.replace(/^-\s*/, '')));
      parts.push(`<li>${content}</li>`);
      continue;
    }

    // Plain paragraph
    if (inList) { parts.push('</ul>'); inList = false; }
    parts.push(`<p>${inlineBold(esc(trimmed))}</p>`);
  }

  if (inList) parts.push('</ul>');
  return parts.join('\n');
}

// ── CSS ────────────────────────────────────────────────────────────────────────
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif;
    font-size: 11px;
    line-height: 1.4;
    color: #1F2937;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page-wrapper {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    padding-bottom: 46px;
  }

  /* ── Header ─────────────────────────────────────────────────────────── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0 8px;
    border-bottom: 3px solid #0EA5E9;
    margin-bottom: 10px;
    flex-shrink: 0;
  }

  .header-logo img {
    max-height: 32px;
    max-width: 120px;
    object-fit: contain;
  }

  .header-logo-text {
    font-size: 13px;
    font-weight: 700;
    color: #1B365D;
  }

  .header-center {
    text-align: center;
    flex: 1;
    padding: 0 12px;
  }

  .header-title {
    font-size: 15px;
    font-weight: 700;
    color: #1B365D;
    letter-spacing: 0.01em;
  }

  .header-subtitle {
    font-size: 11px;
    color: #64748B;
    margin-top: 2px;
  }

  .header-client-logo img {
    max-height: 32px;
    max-width: 120px;
    object-fit: contain;
  }

  .header-client-name {
    font-size: 12px;
    font-weight: 600;
    color: #1B365D;
    text-align: right;
  }

  /* ── Context bar ─────────────────────────────────────────────────────── */
  .context-bar {
    display: flex;
    gap: 0;
    margin-bottom: 14px;
    border: 1px solid #E2E8F0;
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .context-cell {
    flex: 1;
    padding: 6px 10px;
    border-right: 1px solid #E2E8F0;
  }

  .context-cell:last-child {
    border-right: none;
  }

  .context-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #1B365D;
    margin-bottom: 2px;
  }

  .context-value {
    font-size: 10px;
    color: #1F2937;
    line-height: 1.3;
  }

  /* ── Section cards ───────────────────────────────────────────────────── */
  .section {
    margin-bottom: 12px;
  }

  .section-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #1B365D;
    margin-bottom: 5px;
    padding-bottom: 3px;
    border-bottom: 1px solid #E2E8F0;
  }

  .section-body {
    font-size: 11px;
    line-height: 1.4;
    color: #1F2937;
  }

  .section-body ul {
    list-style-type: disc;
    padding-left: 16px;
    margin: 0;
  }

  .section-body li {
    margin-bottom: 2px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .section-body p {
    margin-bottom: 3px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .section-body .bold-line {
    font-size: 11px;
    margin-bottom: 3px;
    margin-top: 4px;
  }

  .section-body .bold-line:first-child {
    margin-top: 0;
  }

  .empty-msg {
    color: #9CA3AF;
    font-style: italic;
  }

  /* ── Footer ─────────────────────────────────────────────────────────── */
  .footer {
    height: 30px;
    background: #1B365D;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: auto;
  }

  .footer-text {
    color: #ffffff;
    font-size: 11px;
    letter-spacing: 0.05em;
    font-style: italic;
  }

  /* ── Print rules ─────────────────────────────────────────────────────── */
  @media print {
    @page {
      size: Letter portrait;
      margin: 0.5in 0.5in 0.1in 0.5in;
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
      padding-bottom: 46px;
    }
  }
`;

// ── HTML builder ───────────────────────────────────────────────────────────────

function buildRubricHtml({
  clientName,
  searchName,
  location,
  currentTeamSize,
  teamSize18Months,
  positionReportsTo,
  mustHave,
  niceToHave,
  redFlags,
  successInRole,
  functionalResponsibility,
  hitchLogoDataUri,
  clientLogoDataUri,
}) {
  // ── Header ────────────────────────────────────────────────────────────────
  const hitchLogoHtml = hitchLogoDataUri
    ? `<img src="${hitchLogoDataUri}" alt="Hitch Partners">`
    : `<span class="header-logo-text">Hitch Partners</span>`;

  const subtitleParts = [clientName, searchName].filter(Boolean);
  const subtitleHtml = subtitleParts.length
    ? `<div class="header-subtitle">${esc(subtitleParts.join(' \u2014 '))}</div>`
    : '';

  const clientSideHtml = clientLogoDataUri
    ? `<div class="header-client-logo"><img src="${clientLogoDataUri}" alt="${esc(clientName || '')}"></div>`
    : clientName
      ? `<div class="header-client-name">${esc(clientName)}</div>`
      : '';

  // ── Context bar ───────────────────────────────────────────────────────────
  const contextCells = [
    { label: 'Location',                  value: location },
    { label: 'Current Team Size',         value: currentTeamSize },
    { label: 'Est. Team Size (18\u201324 mo)', value: teamSize18Months },
    { label: 'Position Reports To',       value: positionReportsTo },
  ].map(({ label, value }) => `
    <div class="context-cell">
      <div class="context-label">${esc(label)}</div>
      <div class="context-value">${value ? esc(value) : '<span style="color:#9CA3AF">\u2014</span>'}</div>
    </div>`).join('');

  // ── Section builder ───────────────────────────────────────────────────────
  function section(label, content) {
    const bodyHtml = content && content.trim()
      ? fieldToHtml(content)
      : '<p class="empty-msg">No items specified.</p>';
    return `
  <div class="section">
    <div class="section-label">${esc(label)}</div>
    <div class="section-body">${bodyHtml}</div>
  </div>`;
  }

  const functionalSection = functionalResponsibility?.trim()
    ? section('Functional Responsibility', functionalResponsibility)
    : '';
  const successSection = successInRole?.trim()
    ? section('Success in Role', successInRole)
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Role Requirements Brief \u2014 ${esc(clientName || '')}</title>
  <style>${CSS}</style>
</head>
<body>
<div class="page-wrapper">

  <!-- Header -->
  <header class="header">
    <div class="header-logo">${hitchLogoHtml}</div>
    <div class="header-center">
      <div class="header-title">Role Requirements Brief</div>
      ${subtitleHtml}
    </div>
    ${clientSideHtml}
  </header>

  <!-- Role context bar -->
  <div class="context-bar">${contextCells}</div>

  <!-- Sections -->
  ${functionalSection}
  ${successSection}
  ${section('Must Have',    mustHave)}
  ${section('Nice to Have', niceToHave)}
  ${section('Red Flags',    redFlags)}

  <!-- Footer -->
  <footer class="footer">
    <span class="footer-text">Hitch Partners &lt;&gt; Confidential &amp; Proprietary</span>
  </footer>

</div>
</body>
</html>`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Generate a rubric PDF from the current role requirements data model.
 *
 * @param {{ clientName, searchName, location, currentTeamSize, teamSize18Months,
 *           positionReportsTo, mustHave, niceToHave, redFlags,
 *           successInRole, functionalResponsibility,
 *           hitchLogoUrl, clientLogoUrl }} data
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function createRubricPdf({
  clientName,
  searchName,
  location,
  currentTeamSize,
  teamSize18Months,
  positionReportsTo,
  mustHave,
  niceToHave,
  redFlags,
  successInRole,
  functionalResponsibility,
  hitchLogoUrl,
  clientLogoUrl,
}) {
  // Fetch logos as base64 data URIs in parallel (non-fatal if unavailable)
  const [hitchLogoDataUri, clientLogoDataUri] = await Promise.all([
    hitchLogoUrl
      ? imageToBase64(hitchLogoUrl, guessMimeType(hitchLogoUrl)).catch(() => null)
      : Promise.resolve(null),
    clientLogoUrl
      ? imageToBase64(clientLogoUrl, guessMimeType(clientLogoUrl)).catch(() => null)
      : Promise.resolve(null),
  ]);

  const htmlString = buildRubricHtml({
    clientName,
    searchName,
    location,
    currentTeamSize,
    teamSize18Months,
    positionReportsTo,
    mustHave,
    niceToHave,
    redFlags,
    successInRole,
    functionalResponsibility,
    hitchLogoDataUri,
    clientLogoDataUri,
  });

  return renderHtmlToPdf(htmlString, { bottomMargin: '0.1in' });
}

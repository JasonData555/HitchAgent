/**
 * Rubric HTML document builder — unified template for both HTML and PDF outputs.
 *
 * buildRubricDocument(data) → string  (complete self-contained HTML)
 *
 * The returned HTML serves two purposes:
 *   1. Uploaded directly to Vercel Blob as an interactive web page (generate-rubric-html.js)
 *   2. Passed to renderHtmlToPdf() via Puppeteer for a static PDF (generate-rubric-pdf.js)
 *
 * Screen view: expand/collapse per section (vanilla JS), fade gradient, View More button.
 * Print / PDF: @media print expands all sections, hides buttons, footer fixed to every page.
 *
 * Design system:
 *   Font:       Inter (Google Fonts), fallback Helvetica Neue / Arial
 *   Navy:       #0F2D52
 *   Accents:    FR+SR #0F2D52 / Must Have #166534 / Nice to Have #1D4ED8 / Red Flags #991B1B
 *   Page bg:    #FFFFFF
 *   PDF:        US Letter portrait, 0.6in margins all sides
 */

import { imageToBase64, guessMimeType } from './fetch-image.js';

// ── HTML helpers ────────────────────────────────────────────────────────────────

function esc(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function replaceArrows(text) {
  if (!text) return '';
  return text
    .replace(/→/g, 'to')
    .replace(/←/g, 'from')
    .replace(/↑/g, 'up')
    .replace(/↓/g, 'down');
}

function inlineBold(text) {
  return (text || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/** Count lines beginning with '-' in a field value. */
function countBullets(text) {
  if (!text) return 0;
  return text.split(/\r?\n/).filter(l => l.trim().startsWith('-')).length;
}

/**
 * Parse field value into blocks: [{ heading: string|null, items: string[] }]
 * A new block begins on each full-line **bold** heading.
 * Lines starting with '-' are bullet items. Plain text and empty lines are skipped.
 */
function parseBlocks(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let current = { heading: null, items: [], plains: [] };

  for (const rawLine of lines) {
    const trimmed = replaceArrows(rawLine.trim());
    if (!trimmed) continue;

    // Full-line bold heading: **text** or **text: more**
    if (/^\*\*.+\*\*$/.test(trimmed)) {
      // Save current block if it has items
      if (current.items.length > 0 || current.plains.length > 0 || current.heading !== null) {
        blocks.push(current);
      }
      current = {
        heading: trimmed.replace(/^\*\*|\*\*$/g, ''),
        items: [],
        plains: [],
      };
      continue;
    }

    // Bullet item
    if (trimmed.startsWith('- ') || trimmed === '-') {
      current.items.push(trimmed.replace(/^-\s*/, ''));
      continue;
    }

    // Plain text (non-bullet, non-heading)
    current.plains.push(trimmed);
  }

  // Push final block
  if (current.items.length > 0 || current.plains.length > 0 || current.heading !== null) {
    blocks.push(current);
  }

  return blocks;
}

/**
 * Distribute blocks into two columns.
 * - If blocks have headings: alternate left/right
 * - If no headings (flat bullet list): split by bullet count, first half left, second right
 */
function distributeTwoColumn(blocks) {
  if (blocks.length === 0) return [[], []];

  const hasHeadings = blocks.some(b => b.heading !== null);

  if (hasHeadings) {
    const left = blocks.filter((_, i) => i % 2 === 0);
    const right = blocks.filter((_, i) => i % 2 === 1);
    return [left, right];
  }

  // Flat list: merge all items, split by count
  const allItems = blocks.flatMap(b => b.items);
  const allPlains = blocks.flatMap(b => b.plains);
  const mid = Math.ceil(allItems.length / 2);
  const leftItems = allItems.slice(0, mid);
  const rightItems = allItems.slice(mid);
  const plainMid = Math.ceil(allPlains.length / 2);
  const leftPlains = allPlains.slice(0, plainMid);
  const rightPlains = allPlains.slice(plainMid);

  const left = [];
  const right = [];
  if (leftItems.length > 0 || leftPlains.length > 0) left.push({ heading: null, items: leftItems, plains: leftPlains });
  if (rightItems.length > 0 || rightPlains.length > 0) right.push({ heading: null, items: rightItems, plains: rightPlains });
  return [left, right];
}

/** Render a single block (optional heading + bullets + plain text). */
function renderBlock(block, accentColor, isFirst) {
  const parts = [];

  if (block.heading !== null) {
    const marginTop = isFirst ? 'margin-top:0' : 'margin-top:14px';
    parts.push(`<p class="block-heading" style="${marginTop}">${esc(block.heading)}</p>`);
  }

  for (const plain of (block.plains || [])) {
    parts.push(`<p class="plain-text">${inlineBold(esc(plain))}</p>`);
  }

  for (const item of block.items) {
    parts.push(`
      <div class="bullet-row">
        <span class="bullet-dot" style="background:${accentColor}"></span>
        <span class="bullet-text">${inlineBold(esc(item))}</span>
      </div>`);
  }

  return parts.join('\n');
}

/** Render a full section block. Returns empty string if content is empty/null. */
function renderSection({ id, title, content, accentColor }) {
  if (!content || !content.trim()) return '';

  const bulletCount = countBullets(content);
  const itemLabel = bulletCount === 1 ? '1 item' : `${bulletCount} items`;
  const blocks = parseBlocks(content);
  const [leftBlocks, rightBlocks] = distributeTwoColumn(blocks);

  const renderCol = (colBlocks) => {
    if (colBlocks.length === 0) return '';
    return colBlocks.map((b, i) => renderBlock(b, accentColor, i === 0)).join('\n');
  };

  return `
  <div class="section" id="section-${id}" data-accent="${accentColor}">
    <div class="section-header">
      <div class="section-header-left">
        <div class="section-accent-bar" style="background:${accentColor}"></div>
        <span class="section-title">${esc(title)}</span>
      </div>
      <span class="section-item-count">${esc(itemLabel)}</span>
    </div>
    <div class="section-content-wrapper">
      <div class="section-content">
        <div class="two-col-grid">
          <div class="col-left">${renderCol(leftBlocks)}</div>
          <div class="col-right">${renderCol(rightBlocks)}</div>
        </div>
      </div>
    </div>
  </div>`;
}

/** Render the role context bar. Omits items with empty values. */
function renderContextBar(items) {
  const filled = items.filter(item => item.value && item.value.trim());
  if (filled.length === 0) return '';

  const itemsHtml = filled.map((item, i) => {
    const isLast = i === filled.length - 1;
    return `
      <div class="context-item${isLast ? ' context-item-last' : ''}">
        <div class="context-label">${esc(item.label)}</div>
        <div class="context-value">${esc(item.value)}</div>
      </div>`;
  }).join('\n');

  return `
  <div class="role-context-bar">
    ${itemsHtml}
  </div>`;
}

// ── CSS ──────────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
    background: #FFFFFF;
    color: #111827;
    font-size: 11.5px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Header ── */
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 32px 12px 32px;
    gap: 16px;
  }

  .header-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    flex-shrink: 0;
  }

  .hitch-logo {
    height: 32px;
    width: auto;
    display: block;
  }

  .hitch-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #6B7280;
  }

  .header-center {
    flex: 1;
    text-align: center;
  }

  .header-title {
    font-size: 20px;
    font-weight: 700;
    color: #0F2D52;
    letter-spacing: -0.01em;
    line-height: 1.2;
  }

  .header-subtitle {
    font-size: 12px;
    font-weight: 400;
    color: #6B7280;
    margin-top: 3px;
  }

  .header-right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .client-logo {
    height: 32px;
    width: auto;
    max-width: 140px;
    object-fit: contain;
  }

  .client-name-text {
    font-size: 14px;
    font-weight: 700;
    color: #0F2D52;
    text-align: right;
  }

  .header-divider {
    height: 2px;
    background: #0F2D52;
    margin: 0 32px;
  }

  /* ── Role Context Bar ── */
  .role-context-bar {
    display: flex;
    background: #F4F6F9;
    border-bottom: 0.5px solid #E5E7EB;
    padding: 12px 32px;
  }

  .context-item {
    flex: 1;
    padding-right: 16px;
    margin-right: 16px;
    border-right: 0.5px solid #D1D5DB;
  }

  .context-item-last {
    border-right: none;
    padding-right: 0;
    margin-right: 0;
  }

  .context-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: #9CA3AF;
    margin-bottom: 2px;
  }

  .context-value {
    font-size: 12px;
    font-weight: 600;
    color: #111827;
  }

  /* ── Sections wrapper ── */
  .sections-wrapper {
    padding: 20px 32px 0 32px;
  }

  /* ── Section ── */
  .section {
    margin-bottom: 20px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 8px;
    border-bottom: 0.5px solid #E5E7EB;
    margin-bottom: 12px;
  }

  .section-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .section-accent-bar {
    width: 3px;
    height: 18px;
    flex-shrink: 0;
  }

  .section-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: #374151;
  }

  .section-item-count {
    font-size: 10px;
    font-weight: 400;
    color: #9CA3AF;
  }

  /* ── Section content: wrapper for expand/collapse ── */
  .section-content-wrapper {
    position: relative;
  }

  .section-content {
    /* JS sets max-height and overflow for collapse; default: fully visible */
  }

  /* ── Two column grid ── */
  .two-col-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 24px;
  }

  .col-left {
    border-right: 0.5px solid #E5E7EB;
    padding-right: 24px;
  }

  /* ── Block heading ── */
  .block-heading {
    font-size: 11.5px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 3px;
  }

  /* ── Bullet row ── */
  .bullet-row {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding-bottom: 4px;
  }

  .bullet-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 5px;
    opacity: 0.5;
  }

  .bullet-text {
    font-size: 11.5px;
    font-weight: 400;
    color: #1F2937;
    line-height: 1.5;
  }

  /* ── Plain text ── */
  .plain-text {
    font-size: 11.5px;
    font-weight: 400;
    color: #374151;
    line-height: 1.5;
    margin-bottom: 5px;
  }

  /* ── Fade gradient ── */
  .fade-gradient {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 48px;
    background: linear-gradient(transparent, #FFFFFF);
    pointer-events: none;
  }

  /* ── Toggle button ── */
  .toggle-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    color: #0F2D52;
    padding: 6px 0 0 0;
    display: block;
    letter-spacing: 0;
  }

  .toggle-btn:hover {
    color: #0A1F3A;
    text-decoration: underline;
  }

  /* ── Footer ── */
  .page-footer {
    padding: 10px 32px;
    border-top: 0.5px solid #E5E7EB;
    background: #F9FAFB;
    text-align: center;
    font-size: 10px;
    font-style: italic;
    color: #9CA3AF;
    letter-spacing: 0.01em;
    margin-top: 20px;
  }

  /* ── Print / PDF ── */
  @media print {
    @page {
      size: Letter portrait;
      margin: 0.6in;
    }

    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      color-adjust: exact;
    }

    .section-content {
      max-height: none !important;
      overflow: visible !important;
    }

    .fade-gradient {
      display: none !important;
    }

    .toggle-btn {
      display: none !important;
    }

    .section {
      page-break-inside: avoid;
    }

    .page-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      width: 100%;
      margin-top: 0;
      border-top: 0.5px solid #E5E7EB;
      background: #F9FAFB;
      z-index: 100;
    }

    .sections-wrapper {
      padding-bottom: 48px;
    }
  }
`;

// ── JavaScript (expand/collapse, screen only) ──────────────────────────────────

const JS = `
(function() {
  var PREVIEW_HEIGHT = 320;

  function countBulletsInEl(el) {
    return el.querySelectorAll('.bullet-row').length;
  }

  function countVisibleBullets(el, maxHeight) {
    var rows = el.querySelectorAll('.bullet-row');
    var count = 0;
    for (var i = 0; i < rows.length; i++) {
      var top = rows[i].offsetTop;
      if (top < maxHeight) count++;
    }
    return count;
  }

  function initSection(wrapper) {
    var content = wrapper.querySelector('.section-content');
    if (!content) return;

    // Measure natural height
    var naturalHeight = content.scrollHeight;
    if (naturalHeight <= PREVIEW_HEIGHT) return; // fits — no button needed

    // Count bullets for hidden item label
    var totalBullets = countBulletsInEl(content);

    // Apply collapsed state
    content.style.maxHeight = PREVIEW_HEIGHT + 'px';
    content.style.overflow = 'hidden';

    // Inject fade gradient
    var fade = document.createElement('div');
    fade.className = 'fade-gradient';
    wrapper.appendChild(fade);

    // Count visible bullets after clamping
    var visibleBullets = countVisibleBullets(content, PREVIEW_HEIGHT);
    var hiddenCount = totalBullets - visibleBullets;
    if (hiddenCount < 0) hiddenCount = 0;

    // Inject toggle button
    var btn = document.createElement('button');
    btn.className = 'toggle-btn';
    var itemWord = hiddenCount === 1 ? 'item' : 'items';
    btn.textContent = hiddenCount > 0
      ? 'View ' + hiddenCount + ' more ' + itemWord + ' \\u2192'
      : 'View more \\u2192';
    var expanded = false;

    btn.addEventListener('click', function() {
      expanded = !expanded;
      if (expanded) {
        content.style.maxHeight = 'none';
        content.style.overflow = 'visible';
        fade.style.display = 'none';
        btn.textContent = 'Show less \\u2191';
      } else {
        content.style.maxHeight = PREVIEW_HEIGHT + 'px';
        content.style.overflow = 'hidden';
        fade.style.display = '';
        var itemWord2 = hiddenCount === 1 ? 'item' : 'items';
        btn.textContent = hiddenCount > 0
          ? 'View ' + hiddenCount + ' more ' + itemWord2 + ' \\u2192'
          : 'View more \\u2192';
      }
    });

    wrapper.parentNode.insertBefore(btn, wrapper.nextSibling);
  }

  document.addEventListener('DOMContentLoaded', function() {
    var wrappers = document.querySelectorAll('.section-content-wrapper');
    for (var i = 0; i < wrappers.length; i++) {
      initSection(wrappers[i]);
    }
  });
})();
`;

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Build a complete self-contained HTML document for the Rubric output.
 *
 * Accepts pre-fetched base64 data URIs for logos (pass null if unavailable;
 * the function falls back to text labels).
 *
 * @param {{
 *   clientName: string,
 *   searchName: string,
 *   location: string,
 *   currentTeamSize: string,
 *   teamSize18Months: string,
 *   positionReportsTo: string,
 *   mustHave: string,
 *   niceToHave: string,
 *   redFlags: string,
 *   successInRole: string,
 *   functionalResponsibility: string,
 *   hitchLogoDataUri: string|null,
 *   clientLogoDataUri: string|null,
 * }} data
 * @returns {string}  Complete HTML string
 */
export function buildRubricDocument({
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
  // ── Header ──────────────────────────────────────────────────────────────────
  const hitchLogoHtml = hitchLogoDataUri
    ? `<img class="hitch-logo" src="${hitchLogoDataUri}" alt="Hitch Partners" />`
    : '';

  const clientLogoHtml = clientLogoDataUri
    ? `<img class="client-logo" src="${clientLogoDataUri}" alt="${esc(clientName)}" />`
    : clientName
      ? `<span class="client-name-text">${esc(clientName)}</span>`
      : '';

  const subtitle = [clientName, searchName].filter(Boolean).map(esc).join(' &mdash; ');

  // ── Role context bar ────────────────────────────────────────────────────────
  const contextBarHtml = renderContextBar([
    { label: 'POSITION',          value: searchName },
    { label: 'LOCATION',          value: location },
    { label: 'CURRENT TEAM',      value: currentTeamSize },
    { label: 'EST. TEAM 18-24 MO', value: teamSize18Months },
    { label: 'REPORTS TO',        value: positionReportsTo },
  ]);

  // ── Content sections (in spec order) ────────────────────────────────────────
  const sectionsHtml = [
    renderSection({ id: 'functional-responsibility', title: 'Functional Responsibility', content: functionalResponsibility, accentColor: '#0F2D52' }),
    renderSection({ id: 'success-in-role',           title: 'Success in Role',           content: successInRole,           accentColor: '#0F2D52' }),
    renderSection({ id: 'must-have',                 title: 'Must Have',                 content: mustHave,                accentColor: '#166534' }),
    renderSection({ id: 'nice-to-have',              title: 'Nice to Have',              content: niceToHave,              accentColor: '#1D4ED8' }),
    renderSection({ id: 'red-flags',                 title: 'Red Flags',                 content: redFlags,                accentColor: '#991B1B' }),
  ].filter(Boolean).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Role Requirements Alignment${clientName ? ' — ' + clientName : ''}</title>
  <style>${CSS}</style>
</head>
<body>

<div class="page-header">
  <div class="header-left">
    ${hitchLogoHtml}
    <span class="hitch-label">Hitch Partners</span>
  </div>
  <div class="header-center">
    <div class="header-title">Role Requirements Alignment</div>
    ${subtitle ? `<div class="header-subtitle">${subtitle}</div>` : ''}
  </div>
  <div class="header-right">
    ${clientLogoHtml}
  </div>
</div>

<div class="header-divider"></div>

${contextBarHtml}

<div class="sections-wrapper">
  ${sectionsHtml}
</div>

<div class="page-footer">Hitch Partners &lt;&gt; Confidential &amp; Proprietary</div>

<script>${JS}</script>
</body>
</html>`;
}

/**
 * Convenience wrapper that fetches logos before building the document.
 * Used by generate-rubric-pdf.js and generate-rubric-html.js when raw URLs
 * are available rather than pre-fetched data URIs.
 *
 * @param {object} data  Same as buildRubricDocument but with hitchLogoUrl/clientLogoUrl
 *   instead of hitchLogoDataUri/clientLogoDataUri
 * @returns {Promise<string>}
 */
export async function buildRubricDocumentFromUrls(data) {
  const { hitchLogoUrl, clientLogoUrl, ...rest } = data;

  const [hitchLogoDataUri, clientLogoDataUri] = await Promise.all([
    hitchLogoUrl
      ? imageToBase64(hitchLogoUrl, guessMimeType(hitchLogoUrl)).catch(() => null)
      : Promise.resolve(null),
    clientLogoUrl
      ? imageToBase64(clientLogoUrl, guessMimeType(clientLogoUrl)).catch(() => null)
      : Promise.resolve(null),
  ]);

  return buildRubricDocument({ ...rest, hitchLogoDataUri, clientLogoDataUri });
}

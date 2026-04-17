/**
 * Rubric HTML document builder.
 *
 * buildRubricHtml(data)  → string   Accordion layout for browser HTML view
 * buildRubricPdf(data)   → string   Tier band layout for Puppeteer → PDF rendering
 * buildRubricDocument    → alias for buildRubricPdf (backwards compatibility)
 *
 * Both functions accept identical parameter objects — only the rendered output differs.
 *
 * Design system:
 *   Font (HTML): Inter (Google Fonts)
 *   Font (PDF):  Arial / system sans-serif
 *   Navy:        #0F2D52
 *   Accents:     FR+SR #0F2D52 / Must Have #166534 / Nice to Have #1D4ED8 / Red Flags #991B1B
 *   Background:  #FFFFFF
 */

import { imageToBase64, guessMimeType } from './fetch-image.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

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

/** Count lines beginning with '-' in a field value (bullet item count). */
function countBullets(text) {
  if (!text) return 0;
  return text.split(/\r?\n/).filter(l => l.trim().startsWith('-')).length;
}

function itemCountLabel(n) {
  return n === 1 ? '1 item' : `${n} items`;
}

/**
 * Parse field value into blocks: [{ heading: string|null, items: string[], plains: string[] }]
 * A new block begins on each full-line **bold** heading.
 * Lines starting with '-' are bullet items. Other non-empty lines are plain text.
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
      if (current.items.length > 0 || current.plains.length > 0 || current.heading !== null) {
        blocks.push(current);
      }
      current = { heading: trimmed.replace(/^\*\*|\*\*$/g, ''), items: [], plains: [] };
      continue;
    }

    // Bullet item
    if (trimmed.startsWith('- ') || trimmed === '-') {
      current.items.push(trimmed.replace(/^-\s*/, ''));
      continue;
    }

    // Plain text
    current.plains.push(trimmed);
  }

  if (current.items.length > 0 || current.plains.length > 0 || current.heading !== null) {
    blocks.push(current);
  }

  return blocks;
}

/**
 * Distribute blocks into two columns.
 * - Blocks with headings: alternate left/right by group
 * - Flat list (no headings): split bullet items evenly, first half left
 */
function distributeTwoColumn(blocks) {
  if (blocks.length === 0) return [[], []];

  const hasHeadings = blocks.some(b => b.heading !== null);

  if (hasHeadings) {
    return [
      blocks.filter((_, i) => i % 2 === 0),
      blocks.filter((_, i) => i % 2 === 1),
    ];
  }

  // Flat list: merge all items, split by count
  const allItems  = blocks.flatMap(b => b.items);
  const allPlains = blocks.flatMap(b => b.plains);
  const mid       = Math.ceil(allItems.length / 2);
  const plainMid  = Math.ceil(allPlains.length / 2);

  const left  = [];
  const right = [];
  const li = allItems.slice(0, mid);
  const ri = allItems.slice(mid);
  const lp = allPlains.slice(0, plainMid);
  const rp = allPlains.slice(plainMid);
  if (li.length > 0 || lp.length > 0) left.push({ heading: null, items: li, plains: lp });
  if (ri.length > 0 || rp.length > 0) right.push({ heading: null, items: ri, plains: rp });
  return [left, right];
}

/**
 * Render a single block (optional bold sub-heading + plain text + bullet items).
 * Dot size and heading default margins are controlled by the calling template's CSS.
 * When isFirst=true, heading margin-top is forced to 0 via inline style.
 */
function renderBlock(block, dotColor, isFirst) {
  const parts = [];

  if (block.heading !== null) {
    const style = isFirst ? ' style="margin-top:0"' : '';
    parts.push(`<p class="block-heading"${style}>${esc(block.heading)}</p>`);
  }

  for (const plain of (block.plains || [])) {
    parts.push(`<p class="plain-text">${inlineBold(esc(plain))}</p>`);
  }

  for (const item of block.items) {
    parts.push(
      `<div class="bullet-row">` +
      `<span class="bullet-dot" style="background:${dotColor}"></span>` +
      `<span class="bullet-text">${inlineBold(esc(item))}</span>` +
      `</div>`
    );
  }

  return parts.join('\n');
}

/**
 * Render content in a single column — for NTH/RF combined band panels.
 * Empty content shows "No items specified."
 */
function renderSingleColumn(content, dotColor) {
  const blocks = parseBlocks(content);
  if (blocks.length === 0) return '<p class="empty-note">No items specified.</p>';
  return blocks.map((b, i) => renderBlock(b, dotColor, i === 0)).join('\n');
}

/**
 * Render content in a two-column grid using shared col-left / col-right classes.
 * Empty content shows "No items specified."
 */
function renderTwoColumnGrid(content, dotColor) {
  if (!content || !content.trim()) {
    return '<p class="empty-note">No items specified.</p>';
  }
  const blocks = parseBlocks(content);
  if (blocks.length === 0) return '<p class="empty-note">No items specified.</p>';

  const [leftBlocks, rightBlocks] = distributeTwoColumn(blocks);
  const renderCol = (cols) => cols.map((b, i) => renderBlock(b, dotColor, i === 0)).join('\n');

  return (
    `<div class="two-col-grid">` +
    `<div class="col-left">${renderCol(leftBlocks)}</div>` +
    `<div class="col-right">${renderCol(rightBlocks)}</div>` +
    `</div>`
  );
}

/** Return the text of the first hyphen-prefixed bullet in a content field. */
function firstBulletText(text) {
  if (!text) return '';
  const line = text.split(/\r?\n/).find(l => l.trim().startsWith('-'));
  return line ? replaceArrows(line.trim().replace(/^-\s*/, '')) : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared structural HTML blocks (header + context bar)
// ─────────────────────────────────────────────────────────────────────────────

/** Build the three-column page header (Hitch logo | title+subtitle | client logo). */
function buildHeaderHtml(clientName, searchName, hitchLogoDataUri, clientLogoDataUri) {
  const hitchLogoHtml = hitchLogoDataUri
    ? `<img class="hitch-logo" src="${hitchLogoDataUri}" alt="Hitch Partners" />`
    : '';

  const clientLogoHtml = clientLogoDataUri
    ? `<img class="client-logo" src="${clientLogoDataUri}" alt="${esc(clientName)}" />`
    : clientName
      ? `<span class="client-name-text">${esc(clientName)}</span>`
      : '';

  const subtitle = [clientName, searchName].filter(Boolean).map(esc).join(' &mdash; ');

  return `
<div class="page-header">
  <div class="header-left">
    ${hitchLogoHtml}
    <span class="hitch-label">Hitch Partners</span>
  </div>
  <div class="header-center">
    <div class="header-title">Role Requirements Alignment</div>
    ${subtitle ? `<div class="header-subtitle">${subtitle}</div>` : ''}
  </div>
  <div class="header-right">${clientLogoHtml}</div>
</div>
<div class="header-divider"></div>`;
}

/**
 * Build the context bar with all four fields.
 * Empty values show an em dash (\u2014) — label is never omitted.
 */
function buildContextBarHtml(searchName, location, currentTeamSize, teamSize18Months) {
  const items = [
    { label: 'POSITION',      value: searchName       || '\u2014' },
    { label: 'LOCATION',      value: location         || '\u2014' },
    { label: 'CURRENT TEAM',  value: currentTeamSize  || '\u2014' },
    { label: 'TEAM 18-24 MO', value: teamSize18Months || '\u2014' },
  ];

  return `
<div class="context-bar">
  ${items.map((item, i) => `
    <div class="context-item${i === items.length - 1 ? ' last' : ''}">
      <div class="context-label">${esc(item.label)}</div>
      <div class="context-value">${esc(item.value)}</div>
    </div>`).join('')}
</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML (accordion) output
// ─────────────────────────────────────────────────────────────────────────────

const HTML_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    background: #FFFFFF;
    color: #111827;
    font-size: 13px;
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Page Header ── */
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 24px 12px;
    gap: 16px;
  }

  .header-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    flex-shrink: 0;
  }

  .hitch-logo { height: 28px; width: auto; display: block; }

  .hitch-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #6B7280;
  }

  .header-center { flex: 1; text-align: center; }

  .header-title {
    font-size: 18px;
    font-weight: 700;
    color: #0F2D52;
    letter-spacing: -0.01em;
    line-height: 1.2;
    margin-bottom: 2px;
  }

  .header-subtitle {
    font-size: 11px;
    font-weight: 400;
    color: #6B7280;
  }

  .header-right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    text-align: right;
    flex-shrink: 0;
  }

  .client-logo { height: 28px; width: auto; max-width: 120px; object-fit: contain; }

  .client-name-text {
    font-size: 12px;
    font-weight: 700;
    color: #0F2D52;
    text-align: right;
  }

  .header-divider { height: 2px; background: #0F2D52; }

  /* ── Context Bar ── */
  .context-bar {
    display: flex;
    background: #F4F6F9;
    border-bottom: 0.5px solid #E5E7EB;
    padding: 10px 24px;
  }

  .context-item {
    flex: 1;
    padding-right: 16px;
    margin-right: 16px;
    border-right: 0.5px solid #D1D5DB;
  }

  .context-item.last { border-right: none; padding-right: 0; margin-right: 0; }

  .context-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #9CA3AF;
    display: block;
    margin-bottom: 2px;
  }

  .context-value { font-size: 12px; font-weight: 600; color: #111827; }

  /* ── Accordion List ── */
  .accordion-list { padding: 16px 24px 8px; }

  /* ── Accordion Item ── */
  .accordion-item {
    border: 0.5px solid #E5E7EB;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 10px;
  }

  /* ── Accordion Header ── */
  .accordion-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: #FAFAFA;
    cursor: pointer;
    gap: 12px;
    user-select: none;
    border-bottom: none;
  }

  .accordion-item[data-open] > .accordion-header {
    border-bottom: 0.5px solid #E5E7EB;
  }

  .header-left-flex { display: flex; align-items: center; gap: 10px; }

  .accent-bar { width: 3px; height: 18px; flex-shrink: 0; }

  .section-label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #374151;
  }

  .header-right-flex { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

  .item-count { font-size: 11px; font-weight: 400; color: #9CA3AF; }

  /* ── Chevron ── */
  .chevron { flex-shrink: 0; transition: transform 0.2s ease; }
  .accordion-item[data-open] .chevron { transform: rotate(180deg); }

  /* ── Accordion Preview (collapsed NTH / RF only) ── */
  .accordion-preview {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px 10px;
    background: #FFFFFF;
    border-top: 0.5px solid #F3F4F6;
  }

  .accordion-item[data-open] .accordion-preview { display: none; }

  .preview-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; opacity: 0.4; }

  .preview-text { font-size: 12px; color: #6B7280; font-style: italic; }

  /* ── Accordion Body ── */
  .accordion-body {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.25s ease;
  }

  .accordion-item[data-open] > .accordion-body { max-height: 3000px; }

  .accordion-body-inner {
    background: #FFFFFF;
    padding: 16px 18px 20px;
  }

  /* ── Two-column grid ── */
  .two-col-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 24px;
  }

  .col-left { border-right: 0.5px solid #E5E7EB; padding-right: 12px; }
  .col-right { padding-left: 12px; }

  /* ── Block heading ── */
  .block-heading {
    font-size: 13px;
    font-weight: 700;
    color: #111827;
    margin-top: 14px;
    margin-bottom: 5px;
  }

  /* ── Bullet row ── */
  .bullet-row {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding-bottom: 5px;
  }

  .bullet-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 6px;
    opacity: 0.5;
  }

  .bullet-text {
    font-size: 13px;
    font-weight: 400;
    color: #374151;
    line-height: 1.65;
  }

  /* ── Plain text ── */
  .plain-text {
    font-size: 13px;
    font-weight: 400;
    color: #374151;
    line-height: 1.65;
    margin-bottom: 6px;
  }

  /* ── Empty note ── */
  .empty-note { font-size: 13px; font-style: italic; color: #9CA3AF; }

  /* ── Page Footer ── */
  .page-footer {
    margin-top: 24px;
    padding: 12px 24px;
    border-top: 0.5px solid #E5E7EB;
    background: #F9FAFB;
    text-align: center;
    font-size: 11px;
    font-style: italic;
    color: #9CA3AF;
  }

  /* ── Print styles ── */
  @media print {
    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      color-adjust: exact;
    }

    .accordion-body {
      max-height: none !important;
      overflow: visible !important;
    }

    .accordion-preview { display: none !important; }

    .accordion-body-inner { break-inside: avoid; }
  }
`;

const CHEVRON_SVG = `<svg class="chevron" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5L7 9L11 5" stroke="#9CA3AF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderAccordionSection({ key, label, accentColor, content, isDefaultOpen, hasPreview }) {
  const count      = countBullets(content);
  const openAttr   = isDefaultOpen ? ' data-open' : '';
  const bodyHtml   = renderTwoColumnGrid(content, accentColor);

  let previewHtml = '';
  if (hasPreview) {
    const first       = firstBulletText(content);
    const previewText = first
      ? `${esc(first)} \u2014 click to expand`
      : 'click to expand';
    previewHtml = `
    <div class="accordion-preview">
      <span class="preview-dot" style="background:${accentColor}"></span>
      <span class="preview-text">${previewText}</span>
    </div>`;
  }

  return `
  <div class="accordion-item" data-section="${key}"${openAttr}>
    <div class="accordion-header">
      <div class="header-left-flex">
        <div class="accent-bar" style="background:${accentColor}"></div>
        <span class="section-label">${esc(label)}</span>
      </div>
      <div class="header-right-flex">
        <span class="item-count">${esc(itemCountLabel(count))}</span>
        ${CHEVRON_SVG}
      </div>
    </div>
    ${previewHtml}
    <div class="accordion-body">
      <div class="accordion-body-inner">
        ${bodyHtml}
      </div>
    </div>
  </div>`;
}

/**
 * Build a complete self-contained HTML document with accordion UI for browser viewing.
 *
 * Sections FR, SR, Must Have are expanded by default.
 * Nice to Have and Red Flags are collapsed with a one-line preview.
 *
 * @param {{
 *   clientName: string,
 *   searchName: string,
 *   location: string,
 *   currentTeamSize: string,
 *   teamSize18Months: string,
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
export function buildRubricHtml({
  clientName,
  searchName,
  location,
  currentTeamSize,
  teamSize18Months,
  mustHave,
  niceToHave,
  redFlags,
  successInRole,
  functionalResponsibility,
  hitchLogoDataUri,
  clientLogoDataUri,
}) {
  const headerHtml     = buildHeaderHtml(clientName, searchName, hitchLogoDataUri, clientLogoDataUri);
  const contextBarHtml = buildContextBarHtml(searchName, location, currentTeamSize, teamSize18Months);

  const sections = [
    { key: 'fr',  label: 'Functional Responsibility', accentColor: '#0F2D52', content: functionalResponsibility, isDefaultOpen: true,  hasPreview: false },
    { key: 'sr',  label: 'Success in Role',            accentColor: '#0F2D52', content: successInRole,           isDefaultOpen: true,  hasPreview: false },
    { key: 'mh',  label: 'Must Have',                  accentColor: '#166534', content: mustHave,                isDefaultOpen: true,  hasPreview: false },
    { key: 'nth', label: 'Nice to Have',               accentColor: '#1D4ED8', content: niceToHave,              isDefaultOpen: false, hasPreview: true  },
    { key: 'rf',  label: 'Red Flags',                  accentColor: '#991B1B', content: redFlags,                isDefaultOpen: false, hasPreview: true  },
  ];

  const accordionHtml = sections.map(renderAccordionSection).join('\n');

  const inlineJs = `
(function () {
  document.querySelectorAll('.accordion-header').forEach(function (header) {
    header.addEventListener('click', function () {
      var item = header.closest('.accordion-item');
      if (item.hasAttribute('data-open')) {
        item.removeAttribute('data-open');
      } else {
        item.setAttribute('data-open', '');
      }
    });
  });
})();`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Role Requirements Alignment${clientName ? ' \u2014 ' + esc(clientName) : ''}</title>
  <style>${HTML_CSS}</style>
</head>
<body>

${headerHtml}
${contextBarHtml}

<div class="accordion-list">
${accordionHtml}
</div>

<div class="page-footer">Hitch Partners &lt;&gt; Confidential &amp; Proprietary</div>

<script>${inlineJs}</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF (tier band) output
// ─────────────────────────────────────────────────────────────────────────────

const PDF_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: Arial, Helvetica, sans-serif;
    background: #FFFFFF;
    color: #111827;
    font-size: 11pt;
    line-height: 1.5;
    padding-bottom: 40pt;
  }

  /* ── Page Header ── */
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12pt 36pt 10pt;
    gap: 16pt;
  }

  .header-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3pt;
    flex-shrink: 0;
  }

  .hitch-logo { height: 24pt; width: auto; display: block; }

  .hitch-label {
    font-size: 7pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #6B7280;
  }

  .header-center { flex: 1; text-align: center; }

  .header-title {
    font-size: 16pt;
    font-weight: 700;
    color: #0F2D52;
    letter-spacing: -0.01em;
    line-height: 1.2;
    margin-bottom: 2pt;
  }

  .header-subtitle { font-size: 10pt; font-weight: 400; color: #6B7280; }

  .header-right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    text-align: right;
    flex-shrink: 0;
  }

  .client-logo { height: 24pt; width: auto; max-width: 100pt; object-fit: contain; }

  .client-name-text { font-size: 10pt; font-weight: 700; color: #0F2D52; text-align: right; }

  .header-divider { height: 2pt; background: #0F2D52; }

  /* ── Context Bar ── */
  .context-bar {
    display: flex;
    background: #F4F6F9;
    border-bottom: 0.5pt solid #E5E7EB;
    padding: 8pt 36pt;
  }

  .context-item {
    flex: 1;
    padding-right: 12pt;
    margin-right: 12pt;
    border-right: 0.5pt solid #D1D5DB;
  }

  .context-item.last { border-right: none; padding-right: 0; margin-right: 0; }

  .context-label {
    font-size: 7pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: #9CA3AF;
    display: block;
    margin-bottom: 2pt;
  }

  .context-value { font-size: 10pt; font-weight: 600; color: #111827; }

  /* ── Band ── */
  .band { border-top: 0.5pt solid #E5E7EB; }

  .band-must-have {
    page-break-before: always;
    break-before: page;
  }

  /* ── Band Header ── */
  .band-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #FAFAFA;
    border-bottom: 0.5pt solid #E5E7EB;
    padding: 7pt 36pt;
  }

  /* ── Section Tag Pill ── */
  .section-tag {
    display: inline-block;
    padding: 2pt 8pt;
    border-radius: 3pt;
    font-size: 8pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* ── Item Count ── */
  .item-count { font-size: 9pt; font-weight: 400; color: #9CA3AF; }

  /* ── Band Content ── */
  .band-content { padding: 12pt 36pt 14pt; }

  /* ── Two-column grid ── */
  .two-col-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 24pt;
  }

  .col-left { border-right: 0.5pt solid #E5E7EB; padding-right: 12pt; }
  .col-right { padding-left: 12pt; }

  /* ── Block heading ── */
  .block-heading {
    font-size: 11pt;
    font-weight: 700;
    color: #111827;
    margin-top: 10pt;
    margin-bottom: 3pt;
  }

  /* ── Bullet row ── */
  .bullet-row {
    display: flex;
    gap: 6pt;
    align-items: flex-start;
    margin-bottom: 3pt;
  }

  .bullet-dot {
    width: 4pt;
    height: 4pt;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 4pt;
    opacity: 0.5;
  }

  .bullet-text { font-size: 11pt; font-weight: 400; color: #374151; line-height: 1.5; }

  /* ── Plain text ── */
  .plain-text { font-size: 11pt; font-weight: 400; color: #374151; line-height: 1.5; margin-bottom: 4pt; }

  /* ── Empty note ── */
  .empty-note { font-size: 11pt; font-style: italic; color: #9CA3AF; }

  /* ── Combined band (Nice to Have + Red Flags side by side) ── */
  .combined-band {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-top: 0.5pt solid #E5E7EB;
  }

  .panel-left { border-right: 0.5pt solid #E5E7EB; }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #FAFAFA;
    border-bottom: 0.5pt solid #E5E7EB;
    padding: 7pt 16pt;
  }

  .panel-content { padding: 12pt 18pt 14pt; }

  /* ── PDF Footer (fixed on every page via print mode) ── */
  .pdf-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: #FFFFFF;
    border-top: 0.5pt solid #E5E7EB;
    text-align: center;
    font-size: 9pt;
    font-style: italic;
    color: #9CA3AF;
    padding: 6pt 0;
  }

  /* ── Print ── */
  @media print {
    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      color-adjust: exact;
    }

    .band-content   { break-inside: avoid; }
    .combined-band  { break-inside: avoid; }
  }
`;

function renderPdfBand({ label, pillBg, pillText, dotColor, content, extraClass }) {
  const count      = countBullets(content);
  const bodyHtml   = renderTwoColumnGrid(content, dotColor);
  const classAttr  = extraClass ? ` ${extraClass}` : '';

  return `
<div class="band${classAttr}">
  <div class="band-header">
    <span class="section-tag" style="background:${pillBg};color:${pillText}">${esc(label)}</span>
    <span class="item-count">${esc(itemCountLabel(count))}</span>
  </div>
  <div class="band-content">
    ${bodyHtml}
  </div>
</div>`;
}

function renderPdfCombinedBand({ niceToHave, redFlags }) {
  const nthCount = countBullets(niceToHave);
  const rfCount  = countBullets(redFlags);

  return `
<div class="combined-band">
  <div class="panel-left">
    <div class="panel-header">
      <span class="section-tag" style="background:#DBEAFE;color:#1D4ED8">Nice to Have</span>
      <span class="item-count">${esc(itemCountLabel(nthCount))}</span>
    </div>
    <div class="panel-content">
      ${renderSingleColumn(niceToHave, '#1D4ED8')}
    </div>
  </div>
  <div class="panel-right">
    <div class="panel-header">
      <span class="section-tag" style="background:#FEE2E2;color:#991B1B">Red Flags</span>
      <span class="item-count">${esc(itemCountLabel(rfCount))}</span>
    </div>
    <div class="panel-content">
      ${renderSingleColumn(redFlags, '#991B1B')}
    </div>
  </div>
</div>`;
}

/**
 * Build the tier band HTML document for Puppeteer → PDF rendering.
 *
 * Page 1: Header + Context Bar + Functional Responsibility + Success in Role
 * Page 2: Must Have (page-break-before) + Nice to Have + Red Flags (combined)
 *
 * @param {{
 *   clientName: string,
 *   searchName: string,
 *   location: string,
 *   currentTeamSize: string,
 *   teamSize18Months: string,
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
export function buildRubricPdf({
  clientName,
  searchName,
  location,
  currentTeamSize,
  teamSize18Months,
  mustHave,
  niceToHave,
  redFlags,
  successInRole,
  functionalResponsibility,
  hitchLogoDataUri,
  clientLogoDataUri,
}) {
  const headerHtml     = buildHeaderHtml(clientName, searchName, hitchLogoDataUri, clientLogoDataUri);
  const contextBarHtml = buildContextBarHtml(searchName, location, currentTeamSize, teamSize18Months);

  const frHtml = renderPdfBand({
    label:    'Functional Responsibility',
    pillBg:   '#E8EDF5',
    pillText: '#0F2D52',
    dotColor: '#0F2D52',
    content:  functionalResponsibility,
  });

  const srHtml = renderPdfBand({
    label:    'Success in Role',
    pillBg:   '#E8EDF5',
    pillText: '#0F2D52',
    dotColor: '#0F2D52',
    content:  successInRole,
  });

  const mhHtml = renderPdfBand({
    label:      'Must Have',
    pillBg:     '#DCFCE7',
    pillText:   '#166534',
    dotColor:   '#166534',
    content:    mustHave,
    extraClass: 'band-must-have',
  });

  const combinedHtml = renderPdfCombinedBand({ niceToHave, redFlags });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Role Requirements Alignment${clientName ? ' \u2014 ' + esc(clientName) : ''}</title>
  <style>${PDF_CSS}</style>
</head>
<body>

${headerHtml}
${contextBarHtml}
${frHtml}
${srHtml}
${mhHtml}
${combinedHtml}

<div class="pdf-footer">Hitch Partners &lt;&gt; Confidential &amp; Proprietary</div>

</body>
</html>`;
}

/**
 * Backwards-compatible alias — callers that still reference buildRubricDocument
 * receive the PDF-optimised output unchanged.
 */
export const buildRubricDocument = buildRubricPdf;

/**
 * Convenience wrapper that fetches logos from URLs before building the PDF document.
 * Used when raw logo URLs are available rather than pre-fetched data URIs.
 *
 * @param {object} data  Same as buildRubricPdf but with hitchLogoUrl/clientLogoUrl
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

  return buildRubricPdf({ ...rest, hitchLogoDataUri, clientLogoDataUri });
}

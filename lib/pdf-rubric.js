/**
 * Rubric HTML document builder — unified template for both HTML and PDF outputs.
 *
 * buildRubricDocument(data) → string  (complete self-contained HTML)
 *
 * The returned HTML serves two purposes:
 *   1. Uploaded directly to Vercel Blob as an interactive web page (generate-rubric-html.js)
 *   2. Passed to renderHtmlToPdf() via Puppeteer for a static PDF (generate-rubric-pdf.js)
 *
 * Financial report tier band design. All content visible by default — no expand/collapse JS.
 * Screen view: browser scrolls naturally through stacked full-width bands.
 * Print / PDF: @media print, footer fixed to every page.
 *
 * Design system:
 *   Font:       Inter (Google Fonts), fallback system sans-serif
 *   Navy:       #0F2D52
 *   Accents:    FR+SR #0F2D52 / Must Have #166534 / Nice to Have #1D4ED8 / Red Flags #991B1B
 *   Page bg:    #FFFFFF
 *   PDF:        US Letter portrait, 0.55in margins all sides
 */

import { imageToBase64, guessMimeType } from './fetch-image.js';

// ── HTML helpers ─────────────────────────────────────────────────────────────────

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
 * - If blocks have headings: alternate left/right
 * - If no headings (flat list): split by bullet count, first half left, second right
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

/**
 * Render a single block (optional bold sub-heading + plain text + bullet items).
 *
 * Bold sub-heading lines have no bullet prefix — they are structural headers.
 * Bullet items render with a 4px circle dot at 50% opacity in the section's dotColor.
 */
function renderBlock(block, dotColor, isFirst) {
  const parts = [];

  if (block.heading !== null) {
    const marginTop = isFirst ? 'margin-top:0' : 'margin-top:10px';
    parts.push(`<p class="block-heading" style="${marginTop}">${esc(block.heading)}</p>`);
  }

  for (const plain of (block.plains || [])) {
    parts.push(`<p class="plain-text">${inlineBold(esc(plain))}</p>`);
  }

  for (const item of block.items) {
    parts.push(`
      <div class="bullet-row">
        <span class="bullet-dot" style="background:${dotColor}"></span>
        <span class="bullet-text">${inlineBold(esc(item))}</span>
      </div>`);
  }

  return parts.join('\n');
}

/**
 * Render all blocks in a single column — used for NTH and RF panels
 * where no sub-column split occurs.
 */
function renderSingleColumn(content, dotColor) {
  const blocks = parseBlocks(content);
  if (blocks.length === 0) {
    return '<p class="empty-note">No items specified.</p>';
  }
  return blocks.map((b, i) => renderBlock(b, dotColor, i === 0)).join('\n');
}

/**
 * Render a full-width section band.
 * Always rendered — empty fields show "No items specified." rather than being omitted.
 */
function renderSection({ id, label, pillBg, pillText, dotColor, content }) {
  const bulletCount = countBullets(content);
  const itemLabel = bulletCount === 1 ? '1 item' : `${bulletCount} items`;

  let contentHtml;
  if (!content || !content.trim()) {
    contentHtml = '<p class="empty-note">No items specified.</p>';
  } else {
    const blocks = parseBlocks(content);
    const [leftBlocks, rightBlocks] = distributeTwoColumn(blocks);

    const renderCol = (colBlocks) => {
      if (colBlocks.length === 0) return '';
      return colBlocks.map((b, i) => renderBlock(b, dotColor, i === 0)).join('\n');
    };

    contentHtml = `
        <div class="band-grid">
          <div class="col-left">${renderCol(leftBlocks)}</div>
          <div class="col-right">${renderCol(rightBlocks)}</div>
        </div>`;
  }

  return `
  <div class="band" id="band-${id}">
    <div class="band-header">
      <span class="section-tag" style="background:${pillBg};color:${pillText}">${esc(label)}</span>
      <span class="item-count">${esc(itemLabel)}</span>
    </div>
    <div class="band-content">
      ${contentHtml}
    </div>
  </div>`;
}

/**
 * Render the combined Nice to Have + Red Flags band.
 * Two half-width panels rendered side by side within a single outer band.
 * Each panel has its own header (pill + count) and single-column content.
 */
function renderCombinedBand({ niceToHave, redFlags }) {
  const nthCount = countBullets(niceToHave);
  const rfCount = countBullets(redFlags);
  const nthLabel = nthCount === 1 ? '1 item' : `${nthCount} items`;
  const rfLabel = rfCount === 1 ? '1 item' : `${rfCount} items`;

  const nthContent = renderSingleColumn(niceToHave, '#1D4ED8');
  const rfContent = renderSingleColumn(redFlags, '#991B1B');

  return `
  <div class="combined-band">
    <div class="panel-left">
      <div class="panel-header">
        <span class="section-tag" style="background:#DBEAFE;color:#1D4ED8">Nice to Have</span>
        <span class="item-count">${esc(nthLabel)}</span>
      </div>
      <div class="panel-content">
        ${nthContent}
      </div>
    </div>
    <div class="panel-right">
      <div class="panel-header">
        <span class="section-tag" style="background:#FEE2E2;color:#991B1B">Red Flags</span>
        <span class="item-count">${esc(rfLabel)}</span>
      </div>
      <div class="panel-content">
        ${rfContent}
      </div>
    </div>
  </div>`;
}

/**
 * Render the role context bar.
 * Items are omitted entirely when their value is empty or null.
 */
function renderContextBar(items) {
  const visible = items.filter(item => item.value && item.value.trim());
  if (visible.length === 0) return '';

  const itemsHtml = visible.map((item, i) => {
    const isLast = i === visible.length - 1;
    return `
      <div class="context-item${isLast ? ' context-item-last' : ''}">
        <div class="context-label">${esc(item.label)}</div>
        <div class="context-value">${esc(item.value.trim())}</div>
      </div>`;
  }).join('\n');

  return `
  <div class="context-bar">
    ${itemsHtml}
  </div>`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    background: #FFFFFF;
    color: #111827;
    font-size: 10px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Page Header ── */
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 24px 12px 24px;
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
    height: 28px;
    width: auto;
    display: block;
  }

  .hitch-label {
    font-size: 8px;
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

  .client-logo {
    height: 28px;
    width: auto;
    max-width: 120px;
    object-fit: contain;
  }

  .client-name-text {
    font-size: 11px;
    font-weight: 700;
    color: #0F2D52;
    text-align: right;
  }

  .header-divider {
    height: 2px;
    background: #0F2D52;
  }

  /* ── Context Bar ── */
  .context-bar {
    display: flex;
    background: #F4F6F9;
    border-bottom: 0.5px solid #E5E7EB;
    padding: 8px 24px;
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
    font-size: 8px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: #9CA3AF;
    margin-bottom: 1px;
  }

  .context-value {
    font-size: 11px;
    font-weight: 600;
    color: #111827;
  }

  /* ── Band ── */
  .band {
    border-top: 0.5px solid #E5E7EB;
  }

  .band-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #FAFAFA;
    border-bottom: 0.5px solid #E5E7EB;
    padding: 8px 24px;
  }

  .band-content {
    padding: 12px 24px 14px 24px;
  }

  /* ── Band two-column grid ── */
  .band-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 28px;
  }

  .band-grid .col-left {
    border-right: 0.5px solid #E5E7EB;
    padding-right: 14px;
  }

  .band-grid .col-right {
    padding-left: 14px;
  }

  /* ── Section tag pill ── */
  .section-tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 8px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* ── Item count ── */
  .item-count {
    font-size: 9px;
    font-weight: 400;
    color: #9CA3AF;
  }

  /* ── Block heading (bold sub-heading lines — no bullet prefix) ── */
  .block-heading {
    font-size: 10px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 3px;
  }

  /* ── Bullet row ── */
  .bullet-row {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    padding-bottom: 3px;
  }

  .bullet-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 5px;
    opacity: 0.5;
  }

  .bullet-text {
    font-size: 10px;
    font-weight: 400;
    color: #374151;
    line-height: 1.45;
  }

  /* ── Plain text ── */
  .plain-text {
    font-size: 10px;
    font-weight: 400;
    color: #374151;
    line-height: 1.45;
    margin-bottom: 4px;
  }

  /* ── Empty note ── */
  .empty-note {
    font-size: 10px;
    font-style: italic;
    color: #9CA3AF;
  }

  /* ── Combined band (Nice to Have + Red Flags side by side) ── */
  .combined-band {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-top: 0.5px solid #E5E7EB;
  }

  .panel-left {
    border-right: 0.5px solid #E5E7EB;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #FAFAFA;
    border-bottom: 0.5px solid #E5E7EB;
    padding: 8px 16px;
  }

  .panel-content {
    padding: 10px 16px 12px;
  }

  /* ── Footer ── */
  .page-footer {
    border-top: 0.5px solid #E5E7EB;
    background: #F9FAFB;
    padding: 8px 24px;
    text-align: center;
    font-size: 9px;
    font-style: italic;
    color: #9CA3AF;
  }

  /* ── Print / PDF ── */
  @media print {
    @page {
      size: Letter portrait;
      margin: 0.55in;
    }

    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      color-adjust: exact;
      background: #FFFFFF;
    }

    .band-content {
      break-inside: avoid;
    }

    .combined-band {
      break-inside: avoid;
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

    .content-wrapper {
      padding-bottom: 40px;
    }
  }
`;

// ── Public API ────────────────────────────────────────────────────────────────────

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
  mustHave,
  niceToHave,
  redFlags,
  successInRole,
  functionalResponsibility,
  hitchLogoDataUri,
  clientLogoDataUri,
}) {
  // ── Header ───────────────────────────────────────────────────────────────────
  const hitchLogoHtml = hitchLogoDataUri
    ? `<img class="hitch-logo" src="${hitchLogoDataUri}" alt="Hitch Partners" />`
    : '';

  const clientLogoHtml = clientLogoDataUri
    ? `<img class="client-logo" src="${clientLogoDataUri}" alt="${esc(clientName)}" />`
    : clientName
      ? `<span class="client-name-text">${esc(clientName)}</span>`
      : '';

  const subtitle = [clientName, searchName].filter(Boolean).map(esc).join(' &mdash; ');

  // ── Context bar (omits items where value is empty) ───────────────────────────
  const contextBarHtml = renderContextBar([
    { label: 'POSITION',           value: searchName       },
    { label: 'LOCATION',           value: location         },
    { label: 'CURRENT TEAM',       value: currentTeamSize  },
    { label: 'EST. TEAM 18-24 MO', value: teamSize18Months },
  ]);

  // ── Section bands (spec order: FR → SR → MH → [NTH + RF combined]) ──────────
  const frHtml = renderSection({
    id:       'functional-responsibility',
    label:    'Functional Responsibility',
    pillBg:   '#E8EDF5',
    pillText: '#0F2D52',
    dotColor: '#0F2D52',
    content:  functionalResponsibility,
  });

  const srHtml = renderSection({
    id:       'success-in-role',
    label:    'Success in Role',
    pillBg:   '#E8EDF5',
    pillText: '#0F2D52',
    dotColor: '#0F2D52',
    content:  successInRole,
  });

  const mhHtml = renderSection({
    id:       'must-have',
    label:    'Must Have',
    pillBg:   '#DCFCE7',
    pillText: '#166534',
    dotColor: '#166534',
    content:  mustHave,
  });

  const combinedHtml = renderCombinedBand({ niceToHave, redFlags });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Role Requirements Alignment${clientName ? ' \u2014 ' + esc(clientName) : ''}</title>
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

<div class="content-wrapper">
  ${frHtml}
  ${srHtml}
  ${mhHtml}
  ${combinedHtml}
</div>

<div class="page-footer">Hitch Partners &lt;&gt; Confidential &amp; Proprietary</div>

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

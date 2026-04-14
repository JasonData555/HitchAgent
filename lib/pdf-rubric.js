/**
 * Rubric HTML generator — fixed sidebar navigation layout.
 *
 * createRubricPdf(data) → Promise<Buffer>  (PDF bytes via Puppeteer)
 *
 * The HTML output is a fully self-contained interactive document:
 *   - Fixed 220px sidebar navigation (screen view)
 *   - Scrollable content panel showing one section at a time
 *   - View More / Show Less toggle for long sections
 *   - Keyboard navigation (arrow keys)
 *
 * @media print collapses the sidebar and renders all five sections
 * expanded sequentially for Puppeteer PDF output.
 *
 * Sections (sidebar order):
 *   1. Success in Role        (accent #0F2D52)
 *   2. Functional Responsibility (accent #0F2D52)
 *   3. Must Have              (accent #166534)
 *   4. Nice to Have           (accent #1D4ED8)
 *   5. Red Flags              (accent #991B1B)
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
 * Parse a field's plain-text content into an HTML block for rendering.
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
      parts.push(`<li><span class="li-text">${content}</span></li>`);
      continue;
    }

    // Plain paragraph
    if (inList) { parts.push('</ul>'); inList = false; }
    parts.push(`<p>${inlineBold(esc(trimmed))}</p>`);
  }

  if (inList) parts.push('</ul>');
  return parts.join('\n');
}

/**
 * Count bullet lines (lines beginning with "-") in a field value.
 * Used server-side to pre-compute item counts for the HTML.
 */
function countBulletLines(text) {
  if (!text) return 0;
  return text.split(/\r?\n/).filter(l => {
    const t = l.trim();
    return t.startsWith('- ') || t === '-';
  }).length;
}

// ── Hex accent → rgba helper ───────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── CSS ────────────────────────────────────────────────────────────────────────
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
    line-height: 1.6;
    color: #374151;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    overflow: hidden;
  }

  /* ── Sidebar ─────────────────────────────────────────────────────── */
  .sidebar {
    position: fixed;
    left: 0; top: 0; bottom: 0;
    width: 220px;
    background: #F8F9FB;
    border-right: 1px solid #E5E7EB;
    overflow: hidden;
    z-index: 10;
    display: flex;
    flex-direction: column;
  }

  .sidebar-header {
    padding: 20px 16px 16px 16px;
    border-bottom: 1px solid #E5E7EB;
    flex-shrink: 0;
  }

  .sidebar-logo img {
    max-height: 28px;
    max-width: 120px;
    object-fit: contain;
  }

  .sidebar-logo-text {
    font-size: 13px;
    font-weight: 700;
    color: #0F2D52;
  }

  .sidebar-brand-label {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6B7280;
    margin-top: 4px;
  }

  .sidebar-company {
    font-size: 12px;
    font-weight: 600;
    color: #0F2D52;
    padding: 12px 16px 2px 16px;
  }

  .sidebar-position {
    font-size: 11px;
    font-weight: 400;
    color: #6B7280;
    padding: 0 16px 8px 16px;
  }

  /* ── Role context block ───────────────────────────────────────────── */
  .role-context {
    padding: 0 16px 16px 16px;
    border-bottom: 1px solid #E5E7EB;
    flex-shrink: 0;
  }

  .context-pair {
    margin-bottom: 8px;
  }

  .context-pair:last-child {
    margin-bottom: 0;
  }

  .ctx-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #9CA3AF;
    margin-bottom: 1px;
  }

  .ctx-value {
    font-size: 12px;
    font-weight: 500;
    color: #111827;
  }

  /* ── Section nav ──────────────────────────────────────────────────── */
  .nav-sections {
    padding: 12px 0;
    flex: 1;
    overflow: hidden;
  }

  .nav-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #9CA3AF;
    padding: 0 16px 8px 16px;
  }

  .nav-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 9px 16px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 400;
    color: #374151;
    border-left: 3px solid transparent;
    transition: all 0.15s ease;
    user-select: none;
    outline: none;
  }

  .nav-item:hover {
    background: #F0F2F5;
    color: #111827;
  }

  .nav-item.active {
    background: #FFFFFF;
    color: #111827;
    font-weight: 500;
    box-shadow: inset 0 0 0 0.5px #E5E7EB;
  }

  .nav-badge {
    font-size: 10px;
    color: #9CA3AF;
  }

  /* ── Sidebar footer ───────────────────────────────────────────────── */
  .sidebar-footer {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    padding: 12px 16px;
    border-top: 1px solid #E5E7EB;
    font-size: 10px;
    font-style: italic;
    color: #9CA3AF;
    background: #F8F9FB;
  }

  /* ── Content panel ────────────────────────────────────────────────── */
  .content-panel {
    position: fixed;
    left: 220px; top: 0; bottom: 0;
    width: calc(100vw - 220px);
    overflow-y: auto;
    background: #ffffff;
    padding: 32px 40px 48px 40px;
    scrollbar-width: thin;
    scrollbar-color: #E5E7EB transparent;
  }

  .content-panel::-webkit-scrollbar { width: 4px; }
  .content-panel::-webkit-scrollbar-track { background: transparent; }
  .content-panel::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 4px; }

  .content-inner {
    max-width: 760px;
    margin: 0 auto;
  }

  /* ── Section panels ───────────────────────────────────────────────── */
  .section-panel { display: none; }
  .section-panel.active { display: block; }

  .section-header {
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid #E5E7EB;
  }

  .section-title {
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .section-count {
    font-size: 12px;
    font-weight: 400;
    color: #6B7280;
    margin-top: 4px;
  }

  /* ── Content preview / expand ─────────────────────────────────────── */
  .section-content {
    position: relative;
  }

  .section-content.preview {
    max-height: 420px;
    overflow: hidden;
  }

  .fade-gradient {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 60px;
    background: linear-gradient(transparent, #ffffff);
    pointer-events: none;
  }

  .view-more-btn {
    font-size: 11px;
    font-weight: 500;
    color: #0F2D52;
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px 0 0 0;
    display: block;
    margin-top: 4px;
  }

  .view-more-btn:hover {
    color: #0A1F3A;
    text-decoration: underline;
  }

  /* ── Field content ────────────────────────────────────────────────── */
  .section-body ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .section-body li {
    display: flex;
    align-items: flex-start;
    padding-left: 16px;
    padding-bottom: 5px;
    font-size: 13px;
    color: #374151;
    line-height: 1.6;
    position: relative;
  }

  .section-body li::before {
    content: '';
    display: block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--bullet-color, #9CA3AF);
    flex-shrink: 0;
    margin-top: 8px;
    position: absolute;
    left: 4px;
  }

  .section-body li .li-text {
    flex: 1;
  }

  .section-body p {
    font-size: 13px;
    color: #374151;
    line-height: 1.6;
    margin-bottom: 6px;
  }

  .section-body .bold-line {
    font-size: 13px;
    font-weight: 600;
    color: #111827;
    margin-top: 16px;
    margin-bottom: 4px;
  }

  .section-body .bold-line:first-child {
    margin-top: 0;
  }

  .empty-msg {
    font-size: 13px;
    font-style: italic;
    color: #9CA3AF;
    margin-top: 24px;
  }

  /* ── Responsive < 700px ───────────────────────────────────────────── */
  @media (max-width: 700px) {
    body { overflow: auto; }

    .sidebar {
      position: static;
      width: 100%;
      height: auto;
      border-right: none;
      border-bottom: 1px solid #E5E7EB;
      flex-direction: row;
      flex-wrap: nowrap;
      overflow-x: auto;
    }

    .sidebar-header,
    .role-context,
    .nav-label,
    .sidebar-footer { display: none; }

    .nav-sections {
      display: flex;
      flex-direction: row;
      padding: 0;
      flex: unset;
      white-space: nowrap;
      overflow-x: auto;
    }

    .nav-item {
      padding: 12px 14px;
      border-left: none;
      border-bottom: 3px solid transparent;
      flex-shrink: 0;
    }

    .nav-item.active {
      border-left: none;
      box-shadow: none;
    }

    .content-panel {
      position: static;
      left: 0;
      width: 100%;
      height: auto;
      overflow-y: visible;
      padding: 24px 20px 48px 20px;
    }
  }

  /* ── Print ────────────────────────────────────────────────────────── */
  @media print {
    @page { size: Letter portrait; margin: 0.5in 0.5in 0.1in 0.5in; }

    body {
      overflow: visible;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .sidebar { display: none !important; }

    .content-panel {
      position: static;
      left: 0;
      width: 100%;
      overflow: visible;
      padding: 0;
      height: auto;
    }

    .content-inner { max-width: 100%; }

    .section-panel { display: block !important; }
    .section-panel + .section-panel { margin-top: 20px; }

    .section-content.preview {
      max-height: none !important;
      overflow: visible;
    }

    .fade-gradient,
    .view-more-btn { display: none !important; }

    .section-header { margin-bottom: 8px; padding-bottom: 8px; }
    .section-title { font-size: 13px; }
    .section-count { display: none; }

    .section-body li,
    .section-body p { font-size: 11px; }
    .section-body .bold-line { font-size: 11px; margin-top: 6px; }

    .section-panel { break-inside: avoid; }
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
  // ── Section definitions (sidebar order) ────────────────────────────────────
  const sections = [
    { id: 'success',    label: 'Success in Role',          accent: '#0F2D52', content: successInRole },
    { id: 'functional', label: 'Functional Responsibility', accent: '#0F2D52', content: functionalResponsibility },
    { id: 'musthave',   label: 'Must Have',                 accent: '#166534', content: mustHave },
    { id: 'nicetohave', label: 'Nice to Have',              accent: '#1D4ED8', content: niceToHave },
    { id: 'redflags',   label: 'Red Flags',                 accent: '#991B1B', content: redFlags },
  ];

  // ── Sidebar logo ───────────────────────────────────────────────────────────
  const logoHtml = hitchLogoDataUri
    ? `<img src="${hitchLogoDataUri}" alt="Hitch Partners">`
    : `<span class="sidebar-logo-text">Hitch Partners</span>`;

  // ── Company / position subtitle ────────────────────────────────────────────
  const companyHtml = clientName
    ? `<div class="sidebar-company">${esc(clientName)}</div>`
    : '';
  const positionHtml = searchName
    ? `<div class="sidebar-position">${esc(searchName)}</div>`
    : '';

  // ── Role context pairs (only non-empty fields) ─────────────────────────────
  const contextFields = [
    { label: 'LOCATION',         value: location },
    { label: 'TEAM SIZE',        value: currentTeamSize },
    { label: 'TEAM IN 18-24 MO', value: teamSize18Months },
  ].filter(f => f.value && f.value.trim());

  const contextHtml = contextFields.length
    ? `<div class="role-context">${
        contextFields.map(f => `
          <div class="context-pair">
            <div class="ctx-label">${esc(f.label)}</div>
            <div class="ctx-value">${esc(f.value)}</div>
          </div>`).join('')
      }</div>`
    : '';

  // ── Nav items ──────────────────────────────────────────────────────────────
  const navItemsHtml = sections.map((s, i) => {
    const isFirst = i === 0;
    const borderColor = isFirst ? s.accent : 'transparent';
    const activeClass = isFirst ? ' active' : '';
    return `
      <div class="nav-item${activeClass}"
           data-section="${s.id}"
           data-accent="${s.accent}"
           style="border-left-color:${borderColor};"
           tabindex="0">
        ${esc(s.label)}
        <span class="nav-badge" data-badge="${s.id}"></span>
      </div>`;
  }).join('');

  // ── Content panels ─────────────────────────────────────────────────────────
  const panelsHtml = sections.map((s, i) => {
    const isFirst = i === 0;
    const activeClass = isFirst ? ' active' : '';
    const bodyHtml = s.content && s.content.trim()
      ? fieldToHtml(s.content)
      : '<p class="empty-msg">No items have been specified for this section.</p>';
    const bulletColor = hexToRgba(s.accent, 0.45);
    return `
      <div class="section-panel${activeClass}"
           id="panel-${s.id}"
           data-section="${s.id}"
           style="--bullet-color:${bulletColor};">
        <div class="section-header">
          <div class="section-title" style="color:${s.accent};">${esc(s.label)}</div>
          <div class="section-count" id="count-${s.id}"></div>
        </div>
        <div class="section-content preview" id="content-${s.id}">
          <div class="section-body">${bodyHtml}</div>
          <div class="fade-gradient" id="grad-${s.id}"></div>
        </div>
        <button class="view-more-btn" id="btn-${s.id}" style="display:none;"></button>
      </div>`;
  }).join('');

  // ── JavaScript ─────────────────────────────────────────────────────────────
  const JS = `
(function () {
  var SECTIONS = ['success','functional','musthave','nicetohave','redflags'];
  var ACCENTS = {
    success: '#0F2D52', functional: '#0F2D52',
    musthave: '#166534', nicetohave: '#1D4ED8', redflags: '#991B1B'
  };
  var current = SECTIONS[0];

  function countBullets(id) {
    var panel = document.getElementById('panel-' + id);
    return panel ? panel.querySelectorAll('.section-body li').length : 0;
  }

  function initCounts() {
    SECTIONS.forEach(function (id) {
      var n = countBullets(id);
      var badge = document.querySelector('[data-badge="' + id + '"]');
      if (badge) badge.textContent = n > 0 ? n : '';
      var countEl = document.getElementById('count-' + id);
      if (countEl) countEl.textContent = n === 1 ? '1 item' : n > 0 ? n + ' items' : '';
    });
  }

  function initViewMore(id) {
    var contentEl = document.getElementById('content-' + id);
    var btnEl = document.getElementById('btn-' + id);
    var gradEl = document.getElementById('grad-' + id);
    if (!contentEl || !btnEl) return;

    var PREVIEW_H = 420;

    // Measure full height
    contentEl.classList.remove('preview');
    var fullH = contentEl.scrollHeight;
    contentEl.classList.add('preview');

    if (fullH <= PREVIEW_H) {
      if (btnEl.parentNode) btnEl.parentNode.removeChild(btnEl);
      if (gradEl && gradEl.parentNode) gradEl.parentNode.removeChild(gradEl);
      return;
    }

    // Count hidden bullet items
    var allItems = contentEl.querySelectorAll('.section-body li');
    var total = allItems.length;
    var visible = 0;
    allItems.forEach(function (li) {
      if (li.offsetTop + li.offsetHeight <= PREVIEW_H) visible++;
    });
    var hidden = Math.max(0, total - visible);

    if (hidden === 0) {
      if (btnEl.parentNode) btnEl.parentNode.removeChild(btnEl);
      if (gradEl && gradEl.parentNode) gradEl.parentNode.removeChild(gradEl);
      return;
    }

    var label = hidden === 1 ? 'View 1 more item \u2192' : 'View ' + hidden + ' more items \u2192';
    btnEl.textContent = label;
    btnEl.dataset.label = label;
    btnEl.style.display = 'block';

    var expanded = false;
    btnEl.addEventListener('click', function () {
      if (!expanded) {
        expanded = true;
        contentEl.classList.remove('preview');
        if (gradEl) gradEl.style.display = 'none';
        btnEl.textContent = 'Show less \u2191';
      } else {
        expanded = false;
        contentEl.classList.add('preview');
        if (gradEl) gradEl.style.display = '';
        btnEl.textContent = label;
        var cp = document.getElementById('contentPanel');
        if (cp) cp.scrollTop = 0;
      }
    });
  }

  function activateSection(id) {
    current = id;

    document.querySelectorAll('.nav-item').forEach(function (item) {
      var isActive = item.dataset.section === id;
      if (isActive) {
        item.classList.add('active');
        item.style.borderLeftColor = ACCENTS[id];
      } else {
        item.classList.remove('active');
        item.style.borderLeftColor = 'transparent';
      }
    });

    document.querySelectorAll('.section-panel').forEach(function (panel) {
      if (panel.dataset.section === id) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });

    var cp = document.getElementById('contentPanel');
    if (cp) cp.scrollTop = 0;

    // Reset preview state
    var contentEl = document.getElementById('content-' + id);
    var btnEl = document.getElementById('btn-' + id);
    var gradEl = document.getElementById('grad-' + id);
    if (contentEl && !contentEl.classList.contains('preview')) {
      contentEl.classList.add('preview');
      if (gradEl) gradEl.style.display = '';
      if (btnEl && btnEl.dataset.label) btnEl.textContent = btnEl.dataset.label;
    }
  }

  // Nav click
  document.querySelectorAll('.nav-item').forEach(function (item) {
    item.addEventListener('click', function () {
      activateSection(item.dataset.section);
    });
  });

  // Keyboard nav on sidebar
  var sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.addEventListener('keydown', function (e) {
      var idx = SECTIONS.indexOf(current);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        var next = SECTIONS[(idx + 1) % SECTIONS.length];
        activateSection(next);
        var el = document.querySelector('[data-section="' + next + '"].nav-item');
        if (el) el.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        var prev = SECTIONS[(idx - 1 + SECTIONS.length) % SECTIONS.length];
        activateSection(prev);
        var el2 = document.querySelector('[data-section="' + prev + '"].nav-item');
        if (el2) el2.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var focused = document.activeElement;
        if (focused && focused.dataset && focused.dataset.section) {
          activateSection(focused.dataset.section);
        }
      }
    });
  }

  // Init
  initCounts();
  SECTIONS.forEach(function (id) { initViewMore(id); });
  activateSection('success');
})();
`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Role Requirements Brief \u2014 ${esc(clientName || '')}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>

<!-- Sidebar -->
<nav class="sidebar" id="sidebar">
  <div class="sidebar-header">
    <div class="sidebar-logo">${logoHtml}</div>
    <div class="sidebar-brand-label">Hitch Partners</div>
  </div>
  ${companyHtml}
  ${positionHtml}
  ${contextHtml}
  <div class="nav-sections">
    <div class="nav-label">SECTIONS</div>
    ${navItemsHtml}
  </div>
  <div class="sidebar-footer">Hitch Partners &lt;&gt; Confidential</div>
</nav>

<!-- Content panel -->
<main class="content-panel" id="contentPanel">
  <div class="content-inner">
    ${panelsHtml}
  </div>
</main>

<script>${JS}</script>
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

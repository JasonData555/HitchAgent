/**
 * Builds a self-contained HTML document for the Rubric role requirements brief.
 *
 * Modern enterprise design: McKinsey/Linear/Notion aesthetic.
 * Left-border accent cards, typography hierarchy, CSS max-height transitions.
 *
 * All CSS and JavaScript are inline. Google Fonts (Inter) is the only
 * external dependency — degrades gracefully to system font stack if unavailable.
 *
 * Sections (in render order):
 *   1. Header     — Hitch logo (left) · title/subtitle (center) · client logo (right)
 *   2. Context Bar — Location, Team Size, Reports To stacked-label pills
 *   3. Functional Responsibility — navy left accent, expanded by default
 *   4. Success in Role           — navy left accent, expanded by default
 *   5. Must Have                 — deep green left accent, expanded by default
 *   6. Nice to Have              — steel blue left accent, collapsed by default
 *   7. Red Flags                 — deep crimson left accent, collapsed by default
 *
 * @param {object} opts
 * @param {string} opts.clientName
 * @param {string} opts.searchName
 * @param {string} opts.location
 * @param {string} opts.currentTeamSize
 * @param {string} opts.teamSize18Months
 * @param {string} opts.positionReportsTo
 * @param {string} opts.mustHave
 * @param {string} opts.niceToHave
 * @param {string} opts.redFlags
 * @param {string} opts.successInRole
 * @param {string} opts.functionalResponsibility
 * @param {string} opts.hitchLogoDataUri  — complete data URI (e.g. 'data:image/png;base64,...')
 * @param {string} opts.clientLogoDataUri — complete data URI for client logo, or ''
 * @returns {string} Complete HTML string
 */
export function createRubricHtml({
  clientName = '',
  searchName = '',
  location = '',
  currentTeamSize = '',
  teamSize18Months = '',
  positionReportsTo = '',
  mustHave = '',
  niceToHave = '',
  redFlags = '',
  successInRole = '',
  functionalResponsibility = '',
  hitchLogoDataUri = '',
  clientLogoDataUri = '',
} = {}) {

  // ── HTML-escape a plain string ──────────────────────────────────────────────
  function esc(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Render inline **bold** markers ──────────────────────────────────────────
  function renderInlineBold(text) {
    return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  // ── Parse field text into HTML (bullets + bold labels) ─────────────────────
  function parseFieldToHtml(text) {
    if (!text || !text.trim()) return '';
    const lines = text.split(/\r?\n/);
    const parts = [];
    let inList = false;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        if (inList) { parts.push('</ul>'); inList = false; }
        continue;
      }

      // Full-line bold: **text** with nothing else on the line
      if (/^\*\*[^*]+\*\*$/.test(line)) {
        if (inList) { parts.push('</ul>'); inList = false; }
        const inner = line.replace(/^\*\*/, '').replace(/\*\*$/, '');
        parts.push(`<p class="bold-label">${esc(inner)}</p>`);
        continue;
      }

      // Bullet line
      if (line.startsWith('- ') || line === '-') {
        if (!inList) { parts.push('<ul>'); inList = true; }
        const content = line.startsWith('- ') ? line.slice(2) : '';
        parts.push(`<li>${renderInlineBold(content)}</li>`);
        continue;
      }

      // Plain text
      if (inList) { parts.push('</ul>'); inList = false; }
      parts.push(`<p>${renderInlineBold(line)}</p>`);
    }

    if (inList) parts.push('</ul>');
    return parts.join('\n');
  }

  // ── Count bullet items (lines starting with "- ") ──────────────────────────
  function countBullets(text) {
    if (!text) return 0;
    return (text.match(/^\s*-\s/gm) || []).length;
  }

  // ── Section builder ─────────────────────────────────────────────────────────

  /**
   * Build a rubric section card with left-border accent and header-click toggle.
   *
   * @param {string}  title        — section heading
   * @param {string}  accentClass  — CSS class controlling left border color
   * @param {string}  content      — raw field text
   * @param {boolean} expanded     — whether section starts open
   * @param {boolean} skipIfEmpty  — omit section entirely when content is empty
   * @param {string}  emptyMsg     — shown when content is empty (if not skipped)
   */
  function buildSection({ title, accentClass, content, expanded, skipIfEmpty, emptyMsg }) {
    const hasContent = content && content.trim();
    if (!hasContent && skipIfEmpty) return '';

    const bodyHtml = hasContent
      ? parseFieldToHtml(content)
      : `<p class="empty-msg">${esc(emptyMsg || 'No items specified.')}</p>`;

    const bulletCount = countBullets(content);
    const countBadge  = bulletCount > 0
      ? `<span class="item-count">${bulletCount} item${bulletCount !== 1 ? 's' : ''}</span>`
      : '';

    const expandedClass = expanded ? ' expanded' : '';

    const chevron = `<svg class="chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6L8 10L12 6" stroke="#6B7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    return `<div class="rubric-section ${accentClass}${expandedClass}">
  <div class="section-header-row" onclick="toggleSection(this)">
    <span class="section-title">${esc(title)}</span>
    <div class="section-meta">
      ${countBadge}
      ${chevron}
    </div>
  </div>
  <div class="section-content">
    <div class="section-body">
      ${bodyHtml}
    </div>
  </div>
</div>`;
  }

  // ── Build sections ──────────────────────────────────────────────────────────

  const functionalSection = buildSection({
    title: 'Functional Responsibility',
    accentClass: 'accent-navy',
    content: functionalResponsibility,
    expanded: true,
    skipIfEmpty: true,
  });

  const successSection = buildSection({
    title: 'Success in Role',
    accentClass: 'accent-navy',
    content: successInRole,
    expanded: true,
    skipIfEmpty: true,
  });

  const mustHaveSection = buildSection({
    title: 'Must Have',
    accentClass: 'accent-green',
    content: mustHave,
    expanded: true,
    skipIfEmpty: false,
    emptyMsg: 'No items specified.',
  });

  const niceToHaveSection = buildSection({
    title: 'Nice to Have',
    accentClass: 'accent-blue',
    content: niceToHave,
    expanded: false,
    skipIfEmpty: false,
    emptyMsg: 'No items specified.',
  });

  const redFlagsSection = buildSection({
    title: 'Red Flags',
    accentClass: 'accent-red',
    content: redFlags,
    expanded: false,
    skipIfEmpty: false,
    emptyMsg: 'No items specified.',
  });

  // ── Header logo slots ───────────────────────────────────────────────────────
  const hitchLogoHtml = hitchLogoDataUri
    ? `<img class="header-logo" src="${hitchLogoDataUri}" alt="Hitch Partners">`
    : `<span class="header-logo-text">Hitch Partners</span>`;

  const clientLogoHtml = clientLogoDataUri
    ? `<img class="header-logo" src="${clientLogoDataUri}" alt="${esc(clientName)}">`
    : `<span class="header-logo-text">${esc(clientName)}</span>`;

  // ── Context bar pills ───────────────────────────────────────────────────────
  const contextItems = [
    { label: 'Location',              value: location },
    { label: 'Current Team Size',     value: currentTeamSize },
    { label: 'Est. Team Size (18–24 mo.)', value: teamSize18Months },
    { label: 'Position Reports To',   value: positionReportsTo },
  ].filter(item => item.value && item.value.trim());

  const contextPillsHtml = contextItems
    .map(item => `<div class="context-pill">
      <span class="pill-label">${esc(item.label)}</span>
      <span class="pill-value">${esc(item.value)}</span>
    </div>`)
    .join('\n      ');

  const titleLine = searchName
    ? `${esc(clientName)} &mdash; ${esc(searchName)}`
    : esc(clientName);

  // ── Full HTML document ──────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Role Requirements &mdash; ${esc(clientName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    /* ── Reset & base ───────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #1A1D23;
      background: #F7F8FA;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Page wrapper ───────────────────────────────────────────────────── */
    .page-wrapper {
      max-width: 860px;
      margin: 0 auto;
      padding: 40px 24px;
    }

    /* ── Header ─────────────────────────────────────────────────────────── */
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 20px;
      border-bottom: 1px solid #E5E7EB;
      margin-bottom: 20px;
    }

    .header-logo {
      height: 32px;
      width: auto;
      max-width: 130px;
      flex-shrink: 0;
      object-fit: contain;
    }

    .header-logo-text {
      font-size: 12px;
      font-weight: 700;
      color: #0F2D52;
      letter-spacing: 0.04em;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .header-center {
      flex: 1;
      text-align: center;
      min-width: 0;
    }

    .header-main-title {
      font-size: 22px;
      font-weight: 700;
      color: #0F2D52;
      letter-spacing: 0.02em;
      line-height: 1.2;
    }

    .header-subtitle {
      font-size: 13px;
      font-weight: 400;
      color: #6B7280;
      margin-top: 4px;
    }

    /* ── Context bar ────────────────────────────────────────────────────── */
    .context-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 24px;
    }

    .context-pill {
      display: flex;
      flex-direction: column;
      background: #FFFFFF;
      border: 1px solid #E5E7EB;
      border-radius: 6px;
      padding: 6px 14px;
    }

    .pill-label {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #6B7280;
      margin-bottom: 2px;
    }

    .pill-value {
      font-size: 14px;
      font-weight: 500;
      color: #1A1D23;
      white-space: nowrap;
    }

    /* ── Sections wrapper ───────────────────────────────────────────────── */
    .sections {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* ── Section card ───────────────────────────────────────────────────── */
    .rubric-section {
      background: #FFFFFF;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      border-left-width: 3px;
      border-left-style: solid;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      overflow: hidden;
    }

    /* Left border accent colors */
    .accent-navy  { border-left-color: #0F2D52; }
    .accent-green { border-left-color: #166534; }
    .accent-blue  { border-left-color: #1D4ED8; }
    .accent-red   { border-left-color: #991B1B; }

    /* ── Section header row ─────────────────────────────────────────────── */
    .section-header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      cursor: pointer;
      user-select: none;
      border-bottom: 1px solid transparent;
      transition: border-bottom-color 0.15s ease;
    }

    .section-header-row:hover {
      background: #FAFAFA;
    }

    .rubric-section.expanded .section-header-row {
      border-bottom-color: #E5E7EB;
    }

    .section-title {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #374151;
    }

    .section-meta {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .item-count {
      font-size: 12px;
      font-weight: 400;
      color: #6B7280;
      white-space: nowrap;
    }

    .chevron {
      display: block;
      flex-shrink: 0;
      transition: transform 0.25s ease;
    }

    .rubric-section.expanded .chevron {
      transform: rotate(180deg);
    }

    /* ── Section content (max-height transition) ────────────────────────── */
    .section-content {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.25s ease-in-out;
    }

    .rubric-section.expanded .section-content {
      max-height: 2000px;
    }

    .section-body {
      padding: 16px 20px 20px;
    }

    /* ── Content typography ─────────────────────────────────────────────── */
    .section-body ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .section-body li {
      font-size: 14px;
      line-height: 1.65;
      color: #1A1D23;
      padding-bottom: 6px;
      padding-left: 16px;
      position: relative;
      overflow-wrap: break-word;
      word-break: break-word;
    }

    .section-body li:last-child { padding-bottom: 0; }

    /* Custom bullet: 5px circle in section accent color at 0.4 opacity */
    .section-body li::before {
      content: '';
      position: absolute;
      left: 0;
      top: 10px;
      width: 5px;
      height: 5px;
      border-radius: 50%;
    }

    .accent-navy .section-body li::before  { background: rgba(15,45,82,0.4); }
    .accent-green .section-body li::before { background: rgba(22,101,52,0.4); }
    .accent-blue .section-body li::before  { background: rgba(29,78,216,0.4); }
    .accent-red .section-body li::before   { background: rgba(153,27,27,0.4); }

    .section-body p {
      font-size: 14px;
      line-height: 1.65;
      color: #1A1D23;
      margin-bottom: 6px;
      overflow-wrap: break-word;
      word-break: break-word;
    }

    .section-body p:last-child { margin-bottom: 0; }

    /* Bold labels (full-line **text**) */
    .bold-label {
      font-size: 14px;
      font-weight: 600;
      color: #1A1D23;
      margin-top: 12px;
      margin-bottom: 4px;
    }

    .bold-label:first-child { margin-top: 0; }

    .empty-msg {
      color: #9CA3AF;
      font-style: italic;
    }

    /* ── Footer ─────────────────────────────────────────────────────────── */
    .page-footer {
      margin-top: 32px;
      padding: 20px 0;
      border-top: 1px solid #E5E7EB;
      text-align: center;
    }

    .footer-text {
      font-size: 12px;
      font-weight: 400;
      color: #9CA3AF;
      font-style: italic;
    }

    /* ── Responsive ─────────────────────────────────────────────────────── */
    @media (max-width: 600px) {
      .page-wrapper { padding: 16px; }

      .page-header {
        flex-direction: column;
        text-align: center;
        gap: 12px;
      }

      .header-main-title { font-size: 18px; }

      .section-header-row { padding: 14px 16px; }
      .section-body { padding: 14px 16px 16px; }
    }

    /* ── Print ──────────────────────────────────────────────────────────── */
    @media print {
      body { background: #fff; }
      .page-wrapper { padding: 0; max-width: 100%; }
      .page-header { margin-bottom: 16px; padding-bottom: 12px; }
      .rubric-section { box-shadow: none; break-inside: avoid; }
      .section-content { max-height: none !important; overflow: visible !important; }
      .chevron { display: none; }
      .item-count { display: none; }
      .rubric-section.expanded .section-header-row,
      .rubric-section:not(.expanded) .section-header-row {
        border-bottom-color: #E5E7EB;
      }
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  </style>
</head>
<body>
<div class="page-wrapper">

  <!-- Header -->
  <header class="page-header">
    ${hitchLogoHtml}
    <div class="header-center">
      <div class="header-main-title">Role Requirements Alignment</div>
      ${titleLine ? `<div class="header-subtitle">${titleLine}</div>` : ''}
    </div>
    ${clientLogoHtml}
  </header>

  <!-- Context Bar -->
  ${contextPillsHtml ? `<div class="context-bar">\n      ${contextPillsHtml}\n    </div>` : ''}

  <!-- Sections -->
  <div class="sections">
    ${functionalSection}
    ${successSection}
    ${mustHaveSection}
    ${niceToHaveSection}
    ${redFlagsSection}
  </div>

  <!-- Footer -->
  <footer class="page-footer">
    <span class="footer-text">Hitch Partners &lt;&gt; Confidential &amp; Proprietary</span>
  </footer>

</div>
<script>
function toggleSection(header) {
  header.closest('.rubric-section').classList.toggle('expanded');
}
</script>
</body>
</html>`;
}

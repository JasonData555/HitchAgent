/**
 * Builds a self-contained HTML document for the Rubric role requirements brief.
 *
 * Modern enterprise design: McKinsey/Linear/Notion aesthetic.
 * Two-column card grid, left-border accent cards, typography hierarchy.
 * Each section shows its first bullet item by default; More/Less button
 * expands/collapses remaining items.
 *
 * All CSS and JavaScript are inline. Google Fonts (Inter) is the only
 * external dependency — degrades gracefully to system font stack if unavailable.
 *
 * Sections (in render order):
 *   1. Header     — Hitch logo (left) · title/subtitle (center) · client logo (right)
 *   2. Context Bar — Location, Team Size, Reports To stacked-label pills
 *   3. Grid Row 1: Functional Responsibility (left) | Success in Role (right)
 *   4. Grid Row 2: Must Have (full width)
 *   5. Grid Row 3: Nice to Have (left) | Red Flags (right)
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

  // ── Split content at first bullet: preview (first item) + extra (rest) ─────
  function splitPreviewExtra(text) {
    if (!text || !text.trim()) return { previewText: '', extraText: '' };

    const lines = text.split(/\r?\n/);
    let firstBulletIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('- ') || lines[i].trim() === '-') {
        firstBulletIdx = i;
        break;
      }
    }

    // No bullets found — all content is preview, nothing extra
    if (firstBulletIdx === -1) return { previewText: text, extraText: '' };

    // Lines up to and including the first bullet → preview
    // Lines after the first bullet → extra
    const previewLines = lines.slice(0, firstBulletIdx + 1);
    const extraLines   = lines.slice(firstBulletIdx + 1);

    return {
      previewText: previewLines.join('\n'),
      extraText:   extraLines.join('\n'),
    };
  }

  // ── Section builder ─────────────────────────────────────────────────────────

  /**
   * Build a rubric section card. Always shows first bullet item; More/Less
   * button expands/collapses the remaining items.
   *
   * @param {string}  title        — section heading
   * @param {string}  accentClass  — CSS class controlling left border color
   * @param {string}  content      — raw field text
   * @param {boolean} skipIfEmpty  — omit section entirely when content is empty
   * @param {string}  emptyMsg     — shown when content is empty (if not skipped)
   * @param {string}  dataCol      — data-col attribute value: 'left'|'right'|'full'
   */
  function buildSection({ title, accentClass, content, skipIfEmpty, emptyMsg, dataCol }) {
    const hasContent = content && content.trim();
    if (!hasContent && skipIfEmpty) return '';

    const bulletCount = countBullets(content);
    const countBadge  = bulletCount > 0
      ? `<span class="item-count">${bulletCount} item${bulletCount !== 1 ? 's' : ''}</span>`
      : '';

    const dataColAttr = dataCol ? ` data-col="${dataCol}"` : '';

    let bodyHtml;
    if (!hasContent) {
      bodyHtml = `<div class="preview-content"><p class="empty-msg">${esc(emptyMsg || 'No items specified.')}</p></div>`;
    } else {
      const { previewText, extraText } = splitPreviewExtra(content);
      const previewHtml = parseFieldToHtml(previewText);
      const extraHtml   = extraText.trim() ? parseFieldToHtml(extraText) : '';
      const moreLessBtn = extraHtml
        ? `<button class="more-less-btn" onclick="toggleMore(this)">More</button>`
        : '';

      bodyHtml = `<div class="preview-content">${previewHtml}</div>
      ${extraHtml ? `<div class="extra-content">${extraHtml}</div>` : ''}
      ${moreLessBtn}`;
    }

    return `<div class="rubric-section ${accentClass}"${dataColAttr}>
  <div class="section-header-row">
    <span class="section-title">${esc(title)}</span>
    <div class="section-meta">
      ${countBadge}
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

  // If both navy sections are empty, omit both rather than rendering two empty cards
  const skipBothNavy = !functionalResponsibility?.trim() && !successInRole?.trim();

  const functionalSection = skipBothNavy ? '' : buildSection({
    title: 'Functional Responsibility',
    accentClass: 'accent-navy',
    content: functionalResponsibility,
    skipIfEmpty: true,
    dataCol: 'left',
  });

  const successSection = skipBothNavy ? '' : buildSection({
    title: 'Success in Role',
    accentClass: 'accent-navy',
    content: successInRole,
    skipIfEmpty: true,
    dataCol: 'right',
  });

  const mustHaveSection = buildSection({
    title: 'Must Have',
    accentClass: 'accent-green',
    content: mustHave,
    skipIfEmpty: false,
    emptyMsg: 'No items specified.',
    dataCol: 'full',
  });

  const niceToHaveSection = buildSection({
    title: 'Nice to Have',
    accentClass: 'accent-blue',
    content: niceToHave,
    skipIfEmpty: false,
    emptyMsg: 'No items specified.',
    dataCol: 'left',
  });

  const redFlagsSection = buildSection({
    title: 'Red Flags',
    accentClass: 'accent-red',
    content: redFlags,
    skipIfEmpty: false,
    emptyMsg: 'No items specified.',
    dataCol: 'right',
  });

  // ── Header logo slots ───────────────────────────────────────────────────────
  const hitchLogoHtml = hitchLogoDataUri
    ? `<img class="header-logo" src="${hitchLogoDataUri}" alt="Hitch Partners">`
    : `<span class="header-logo-text">Hitch Partners</span>`;

  const clientLogoHtml = clientLogoDataUri
    ? `<img class="header-logo header-logo-right" src="${clientLogoDataUri}" alt="${esc(clientName)}">`
    : `<span class="header-logo-text header-logo-text-right">${esc(clientName)}</span>`;

  // ── Context bar pills ───────────────────────────────────────────────────────
  const contextItems = [
    { label: 'Location',      value: location },
    { label: 'Team now',      value: currentTeamSize },
    { label: 'Team 18-24mo',  value: teamSize18Months },
    { label: 'Reports to',    value: positionReportsTo },
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
      font-size: 13px;
      line-height: 1.6;
      color: #111827;
      background: #F4F5F7;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Page wrapper ───────────────────────────────────────────────────── */
    .page-wrapper {
      max-width: 900px;
      margin: 0 auto;
      padding: 36px 24px;
    }

    /* ── Header ─────────────────────────────────────────────────────────── */
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid #E5E7EB;
      margin-bottom: 16px;
    }

    .header-left {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      flex-shrink: 0;
    }

    .header-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      flex-shrink: 0;
    }

    .header-logo {
      height: 32px;
      width: auto;
      max-width: 130px;
      object-fit: contain;
    }

    .header-logo-right {
      max-width: 130px;
    }

    .header-logo-text {
      font-size: 12px;
      font-weight: 700;
      color: #0F2D52;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }

    .header-logo-text-right {
      font-size: 13px;
      font-weight: 600;
      color: #0F2D52;
      text-align: right;
    }

    .header-hitch-label {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6B7280;
      margin-top: 4px;
    }

    .header-center {
      flex: 1;
      text-align: center;
      min-width: 0;
    }

    .header-main-title {
      font-size: 20px;
      font-weight: 600;
      color: #0F2D52;
      letter-spacing: 0.01em;
      line-height: 1.2;
    }

    .header-subtitle {
      font-size: 12px;
      font-weight: 400;
      color: #6B7280;
      margin-top: 4px;
    }

    /* ── Context bar ────────────────────────────────────────────────────── */
    .context-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 20px;
    }

    .context-pill {
      display: inline-flex;
      flex-direction: column;
      background: #FFFFFF;
      border: 1px solid #E5E7EB;
      border-radius: 6px;
      padding: 6px 14px;
    }

    .pill-label {
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: #6B7280;
      margin-bottom: 2px;
    }

    .pill-value {
      font-size: 13px;
      font-weight: 500;
      color: #111827;
      white-space: nowrap;
    }

    /* ── Sections grid ──────────────────────────────────────────────────── */
    .sections {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    /* Grid column placement via data-col attribute */
    [data-col="left"]  { grid-column: 1 / 2; }
    [data-col="right"] { grid-column: 2 / 3; }
    [data-col="full"]  { grid-column: 1 / -1; }

    /* ── Section card ───────────────────────────────────────────────────── */
    .rubric-section {
      background: #FFFFFF;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      border-left-width: 3px;
      border-left-style: solid;
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
      padding: 14px 18px;
      user-select: none;
      border-bottom: 1px solid #E5E7EB;
      cursor: default;
    }

    .section-title {
      font-size: 10px;
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
      font-size: 11px;
      font-weight: 400;
      color: #6B7280;
      white-space: nowrap;
    }

    /* ── Section content (always visible) ──────────────────────────────── */
    .section-content {
      padding: 0 18px;
    }

    .section-body {
      padding: 14px 0 18px;
    }

    /* ── Extra content (hidden until More is clicked) ───────────────────── */
    .extra-content {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.2s ease;
    }

    .rubric-section.expanded .extra-content {
      max-height: 1200px;
      overflow: visible;
    }

    /* ── More/Less button ───────────────────────────────────────────────── */
    .more-less-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
      padding: 0;
      background: none;
      border: none;
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      color: #6B7280;
      cursor: pointer;
      letter-spacing: 0.01em;
    }

    .more-less-btn:hover {
      color: #374151;
    }

    /* ── Content typography ─────────────────────────────────────────────── */
    .section-body ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .section-body li {
      font-size: 13px;
      line-height: 1.6;
      color: #111827;
      padding-bottom: 5px;
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
      top: 9px;
      width: 5px;
      height: 5px;
      border-radius: 50%;
    }

    .accent-navy .section-body li::before  { background: rgba(15,45,82,0.4); }
    .accent-green .section-body li::before { background: rgba(22,101,52,0.4); }
    .accent-blue .section-body li::before  { background: rgba(29,78,216,0.4); }
    .accent-red .section-body li::before   { background: rgba(153,27,27,0.4); }

    .section-body p {
      font-size: 13px;
      line-height: 1.6;
      color: #111827;
      margin-bottom: 6px;
      overflow-wrap: break-word;
      word-break: break-word;
    }

    .section-body p:last-child { margin-bottom: 0; }

    /* Bold labels (full-line **text**) */
    .bold-label {
      font-size: 13px;
      font-weight: 600;
      color: #111827;
      margin-top: 10px;
      margin-bottom: 2px;
    }

    .bold-label:first-child { margin-top: 0; }

    .empty-msg {
      font-size: 12px;
      font-style: italic;
      color: #6B7280;
    }

    /* ── Footer ─────────────────────────────────────────────────────────── */
    .page-footer {
      margin-top: 28px;
      padding-top: 16px;
      border-top: 1px solid #E5E7EB;
      text-align: center;
    }

    .footer-text {
      font-size: 11px;
      font-weight: 400;
      color: #9CA3AF;
      font-style: italic;
    }

    /* ── Responsive ─────────────────────────────────────────────────────── */
    @media (max-width: 640px) {
      .page-wrapper { padding: 16px; }

      .page-header {
        flex-direction: column;
        text-align: center;
        gap: 12px;
      }

      .header-left { align-items: center; }
      .header-right { align-items: center; }
      .header-logo-text-right { text-align: center; }

      .header-main-title { font-size: 18px; }

      .sections { grid-template-columns: 1fr; }

      [data-col="left"],
      [data-col="right"],
      [data-col="full"] { grid-column: 1; }

      .section-header-row { padding: 12px 16px; }
      .section-content { padding: 0 16px; }
    }

    /* ── Print ──────────────────────────────────────────────────────────── */
    @media print {
      body { background: #fff; }
      .page-wrapper { padding: 0; max-width: 100%; }
      .page-header { margin-bottom: 16px; padding-bottom: 12px; }
      .rubric-section { break-inside: avoid; }
      .extra-content {
        max-height: none !important;
        overflow: visible !important;
        transition: none !important;
      }
      .more-less-btn { display: none; }
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  </style>
</head>
<body>
<div class="page-wrapper">

  <!-- Header -->
  <header class="page-header">
    <div class="header-left">
      ${hitchLogoHtml}
      <div class="header-hitch-label">Hitch Partners</div>
    </div>
    <div class="header-center">
      <div class="header-main-title">Role Requirements Alignment</div>
      ${titleLine ? `<div class="header-subtitle">${titleLine}</div>` : ''}
    </div>
    <div class="header-right">
      ${clientLogoHtml}
    </div>
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
function toggleMore(btn) {
  var section = btn.closest('.rubric-section');
  section.classList.toggle('expanded');
  btn.textContent = section.classList.contains('expanded') ? 'Less' : 'More';
}
</script>
</body>
</html>`;
}

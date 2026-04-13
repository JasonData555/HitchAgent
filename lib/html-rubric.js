/**
 * Builds a self-contained HTML document for the Rubric role requirements brief.
 *
 * All CSS and JavaScript are inline — no external dependencies.
 * Intended to be uploaded to Vercel Blob as text/html and served directly in browser.
 *
 * Sections (in render order):
 *   1. Header — logo, title, company/role, confidential label
 *   2. Role Context Bar — Location, Team Size, Reports To pills
 *   3. Functional Responsibility — expanded by default, dark navy header
 *   4. Success in Role — expanded by default, dark navy header
 *   5. Must Have — expanded by default, dark teal header
 *   6. Nice to Have — collapsed by default, light blue header
 *   7. Red Flags — collapsed by default, red header
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
 * @param {string} opts.hitchLogoDataUri  — complete data URI returned by imageToBase64() (e.g. 'data:image/png;base64,...')
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
} = {}) {
  const logoSrc = hitchLogoDataUri || '';

  // ── HTML-escape a plain string ──────────────────────────────────────────
  function esc(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Render inline **bold** markers ──────────────────────────────────────
  function renderInlineBold(text) {
    // Replace **...** with <strong>...</strong> (non-greedy)
    return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  /**
   * Parse a field value (newline-delimited) into rendered HTML.
   * Rules:
   *   - Lines starting with "-" → <li> bullet (with inline bold support)
   *   - Lines wrapped in **...** (full line) → <strong> block, no bullet
   *   - Other non-empty lines → <p> paragraph
   * Returns an HTML string (no outer wrapper).
   */
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

  /** Count bullet items in a field value (lines starting with "-"). */
  function countBullets(text) {
    if (!text) return 0;
    return (text.match(/^\s*-\s/gm) || []).length;
  }

  // ── Build Role Context Bar pills ─────────────────────────────────────────
  const contextItems = [
    { label: 'Reports To',             value: positionReportsTo },
    { label: 'Location',               value: location },
    { label: 'Current Team Size',      value: currentTeamSize },
    { label: 'Team Size (18–24 mo.)',  value: teamSize18Months },
  ].filter((item) => item.value && item.value.trim());

  const contextPills = contextItems
    .map((item) => `<div class="context-pill"><span class="pill-label">${esc(item.label)}</span><span class="pill-value">${esc(item.value)}</span></div>`)
    .join('\n      ');

  // ── Section builder ──────────────────────────────────────────────────────
  /**
   * @param {object} opts
   * @param {string} opts.id         — unique section id
   * @param {string} opts.title      — header label
   * @param {string} opts.colorClass — CSS class for header bg color
   * @param {string} opts.content    — raw field text
   * @param {boolean} opts.expanded  — default open state
   * @param {boolean} opts.skipIfEmpty — if true and content empty, return ''
   * @param {string} opts.emptyMsg   — text shown when content is empty (if not skipped)
   */
  function buildSection({ id, title, colorClass, content, expanded, skipIfEmpty, emptyMsg }) {
    const hasContent = content && content.trim();
    if (!hasContent && skipIfEmpty) return '';

    const bodyHtml = hasContent ? parseFieldToHtml(content) : `<p class="empty-msg">${esc(emptyMsg || 'No items specified.')}</p>`;
    const bulletCount = countBullets(content);
    const countLabel = bulletCount > 0 ? `<span class="item-count">${bulletCount} item${bulletCount !== 1 ? 's' : ''}</span>` : '';
    const openAttr = expanded ? ' open' : '';

    return `
  <details class="section" id="${id}"${openAttr}>
    <summary class="section-header ${colorClass}">
      <span class="section-title">${esc(title)}</span>
      ${countLabel}
      <span class="chevron">&#9660;</span>
    </summary>
    <div class="section-body">
      ${bodyHtml}
    </div>
  </details>`;
  }

  const functionalSection = buildSection({
    id: 'functional-responsibility',
    title: 'Functional Responsibility',
    colorClass: 'header-navy',
    content: functionalResponsibility,
    expanded: true,
    skipIfEmpty: true,
  });

  const successSection = buildSection({
    id: 'success-in-role',
    title: 'Success in Role',
    colorClass: 'header-navy',
    content: successInRole,
    expanded: true,
    skipIfEmpty: true,
  });

  const mustHaveSection = buildSection({
    id: 'must-have',
    title: 'Must Have',
    colorClass: 'header-teal',
    content: mustHave,
    expanded: true,
    skipIfEmpty: false,
    emptyMsg: 'No items specified.',
  });

  const niceToHaveSection = buildSection({
    id: 'nice-to-have',
    title: 'Nice to Have',
    colorClass: 'header-blue',
    content: niceToHave,
    expanded: false,
    skipIfEmpty: false,
    emptyMsg: 'No items specified.',
  });

  const redFlagsSection = buildSection({
    id: 'red-flags',
    title: 'Red Flags',
    colorClass: 'header-red',
    content: redFlags,
    expanded: false,
    skipIfEmpty: false,
    emptyMsg: 'No items specified.',
  });

  const titleLine = searchName ? `${esc(clientName)} — ${esc(searchName)}` : esc(clientName);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Role Requirements — ${esc(clientName)}</title>
  <style>
    /* ── Reset & base ───────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #333;
      background: #f5f5f5;
      padding: 0 0 40px;
    }

    /* ── Header ─────────────────────────────────────────────────────────── */
    .page-header {
      background: #fff;
      border-bottom: 3px solid #0EA5E9;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .header-logo {
      flex-shrink: 0;
      height: 36px;
      width: auto;
    }

    .header-logo-placeholder {
      font-weight: 700;
      font-size: 15px;
      color: #1B365D;
      white-space: nowrap;
    }

    .header-center {
      flex: 1;
      text-align: center;
    }

    .header-main-title {
      font-size: 18px;
      font-weight: 700;
      color: #1B365D;
      line-height: 1.2;
    }

    .header-subtitle {
      font-size: 13px;
      color: #64748B;
      margin-top: 2px;
    }

    .header-confidential {
      font-size: 11px;
      color: #9CA3AF;
      text-align: right;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ── Role Context Bar ────────────────────────────────────────────────── */
    .context-bar {
      background: #fff;
      border-bottom: 1px solid #e5e7eb;
      padding: 12px 24px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .context-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #f0f4f8;
      border: 1px solid #d1d5db;
      border-radius: 20px;
      padding: 4px 12px;
      font-size: 12px;
    }

    .pill-label {
      font-weight: 600;
      color: #374151;
      white-space: nowrap;
    }

    .pill-value {
      color: #1B365D;
      white-space: nowrap;
    }

    /* ── Main content ────────────────────────────────────────────────────── */
    .content {
      max-width: 860px;
      margin: 20px auto;
      padding: 0 16px;
    }

    /* ── Sections (details/summary) ──────────────────────────────────────── */
    .section {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      margin-bottom: 12px;
      overflow: hidden;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      cursor: pointer;
      user-select: none;
      list-style: none;
      gap: 8px;
    }

    /* Remove default details marker */
    .section-header::-webkit-details-marker { display: none; }
    .section-header::marker { display: none; }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      flex: 1;
    }

    .item-count {
      font-size: 11px;
      font-weight: 400;
      opacity: 0.75;
      white-space: nowrap;
    }

    .chevron {
      font-size: 10px;
      transition: transform 0.25s ease;
      flex-shrink: 0;
    }

    details[open] .chevron {
      transform: rotate(180deg);
    }

    /* ── Section header color themes ─────────────────────────────────────── */
    .header-navy {
      background: #1B365D;
      color: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .header-teal {
      background: #1a7a6e;
      color: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .header-blue {
      background: #a8d8e8;
      color: #1B365D;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .header-red {
      background: #c0392b;
      color: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Section body ────────────────────────────────────────────────────── */
    .section-body {
      padding: 14px 18px 16px;
      overflow: hidden;
    }

    .section-body p {
      margin-bottom: 6px;
    }

    .section-body p:last-child {
      margin-bottom: 0;
    }

    .section-body ul {
      padding-left: 20px;
      margin-bottom: 6px;
    }

    .section-body li {
      margin-bottom: 5px;
    }

    .section-body li:last-child {
      margin-bottom: 0;
    }

    .bold-label {
      font-weight: 700;
      color: #1B365D;
      margin-bottom: 4px;
      margin-top: 8px;
    }

    .bold-label:first-child {
      margin-top: 0;
    }

    .empty-msg {
      color: #9CA3AF;
      font-style: italic;
    }

    /* ── Smooth expand/collapse via CSS only ─────────────────────────────── */
    /* The details element handles open/close natively; the chevron rotates via CSS. */
    /* No max-height animation needed — browser handles details natively. */

    /* ── Print styles ────────────────────────────────────────────────────── */
    @media print {
      body { background: #fff; padding: 0; font-size: 12px; }

      .page-header { border-bottom: 2px solid #0EA5E9; padding: 10px 16px; }
      .header-main-title { font-size: 15px; }

      .context-bar { padding: 8px 16px; }

      .content { max-width: 100%; margin: 10px 0; padding: 0 16px; }

      /* Force all sections open in print */
      .section { margin-bottom: 8px; break-inside: avoid; }
      details.section { display: block; }
      details.section .section-body { display: block !important; }
      .chevron { display: none; }
      .item-count { display: none; }

      /* Preserve background colors in print */
      .header-navy, .header-teal, .header-blue, .header-red {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }

    /* ── Responsive ──────────────────────────────────────────────────────── */
    @media (max-width: 600px) {
      .page-header {
        flex-wrap: wrap;
        gap: 10px;
      }
      .header-confidential {
        flex-basis: 100%;
        text-align: left;
      }
      .header-logo { height: 28px; }
      .header-main-title { font-size: 15px; }
      .context-pill { font-size: 11px; }
    }
  </style>
</head>
<body>

  <!-- ── Header ──────────────────────────────────────────────────────────── -->
  <header class="page-header">
    ${logoSrc
      ? `<img src="${logoSrc}" alt="Hitch Partners" class="header-logo">`
      : `<div class="header-logo-placeholder">Hitch Partners</div>`
    }
    <div class="header-center">
      <div class="header-main-title">Role Requirements Alignment</div>
      <div class="header-subtitle">${titleLine}</div>
    </div>
    <div class="header-confidential">Confidential — Internal Use Only</div>
  </header>

  <!-- ── Role Context Bar ────────────────────────────────────────────────── -->
  ${contextPills ? `<div class="context-bar">\n      ${contextPills}\n    </div>` : ''}

  <!-- ── Sections ────────────────────────────────────────────────────────── -->
  <div class="content">
    ${functionalSection}
    ${successSection}
    ${mustHaveSection}
    ${niceToHaveSection}
    ${redFlagsSection}
  </div>

</body>
</html>`;
}

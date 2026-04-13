/**
 * Builds a self-contained HTML document for the Rubric role requirements brief.
 *
 * Matches the enterprise card aesthetic of lib/html-tile-web.js:
 *   - 816px max-width card, Inter font, border/shadow
 *   - Preview-first expand/collapse (More/Less buttons, JS toggle)
 *   - First bullet visible by default; overflow hidden until expanded
 *   - Navy footer (matches tile)
 *
 * All CSS and JavaScript are inline — no external dependencies beyond Google Fonts.
 * Intended to be uploaded to Vercel Blob as text/html and served directly in browser.
 *
 * Sections (in render order):
 *   1. Header     — Hitch logo (left) · title/subtitle (center) · client logo (right)
 *   2. Context Bar — Location, Team Size, Reports To pills
 *   3. Functional Responsibility — navy header
 *   4. Success in Role           — navy header
 *   5. Must Have                 — teal header
 *   6. Nice to Have              — accent blue header
 *   7. Red Flags                 — red header
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

  // ── Preview split helpers ───────────────────────────────────────────────────

  /**
   * Split a field's bullet lines into preview (first bullet) and overflow (rest).
   * Falls back to sentence-boundary split for non-bullet content.
   */
  function splitBulletsPreview(text) {
    if (!text || !text.trim()) return { previewHtml: '', overflowHtml: '' };

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const bullets = lines.filter(l => l.startsWith('- ') || l === '-');

    if (bullets.length === 0) {
      // Non-bullet content — sentence-boundary split
      const clean = text.trim();
      const maxChars = 200;
      if (clean.length <= maxChars) {
        return { previewHtml: `<p>${renderInlineBold(clean)}</p>`, overflowHtml: '' };
      }
      let breakAt = -1;
      for (let i = Math.min(maxChars, clean.length) - 1; i >= Math.floor(maxChars * 0.5); i--) {
        if (/[.!?]/.test(clean[i])) { breakAt = i + 1; break; }
      }
      if (breakAt === -1) breakAt = maxChars;
      const preview  = clean.slice(0, breakAt).trimEnd();
      const overflow = clean.slice(breakAt).trimStart();
      return {
        previewHtml:  `<p>${renderInlineBold(preview)}${overflow ? '...' : ''}</p>`,
        overflowHtml: overflow ? `<p>${renderInlineBold(overflow)}</p>` : '',
      };
    }

    const renderBullet = (l) => {
      const content = l.startsWith('- ') ? l.slice(2) : '';
      return renderInlineBold(content);
    };

    const previewHtml  = `<ul><li>${renderBullet(bullets[0])}</li></ul>`;
    const overflowHtml = bullets.length > 1
      ? `<ul>${bullets.slice(1).map(l => `<li>${renderBullet(l)}</li>`).join('')}</ul>`
      : '';

    return { previewHtml, overflowHtml };
  }

  /** Count bullet items (lines starting with "- "). */
  function countBullets(text) {
    if (!text) return 0;
    return (text.match(/^\s*-\s/gm) || []).length;
  }

  // ── Expandable section builder ──────────────────────────────────────────────

  /**
   * Build an expandable rubric section div.
   * Shows first bullet in preview; rest collapsed behind More/Less button.
   *
   * @param {string} title      — section heading text
   * @param {string} colorClass — CSS class for the header bar bg color
   * @param {string} content    — raw field text
   * @param {boolean} skipIfEmpty — omit section entirely when content is empty
   * @param {string} emptyMsg   — shown when content is empty (if not skipped)
   */
  function buildSection({ title, colorClass, content, skipIfEmpty, emptyMsg }) {
    const hasContent = content && content.trim();
    if (!hasContent && skipIfEmpty) return '';

    const { previewHtml, overflowHtml } = hasContent
      ? splitBulletsPreview(content)
      : { previewHtml: `<p class="empty-msg">${esc(emptyMsg || 'No items specified.')}</p>`, overflowHtml: '' };

    const bulletCount = countBullets(content);
    const countBadge  = bulletCount > 0
      ? `<span class="item-count">${bulletCount} item${bulletCount !== 1 ? 's' : ''}</span>`
      : '';

    const hasOverflow = overflowHtml && overflowHtml.trim();

    return `<div class="rubric-section">
  <div class="section-header ${colorClass}">
    <span class="section-title">${esc(title)}</span>
    ${countBadge}
  </div>
  <div class="section-body">
    <div class="section-preview">${previewHtml}</div>
    ${hasOverflow ? `<div class="section-overflow">${overflowHtml}</div>` : ''}
    ${hasOverflow ? `<button class="expand-btn" onclick="toggleSection(this)">More</button>` : ''}
  </div>
</div>`;
  }

  // ── Build sections ──────────────────────────────────────────────────────────

  const functionalSection = buildSection({
    title: 'Functional Responsibility',
    colorClass: 'header-navy',
    content: functionalResponsibility,
    skipIfEmpty: true,
  });

  const successSection = buildSection({
    title: 'Success in Role',
    colorClass: 'header-navy',
    content: successInRole,
    skipIfEmpty: true,
  });

  const mustHaveSection = buildSection({
    title: 'Must Have',
    colorClass: 'header-teal',
    content: mustHave,
    skipIfEmpty: false,
    emptyMsg: 'No items specified.',
  });

  const niceToHaveSection = buildSection({
    title: 'Nice to Have',
    colorClass: 'header-accent',
    content: niceToHave,
    skipIfEmpty: false,
    emptyMsg: 'No items specified.',
  });

  const redFlagsSection = buildSection({
    title: 'Red Flags',
    colorClass: 'header-red',
    content: redFlags,
    skipIfEmpty: false,
    emptyMsg: 'No items specified.',
  });

  // ── Header: logo slots ──────────────────────────────────────────────────────
  const hitchLogoHtml = hitchLogoDataUri
    ? `<img class="header-logo" src="${hitchLogoDataUri}" alt="Hitch Partners">`
    : `<span class="header-logo-text">Hitch Partners</span>`;

  const clientLogoHtml = clientLogoDataUri
    ? `<img class="header-logo" src="${clientLogoDataUri}" alt="${esc(clientName)}">`
    : `<span class="header-logo-text">${esc(clientName)}</span>`;

  // ── Context Bar pills ───────────────────────────────────────────────────────
  const contextItems = [
    { label: 'Reports To',            value: positionReportsTo },
    { label: 'Location',              value: location },
    { label: 'Current Team Size',     value: currentTeamSize },
    { label: 'Team Size (18–24 mo.)', value: teamSize18Months },
  ].filter(item => item.value && item.value.trim());

  const contextPillsHtml = contextItems
    .map(item => `<div class="context-pill"><span class="pill-label">${esc(item.label)}</span><span class="pill-value">${esc(item.value)}</span></div>`)
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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    /* ── Reset & base ───────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 12px;
      line-height: 1.5;
      color: #1F2937;
      background: #F0F4F8;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      padding: 12px;
    }

    /* ── Card ───────────────────────────────────────────────────────────── */
    .card {
      max-width: 816px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #D1D9E0;
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 2px 8px 0 rgba(0,0,0,.10), 0 1px 2px -1px rgba(0,0,0,.06);
      display: flex;
      flex-direction: column;
    }

    /* ── Header ─────────────────────────────────────────────────────────── */
    .tile-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      gap: 14px;
      border-bottom: 3px solid #0EA5E9;
      flex-shrink: 0;
    }

    .header-center {
      flex: 1;
      text-align: center;
      min-width: 0;
    }

    .header-main-title {
      font-size: 18px;
      font-weight: 700;
      color: #1B365D;
      line-height: 1.2;
    }

    .header-subtitle {
      font-size: 12px;
      font-weight: 400;
      color: #64748B;
      margin-top: 3px;
    }

    .header-logo {
      height: 32px;
      width: auto;
      max-width: 130px;
      flex-shrink: 0;
      object-fit: contain;
    }

    .header-logo-text {
      font-size: 11px;
      font-weight: 700;
      color: #1B365D;
      letter-spacing: 0.04em;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ── Context Bar ────────────────────────────────────────────────────── */
    .context-bar {
      background: #fff;
      border-bottom: 1px solid #E2E8F0;
      padding: 10px 20px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .context-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #F0F4F8;
      border: 1px solid #D1D9E0;
      border-radius: 20px;
      padding: 3px 11px;
      font-size: 11px;
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

    /* ── Sections wrapper ───────────────────────────────────────────────── */
    .sections {
      padding: 12px 16px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* ── Rubric section card ────────────────────────────────────────────── */
    .rubric-section {
      border: 1px solid #E2E8F0;
      border-radius: 5px;
      overflow: hidden;
    }

    /* ── Section header bar ─────────────────────────────────────────────── */
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 14px;
      gap: 8px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .section-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      flex: 1;
    }

    .item-count {
      font-size: 10px;
      font-weight: 400;
      opacity: 0.80;
      white-space: nowrap;
    }

    /* Section header color themes */
    .header-navy  { background: #1B365D; color: #fff; }
    .header-teal  { background: #1a7a6e; color: #fff; }
    .header-accent { background: #0EA5E9; color: #fff; }
    .header-red   { background: #c0392b; color: #fff; }

    /* ── Section body ───────────────────────────────────────────────────── */
    .section-body {
      padding: 12px 16px 10px;
      background: #fff;
    }

    .section-preview ul,
    .section-overflow ul {
      list-style-type: disc;
      padding-left: 18px;
      margin: 0;
    }

    .section-preview li,
    .section-overflow li {
      font-size: 12px;
      line-height: 1.5;
      color: #374151;
      margin-bottom: 3px;
      overflow-wrap: break-word;
      word-break: break-word;
    }

    .section-preview li:last-child,
    .section-overflow li:last-child { margin-bottom: 0; }

    .section-preview p,
    .section-overflow p {
      font-size: 12px;
      line-height: 1.5;
      color: #374151;
      margin-bottom: 3px;
      overflow-wrap: break-word;
      word-break: break-word;
    }

    .section-preview p:last-child,
    .section-overflow p:last-child { margin-bottom: 0; }

    /* Overflow hidden by default; revealed when parent gains .expanded */
    .section-overflow {
      display: none;
      margin-top: 4px;
    }

    .rubric-section.expanded .section-overflow {
      display: block;
    }

    /* ── More/Less button ───────────────────────────────────────────────── */
    .expand-btn {
      display: inline-block;
      margin-top: 5px;
      font-size: 10.5px;
      font-weight: 600;
      color: #0EA5E9;
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      letter-spacing: 0.02em;
      font-family: inherit;
      line-height: 1.4;
    }

    .expand-btn:hover { text-decoration: underline; }

    /* ── Bold labels (full-line **text**) ───────────────────────────────── */
    .bold-label {
      font-weight: 700;
      color: #1B365D;
      margin-bottom: 4px;
      margin-top: 8px;
    }

    .bold-label:first-child { margin-top: 0; }

    .empty-msg {
      color: #9CA3AF;
      font-style: italic;
    }

    /* ── Footer ─────────────────────────────────────────────────────────── */
    .tile-footer {
      height: 32px;
      background: #1B365D;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: auto;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .footer-text {
      color: #ffffff;
      font-size: 10px;
      font-weight: 400;
      letter-spacing: 0.05em;
      font-style: italic;
    }

    /* ── Responsive ─────────────────────────────────────────────────────── */
    @media (max-width: 600px) {
      body { padding: 0; }
      .card { margin: 0; border-radius: 0; border-left: none; border-right: none; }
      .tile-header { padding: 12px 14px; }
      .header-logo { height: 28px; }
      .header-main-title { font-size: 15px; }
      .context-bar { padding: 8px 14px; }
      .context-pill { font-size: 10px; }
      .sections { padding: 10px 12px 12px; }
    }

    @media (max-width: 480px) {
      .tile-header { gap: 10px; }
      .header-main-title { font-size: 13px; }
    }

    /* ── Print ──────────────────────────────────────────────────────────── */
    @media print {
      body { background: #ffffff; padding: 0; }
      .card { margin: 0; border: none; border-radius: 0; box-shadow: none; }
      .section-overflow { display: block !important; }
      .expand-btn { display: none !important; }
      .rubric-section { break-inside: avoid; }
    }
  </style>
</head>
<body>
<div class="card">

  <!-- Header -->
  <header class="tile-header">
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
  <footer class="tile-footer">
    <span class="footer-text">Hitch Partners &lt;&gt; Confidential &amp; Proprietary</span>
  </footer>

</div>
<script>
function toggleSection(btn) {
  var section = btn.closest('.rubric-section');
  var isExpanded = section.classList.contains('expanded');
  section.classList.toggle('expanded', !isExpanded);
  btn.textContent = isExpanded ? 'More' : 'Less';
}
</script>
</body>
</html>`;
}

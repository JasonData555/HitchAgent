/**
 * Candidate Tile web HTML generator — hosted page format.
 *
 * createCandidateTileWebHtml(data) → string  (complete HTML document)
 *
 * Default view: letter-page proportions (816px wide). Each content section
 * shows a preview (first bullet / first sentence) with a "More" button that
 * expands to reveal all content. "More" toggles to "Less" to collapse.
 * Print CSS reveals all content and hides More/Less buttons.
 *
 * Synchronous — accepts pre-fetched base64 data URIs (same pattern as
 * lib/html-rubric.js). No async image fetching.
 *
 * Color palette (matches PPTX/PDF):
 *   NAVY   #1B365D — headings, candidate name, footer background
 *   SLATE  #64748B — body text, contact info
 *   ACCENT #0EA5E9 — header accent line, More/Less buttons, links
 *   WHITE  #FFFFFF — card background, footer text
 */

// ── HTML escaping ─────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Text helpers (identical to lib/html-tile.js) ──────────────────────────────

function stripMarkdown(text) {
  return (text || '').replace(/\*\*/g, '');
}

function inlineBold(text) {
  return (text || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function replaceArrows(text) {
  if (!text) return '';
  return text
    .replace(/→/g, 'to')
    .replace(/←/g, 'from')
    .replace(/↑/g, 'up')
    .replace(/↓/g, 'down');
}

function expertiseToHtml(text) {
  if (!text) return '';
  const lines = stripMarkdown(text).split('\n');
  const parts = [];
  let inList = false;
  let inAccomplishments = false;

  const isCompanyHeader = (line) => /^[A-Za-z0-9].*\((?:[A-Za-z]{3}\s+)?\d{4}/.test(line.trim());
  const isBullet = (line) => /^\s*[•○\-]/.test(line);
  const isLabelLine = (line) => /^(Role|Scope|Accomplishments)\s*:/i.test(line);

  for (const line of lines) {
    const trimmed = replaceArrows(line.trim());
    if (!trimmed) {
      if (inList) { parts.push('</ul>'); inList = false; }
      continue;
    }
    if (isCompanyHeader(trimmed)) {
      if (inList) { parts.push('</ul>'); inList = false; }
      inAccomplishments = false;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > -1) {
        const header = escapeHtml(trimmed.slice(0, colonIdx));
        const desc   = escapeHtml(trimmed.slice(colonIdx + 1).trim());
        parts.push(`<p class="company-header"><strong>${header}</strong>${desc ? ': <span class="company-desc">' + desc + '</span>' : ''}</p>`);
      } else {
        parts.push(`<p class="company-header"><strong>${escapeHtml(trimmed)}</strong></p>`);
      }
    } else if (isLabelLine(trimmed)) {
      if (inList) { parts.push('</ul>'); inList = false; }
      const colonIdx = trimmed.indexOf(':');
      const label = escapeHtml(trimmed.slice(0, colonIdx + 1));
      const rest  = escapeHtml(trimmed.slice(colonIdx + 1).trim()).replace(/\bTeam:/g, '<strong>Team:</strong>');
      inAccomplishments = /^accomplishments/i.test(trimmed);
      parts.push(`<p><strong>${label}</strong>${rest ? ' ' + rest : ''}</p>`);
    } else if (isBullet(trimmed)) {
      const bulletContent = trimmed.replace(/^[•○\-]\s*/, '');
      if (isLabelLine(bulletContent)) {
        if (inList) { parts.push('</ul>'); inList = false; }
        const colonIdx = bulletContent.indexOf(':');
        const label = escapeHtml(bulletContent.slice(0, colonIdx + 1));
        const rest  = escapeHtml(bulletContent.slice(colonIdx + 1).trim()).replace(/\bTeam:/g, '<strong>Team:</strong>');
        inAccomplishments = /^accomplishments/i.test(bulletContent);
        parts.push(`<p><strong>${label}</strong>${rest ? ' ' + rest : ''}</p>`);
      } else {
        const listClass = inAccomplishments ? ' class="accomplishments-list"' : '';
        if (!inList) { parts.push(`<ul${listClass}>`); inList = true; }
        parts.push(`<li>${escapeHtml(bulletContent)}</li>`);
      }
    } else {
      if (inList) { parts.push('</ul>'); inList = false; }
      inAccomplishments = false;
      parts.push(`<p>${escapeHtml(trimmed)}</p>`);
    }
  }
  if (inList) parts.push('</ul>');
  return parts.join('\n');
}

function parseAdditionalInfoHtml(text) {
  if (!text) return '';

  const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const RAW_URL = /https?:\/\/[^\s<>"{}|\\^[\]`]+/g;

  const parts = [];
  let lastIndex = 0;
  let match;

  MD_LINK.lastIndex = 0;
  while ((match = MD_LINK.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'mdlink', anchor: match[1], url: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  const finalParts = [];
  for (const part of parts) {
    if (part.type === 'mdlink') { finalParts.push(part); continue; }
    const seg = part.value;
    let segLast = 0;
    RAW_URL.lastIndex = 0;
    let rawMatch;
    while ((rawMatch = RAW_URL.exec(seg)) !== null) {
      if (rawMatch.index > segLast) {
        finalParts.push({ type: 'text', value: seg.slice(segLast, rawMatch.index) });
      }
      finalParts.push({ type: 'rawurl', url: rawMatch[0] });
      segLast = rawMatch.index + rawMatch[0].length;
    }
    if (segLast < seg.length) {
      finalParts.push({ type: 'text', value: seg.slice(segLast) });
    }
  }

  return finalParts.map(p => {
    if (p.type === 'text')   return escapeHtml(p.value);
    if (p.type === 'mdlink') return `<a href="${escapeHtml(p.url)}" class="info-link">${escapeHtml(p.anchor)}</a>`;
    if (p.type === 'rawurl') return `<a href="${escapeHtml(p.url)}" class="info-link">Link</a>`;
    return '';
  }).join('');
}

// ── Preview split helpers ─────────────────────────────────────────────────────

/**
 * Split plain paragraph text into a preview (first sentence or maxChars) and
 * overflow (the remainder). Returns HTML strings for each part.
 */
function splitTextPreview(rawText, maxChars) {
  var chars = maxChars || 160;
  var clean = stripMarkdown(replaceArrows(rawText || '')).trim();
  if (!clean) return { previewHtml: '', overflowHtml: '' };

  if (clean.length <= chars) {
    return { previewHtml: '<p>' + escapeHtml(clean) + '</p>', overflowHtml: '' };
  }

  // Find a sentence boundary (. ! ?) within the first `chars` characters
  var breakAt = -1;
  var half = Math.floor(chars * 0.5);
  for (var i = Math.min(chars, clean.length) - 1; i >= half; i--) {
    if (/[.!?]/.test(clean[i])) { breakAt = i + 1; break; }
  }
  // Fallback: last word boundary before `chars`
  if (breakAt === -1) {
    for (var j = chars; j >= Math.floor(chars * 0.6); j--) {
      if (clean[j] === ' ') { breakAt = j; break; }
    }
  }
  if (breakAt === -1) breakAt = chars;

  var preview  = clean.slice(0, breakAt).trimRight();
  var overflow = clean.slice(breakAt).trimLeft();

  return {
    previewHtml:  '<p>' + escapeHtml(preview) + (overflow ? '...' : '') + '</p>',
    overflowHtml: overflow ? '<p>' + escapeHtml(overflow) + '</p>' : '',
  };
}

/**
 * Split a bulleted text block (• / ○ / - prefixed lines) into preview
 * (first two bullets) and full HTML (all bullets).
 */
function splitBulletsPreview(text) {
  if (!text) return { previewHtml: '', fullHtml: '' };

  var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
  var bullets = lines.filter(function(l) { return /^[•○\-]/.test(l); });

  if (bullets.length === 0) {
    // No bullet lines — treat as plain paragraph
    return splitTextPreview(text);
  }

  var render = function(l) {
    return inlineBold(escapeHtml(replaceArrows(l.replace(/^[•○\-]\s*/, ''))));
  };

  var previewBullets = bullets.slice(0, 2);
  var previewHtml = '<ul>' + previewBullets.map(function(l) { return '<li>' + render(l) + '</li>'; }).join('') + '</ul>';
  var fullHtml    = '<ul>' + bullets.map(function(l) { return '<li>' + render(l) + '</li>'; }).join('') + '</ul>';

  return { previewHtml: previewHtml, fullHtml: fullHtml };
}

/**
 * Split semicolon-delimited concerns text into preview (first two items) and
 * full HTML (all items).
 */
function splitConcernsPreview(text) {
  if (!text) return { previewHtml: '', fullHtml: '' };

  var items = stripMarkdown(text).split(';').map(function(s) { return s.trim(); }).filter(Boolean);
  if (items.length === 0) return { previewHtml: '', fullHtml: '' };

  var render = function(s) { return escapeHtml(replaceArrows(s)); };

  var previewItems = items.slice(0, 2);
  var previewHtml  = '<ul class="concerns-list">' + previewItems.map(function(s) { return '<li>' + render(s) + '</li>'; }).join('') + '</ul>';
  var fullHtml     = '<ul class="concerns-list">' + items.map(function(s) { return '<li>' + render(s) + '</li>'; }).join('') + '</ul>';

  return { previewHtml: previewHtml, fullHtml: fullHtml };
}

/**
 * Split Domain Expertise HTML at the second company header block.
 * Preview = first company entry. Overflow = all subsequent entries.
 */
function splitExpertiseHtml(text) {
  var fullHtml = expertiseToHtml(text);
  if (!fullHtml) return { previewHtml: '', overflowHtml: '' };

  var marker   = '<p class="company-header">';
  var firstIdx = fullHtml.indexOf(marker);
  if (firstIdx === -1) return { previewHtml: fullHtml, overflowHtml: '' };

  var secondIdx = fullHtml.indexOf(marker, firstIdx + marker.length);
  if (secondIdx === -1) return { previewHtml: fullHtml, overflowHtml: '' };

  return {
    previewHtml:  fullHtml.slice(0, secondIdx),
    overflowHtml: fullHtml.slice(secondIdx),
  };
}

// ── Section renderer ──────────────────────────────────────────────────────────

/**
 * Render an expandable section. Always renders a "View more" button that
 * opens a modal with the full content. Preview shows a condensed version.
 *
 * @param {string} labelText   — section heading shown in card and modal header
 * @param {string} previewHtml — HTML shown in the card preview area
 * @param {string} fullHtml    — complete HTML stored in data-content for the modal
 * @param {string} [btnLabel]  — button label text (defaults to "View more →")
 */
function expandableSection(labelText, previewHtml, fullHtml, btnLabel) {
  if (!previewHtml) return '';
  var label = btnLabel || 'View more \u2192';

  // If preview shows all content, render as static section (no expand button needed)
  if (!fullHtml || previewHtml === fullHtml) {
    return '<div class="expandable-section">'
      + '<div class="section-label-row"><span class="section-label">' + escapeHtml(labelText) + '</span></div>'
      + '<div class="section-preview">' + previewHtml + '</div>'
      + '</div>';
  }

  return '<div class="expandable-section">'
    + '<div class="section-label-row"><span class="section-label">' + escapeHtml(labelText) + '</span></div>'
    + '<div class="section-preview">' + previewHtml + '</div>'
    + '<button class="expand-btn"'
    + ' data-title="' + escapeHtml(labelText) + '"'
    + ' data-content="' + escapeHtml(fullHtml || '') + '">'
    + label
    + '</button>'
    + '</div>';
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
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

  /* ── Card (letter-page width) ────────────────────────────────────────── */
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

  /* ── Header ──────────────────────────────────────────────────────────── */
  .tile-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    gap: 14px;
    border-bottom: 3px solid #0EA5E9;
    flex-shrink: 0;
  }

  .header-identity { flex: 1; min-width: 0; }

  .header-name {
    font-size: 20px;
    font-weight: 700;
    color: #1B365D;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header-subtitle {
    font-size: 12px;
    font-weight: 400;
    color: #64748B;
    margin-top: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  }

  /* ── Body: two columns ────────────────────────────────────────────────── */
  .tile-body {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    flex: 1;
  }

  /* ── Sidebar ──────────────────────────────────────────────────────────── */
  .sidebar {
    width: 210px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 12px 14px;
    border-right: 1px solid #E2E8F0;
  }

  .candidate-photo {
    width: 148px;
    height: 148px;
    object-fit: cover;
    object-position: top center;
    border-radius: 5px;
    display: block;
    margin-bottom: 8px;
  }

  .photo-placeholder {
    width: 148px;
    height: 148px;
    background: #E2E8F0;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 8px;
    flex-shrink: 0;
  }

  .linkedin-link {
    display: inline-block;
    font-size: 11px;
    font-weight: 500;
    color: #0EA5E9;
    text-decoration: none;
    margin-bottom: 4px;
  }

  .linkedin-link:hover { text-decoration: underline; }

  /* ── Expandable sections (shared) ─────────────────────────────────────── */
  .expandable-section {
    border-top: 1px solid #E2E8F0;
    padding: 7px 0 5px;
  }

  .section-label-row {
    margin-bottom: 3px;
  }

  .section-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #1B365D;
  }

  .section-preview p,
  .section-overflow p {
    font-size: 11px;
    line-height: 1.5;
    color: #374151;
    margin-bottom: 2px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .section-preview ul,
  .section-overflow ul {
    list-style-type: disc;
    padding-left: 16px;
    margin: 0;
  }

  .section-preview ul.accomplishments-list,
  .section-overflow ul.accomplishments-list { padding-left: 26px; }

  .section-preview li,
  .section-overflow li {
    font-size: 11px;
    line-height: 1.5;
    color: #374151;
    margin-bottom: 2px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .expand-btn {
    display: inline-block;
    margin-top: 4px;
    padding: 4px 0;
    font-size: 11px;
    font-weight: 500;
    color: #0F2D52;
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    text-decoration: none;
    letter-spacing: 0.01em;
    line-height: 1.4;
  }

  .expand-btn:hover {
    color: #0A1F3A;
    text-decoration: underline;
  }

  /* ── Modal overlay ────────────────────────────────────────────────────── */
  .tile-modal-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.45);
    z-index: 1000;
    opacity: 0;
    transition: opacity 0.15s ease;
    align-items: center;
    justify-content: center;
  }

  .tile-modal-overlay.is-open {
    display: flex;
  }

  .tile-modal-overlay.is-visible {
    opacity: 1;
  }

  /* ── Modal panel ──────────────────────────────────────────────────────── */
  .tile-modal-panel {
    width: 640px;
    max-width: 92vw;
    max-height: 80vh;
    background: #FFFFFF;
    border-radius: 10px;
    border: 1px solid #D1D9E0;
    border-left: 3px solid #0EA5E9;
    box-shadow: 0 8px 32px rgba(0,0,0,0.12);
    display: flex;
    flex-direction: column;
    transform: scale(0.96);
    opacity: 0;
    transition: transform 0.15s ease, opacity 0.15s ease;
  }

  .tile-modal-overlay.is-visible .tile-modal-panel {
    transform: scale(1);
    opacity: 1;
  }

  /* ── Modal header ─────────────────────────────────────────────────────── */
  .tile-modal-header {
    padding: 18px 20px 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #E2E8F0;
    flex-shrink: 0;
  }

  .tile-modal-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #1B365D;
  }

  .tile-modal-close {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    line-height: 0;
  }

  .tile-modal-close:hover { background: #F3F4F6; }

  /* ── Modal content area ───────────────────────────────────────────────── */
  .tile-modal-body {
    padding: 20px 20px 24px 20px;
    overflow-y: auto;
    flex: 1;
    font-size: 12px;
    line-height: 1.5;
    color: #374151;
  }

  .tile-modal-body p {
    font-size: 12px;
    line-height: 1.5;
    color: #374151;
    margin-bottom: 4px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .tile-modal-body p:last-child { margin-bottom: 0; }

  .tile-modal-body ul {
    list-style-type: disc;
    padding-left: 16px;
    margin: 0;
  }

  .tile-modal-body ul.accomplishments-list { padding-left: 26px; }

  .tile-modal-body li {
    font-size: 12px;
    line-height: 1.5;
    color: #374151;
    margin-bottom: 4px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .tile-modal-body li:last-child { margin-bottom: 0; }

  .tile-modal-body .company-header {
    font-size: 12px;
    font-weight: 600;
    color: #1B365D;
    margin-top: 12px;
    margin-bottom: 2px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .tile-modal-body .company-header:first-child { margin-top: 0; }

  .tile-modal-body .company-desc {
    font-weight: 400;
    font-style: italic;
  }

  .tile-modal-body ul.concerns-list {
    list-style-type: disc;
    padding-left: 16px;
    margin: 0;
  }

  .tile-modal-body .concerns-list li { font-size: 12px; }

  /* ── Static sidebar sections (Contact Info, Education) ────────────────── */
  .static-section {
    padding: 7px 0 5px;
    border-top: 1px solid #E2E8F0;
  }

  .static-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #1B365D;
    margin-bottom: 4px;
  }

  .static-body {
    font-size: 11px;
    line-height: 1.5;
    color: #64748B;
  }

  .static-body p {
    margin-bottom: 2px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  /* ── Main column ──────────────────────────────────────────────────────── */
  .tile-main {
    flex: 1;
    min-width: 0;
    padding: 10px 20px 8px;
    display: flex;
    flex-direction: column;
  }

  /* Main column uses slightly larger text */
  .tile-main .section-preview p,
  .tile-main .section-overflow p {
    font-size: 12px;
  }

  .tile-main .section-preview li,
  .tile-main .section-overflow li {
    font-size: 12px;
  }

  .tile-main .expandable-section {
    padding: 9px 0 6px;
  }

  /* ── Expertise (company headers) ──────────────────────────────────────── */
  .company-header {
    font-size: 12px;
    font-weight: 600;
    color: #1B365D;
    margin-top: 12px;
    margin-bottom: 2px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .company-header:first-child { margin-top: 0; }

  .company-desc {
    font-weight: 400;
    font-style: italic;
  }

  /* ── Concerns list ────────────────────────────────────────────────────── */
  .concerns-list {
    list-style-type: disc;
    padding-left: 16px;
    margin: 0;
  }

  .concerns-list li {
    font-size: 12px;
    line-height: 1.5;
    color: #374151;
    margin-bottom: 2px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  /* ── Info links ───────────────────────────────────────────────────────── */
  .info-link {
    color: #0EA5E9;
    text-decoration: underline;
  }

  /* ── Footer ──────────────────────────────────────────────────────────── */
  .tile-footer {
    height: 32px;
    background: #1B365D;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: auto;
  }

  .footer-text {
    color: #ffffff;
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.05em;
    font-style: italic;
  }

  /* ── Responsive ─────────────────────────────────────────────────────── */
  @media (max-width: 768px) {
    body { padding: 0; }

    .card { margin: 0; border-radius: 0; border-left: none; border-right: none; }

    .tile-body { flex-direction: column; }

    .sidebar {
      width: 100%;
      border-right: none;
      border-bottom: 1px solid #E2E8F0;
    }

    .candidate-photo,
    .photo-placeholder { width: 110px; height: 110px; }

    .tile-main { padding: 10px 16px 8px; }

    .header-name { font-size: 17px; }
    .header-subtitle { font-size: 11px; }
  }

  @media (max-width: 480px) {
    .tile-header { padding: 12px 14px; }
    .candidate-photo, .photo-placeholder { width: 90px; height: 90px; }
  }

  /* ── Print: hide modal and More buttons ─────────────────────────────── */
  @media print {
    body { background: #ffffff; padding: 0; }

    .card { margin: 0; border: none; border-radius: 0; box-shadow: none; }

    .tile-modal-overlay { display: none !important; }

    .expand-btn { display: none !important; }
  }
`;

// ── HTML builder ──────────────────────────────────────────────────────────────

/**
 * Generate the complete self-contained HTML document for the hosted candidate tile.
 *
 * @param {{
 *   candidateName, currentTitle, currentCompany, location, education,
 *   institution, email, linkedinUrl, situation, relevantDomainExpertise,
 *   reasonsToConsider, cultureAdd, anticipatedConcerns, additionalInfo,
 *   photoDataUri,     — pre-fetched base64 data URI string, or null/''
 *   hitchLogoDataUri  — pre-fetched base64 data URI string, or null/''
 * }} data
 * @returns {string} Complete HTML document
 */
export function createCandidateTileWebHtml({
  candidateName,
  currentTitle,
  currentCompany,
  location,
  education,
  institution,
  email,
  linkedinUrl,
  situation,
  relevantDomainExpertise,
  reasonsToConsider,
  cultureAdd,
  anticipatedConcerns,
  additionalInfo,
  photoDataUri,
  hitchLogoDataUri,
}) {
  const nameHtml     = escapeHtml(candidateName || '');
  const subtitleHtml = [currentTitle, currentCompany].filter(Boolean).map(escapeHtml).join(' &nbsp;|&nbsp; ');

  // ── Header ────────────────────────────────────────────────────────────────
  const logoHtml = hitchLogoDataUri
    ? `<img class="header-logo" src="${hitchLogoDataUri}" alt="Hitch Partners">`
    : `<span class="header-logo-text">Hitch Partners</span>`;

  // ── Photo ─────────────────────────────────────────────────────────────────
  const photoHtml = photoDataUri
    ? `<img class="candidate-photo" src="${photoDataUri}" alt="${nameHtml}">`
    : `<div class="photo-placeholder"></div>`;

  // ── LinkedIn ──────────────────────────────────────────────────────────────
  const linkedinHtml = linkedinUrl
    ? `<a class="linkedin-link" href="${escapeHtml(linkedinUrl)}" target="_blank" rel="noopener noreferrer">LinkedIn Profile &#8599;</a>`
    : '';

  // ── Sidebar: Situation ────────────────────────────────────────────────────
  const situationClean   = stripMarkdown(replaceArrows(situation || '')).trim();
  const situationFullHtml = situationClean ? '<p>' + escapeHtml(situationClean) + '</p>' : '';
  const situationSplit   = splitTextPreview(situation);
  const situationSection = situationSplit.previewHtml
    ? expandableSection('Situation', situationSplit.previewHtml, situationFullHtml)
    : '';

  // ── Sidebar: Culture Add ──────────────────────────────────────────────────
  const cultureClean   = stripMarkdown(replaceArrows(cultureAdd || '')).trim();
  const cultureFullHtml = cultureClean ? '<p>' + escapeHtml(cultureClean) + '</p>' : '';
  const cultureSplit   = splitTextPreview(cultureAdd);
  const cultureSection = cultureSplit.previewHtml
    ? expandableSection('Culture Add', cultureSplit.previewHtml, cultureFullHtml)
    : '';

  // ── Sidebar: Contact Info (static) ────────────────────────────────────────
  const contactLines = [];
  if (email)    contactLines.push(`<p>${escapeHtml(email)}</p>`);
  if (location) contactLines.push(`<p>${escapeHtml(location)}</p>`);
  const contactSection = contactLines.length
    ? `<div class="static-section">
        <p class="static-label">Contact Info</p>
        <div class="static-body">${contactLines.join('')}</div>
      </div>`
    : '';

  // ── Sidebar: Education (static) ───────────────────────────────────────────
  const institutionLines = (institution || '').split(';').map(s => s.trim()).filter(Boolean);
  const educationSection = institutionLines.length
    ? `<div class="static-section">
        <p class="static-label">Education</p>
        <div class="static-body">${institutionLines.map(s => `<p>${escapeHtml(s)}</p>`).join('')}</div>
      </div>`
    : '';

  // ── Sidebar: Additional Info ──────────────────────────────────────────────
  const additionalInfoHtml = parseAdditionalInfoHtml(additionalInfo);
  const additionalFullHtml = additionalInfoHtml ? '<p>' + additionalInfoHtml + '</p>' : '';
  const additionalSection  = additionalInfoHtml
    ? expandableSection('Additional Info',
        '<p>' + additionalInfoHtml.slice(0, 160) + (additionalInfoHtml.length > 160 ? '...' : '') + '</p>',
        additionalFullHtml)
    : '';

  // ── Main: Domain Expertise ────────────────────────────────────────────────
  const expertiseFullHtml  = expertiseToHtml(relevantDomainExpertise);
  const expertiseSplit     = splitExpertiseHtml(relevantDomainExpertise);
  const expertiseSection   = expandableSection(
    'Relevant Domain Expertise',
    expertiseSplit.previewHtml,
    expertiseFullHtml
  );

  // ── Main: Reasons to Consider ─────────────────────────────────────────────
  const reasonsBullets  = (reasonsToConsider || '').split('\n').map(l => l.trim()).filter(l => /^[•○\-]/.test(l));
  const reasonsCount    = reasonsBullets.length;
  const reasonsBtnLabel = reasonsCount > 0 ? `View all ${reasonsCount} items \u2192` : 'View more \u2192';
  const reasonsSplit    = splitBulletsPreview(reasonsToConsider);
  const reasonsSection  = reasonsSplit.previewHtml
    ? expandableSection('Reasons to Consider', reasonsSplit.previewHtml, reasonsSplit.fullHtml, reasonsBtnLabel)
    : '';

  // ── Main: Anticipated Concerns ────────────────────────────────────────────
  const concernsItems   = stripMarkdown(anticipatedConcerns || '').split(';').map(s => s.trim()).filter(Boolean);
  const concernsCount   = concernsItems.length;
  const concernsBtnLabel = concernsCount > 0 ? `View all ${concernsCount} items \u2192` : 'View more \u2192';
  const concernsSplit   = splitConcernsPreview(anticipatedConcerns);
  const concernsSection = concernsSplit.previewHtml
    ? expandableSection('Anticipated Concerns', concernsSplit.previewHtml, concernsSplit.fullHtml, concernsBtnLabel)
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${nameHtml} &mdash; Candidate Profile</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>
<div class="card">

  <!-- Header -->
  <header class="tile-header">
    <div class="header-identity">
      <div class="header-name">${nameHtml}</div>
      ${subtitleHtml ? `<div class="header-subtitle">${subtitleHtml}</div>` : ''}
    </div>
    ${logoHtml}
  </header>

  <!-- Body: sidebar + main -->
  <div class="tile-body">

    <!-- Sidebar -->
    <aside class="sidebar">
      ${photoHtml}
      ${linkedinHtml}
      ${situationSection}
      ${cultureSection}
      ${contactSection}
      ${educationSection}
      ${additionalSection}
    </aside>

    <!-- Main content -->
    <main class="tile-main">
      ${expertiseSection}
      ${reasonsSection}
      ${concernsSection}
    </main>
  </div>

  <!-- Footer -->
  <footer class="tile-footer">
    <span class="footer-text">Hitch Partners &lt;&gt; Confidential &amp; Proprietary</span>
  </footer>

</div>

<!-- Modal (single instance, reused for all sections) -->
<div class="tile-modal-overlay" id="tile-modal" role="dialog" aria-modal="true" aria-label="">
  <div class="tile-modal-panel" id="tile-modal-panel">
    <div class="tile-modal-header">
      <span class="tile-modal-label" id="tile-modal-label"></span>
      <button class="tile-modal-close" id="tile-modal-close" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 3L13 13M13 3L3 13" stroke="#6B7280" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="tile-modal-body" id="tile-modal-body"></div>
  </div>
</div>

<script>
(function () {
  var overlay    = document.getElementById('tile-modal');
  var labelEl    = document.getElementById('tile-modal-label');
  var bodyEl     = document.getElementById('tile-modal-body');
  var closeBtn   = document.getElementById('tile-modal-close');
  var triggerBtn = null;
  var escListener = null;

  function openModal(btn) {
    triggerBtn = btn;
    var title   = btn.getAttribute('data-title') || '';
    var content = btn.getAttribute('data-content') || '';

    overlay.setAttribute('aria-label', title);
    labelEl.textContent = title;
    bodyEl.innerHTML = content;

    overlay.classList.add('is-open');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add('is-visible');
      });
    });

    document.body.style.overflow = 'hidden';
    closeBtn.focus();

    escListener = function (e) {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escListener);
  }

  function closeModal() {
    overlay.classList.remove('is-visible');
    document.removeEventListener('keydown', escListener);
    escListener = null;

    setTimeout(function () {
      overlay.classList.remove('is-open');
      document.body.style.overflow = '';
      if (triggerBtn) {
        triggerBtn.focus();
        triggerBtn = null;
      }
    }, 150);
  }

  document.querySelectorAll('.expand-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { openModal(btn); });
  });

  closeBtn.addEventListener('click', closeModal);

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });
})();
</script>
</body>
</html>`;
}

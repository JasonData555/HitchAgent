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

import {
  escapeHtml,
  replaceArrows,
  parseInlineSegments,
  renderInlineSegmentsHtml,
  parseFormattedText,
  renderFormattedHtml,
  parseConcernsItems,
} from './format-parser.js';

/** Strip ** markdown bold markers — used only where plain strings are needed. */
function stripMarkdown(text) {
  return (text || '').replace(/\*\*/g, '');
}

function expertiseToHtml(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const parts = [];
  let inList = false;
  let inAccomplishments = false;
  let pendingSpacer = false;

  const isCompanyHeader = (line) => /^[A-Za-z0-9].*\((?:[A-Za-z]{3}\s+)?\d{4}/.test(line.trim());
  const isBullet = (line) => /^\s*[•○\-]/.test(line);
  const isLabelLine = (line) => /^(Role|Scope|Accomplishments)\s*:/i.test(line);

  for (const line of lines) {
    const trimmed = replaceArrows(line.trim());
    if (!trimmed) {
      if (inList) { parts.push('</ul>'); inList = false; }
      if (parts.length > 0) pendingSpacer = true;
      continue;
    }
    const spacerCls = pendingSpacer ? ' spacer-before' : '';
    pendingSpacer = false;

    if (isCompanyHeader(trimmed)) {
      if (inList) { parts.push('</ul>'); inList = false; }
      inAccomplishments = false;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > -1) {
        const headerHtml = renderInlineSegmentsHtml(parseInlineSegments(trimmed.slice(0, colonIdx)));
        const desc       = renderInlineSegmentsHtml(parseInlineSegments(trimmed.slice(colonIdx + 1).trim()));
        parts.push(`<p class="company-header${spacerCls}"><strong>${headerHtml}</strong>${desc ? ': <span class="company-desc">' + desc + '</span>' : ''}</p>`);
      } else {
        parts.push(`<p class="company-header${spacerCls}"><strong>${renderInlineSegmentsHtml(parseInlineSegments(trimmed))}</strong></p>`);
      }
    } else if (isLabelLine(trimmed)) {
      if (inList) { parts.push('</ul>'); inList = false; }
      const colonIdx = trimmed.indexOf(':');
      const label = escapeHtml(trimmed.slice(0, colonIdx + 1));
      const rest  = renderInlineSegmentsHtml(parseInlineSegments(trimmed.slice(colonIdx + 1).trim()));
      inAccomplishments = /^accomplishments/i.test(trimmed);
      parts.push(`<p${spacerCls ? ` class="${spacerCls.trim()}"` : ''}><strong>${label}</strong>${rest ? ' ' + rest : ''}</p>`);
    } else if (isBullet(trimmed)) {
      const bulletContent = trimmed.replace(/^[•○\-]\s*/, '');
      if (isLabelLine(bulletContent)) {
        if (inList) { parts.push('</ul>'); inList = false; }
        const colonIdx = bulletContent.indexOf(':');
        const label = escapeHtml(bulletContent.slice(0, colonIdx + 1));
        const rest  = renderInlineSegmentsHtml(parseInlineSegments(bulletContent.slice(colonIdx + 1).trim()));
        inAccomplishments = /^accomplishments/i.test(bulletContent);
        parts.push(`<p${spacerCls ? ` class="${spacerCls.trim()}"` : ''}><strong>${label}</strong>${rest ? ' ' + rest : ''}</p>`);
      } else {
        if (!inList) {
          const classes = [inAccomplishments ? 'accomplishments-list' : '', spacerCls.trim()].filter(Boolean).join(' ');
          parts.push(classes ? `<ul class="${classes}">` : '<ul>');
          inList = true;
        }
        parts.push(`<li>${renderInlineSegmentsHtml(parseInlineSegments(bulletContent))}</li>`);
      }
    } else {
      if (inList) { parts.push('</ul>'); inList = false; }
      inAccomplishments = false;
      parts.push(`<p${spacerCls ? ` class="${spacerCls.trim()}"` : ''}>${renderInlineSegmentsHtml(parseInlineSegments(trimmed))}</p>`);
    }
  }
  if (inList) parts.push('</ul>');
  return parts.join('\n');
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
 * Split formatted text into a preview (first 1–2 lines) and full HTML.
 * Unlike splitTextPreview, this preserves bold, italic, underline, and link
 * formatting by delegating to the shared format parser instead of stripping
 * markdown markers with stripMarkdown().
 */
function splitFormattedPreview(rawText) {
  if (!rawText) return { previewHtml: '', fullHtml: '' };
  var parsed = parseFormattedText(rawText);
  if (parsed.length === 0) return { previewHtml: '', fullHtml: '' };
  var fullHtml = renderFormattedHtml(parsed, {});
  if (parsed.length <= 2) {
    return { previewHtml: fullHtml, fullHtml: fullHtml };
  }
  var previewHtml = renderFormattedHtml(parsed.slice(0, 2), {});
  // Append ellipsis inside the last closing </p> to signal truncation
  previewHtml = previewHtml.replace(/<\/p>(\s*)$/, '...<\/p>$1');
  return { previewHtml: previewHtml, fullHtml: fullHtml };
}

/**
 * Split semicolon-delimited concerns text into preview (first two items) and
 * full HTML (all items).
 */
function splitConcernsPreview(text) {
  if (!text) return { previewHtml: '', fullHtml: '' };

  var items = parseConcernsItems(text);
  if (items.length === 0) return { previewHtml: '', fullHtml: '' };

  var render = function(s) {
    return renderInlineSegmentsHtml(parseInlineSegments(replaceArrows(s)));
  };

  var previewHtml = '<ul class="concerns-list">' + items.map(function(s) { return '<li>' + render(s) + '</li>'; }).join('') + '</ul>';
  var fullHtml    = previewHtml;

  return { previewHtml: previewHtml, fullHtml: fullHtml };
}

/**
 * Split Domain Expertise HTML at the second company header block.
 * Preview = first company entry. Overflow = all subsequent entries.
 */
function splitExpertiseHtml(text) {
  var fullHtml = expertiseToHtml(text);
  if (!fullHtml) return { previewHtml: '', overflowHtml: '' };

  // Match the class prefix only (not the closing '">') — a header preceded by a
  // blank line also carries "spacer-before" and would no longer match an exact string.
  var marker   = '<p class="company-header';
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
    var countBadge = label && label !== 'View more →'
      ? '<span class="section-item-count">' + escapeHtml(label) + '</span>'
      : '';
    return '<div class="expandable-section">'
      + '<div class="section-label-row">'
      + '<span class="section-label">' + escapeHtml(labelText) + '</span>'
      + countBadge
      + '</div>'
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

/**
 * Render an inline-expandable section. "View more" reveals full content within
 * the section (no modal). Used for Situation and Culture Add in the sidebar.
 *
 * @param {string} labelText   — section heading
 * @param {string} previewHtml — HTML shown on load (truncated)
 * @param {string} fullHtml    — complete HTML revealed on expand
 */
function inlineExpandableSection(labelText, previewHtml, fullHtml) {
  if (!previewHtml) return '';

  if (!fullHtml || previewHtml === fullHtml) {
    return '<div class="expandable-section">'
      + '<div class="section-label-row"><span class="section-label">' + escapeHtml(labelText) + '</span></div>'
      + '<div class="section-preview">' + previewHtml + '</div>'
      + '</div>';
  }

  return '<div class="expandable-section">'
    + '<div class="section-label-row"><span class="section-label">' + escapeHtml(labelText) + '</span></div>'
    + '<div class="section-preview">' + previewHtml + '</div>'
    + '<div class="inline-overflow">' + fullHtml + '</div>'
    + '<button class="inline-expand-btn" aria-expanded="false">View more</button>'
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
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #1B365D;
  }

  .section-item-count {
    font-size: 10px;
    font-weight: 500;
    color: #9CA3AF;
    margin-left: 6px;
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

  /* ── Inline expand (Situation / Culture Add) ─────────────────────────── */
  .inline-overflow {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.25s ease;
  }

  .inline-overflow.expanded { max-height: 600px; }

  .inline-expand-btn {
    display: inline-block;
    margin-top: 2px;
    padding: 2px 0 4px;
    font-size: 11px;
    font-weight: 600;
    color: #0EA5E9;
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    letter-spacing: 0.02em;
    line-height: 1.4;
  }

  .inline-expand-btn:hover { text-decoration: underline; }

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

  /* The rule above targets a p in the main column, so it outranks the bare
     .block-heading class and would size the Must Have / Nice to Have headings at
     12px — larger than the 11px section labels above them. Match its specificity
     to keep them just under the section labels. */
  .tile-main .section-preview p.block-heading,
  .tile-main .section-overflow p.block-heading {
    font-size: 10px;
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

  /* ── Block heading (Reasons to Consider: "Must Have" / "Nice to Have") ──── */
  /* parseFormattedText strips the ** markers from a standalone bold line, so the
     weight has to come from CSS or the heading renders as plain body text. */
  .block-heading {
    font-size: 10px;
    font-weight: 700;
    color: #1B365D;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-top: 8px;
    margin-bottom: 3px;
  }

  .block-heading:first-child { margin-top: 0; }

  /* Manual blank-line spacer: a blank line in the raw field text adds extra
     space before the next block. Declared after .block-heading so it wins the
     specificity tie when both classes are present; margins otherwise collapse
     with .company-header's own margin-top, so this composes safely everywhere
     (card preview and the "View more" modal both use plain .spacer-before). */
  .spacer-before { margin-top: 12px; }

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
 *   cultureAdd, anticipatedConcerns, additionalInfo,
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
  const situationSplit   = splitFormattedPreview(situation);
  const situationSection = situationSplit.previewHtml
    ? inlineExpandableSection('Situation', situationSplit.previewHtml, situationSplit.fullHtml)
    : '';

  // ── Sidebar: Culture Add ──────────────────────────────────────────────────
  const cultureSplit   = splitFormattedPreview(cultureAdd);
  const cultureSection = cultureSplit.previewHtml
    ? inlineExpandableSection('Culture Add', cultureSplit.previewHtml, cultureSplit.fullHtml)
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
  const additionalInfoHtml = renderInlineSegmentsHtml(parseInlineSegments(additionalInfo || ''));
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
  // "**Must Have**" / "**Nice to Have**" heading lines plus hyphen bullets. Rendered
  // in full on load — it is capped at eight short bullets and is the section the
  // client scans first, so truncating it behind "View more" would defeat the point.
  // Passing the same HTML as preview and full makes expandableSection static.
  const reasonsHtml     = renderFormattedHtml(parseFormattedText(reasonsToConsider || ''), {});
  const reasonsSection  = reasonsHtml
    ? expandableSection('Reasons to Consider', reasonsHtml, reasonsHtml)
    : '';

  // ── Main: Anticipated Concerns ────────────────────────────────────────────
  const concernsItems   = parseConcernsItems(anticipatedConcerns || '');
  const concernsCount   = concernsItems.length;
  const concernsBtnLabel = concernsCount > 0 ? `${concernsCount} items` : '';
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

  document.querySelectorAll('.inline-expand-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var overflow = btn.previousElementSibling;
      var expanded = overflow.classList.toggle('expanded');
      btn.textContent = expanded ? 'View less' : 'View more';
      btn.setAttribute('aria-expanded', String(expanded));
    });
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

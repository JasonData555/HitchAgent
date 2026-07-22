/**
 * Candidate Tile HTML generator.
 *
 * createCandidateTileHtml(data) → Promise<string>  (complete HTML document)
 *
 * Uses flexbox — sections flow naturally, no fixed heights, no overlap regardless
 * of content length. Images are embedded as base64 data URIs so Puppeteer renders
 * with no external network requests.
 *
 * Color palette matches the PPTX:
 *   NAVY   #1B365D  — headings, candidate name, footer background
 *   SLATE  #64748B  — body text, contact info
 *   ACCENT #0EA5E9  — accent divider line
 *   WHITE  #FFFFFF  — background, footer text
 */

import { imageToBase64, guessMimeType } from './fetch-image.js';
import {
  escapeHtml,
  replaceArrows,
  parseInlineSegments,
  renderInlineSegmentsHtml,
  parseFormattedText,
  renderFormattedHtml,
  parseConcernsItems,
} from './format-parser.js';

/**
 * Parse the Relevant Domain Expertise text into HTML.
 * Company header lines (e.g. "Coinbase (2016 - present): ...") are rendered
 * bold in NAVY. Bullet lines (• ○ -) become list items. Other lines are <p>.
 *
 * Structural detection (company headers, label lines, bullets) is kept intact.
 * Inline formatting (bold, italic, underline, links) within content strings is
 * handled by renderInlineSegmentsHtml so PM edits in Airtable render correctly.
 */
function expertiseToHtml(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const parts = [];
  let inList = false;
  let inAccomplishments = false;

  // Pattern: starts with a letter/digit and contains a year in parens — company header
  const isCompanyHeader = (line) => /^[A-Za-z0-9].*\((?:[A-Za-z]{3}\s+)?\d{4}/.test(line.trim());
  const isBullet = (line) => /^\s*[•○\-]/.test(line);
  // Pattern: Role:, Scope:, or Accomplishments: label lines
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
      // Split on first colon to separate company/date from description.
      // Both header and desc go through the inline renderer so **bold** and
      // *italic* markers added by PMs render correctly in both portions.
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > -1) {
        const headerHtml = renderInlineSegmentsHtml(parseInlineSegments(trimmed.slice(0, colonIdx)));
        const desc       = renderInlineSegmentsHtml(parseInlineSegments(trimmed.slice(colonIdx + 1).trim()));
        parts.push(`<p class="company-header"><strong>${headerHtml}</strong>${desc ? ': <span class="company-desc">' + desc + '</span>' : ''}</p>`);
      } else {
        parts.push(`<p class="company-header"><strong>${renderInlineSegmentsHtml(parseInlineSegments(trimmed))}</strong></p>`);
      }
    } else if (isLabelLine(trimmed)) {
      if (inList) { parts.push('</ul>'); inList = false; }
      const colonIdx = trimmed.indexOf(':');
      const label = escapeHtml(trimmed.slice(0, colonIdx + 1));
      const rest  = renderInlineSegmentsHtml(parseInlineSegments(trimmed.slice(colonIdx + 1).trim()));
      inAccomplishments = /^accomplishments/i.test(trimmed);
      parts.push(`<p><strong>${label}</strong>${rest ? ' ' + rest : ''}</p>`);
    } else if (isBullet(trimmed)) {
      const bulletContent = trimmed.replace(/^[•○\-]\s*/, '');
      if (isLabelLine(bulletContent)) {
        // Label line arrived as a bullet (e.g. "• Role:", "• Scope:", "• Accomplishments:")
        if (inList) { parts.push('</ul>'); inList = false; }
        const colonIdx = bulletContent.indexOf(':');
        const label = escapeHtml(bulletContent.slice(0, colonIdx + 1));
        const rest  = renderInlineSegmentsHtml(parseInlineSegments(bulletContent.slice(colonIdx + 1).trim()));
        inAccomplishments = /^accomplishments/i.test(bulletContent);
        parts.push(`<p><strong>${label}</strong>${rest ? ' ' + rest : ''}</p>`);
      } else {
        const listClass = inAccomplishments ? ' class="accomplishments-list"' : '';
        if (!inList) { parts.push(`<ul${listClass}>`); inList = true; }
        parts.push(`<li>${renderInlineSegmentsHtml(parseInlineSegments(bulletContent))}</li>`);
      }
    } else {
      if (inList) { parts.push('</ul>'); inList = false; }
      inAccomplishments = false;
      parts.push(`<p>${renderInlineSegmentsHtml(parseInlineSegments(trimmed))}</p>`);
    }
  }
  if (inList) parts.push('</ul>');
  return parts.join('\n');
}

/**
 * Render Anticipated Concerns as a bullet list.
 * Supports both the new '- item' line format and the legacy '; item' semicolon
 * format for backward compatibility. Inline formatting (bold, italic, underline,
 * links) is applied within each item via the shared inline renderer.
 */
function concernsToHtml(text) {
  const items = parseConcernsItems(text);
  if (items.length === 0) return '';
  return '<ul class="concerns-list">' +
    items.map(s => `<li>${renderInlineSegmentsHtml(parseInlineSegments(replaceArrows(s)))}</li>`).join('') +
    '</ul>';
}

// ── CSS ────────────────────────────────────────────────────────────────────────
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif;
    font-size: 11px;
    line-height: 1.35;
    color: #1F2937;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Outer page wrapper ─────────────────────────────────────────────── */
  .page-wrapper {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  /* ── Header ─────────────────────────────────────────────────────────── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 18px;
    height: 54px;
    flex-shrink: 0;
    border-bottom: 3px solid #0EA5E9;
    background: #ffffff;
    gap: 12px;
  }

  .header-name {
    font-size: 21px;
    font-weight: 700;
    color: #1B365D;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 1;
    min-width: 0;
  }

  .header-title {
    font-size: 13px;
    font-weight: 400;
    color: #64748B;
    text-align: center;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .header-logo {
    height: 32px;
    width: auto;
    max-width: 130px;
    flex-shrink: 0;
    object-fit: contain;
  }

  .header-logo-placeholder {
    height: 32px;
    width: 100px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .header-logo-text {
    font-size: 11px;
    font-weight: 700;
    color: #1B365D;
    text-align: right;
  }

  /* ── Body (two columns) ─────────────────────────────────────────────── */
  .body {
    display: flex;
    flex-direction: row;
    flex: 1;
  }

  /* ── Left sidebar ───────────────────────────────────────────────────── */
  .sidebar {
    width: 240px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 14px;
    border-right: 1px solid #E5E7EB;
    align-items: flex-start;
  }

  .candidate-photo {
    width: 173px;
    height: 173px;
    object-fit: cover;
    object-position: top center;
    border-radius: 4px;
    display: block;
  }

  .photo-placeholder {
    width: 173px;
    height: 173px;
    background: #D4D4D8;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .linkedin-link {
    display: block;
    font-size: 11px;
    color: #0EA5E9;
    text-decoration: underline;
    cursor: pointer;
    margin-top: -4px;
  }

  /* ── Section labels (shared) ────────────────────────────────────────── */
  .section-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #1B365D;
    margin-bottom: 2px;
  }

  .section-body {
    font-size: 11px;
    line-height: 1.35;
    color: #64748B;
  }

  .section-body p {
    margin-bottom: 2px;
  }

  .education-institution {
    font-weight: 400;
    color: #64748B;
  }

  .situation .section-body {
    overflow-wrap: break-word;
    word-break: normal;
    white-space: normal;
    color: #1F2937;
  }

  /* ── Right main column ──────────────────────────────────────────────── */
  .main {
    flex: 1;
    min-width: 0;
    padding: 10px 18px;
    overflow: visible;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .section {
    display: block;
    margin-bottom: 9px;
  }

  /* ── Expertise section ──────────────────────────────────────────────── */
  .company-header {
    font-size: 11px;
    font-weight: 600;
    color: #1B365D;
    margin-bottom: 2px;
    margin-top: 14px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .company-header:first-child {
    margin-top: 0;
  }

  .company-desc {
    font-weight: normal;
    font-style: italic;
  }

  .main .section ul {
    list-style-type: disc;
    padding-left: 16px;
    margin-bottom: 2px;
  }

  /* Accomplishments bullets get deeper indent to nest under the label */
  .main .section ul.accomplishments-list {
    padding-left: 28px;
  }

  .main .section li {
    font-size: 11px;
    line-height: 1.35;
    color: #1F2937;
    margin-bottom: 1px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .main .section p {
    font-size: 11px;
    line-height: 1.35;
    color: #1F2937;
    margin-bottom: 2px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  /* ── Inline label+value sections (Culture Add, Concerns) ───────────── */
  .inline-section {
    display: block;
    margin-bottom: 5px;
  }

  .inline-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #1B365D;
    margin-bottom: 2px;
  }

  .inline-value {
    font-size: 11px;
    color: #1F2937;
    line-height: 1.35;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  /* Culture Add: label and value on the same line */
  .inline-section.inline-row {
    display: flex;
    flex-direction: row;
    align-items: baseline;
    gap: 4px;
  }

  .inline-section.inline-row .inline-label {
    flex-shrink: 0;
    margin-bottom: 0;
  }

  /* Reasons to Consider: "Must Have" / "Nice to Have" heading lines.
     parseFormattedText strips the ** markers from a standalone bold line, so the
     weight has to come from CSS or the heading renders as plain body text. */
  .block-heading {
    font-size: 10px;
    font-weight: bold;
    color: #1B365D;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-top: 7px;
    margin-bottom: 2px;
  }

  .block-heading:first-child { margin-top: 0; }

  /* Anticipated Concerns: bulleted list */
  .concerns-list {
    list-style-type: disc;
    padding-left: 14px;
    margin: 0;
  }

  .concerns-list li {
    font-size: 11px;
    line-height: 1.35;
    color: #1F2937;
    margin-bottom: 1px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .info-link {
    color: #0EA5E9;
    text-decoration: underline;
  }

  /* Prevent Reasons to Consider and Anticipated Concerns from splitting
     across a page boundary — entire section moves to next page if needed */
  .no-break {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* Keep each bullet / Role:/Scope:/Accomplishments: paragraph whole at a page
     break — a partially rendered item would be the piece the footer clips.
     The item moves to the next page intact; a long tenure may still continue. */
  .main .section li,
  .main .section p,
  .concerns-list li {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* Never leave a company header stranded alone at the bottom of a page */
  .company-header {
    break-after: avoid;
    page-break-after: avoid;
  }

  /* ── Footer ─────────────────────────────────────────────────────────── */
  .footer {
    height: 30px;
    background: #1B365D;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: auto;
  }

  .footer-text {
    color: #ffffff;
    font-size: 11px;
    letter-spacing: 0.05em;
    font-style: italic;
  }

  /* ── Print rules ─────────────────────────────────────────────────────── */
  @media print {
    @page {
      /* Bottom margin carves out the footer band on EVERY page: the bar sits
         20px..50px above the paper edge, and 0.66in (63.4px) leaves ~13px of
         clearance above it. Chromium never flows content into a page margin,
         so text stops above the footer and the remainder moves to the next page.
         Must match TILE_PDF_BOTTOM_MARGIN / the bottomMargin passed to page.pdf(). */
      size: Letter portrait;
      margin: 0.5in 0.5in 0.66in 0.5in;
      orphans: 2;
      widows: 2;
    }

    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      orphans: 2;
      widows: 2;
    }

    /* The footer is drawn by Chromium in the bottom page margin via
       TILE_PDF_FOOTER_TEMPLATE (see below), not by this in-flow element.
       A position:fixed footer repeats on every page but reserves NO layout
       space, so body text rendered straight through it at every page break. */
    .footer {
      display: none;
    }

    /* Footer clearance now comes from the @page bottom margin above. Element
       padding only ever protected the bottom of the LAST page. */
    .sidebar,
    .main {
      padding-bottom: 0;
    }

    .page-wrapper {
      min-height: unset;
    }
  }
`;

/**
 * Footer rendered by Chromium inside the bottom page margin, on every page.
 * Pass to renderHtmlToPdf() as `footerTemplate` together with TILE_PDF_BOTTOM_MARGIN.
 *
 * Header/footer templates are isolated from the document's stylesheet, so every
 * rule here must be inline, and font-size must be set explicitly (Chromium
 * defaults it to 0). The template spans the full paper width, so the 0.5in side
 * padding re-creates the side margins and keeps the bar the same width as the
 * body content.
 *
 * Geometry — measured, not assumed. Chromium anchors the footer box a fixed
 * ~20px above the paper edge and does NOT move it when the bottom margin
 * changes, so with no bottom padding the bar occupies 20px..50px above the
 * paper edge — pixel-identical to where the old in-document footer printed.
 * A 0.66in (63.4px) bottom margin therefore leaves ~13px of clearance between
 * the last line of body text and the top of the bar, on every page.
 * If you change either value, re-measure; they are not independent.
 */
export const TILE_PDF_BOTTOM_MARGIN = '0.66in';

export const TILE_PDF_FOOTER_TEMPLATE = `
<div style="width:100%; margin:0; padding:0 0.5in 0 0.5in; box-sizing:border-box;
            -webkit-print-color-adjust:exact; print-color-adjust:exact;">
  <div style="height:30px; line-height:30px; background:#1B365D; text-align:center;
              -webkit-print-color-adjust:exact; print-color-adjust:exact;">
    <span style="color:#ffffff; font-family:Arial,Helvetica,sans-serif; font-size:11px;
                 letter-spacing:0.05em; font-style:italic;">Hitch Partners &lt;&gt; Confidential &amp; Proprietary</span>
  </div>
</div>`;

// ── HTML builder ───────────────────────────────────────────────────────────────

/**
 * Generate the complete HTML document for the candidate tile.
 *
 * @param {{ candidateName, currentTitle, currentCompany, location, education,
 *           email, linkedinUrl, situation, relevantDomainExpertise,
 *           reasonsToConsider, cultureAdd, anticipatedConcerns,
 *           photoUrl, hitchLogoUrl }} data
 * @returns {Promise<string>} Complete HTML document string
 */
export async function createCandidateTileHtml({
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
  photoUrl,
  hitchLogoUrl,
}) {
  // Fetch images as base64 data URIs in parallel
  const [photoData, logoData] = await Promise.all([
    photoUrl  ? imageToBase64(photoUrl,  guessMimeType(photoUrl))  : Promise.resolve(null),
    hitchLogoUrl ? imageToBase64(hitchLogoUrl, guessMimeType(hitchLogoUrl)) : Promise.resolve(null),
  ]);

  // ── Header ──────────────────────────────────────────────────────────────────
  const nameHtml  = escapeHtml(candidateName || '');
  const titleHtml = [currentTitle, currentCompany].filter(Boolean).map(escapeHtml).join(' | ');

  const logoHtml = logoData
    ? `<img class="header-logo" src="${logoData}" alt="Hitch Partners">`
    : `<div class="header-logo-placeholder"><span class="header-logo-text">Hitch Partners</span></div>`;

  // ── Left sidebar ─────────────────────────────────────────────────────────────
  const photoHtml = photoData
    ? `<img class="candidate-photo" src="${photoData}" alt="${nameHtml}">`
    : `<div class="photo-placeholder"></div>`;

  const linkedinHtml = linkedinUrl
    ? `<a class="linkedin-link" href="${linkedinUrl}">LinkedIn Bio</a>`
    : '';

  const emailHtml    = email    ? `<p>${escapeHtml(email)}</p>`    : '';
  const locationHtml = location
    ? `<p class="section-label" style="margin-top:9px;">Location</p><p>${escapeHtml(location)}</p>`
    : '';
  const additionalInfoSection = additionalInfo
    ? `<div class="section additional-info">
        <p class="section-label">Additional Info</p>
        <div class="section-body"><p>${renderInlineSegmentsHtml(parseInlineSegments(additionalInfo))}</p></div>
      </div>`
    : '';

  const institutionLines = (institution || '').split(';').map(s => s.trim()).filter(Boolean);
  const educationSection = institutionLines.length
    ? `<div class="section education">
        <p class="section-label">Education</p>
        <div class="section-body">
          ${institutionLines.map(s => `<p class="education-institution">${escapeHtml(s)}</p>`).join('')}
        </div>
      </div>`
    : '';

  // ── Right column ─────────────────────────────────────────────────────────────
  const expertiseHtml    = expertiseToHtml(relevantDomainExpertise);
  const reasonsHtml      = renderFormattedHtml(parseFormattedText(reasonsToConsider || ''), {});
  const cultureHtml      = renderFormattedHtml(parseFormattedText(cultureAdd || ''), {});
  const concernsHtml     = concernsToHtml(anticipatedConcerns);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Candidate Tile — ${nameHtml}</title>
  <style>${CSS}</style>
</head>
<body>
<div class="page-wrapper">

  <!-- Header -->
  <header class="header">
    <div class="header-name">${nameHtml}</div>
    <div class="header-title">${titleHtml}</div>
    ${logoHtml}
  </header>

  <!-- Body: two columns -->
  <div class="body">

    <!-- Left sidebar -->
    <aside class="sidebar">
      ${photoHtml}
      ${linkedinHtml}

      <div class="section situation">
        <p class="section-label">Situation</p>
        <div class="section-body">${renderFormattedHtml(parseFormattedText(situation || ''), {})}</div>
      </div>

      ${cultureHtml ? `<div class="section">
        <p class="section-label">Culture Add</p>
        <div class="section-body">${cultureHtml}</div>
      </div>` : ''}

      <div class="section contact">
        <div class="section-body">
          ${emailHtml}
          ${locationHtml}
        </div>
      </div>

      ${educationSection}

      ${additionalInfoSection}
    </aside>

    <!-- Right main content -->
    <main class="main">

      <div class="section expertise">
        <p class="section-label">Relevant Domain Expertise</p>
        ${expertiseHtml}
      </div>

      ${reasonsHtml ? `<div class="section reasons no-break">
        <p class="section-label">Reasons to Consider</p>
        <div class="section-body">${reasonsHtml}</div>
      </div>` : ''}

      <div class="inline-section no-break">
        <p class="inline-label">Anticipated Concerns</p>
        <div class="inline-value">${concernsHtml}</div>
      </div>

    </main>
  </div>

  <!-- Footer -->
  <footer class="footer">
    <span class="footer-text">Hitch Partners &lt;&gt; Confidential &amp; Proprietary</span>
  </footer>

</div>
</body>
</html>`;
}

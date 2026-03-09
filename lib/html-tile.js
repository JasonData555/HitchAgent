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

// ── HTML escaping ──────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Text helpers ───────────────────────────────────────────────────────────────

/** Strip markdown bold markers that Claude sometimes adds. */
function stripMarkdown(text) {
  return (text || '').replace(/\*\*/g, '');
}

/**
 * Convert a plain-text bullets string (lines starting with • or ○) into an
 * HTML unordered list. Non-bullet lines are wrapped in <p> tags.
 */
function bulletsToHtml(text) {
  if (!text) return '';
  const lines = stripMarkdown(text).split('\n').filter(l => l.trim());
  const parts = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isBullet = trimmed.startsWith('•') || trimmed.startsWith('○') || trimmed.startsWith('-');
    if (isBullet) {
      if (!inList) { parts.push('<ul>'); inList = true; }
      const content = escapeHtml(trimmed.replace(/^[•○\-]\s*/, ''));
      parts.push(`<li>${content}</li>`);
    } else {
      if (inList) { parts.push('</ul>'); inList = false; }
      if (trimmed) parts.push(`<p>${escapeHtml(trimmed)}</p>`);
    }
  }
  if (inList) parts.push('</ul>');
  return parts.join('\n');
}

/**
 * Parse the Relevant Domain Expertise text into HTML.
 * Company header lines (e.g. "Coinbase (2016 - present): ...") are rendered
 * bold in NAVY. Bullet lines (• ○) become list items. Other lines are <p>.
 */
function expertiseToHtml(text) {
  if (!text) return '';
  const lines = stripMarkdown(text).split('\n');
  const parts = [];
  let inList = false;
  let inAccomplishments = false;

  // Pattern: starts with a capital letter and contains a year in parens
  const isCompanyHeader = (line) => /^[A-Za-z].*\(\d{4}/.test(line.trim());
  const isBullet = (line) => /^\s*[•○\-]/.test(line);
  // Pattern: Role:, Scope:, or Accomplishments: label lines
  const isLabelLine = (line) => /^(Role|Scope|Accomplishments)\s*:/i.test(line);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inList) { parts.push('</ul>'); inList = false; }
      continue;
    }

    if (isCompanyHeader(trimmed)) {
      if (inList) { parts.push('</ul>'); inList = false; }
      inAccomplishments = false;
      // Split on first colon to separate company/date from description
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > -1) {
        const header = escapeHtml(trimmed.slice(0, colonIdx));
        const desc   = escapeHtml(trimmed.slice(colonIdx + 1).trim());
        parts.push(`<p class="company-header"><strong>${header}</strong>${desc ? ': ' + desc : ''}</p>`);
      } else {
        parts.push(`<p class="company-header"><strong>${escapeHtml(trimmed)}</strong></p>`);
      }
    } else if (isLabelLine(trimmed)) {
      if (inList) { parts.push('</ul>'); inList = false; }
      const colonIdx = trimmed.indexOf(':');
      const label = escapeHtml(trimmed.slice(0, colonIdx + 1));
      const rest  = escapeHtml(trimmed.slice(colonIdx + 1).trim());
      inAccomplishments = /^accomplishments/i.test(trimmed);
      parts.push(`<p><strong>${label}</strong>${rest ? ' ' + rest : ''}</p>`);
    } else if (isBullet(trimmed)) {
      const bulletContent = trimmed.replace(/^[•○\-]\s*/, '');
      if (isLabelLine(bulletContent)) {
        // Label line arrived as a bullet (e.g. "• Role:", "• Scope:", "• Accomplishments:")
        if (inList) { parts.push('</ul>'); inList = false; }
        const colonIdx = bulletContent.indexOf(':');
        const label = escapeHtml(bulletContent.slice(0, colonIdx + 1));
        const rest  = escapeHtml(bulletContent.slice(colonIdx + 1).trim());
        inAccomplishments = /^accomplishments/i.test(bulletContent);
        parts.push(`<p><strong>${label}</strong>${rest ? ' ' + rest : ''}</p>`);
      } else {
        const listClass = inAccomplishments ? ' class="accomplishments-list"' : '';
        if (!inList) { parts.push(`<ul${listClass}>`); inList = true; }
        const content = escapeHtml(bulletContent);
        parts.push(`<li>${content}</li>`);
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

/**
 * Render Anticipated Concerns: semicolons become bullet list items.
 */
function concernsToHtml(text) {
  if (!text) return '';
  const items = stripMarkdown(text)
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
  if (items.length === 0) return '';
  return '<ul class="concerns-list">' +
    items.map(s => `<li>${escapeHtml(s)}</li>`).join('') +
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
    margin-top: 6px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .company-header:first-child {
    margin-top: 0;
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
      size: Letter portrait;
      margin: 0.5in;   /* must match page.pdf() margin in pdf-render.js */
    }

    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .footer {
      position: fixed;
      bottom: 10px;
      left: 0;
      right: 0;
      width: 100%;
    }

    /* Reserve space above the fixed footer so no text renders behind it */
    .sidebar,
    .main {
      padding-bottom: 46px;   /* footer height (30) + bottom offset (10) + 6px buffer */
    }

    .page-wrapper {
      min-height: unset;
    }
  }
`;

// ── HTML builder ───────────────────────────────────────────────────────────────

/**
 * Generate the complete HTML document for the candidate tile.
 *
 * @param {{ candidateName, currentTitle, currentCompany, location, education,
 *           email, linkedinUrl, situation, relevantDomainExpertise, reasonsToConsider,
 *           cultureAdd, anticipatedConcerns,
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
  const locationHtml = location ? `<p>${escapeHtml(location)}</p>` : '';
  const educationSection = (education || institution)
    ? `<div class="section education">
        <p class="section-label">Education</p>
        <div class="section-body">
          ${institution ? `<p class="education-institution">${escapeHtml(institution)}</p>` : ''}
          ${education  ? `<p>${escapeHtml(education)}</p>` : ''}
        </div>
      </div>`
    : '';

  // ── Right column ─────────────────────────────────────────────────────────────
  const expertiseHtml  = expertiseToHtml(relevantDomainExpertise);
  const reasonsHtml    = bulletsToHtml(reasonsToConsider);
  const cultureHtml    = escapeHtml(stripMarkdown(cultureAdd || ''));
  const concernsHtml   = concernsToHtml(anticipatedConcerns);

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
        <div class="section-body"><p>${escapeHtml(stripMarkdown(situation || ''))}</p></div>
      </div>

      <div class="section contact">
        <p class="section-label">Contact Info</p>
        <div class="section-body">
          ${emailHtml}
          ${locationHtml}
        </div>
      </div>

      ${educationSection}
    </aside>

    <!-- Right main content -->
    <main class="main">

      <div class="section expertise">
        <p class="section-label">Relevant Domain Expertise</p>
        ${expertiseHtml}
      </div>

      ${reasonsHtml ? `<div class="section reasons">
        <p class="section-label">Reasons to Consider</p>
        <div class="section-body">${reasonsHtml}</div>
      </div>` : ''}

      <div class="inline-section inline-row">
        <p class="inline-label">Culture Add</p>
        <div class="inline-value">${cultureHtml}</div>
      </div>

      <div class="inline-section">
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

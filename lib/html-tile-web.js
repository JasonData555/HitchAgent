/**
 * Candidate Tile web HTML generator — hosted page format.
 *
 * createCandidateTileWebHtml(data) → string  (complete HTML document)
 *
 * Unlike lib/html-tile.js (which is async and fetches images internally),
 * this function is synchronous and accepts pre-fetched base64 data URIs.
 * Follows the same pattern as lib/html-rubric.js.
 *
 * Sections render as native <details>/<summary> collapsible blocks so Program
 * Managers can expand/collapse before sharing the hosted link. All sections are
 * open by default. Print CSS forces them all open regardless.
 *
 * Color palette (matches PPTX/PDF):
 *   NAVY   #1B365D — headings, candidate name, footer background
 *   SLATE  #64748B — body text, contact info
 *   ACCENT #0EA5E9 — header accent line, links
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

function bulletsToHtml(text) {
  if (!text) return '';
  const lines = text.split('\n').filter(l => l.trim());
  const parts = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isBullet = trimmed.startsWith('•') || trimmed.startsWith('○') || trimmed.startsWith('-');
    if (isBullet) {
      if (!inList) { parts.push('<ul>'); inList = true; }
      const content = inlineBold(escapeHtml(replaceArrows(trimmed.replace(/^[•○\-]\s*/, ''))));
      parts.push(`<li>${content}</li>`);
    } else {
      if (inList) { parts.push('</ul>'); inList = false; }
      if (trimmed) parts.push(`<p>${inlineBold(escapeHtml(replaceArrows(trimmed)))}</p>`);
    }
  }
  if (inList) parts.push('</ul>');
  return parts.join('\n');
}

function expertiseToHtml(text) {
  if (!text) return '';
  const lines = stripMarkdown(text).split('\n');
  const parts = [];
  let inList = false;
  let inAccomplishments = false;

  const isCompanyHeader = (line) => /^[A-Za-z].*\(\d{4}/.test(line.trim());
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
      const rest  = escapeHtml(trimmed.slice(colonIdx + 1).trim());
      inAccomplishments = /^accomplishments/i.test(trimmed);
      parts.push(`<p><strong>${label}</strong>${rest ? ' ' + rest : ''}</p>`);
    } else if (isBullet(trimmed)) {
      const bulletContent = trimmed.replace(/^[•○\-]\s*/, '');
      if (isLabelLine(bulletContent)) {
        if (inList) { parts.push('</ul>'); inList = false; }
        const colonIdx = bulletContent.indexOf(':');
        const label = escapeHtml(bulletContent.slice(0, colonIdx + 1));
        const rest  = escapeHtml(bulletContent.slice(colonIdx + 1).trim());
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

function concernsToHtml(text) {
  if (!text) return '';
  const items = stripMarkdown(text)
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
  if (items.length === 0) return '';
  return '<ul class="concerns-list">' +
    items.map(s => `<li>${escapeHtml(replaceArrows(s))}</li>`).join('') +
    '</ul>';
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

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    color: #1F2937;
    background: #F8FAFC;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    padding: 24px;
  }

  /* ── Card ────────────────────────────────────────────────────────────── */
  .card {
    max-width: 900px;
    margin: 0 auto;
    background: #ffffff;
    border: 1px solid #E2E8F0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 1px 3px 0 rgba(0,0,0,.08), 0 1px 2px -1px rgba(0,0,0,.06);
    display: flex;
    flex-direction: column;
  }

  /* ── Header ──────────────────────────────────────────────────────────── */
  .tile-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 24px;
    gap: 16px;
    border-bottom: 3px solid #0EA5E9;
    flex-shrink: 0;
  }

  .header-identity {
    flex: 1;
    min-width: 0;
  }

  .header-name {
    font-size: 22px;
    font-weight: 700;
    color: #1B365D;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header-subtitle {
    font-size: 13px;
    font-weight: 400;
    color: #64748B;
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header-logo {
    height: 36px;
    width: auto;
    max-width: 140px;
    flex-shrink: 0;
    object-fit: contain;
  }

  .header-logo-text {
    font-size: 12px;
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
    width: 240px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 16px 18px;
    border-right: 1px solid #E2E8F0;
  }

  .candidate-photo {
    width: 180px;
    height: 180px;
    object-fit: cover;
    object-position: top center;
    border-radius: 6px;
    display: block;
    margin-bottom: 10px;
  }

  .photo-placeholder {
    width: 180px;
    height: 180px;
    background: #E2E8F0;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 10px;
    flex-shrink: 0;
  }

  .linkedin-link {
    display: inline-block;
    font-size: 12px;
    font-weight: 500;
    color: #0EA5E9;
    text-decoration: none;
    margin-bottom: 4px;
  }

  .linkedin-link:hover {
    text-decoration: underline;
  }

  /* ── Collapsible sections (shared) ────────────────────────────────────── */
  details.tile-section {
    border-top: 1px solid #E2E8F0;
  }

  details.tile-section > summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0 5px;
    cursor: pointer;
    list-style: none;
    user-select: none;
    gap: 6px;
  }

  details.tile-section > summary::-webkit-details-marker { display: none; }
  details.tile-section > summary::marker { display: none; }

  .summary-label {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #1B365D;
  }

  .chevron {
    color: #94A3B8;
    font-size: 11px;
    flex-shrink: 0;
    transition: transform 0.2s ease;
    line-height: 1;
  }

  details[open] > summary .chevron {
    transform: rotate(180deg);
  }

  .section-content {
    padding: 3px 0 12px;
    font-size: 12px;
    line-height: 1.55;
    color: #374151;
  }

  .section-content p {
    margin-bottom: 3px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .section-content ul {
    list-style-type: disc;
    padding-left: 18px;
    margin-bottom: 4px;
  }

  .section-content ul.accomplishments-list {
    padding-left: 30px;
  }

  .section-content li {
    font-size: 12px;
    line-height: 1.55;
    color: #374151;
    margin-bottom: 2px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  /* ── Static sidebar sections (Contact Info, Education) ────────────────── */
  .static-section {
    padding: 8px 0 6px;
    border-top: 1px solid #E2E8F0;
  }

  .static-label {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #1B365D;
    margin-bottom: 5px;
  }

  .static-body {
    font-size: 12px;
    line-height: 1.55;
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
    padding: 14px 24px 0;
    display: flex;
    flex-direction: column;
  }

  /* Main column uses slightly larger text */
  .tile-main .section-content {
    font-size: 13px;
    padding-bottom: 14px;
  }

  .tile-main .section-content li {
    font-size: 13px;
  }

  .tile-main details.tile-section > summary {
    padding: 10px 0 7px;
  }

  /* ── Expertise (company headers + bullets) ────────────────────────────── */
  .company-header {
    font-size: 13px;
    font-weight: 600;
    color: #1B365D;
    margin-top: 14px;
    margin-bottom: 3px;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .company-header:first-child {
    margin-top: 0;
  }

  .company-desc {
    font-weight: 400;
    font-style: italic;
  }

  /* ── Concerns list ────────────────────────────────────────────────────── */
  .concerns-list {
    list-style-type: disc;
    padding-left: 18px;
    margin: 0;
  }

  .concerns-list li {
    font-size: 13px;
    line-height: 1.5;
    color: #374151;
    margin-bottom: 3px;
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
    height: 36px;
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
    font-weight: 400;
    letter-spacing: 0.05em;
    font-style: italic;
  }

  /* ── Responsive ─────────────────────────────────────────────────────── */
  @media (max-width: 768px) {
    body { padding: 0; }

    .card {
      margin: 0;
      border-radius: 0;
      border-left: none;
      border-right: none;
    }

    .tile-body { flex-direction: column; }

    .sidebar {
      width: 100%;
      border-right: none;
      border-bottom: 1px solid #E2E8F0;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 0 16px;
      align-items: flex-start;
    }

    .candidate-photo,
    .photo-placeholder {
      width: 100px;
      height: 100px;
      flex-shrink: 0;
    }

    .sidebar-text-content {
      flex: 1;
      min-width: 0;
    }

    .tile-main { padding: 14px 18px 0; }

    .header-name { font-size: 18px; }
    .header-subtitle { font-size: 12px; }
  }

  @media (max-width: 480px) {
    .sidebar { flex-direction: column; }
    .candidate-photo, .photo-placeholder { width: 120px; height: 120px; }
    .tile-header { padding: 14px 16px; }
  }

  /* ── Print ────────────────────────────────────────────────────────────── */
  @media print {
    body {
      background: #ffffff;
      padding: 0;
    }

    .card {
      margin: 0;
      border: none;
      border-radius: 0;
      box-shadow: none;
    }

    /* Force all <details> sections open when printing */
    details.tile-section > .section-content {
      display: block !important;
    }

    details.tile-section:not([open]) > .section-content {
      display: block !important;
    }
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
  const situationBody = escapeHtml(stripMarkdown(situation || ''));

  // ── Sidebar: Culture Add ──────────────────────────────────────────────────
  const cultureBody = escapeHtml(stripMarkdown(cultureAdd || ''));
  const cultureSection = cultureBody
    ? `<details class="tile-section" open>
        <summary><span class="summary-label">Culture Add</span><span class="chevron">&#9660;</span></summary>
        <div class="section-content"><p>${cultureBody}</p></div>
      </details>`
    : '';

  // ── Sidebar: Contact Info ─────────────────────────────────────────────────
  const contactLines = [];
  if (email)    contactLines.push(`<p>${escapeHtml(email)}</p>`);
  if (location) contactLines.push(`<p>${escapeHtml(location)}</p>`);
  const contactSection = contactLines.length
    ? `<div class="static-section">
        <p class="static-label">Contact Info</p>
        <div class="static-body">${contactLines.join('')}</div>
      </div>`
    : '';

  // ── Sidebar: Education ────────────────────────────────────────────────────
  const institutionLines = (institution || '').split(';').map(s => s.trim()).filter(Boolean);
  const educationSection = institutionLines.length
    ? `<div class="static-section">
        <p class="static-label">Education</p>
        <div class="static-body">${institutionLines.map(s => `<p>${escapeHtml(s)}</p>`).join('')}</div>
      </div>`
    : '';

  // ── Sidebar: Additional Info ──────────────────────────────────────────────
  const additionalInfoHtml = parseAdditionalInfoHtml(additionalInfo);
  const additionalInfoSection = additionalInfoHtml
    ? `<details class="tile-section" open>
        <summary><span class="summary-label">Additional Info</span><span class="chevron">&#9660;</span></summary>
        <div class="section-content"><p>${additionalInfoHtml}</p></div>
      </details>`
    : '';

  // ── Main: Domain Expertise ────────────────────────────────────────────────
  const expertiseHtml = expertiseToHtml(relevantDomainExpertise);

  // ── Main: Reasons to Consider ─────────────────────────────────────────────
  const reasonsHtml = bulletsToHtml(reasonsToConsider);
  const reasonsSection = reasonsHtml
    ? `<details class="tile-section" open>
        <summary><span class="summary-label">Reasons to Consider</span><span class="chevron">&#9660;</span></summary>
        <div class="section-content">${reasonsHtml}</div>
      </details>`
    : '';

  // ── Main: Anticipated Concerns ────────────────────────────────────────────
  const concernsHtml = concernsToHtml(anticipatedConcerns);
  const concernsSection = concernsHtml
    ? `<details class="tile-section" open>
        <summary><span class="summary-label">Anticipated Concerns</span><span class="chevron">&#9660;</span></summary>
        <div class="section-content">${concernsHtml}</div>
      </details>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${nameHtml} — Candidate Profile</title>
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

      <details class="tile-section" open>
        <summary><span class="summary-label">Situation</span><span class="chevron">&#9660;</span></summary>
        <div class="section-content"><p>${situationBody}</p></div>
      </details>

      ${cultureSection}

      ${contactSection}

      ${educationSection}

      ${additionalInfoSection}
    </aside>

    <!-- Main content -->
    <main class="tile-main">

      ${expertiseHtml ? `<details class="tile-section" open>
        <summary><span class="summary-label">Relevant Domain Expertise</span><span class="chevron">&#9660;</span></summary>
        <div class="section-content">${expertiseHtml}</div>
      </details>` : ''}

      ${reasonsSection}

      ${concernsSection}

    </main>
  </div>

  <!-- Footer -->
  <footer class="tile-footer">
    <span class="footer-text">Hitch Partners &lt;&gt; Confidential &amp; Proprietary</span>
  </footer>

</div>
</body>
</html>`;
}

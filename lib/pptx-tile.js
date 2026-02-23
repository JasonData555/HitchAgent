/**
 * Candidate Tile PowerPoint generator.
 *
 * createCandidateTilePresentation(data) → Buffer (PPTX binary)
 *
 * Slide layout (16:9, 13.333" × 7.5"):
 *
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │ [HITCH LOGO]   CANDIDATE PROFILE                                    │
 *  │                {Role Title} | {Client Name}                         │
 *  │─────────────────────────────────────────────────────────────────────│
 *  │ ┌──────────┐  {CANDIDATE NAME}                                      │
 *  │ │  PHOTO   │  {Title} — {Company}                                   │
 *  │ │ or GRAY  │  📍 Location  🎓 Education  ✉️ Email  📱 Phone          │
 *  │ └──────────┘                                                        │
 *  │─────────────────────────────────────────────────────────────────────│
 *  │ RELEVANT SECURITY EXPERIENCE                                        │
 *  │ {experience text}                                                   │
 *  │─────────────────────────────────────────────────────────────────────│
 *  │ CURRENT SITUATION          │ ANTICIPATED CONCERNS                   │
 *  │ {text}                     │ • point 1                              │
 *  │                            │ • point 2                              │
 *  └─────────────────────────────────────────────────────────────────────┘
 */

import PptxGenJS from 'pptxgenjs';

// ── Color palette ────────────────────────────────────────────────────────────
const NAVY   = '1B365D';
const SLATE  = '64748B';
const ACCENT = '0EA5E9';
const GRAY   = 'D4D4D8';
const WHITE  = 'FFFFFF';

/**
 * Download an image from a URL and return it as a base64 data URL string
 * suitable for pptxgenjs addImage({ data: ... }).
 *
 * @param {string} url
 * @param {string} mimeType - e.g. 'image/png'
 * @returns {Promise<string|null>} base64 data URL or null on failure
 */
async function imageToBase64(url, mimeType = 'image/png') {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch {
    return null;
  }
}

/**
 * Guess MIME type from a URL string.
 */
function guessMimeType(url) {
  if (!url) return 'image/png';
  const lower = url.toLowerCase();
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg';
  if (lower.includes('.gif')) return 'image/gif';
  return 'image/png';
}

/**
 * Generate a one-page Candidate Tile PowerPoint.
 *
 * @param {{
 *   candidateName: string,
 *   currentTitle: string,
 *   currentCompany: string,
 *   location: string,
 *   education: string,
 *   email: string,
 *   phone: string,
 *   relevantExperience: string,
 *   currentSituation: string,
 *   anticipatedConcerns: string,
 *   roleTitle: string,
 *   clientName: string,
 *   photoUrl: string|null,
 *   hitchLogoUrl: string|null
 * }} data
 * @returns {Promise<Buffer>}
 */
export async function createCandidateTilePresentation(data) {
  const {
    candidateName,
    currentTitle,
    currentCompany,
    location,
    education,
    email,
    phone,
    relevantExperience,
    currentSituation,
    anticipatedConcerns,
    roleTitle,
    clientName,
    photoUrl,
    hitchLogoUrl,
  } = data;

  // Pre-download images in parallel (avoids file I/O, works in Vercel read-only fs)
  const [logoData, photoData] = await Promise.all([
    hitchLogoUrl ? imageToBase64(hitchLogoUrl, guessMimeType(hitchLogoUrl)) : Promise.resolve(null),
    photoUrl     ? imageToBase64(photoUrl, guessMimeType(photoUrl))         : Promise.resolve(null),
  ]);

  // ── Init presentation ──────────────────────────────────────────────────────
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDE';

  const slide = pptx.addSlide();
  slide.background = { color: WHITE };

  // ── Header: Logo ───────────────────────────────────────────────────────────
  if (logoData) {
    slide.addImage({
      data: logoData,
      x: 0.5,
      y: 0.3,
      w: 1.5,
      h: 0.5,
      sizing: { type: 'contain', w: 1.5, h: 0.5 },
    });
  }

  // ── Header: "CANDIDATE PROFILE" title ─────────────────────────────────────
  slide.addText('CANDIDATE PROFILE', {
    x: 0.5,
    y: 1.0,
    w: 12.333,
    h: 0.4,
    fontSize: 24,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  // ── Header: Role | Client subtitle ────────────────────────────────────────
  const subtitle = [roleTitle, clientName].filter(Boolean).join('  |  ');
  slide.addText(subtitle, {
    x: 0.5,
    y: 1.45,
    w: 12.333,
    h: 0.3,
    fontSize: 14,
    color: SLATE,
    fontFace: 'Calibri',
  });

  // ── Accent divider (header) ────────────────────────────────────────────────
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 1.85,
    w: 13.333,
    h: 0.02,
    fill: { color: ACCENT },
    line: { color: ACCENT },
  });

  // ── Bio: Photo or gray placeholder ────────────────────────────────────────
  if (photoData) {
    slide.addImage({
      data: photoData,
      x: 0.5,
      y: 2.0,
      w: 1.5,
      h: 1.5,
      sizing: { type: 'cover', w: 1.5, h: 1.5 },
    });
  } else {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.5,
      y: 2.0,
      w: 1.5,
      h: 1.5,
      fill: { color: GRAY },
      line: { color: GRAY },
    });
  }

  // ── Bio: Candidate name ────────────────────────────────────────────────────
  slide.addText(candidateName || '', {
    x: 2.2,
    y: 2.0,
    w: 10.633,
    h: 0.35,
    fontSize: 20,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  // ── Bio: Title — Company ───────────────────────────────────────────────────
  const titleLine = [currentTitle, currentCompany].filter(Boolean).join('  —  ');
  slide.addText(titleLine, {
    x: 2.2,
    y: 2.4,
    w: 10.633,
    h: 0.3,
    fontSize: 12,
    color: SLATE,
    fontFace: 'Calibri',
  });

  // ── Bio: Contact details ───────────────────────────────────────────────────
  const contactLines = [];
  if (location)  contactLines.push(`📍 ${location}`);
  if (education) contactLines.push(`🎓 ${education}`);

  const contactLine2Parts = [];
  if (email) contactLine2Parts.push(`✉️ ${email}`);
  if (phone) contactLine2Parts.push(`📱 ${phone}`);
  const contactLine2 = contactLine2Parts.join('    ');

  if (contactLines.length > 0) {
    slide.addText(contactLines.join('    '), {
      x: 2.2,
      y: 3.0,
      w: 10.633,
      h: 0.25,
      fontSize: 10,
      color: SLATE,
      fontFace: 'Calibri',
    });
  }

  if (contactLine2) {
    slide.addText(contactLine2, {
      x: 2.2,
      y: 3.3,
      w: 10.633,
      h: 0.25,
      fontSize: 10,
      color: SLATE,
      fontFace: 'Calibri',
    });
  }

  // ── Accent divider (mid) ───────────────────────────────────────────────────
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 3.8,
    w: 13.333,
    h: 0.02,
    fill: { color: ACCENT },
    line: { color: ACCENT },
  });

  // ── Relevant Security Experience: header ───────────────────────────────────
  slide.addText('RELEVANT SECURITY EXPERIENCE', {
    x: 0.5,
    y: 4.0,
    w: 12.333,
    h: 0.25,
    fontSize: 12,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  // ── Relevant Security Experience: body ────────────────────────────────────
  slide.addText(relevantExperience || '', {
    x: 0.5,
    y: 4.3,
    w: 12.333,
    h: 0.8,
    fontSize: 10,
    color: SLATE,
    fontFace: 'Calibri',
    wrap: true,
    valign: 'top',
  });

  // ── Accent divider (bottom) ────────────────────────────────────────────────
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 5.2,
    w: 13.333,
    h: 0.02,
    fill: { color: ACCENT },
    line: { color: ACCENT },
  });

  // ── Current Situation: header ──────────────────────────────────────────────
  slide.addText('CURRENT SITUATION', {
    x: 0.5,
    y: 5.5,
    w: 5.5,
    h: 0.25,
    fontSize: 12,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  // ── Current Situation: body ────────────────────────────────────────────────
  slide.addText(currentSituation || '', {
    x: 0.5,
    y: 5.8,
    w: 5.5,
    h: 1.5,
    fontSize: 10,
    color: SLATE,
    fontFace: 'Calibri',
    wrap: true,
    valign: 'top',
  });

  // ── Anticipated Concerns: header ───────────────────────────────────────────
  slide.addText('ANTICIPATED CONCERNS', {
    x: 6.8,
    y: 5.5,
    w: 5.5,
    h: 0.25,
    fontSize: 12,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  // ── Anticipated Concerns: body ─────────────────────────────────────────────
  slide.addText(anticipatedConcerns || '', {
    x: 6.8,
    y: 5.8,
    w: 5.5,
    h: 1.5,
    fontSize: 10,
    color: SLATE,
    fontFace: 'Calibri',
    wrap: true,
    valign: 'top',
  });

  // ── Output as Buffer ───────────────────────────────────────────────────────
  const output = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(output);
}

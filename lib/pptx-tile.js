/**
 * Candidate Tile PowerPoint generator.
 * Layout matches the Candidate Tile Example reference design.
 *
 * createCandidateTilePresentation(data) → Buffer (PPTX binary)
 *
 * Slide layout (16:9, 13.333" × 7.5"):
 *
 *  ┌──────────────────────────────────────────────────────────────────────┐
 *  │  CANDIDATE NAME                                       [HITCH LOGO]  │
 *  │  Role Title | Client                                                 │
 *  ├──────────────────────────────────────────────────────────────────────┤
 *  │ ┌──────────┐  Title — Company (italic)                              │
 *  │ │  PHOTO   │  RELEVANT SECURITY EXPERIENCE                          │
 *  │ │ or GRAY  │  {experience text}                                     │
 *  │ └──────────┘  ─────────────────────────────────────                 │
 *  │ 📍 Location   ANTICIPATED CONCERNS                                  │
 *  │ 🎓 Education  • concern 1                                           │
 *  │ ✉️ Email      • concern 2                                           │
 *  │ ─────────────                                                        │
 *  │ CURRENT       (concerns cont.)                                       │
 *  │ SITUATION                                                            │
 *  │ {text}                                                               │
 *  └──────────────────────────────────────────────────────────────────────┘
 */

import PptxGenJS from 'pptxgenjs';

// ── Color palette ────────────────────────────────────────────────────────────
const NAVY   = '1B365D';
const SLATE  = '64748B';
const ACCENT = '0EA5E9';
const GRAY   = 'D4D4D8';
const WHITE  = 'FFFFFF';

// Column layout constants
const LEFT_X  = 0.2;   // left column x start
const LEFT_W  = 2.95;  // left column width
const RIGHT_X = 3.45;  // right column x start
const RIGHT_W = 9.65;  // right column width (extends to x=13.1")

/**
 * Strip markdown bold markers (** **) that Claude sometimes adds.
 */
function stripMarkdown(text) {
  if (!text) return '';
  return text.replace(/\*\*/g, '').trim();
}

/**
 * Download an image from a URL and return a base64 data URL for pptxgenjs.
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

function guessMimeType(url) {
  if (!url) return 'image/png';
  const lower = url.toLowerCase();
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg';
  if (lower.includes('.gif')) return 'image/gif';
  return 'image/png';
}

/**
 * Generate a one-page Candidate Tile PowerPoint.
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

  // Pre-download images in parallel (no file I/O — works in Vercel read-only fs)
  const [logoData, photoData] = await Promise.all([
    hitchLogoUrl ? imageToBase64(hitchLogoUrl, guessMimeType(hitchLogoUrl)) : Promise.resolve(null),
    photoUrl     ? imageToBase64(photoUrl,     guessMimeType(photoUrl))     : Promise.resolve(null),
  ]);

  // ── Init presentation ──────────────────────────────────────────────────────
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDE';

  const slide = pptx.addSlide();
  slide.background = { color: WHITE };

  // ── HEADER: "CANDIDATE PROFILE" label ────────────────────────────────────
  slide.addText('CANDIDATE PROFILE', {
    x: 0.5,
    y: 0.5,
    w: 3.5,
    h: 0.26,
    fontSize: 14,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  // ── HEADER: Candidate name (large) ────────────────────────────────────────
  slide.addText(candidateName || '', {
    x: 0.5,
    y: 0.85,
    w: 9.5,
    h: 0.45,
    fontSize: 24,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  // ── HEADER: Current title — company (left, below name) ────────────────────
  const titleLine = [currentTitle, currentCompany].filter(Boolean).join('  —  ');
  if (titleLine) {
    slide.addText(titleLine, {
      x: 0.5,
      y: 1.25,
      w: 2.8,
      h: 0.28,
      fontSize: 12,
      color: SLATE,
      fontFace: 'Calibri',
    });
  }

  // ── HEADER: Role title | Client (center) ──────────────────────────────────
  const subtitle = [roleTitle, clientName].filter(Boolean).join('  |  ');
  slide.addText(subtitle, {
    x: 4.5,
    y: 0.7,
    w: 4.5,
    h: 0.45,
    fontSize: 18,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
    align: 'center',
  });

  // ── HEADER: Logo — top RIGHT corner ───────────────────────────────────────
  if (logoData) {
    slide.addImage({
      data: logoData,
      x: 11.3,
      y: 0.3,
      w: 1.8,
      h: 0.6,
      sizing: { type: 'contain', w: 1.8, h: 0.6 },
    });
  }

  // ── LEFT COLUMN: Profile photo ─────────────────────────────────────────────
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
    // Gray placeholder
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.5,
      y: 2.0,
      w: 1.5,
      h: 1.5,
      fill: { color: GRAY },
      line: { color: GRAY },
    });
    slide.addText('Photo', {
      x: 0.5,
      y: 2.0,
      w: 1.5,
      h: 1.5,
      fontSize: 10,
      color: WHITE,
      fontFace: 'Calibri',
      align: 'center',
      valign: 'middle',
    });
  }

  // ── LEFT COLUMN: Contact info (beside photo) ──────────────────────────────
  const contactLines = [];
  if (location)  contactLines.push(`📍  ${location}`);
  if (education) contactLines.push(`🎓  ${education}`);
  if (email)     contactLines.push(`✉️  ${email}`);
  if (phone)     contactLines.push(`📱  ${phone}`);

  if (contactLines.length > 0) {
    slide.addText(contactLines.join('\n'), {
      x: 2.2,
      y: 2.0,
      w: 0.95,
      h: 1.5,
      fontSize: 9,
      color: SLATE,
      fontFace: 'Calibri',
      wrap: true,
      valign: 'top',
    });
  }

  // ── LEFT COLUMN: Accent divider + Current Situation ───────────────────────
  slide.addShape(pptx.ShapeType.rect, {
    x: LEFT_X,
    y: 4.45,
    w: LEFT_W,
    h: 0.02,
    fill: { color: ACCENT },
    line: { color: ACCENT },
  });

  slide.addText('CURRENT SITUATION', {
    x: LEFT_X,
    y: 4.53,
    w: LEFT_W,
    h: 0.26,
    fontSize: 10,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  slide.addText(stripMarkdown(currentSituation) || '', {
    x: LEFT_X,
    y: 4.84,
    w: LEFT_W,
    h: 2.45,
    fontSize: 9,
    color: SLATE,
    fontFace: 'Calibri',
    wrap: true,
    valign: 'top',
  });

  // ── RIGHT COLUMN: Relevant Security Experience ─────────────────────────────
  slide.addText('RELEVANT SECURITY EXPERIENCE', {
    x: RIGHT_X,
    y: 1.25,
    w: RIGHT_W,
    h: 0.28,
    fontSize: 12,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  slide.addText(stripMarkdown(relevantExperience) || '', {
    x: RIGHT_X,
    y: 1.58,
    w: RIGHT_W,
    h: 2.7,
    fontSize: 10,
    color: SLATE,
    fontFace: 'Calibri',
    wrap: true,
    valign: 'top',
  });

  // ── RIGHT COLUMN: Accent divider + Anticipated Concerns ───────────────────
  slide.addShape(pptx.ShapeType.rect, {
    x: RIGHT_X,
    y: 4.38,
    w: RIGHT_W,
    h: 0.02,
    fill: { color: ACCENT },
    line: { color: ACCENT },
  });

  slide.addText('ANTICIPATED CONCERNS', {
    x: RIGHT_X,
    y: 4.46,
    w: RIGHT_W,
    h: 0.28,
    fontSize: 12,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  slide.addText(stripMarkdown(anticipatedConcerns) || '', {
    x: RIGHT_X,
    y: 4.79,
    w: RIGHT_W,
    h: 2.5,
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

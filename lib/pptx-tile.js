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

  // ── HEADER: Candidate name + role context ──────────────────────────────────
  slide.addText(candidateName || '', {
    x: LEFT_X,
    y: 0.07,
    w: 10.0,
    h: 0.38,
    fontSize: 20,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  const subtitle = [roleTitle, clientName].filter(Boolean).join('  |  ');
  slide.addText(subtitle, {
    x: LEFT_X,
    y: 0.47,
    w: 10.0,
    h: 0.26,
    fontSize: 11,
    color: SLATE,
    fontFace: 'Calibri',
  });

  // ── HEADER: Logo — top RIGHT corner ───────────────────────────────────────
  if (logoData) {
    slide.addImage({
      data: logoData,
      x: 10.4,
      y: 0.07,
      w: 2.7,
      h: 0.63,
      sizing: { type: 'contain', w: 2.7, h: 0.63 },
    });
  }

  // ── Accent divider (header / content separator) ────────────────────────────
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0.78,
    w: 13.333,
    h: 0.03,
    fill: { color: ACCENT },
    line: { color: ACCENT },
  });

  // ── LEFT COLUMN: Profile photo ─────────────────────────────────────────────
  if (photoData) {
    slide.addImage({
      data: photoData,
      x: LEFT_X,
      y: 0.88,
      w: LEFT_W,
      h: 2.1,
      sizing: { type: 'cover', w: LEFT_W, h: 2.1 },
    });
  } else {
    // Gray placeholder
    slide.addShape(pptx.ShapeType.rect, {
      x: LEFT_X,
      y: 0.88,
      w: LEFT_W,
      h: 2.1,
      fill: { color: GRAY },
      line: { color: GRAY },
    });
    slide.addText('Photo', {
      x: LEFT_X,
      y: 0.88,
      w: LEFT_W,
      h: 2.1,
      fontSize: 10,
      color: WHITE,
      fontFace: 'Calibri',
      align: 'center',
      valign: 'middle',
    });
  }

  // ── LEFT COLUMN: Contact info (below photo) ────────────────────────────────
  const contactLines = [];
  if (location)  contactLines.push(`📍  ${location}`);
  if (education) contactLines.push(`🎓  ${education}`);
  if (email)     contactLines.push(`✉️  ${email}`);
  if (phone)     contactLines.push(`📱  ${phone}`);

  if (contactLines.length > 0) {
    slide.addText(contactLines.join('\n'), {
      x: LEFT_X,
      y: 3.1,
      w: LEFT_W,
      h: 1.25,
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

  // ── RIGHT COLUMN: Current title + company ──────────────────────────────────
  const titleLine = [currentTitle, currentCompany].filter(Boolean).join('  —  ');
  if (titleLine) {
    slide.addText(titleLine, {
      x: RIGHT_X,
      y: 0.88,
      w: RIGHT_W,
      h: 0.28,
      fontSize: 11,
      italic: true,
      color: SLATE,
      fontFace: 'Calibri',
    });
  }

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
    h: 1.8,
    fontSize: 10,
    color: SLATE,
    fontFace: 'Calibri',
    wrap: true,
    valign: 'top',
  });

  // ── RIGHT COLUMN: Accent divider + Anticipated Concerns ───────────────────
  slide.addShape(pptx.ShapeType.rect, {
    x: RIGHT_X,
    y: 3.48,
    w: RIGHT_W,
    h: 0.02,
    fill: { color: ACCENT },
    line: { color: ACCENT },
  });

  slide.addText('ANTICIPATED CONCERNS', {
    x: RIGHT_X,
    y: 3.56,
    w: RIGHT_W,
    h: 0.28,
    fontSize: 12,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  slide.addText(stripMarkdown(anticipatedConcerns) || '', {
    x: RIGHT_X,
    y: 3.89,
    w: RIGHT_W,
    h: 3.35,
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

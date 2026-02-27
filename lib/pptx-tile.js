/**
 * Candidate Tile PowerPoint generator.
 *
 * createCandidateTilePresentation(data) → Buffer (PPTX binary)
 *
 * Slide layout (16:9, 13.333" × 7.5"):
 *
 *  ┌────────────────────────────────────────────────────────────────────┐
 *  │  CANDIDATE NAME (28pt)          Title | Company (18pt)  [LOGO]    │
 *  ├────────────────────────────────────────────────────────────────────┤  ← blue line y:0.7
 *  │ ┌──────────┐  RELEVANT DOMAIN EXPERTISE (12pt bold)               │
 *  │ │  PHOTO   │  {Company (blue bold)} (date): desc                  │
 *  │ │  2"×2"   │    • Role | Team                                     │
 *  │ └──────────┘    • Scope                                           │
 *  │                 • Accomplishments                                  │
 *  │ LinkedIn Bio      ○ achievement                                   │
 *  │ (hyperlink)                                                        │
 *  │ SITUATION       REASONS TO CONSIDER                                │
 *  │ {text}          • bullet 1                                        │
 *  │ CONTACT INFO    CULTURE ADD: {val}                                 │
 *  │ email           ANTICIPATED CONCERNS: {val}                        │
 *  │ Location: x                                                        │
 *  │ EDUCATION                                                          │
 *  │ {text}                                                             │
 *  ├────────────────────────────────────────────────────────────────────┤  ← blue footer y:7.1
 *  │         Hitch Partners <> Confidential & Proprietary               │
 *  └────────────────────────────────────────────────────────────────────┘
 */

import PptxGenJS from 'pptxgenjs';
import { assertSafeUrl } from './url-validate.js';

// ── Color palette ─────────────────────────────────────────────────────────────
const NAVY   = '1B365D';
const SLATE  = '64748B';
const ACCENT = '0EA5E9';
const GRAY   = 'D4D4D8';
const WHITE  = 'FFFFFF';

// ── Column layout constants ───────────────────────────────────────────────────
const LEFT_X  = 0.4;   // left column x start
const LEFT_W  = 3.2;   // left column width
const RIGHT_X = 3.8;   // right column x start
const RIGHT_W = 9.0;   // right column width (extends to x=12.8")

const IMAGE_FETCH_TIMEOUT_MS = 10_000; // 10 seconds

/**
 * Download an image from a URL and return a base64 data URL for pptxgenjs.
 */
async function imageToBase64(url, mimeType = 'image/png') {
  try {
    // SSRF guard — throws if the URL is not on the allowlist
    assertSafeUrl(url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

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
 * Strip markdown bold markers (** **) that Claude sometimes adds.
 */
function stripMarkdown(text) {
  if (!text) return '';
  return text.replace(/\*\*/g, '').trim();
}

/**
 * Parse Claude-generated relevantDomainExpertise text into pptxgenjs rich-text
 * run objects, rendering company header lines in blue/bold and body lines in slate.
 *
 * Company header pattern: "CompanyName (YYYY - YYYY):" or "CompanyName (YYYY - present):"
 *
 * Returns an array of { text, options } run objects for slide.addText([...], opts).
 * Each run ends with a newline so lines stack correctly.
 */
function parseExpertiseToRuns(text) {
  if (!text) return [{ text: '', options: { color: SLATE, fontSize: 9 } }];

  // Regex: line starts with non-bullet text followed by (YYYY - YYYY): or (YYYY - present):
  const COMPANY_HEADER_RE = /^([^•○\n]+\(\d{4}\s*[-–]\s*(?:\d{4}|present)\):?)/i;

  const lines = stripMarkdown(text).split('\n');
  const runs = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLast = i === lines.length - 1;
    const suffix = isLast ? '' : '\n';

    if (COMPANY_HEADER_RE.test(line.trim())) {
      // Company header line — render in blue bold
      runs.push({
        text: line + suffix,
        options: { bold: true, color: ACCENT, fontSize: 10 },
      });
    } else {
      // Body line — render in slate
      runs.push({
        text: line + suffix,
        options: { bold: false, color: SLATE, fontSize: 9 },
      });
    }
  }

  return runs.length > 0 ? runs : [{ text: '', options: { color: SLATE, fontSize: 9 } }];
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
    linkedinUrl,
    situation,
    relevantDomainExpertise,
    reasonsToConsider,
    cultureAdd,
    anticipatedConcerns,
    photoUrl,
    hitchLogoUrl,
  } = data;

  // Pre-download images in parallel (no file I/O — works in Vercel read-only fs)
  const [logoData, photoData] = await Promise.all([
    hitchLogoUrl ? imageToBase64(hitchLogoUrl, guessMimeType(hitchLogoUrl)) : Promise.resolve(null),
    photoUrl     ? imageToBase64(photoUrl,     guessMimeType(photoUrl))     : Promise.resolve(null),
  ]);

  // ── Init presentation ───────────────────────────────────────────────────────
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDE';

  const slide = pptx.addSlide();
  slide.background = { color: WHITE };

  // ── HEADER: Candidate name ──────────────────────────────────────────────────
  slide.addText(candidateName || '', {
    x: 0.4,
    y: 0.25,
    w: 3.0,
    h: 0.4,
    fontSize: 28,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
    shrinkText: true,
  });

  // ── HEADER: Current title | Company (right of name) ────────────────────────
  const titleCompany = [currentTitle, currentCompany].filter(Boolean).join('  |  ');
  if (titleCompany) {
    slide.addText(titleCompany, {
      x: 3.5,
      y: 0.35,
      w: 7.7,
      h: 0.3,
      fontSize: 18,
      color: SLATE,
      fontFace: 'Calibri',
      shrinkText: true,
    });
  }

  // ── HEADER: Logo — top right corner ────────────────────────────────────────
  if (logoData) {
    slide.addImage({
      data: logoData,
      x: 11.5,
      y: 0.2,
      w: 1.5,
      h: 0.5,
      sizing: { type: 'contain', w: 1.5, h: 0.5 },
    });
  }

  // ── HEADER: Blue accent line (full width) ───────────────────────────────────
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0.7,
    w: 13.333,
    h: 0.04,
    fill: { color: ACCENT },
    line: { color: ACCENT },
  });

  // ── LEFT COLUMN: Profile photo ──────────────────────────────────────────────
  if (photoData) {
    slide.addImage({
      data: photoData,
      x: LEFT_X,
      y: 0.9,
      w: 2.0,
      h: 2.0,
      sizing: { type: 'cover', w: 2.0, h: 2.0 },
    });
  } else {
    slide.addShape(pptx.ShapeType.rect, {
      x: LEFT_X,
      y: 0.9,
      w: 2.0,
      h: 2.0,
      fill: { color: GRAY },
      line: { color: GRAY },
    });
    slide.addText('Photo', {
      x: LEFT_X,
      y: 0.9,
      w: 2.0,
      h: 2.0,
      fontSize: 10,
      color: WHITE,
      fontFace: 'Calibri',
      align: 'center',
      valign: 'middle',
    });
  }

  // ── LEFT COLUMN: LinkedIn Bio hyperlink ────────────────────────────────────
  if (linkedinUrl) {
    slide.addText([{
      text: 'LinkedIn Bio',
      options: { hyperlink: { url: linkedinUrl } },
    }], {
      x: LEFT_X,
      y: 3.0,
      w: LEFT_W,
      h: 0.25,
      fontSize: 11,
      color: ACCENT,
      underline: true,
      fontFace: 'Calibri',
    });
  }

  // ── LEFT COLUMN: Situation ──────────────────────────────────────────────────
  slide.addText('SITUATION', {
    x: LEFT_X,
    y: 3.36,
    w: LEFT_W,
    h: 0.22,
    fontSize: 11,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  slide.addText(stripMarkdown(situation) || '', {
    x: LEFT_X,
    y: 3.58,
    w: 3.0,
    h: 1.33,
    fontSize: 10,
    color: SLATE,
    fontFace: 'Calibri',
    wrap: true,
    valign: 'top',
    shrinkText: true,
  });

  // ── LEFT COLUMN: Contact Info ───────────────────────────────────────────────
  slide.addText('CONTACT INFO', {
    x: LEFT_X,
    y: 5.01,
    w: LEFT_W,
    h: 0.22,
    fontSize: 11,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  if (email) {
    slide.addText(email, {
      x: LEFT_X,
      y: 5.23,
      w: LEFT_W,
      h: 0.22,
      fontSize: 10,
      color: SLATE,
      fontFace: 'Calibri',
    });
  }

  // ── LEFT COLUMN: Location ───────────────────────────────────────────────────
  if (location) {
    slide.addText(`Location: ${location}`, {
      x: LEFT_X,
      y: 5.53,
      w: LEFT_W,
      h: 0.22,
      fontSize: 10,
      color: SLATE,
      fontFace: 'Calibri',
    });
  }

  // ── LEFT COLUMN: Education ──────────────────────────────────────────────────
  slide.addText('EDUCATION', {
    x: LEFT_X,
    y: 5.83,
    w: LEFT_W,
    h: 0.22,
    fontSize: 11,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  if (education) {
    slide.addText(education, {
      x: LEFT_X,
      y: 6.05,
      w: 3.0,
      h: 0.8,
      fontSize: 9,
      color: SLATE,
      fontFace: 'Calibri',
      wrap: true,
      valign: 'top',
    });
  }

  // ── RIGHT COLUMN: Relevant Domain Expertise ─────────────────────────────────
  slide.addText('RELEVANT DOMAIN EXPERTISE', {
    x: RIGHT_X,
    y: 0.9,
    w: RIGHT_W,
    h: 0.28,
    fontSize: 12,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  const expertiseRuns = parseExpertiseToRuns(relevantDomainExpertise);
  slide.addText(expertiseRuns, {
    x: RIGHT_X,
    y: 1.15,
    w: RIGHT_W,
    h: 3.55,
    fontFace: 'Calibri',
    wrap: true,
    valign: 'top',
    shrinkText: true,
  });

  // ── RIGHT COLUMN: Reasons to Consider ──────────────────────────────────────
  slide.addText('REASONS TO CONSIDER', {
    x: RIGHT_X,
    y: 4.78,
    w: RIGHT_W,
    h: 0.22,
    fontSize: 10,
    bold: true,
    color: NAVY,
    fontFace: 'Calibri',
  });

  slide.addText(stripMarkdown(reasonsToConsider) || '', {
    x: RIGHT_X,
    y: 5.00,
    w: RIGHT_W,
    h: 0.8,
    fontSize: 9,
    color: SLATE,
    fontFace: 'Calibri',
    wrap: true,
    valign: 'top',
    shrinkText: true,
  });

  // ── RIGHT COLUMN: Culture Add (inline bold label + regular value) ───────────
  slide.addText([
    { text: 'CULTURE ADD: ', options: { bold: true, color: NAVY } },
    { text: stripMarkdown(cultureAdd) || '', options: { bold: false, color: SLATE } },
  ], {
    x: RIGHT_X,
    y: 5.90,
    w: RIGHT_W,
    h: 0.28,
    fontSize: 10,
    fontFace: 'Calibri',
    wrap: true,
    valign: 'top',
  });

  // ── RIGHT COLUMN: Anticipated Concerns (inline bold label + regular value) ──
  slide.addText([
    { text: 'ANTICIPATED CONCERNS: ', options: { bold: true, color: NAVY } },
    { text: stripMarkdown(anticipatedConcerns) || '', options: { bold: false, color: SLATE } },
  ], {
    x: RIGHT_X,
    y: 6.28,
    w: RIGHT_W,
    h: 0.70,
    fontSize: 10,
    fontFace: 'Calibri',
    wrap: true,
    valign: 'top',
  });

  // ── FOOTER: Blue bar ────────────────────────────────────────────────────────
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 7.1,
    w: 13.333,
    h: 0.35,
    fill: { color: ACCENT },
    line: { color: ACCENT },
  });

  slide.addText('Hitch Partners <> Confidential & Proprietary', {
    x: 0,
    y: 7.1,
    w: 13.333,
    h: 0.35,
    fontSize: 10,
    color: WHITE,
    italic: true,
    fontFace: 'Calibri',
    align: 'center',
    valign: 'middle',
  });

  // ── Output as Buffer ────────────────────────────────────────────────────────
  const output = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(output);
}

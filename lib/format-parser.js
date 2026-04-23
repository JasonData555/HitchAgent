/**
 * Shared text formatting parser and renderers.
 *
 * Supported markdown syntax:
 *   **text**        — bold (inline; or full sub-heading when entire line is wrapped)
 *   *text*          — italic (inline only)
 *   __text__        — underline (inline only; rendered in #374151, NOT link blue)
 *   [anchor](url)   — hyperlink (https? URLs only)
 *   https?://...    — raw URL auto-link
 *   - text / • / ○  — bullet item (line-level; strip leading prefix before rendering)
 *
 * Exports:
 *   escapeHtml(str)                          → string
 *   replaceArrows(text)                      → string
 *   parseInlineSegments(rawText)             → Segment[]
 *   renderInlineSegmentsHtml(segments)       → string
 *   parseFormattedText(rawText)              → Line[]
 *   renderFormattedHtml(parsedLines, opts)   → string
 *   buildPptxRuns(parsedLines, opts)         → RunObject[]  (PptxGenJS)
 *   parseConcernsItems(text)                 → string[]
 */

// ── HTML escaping ──────────────────────────────────────────────────────────────

export function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Arrow replacement ──────────────────────────────────────────────────────────

/**
 * Replace Unicode arrow characters with ASCII word equivalents so they render
 * reliably in the Puppeteer/Lambda Chromium environment, which lacks full
 * Unicode Arrows block font coverage.
 */
export function replaceArrows(text) {
  if (!text) return '';
  return text
    .replace(/→/g, 'to')
    .replace(/←/g, 'from')
    .replace(/↑/g, 'up')
    .replace(/↓/g, 'down');
}

// ── Inline segment parser ──────────────────────────────────────────────────────

/**
 * Parse a string into an array of inline segments with formatting metadata.
 *
 * Parsing order (to avoid conflict):
 *   1. **bold**         — double asterisk before single
 *   2. *italic*         — single asterisk not adjacent to another
 *   3. __underline__    — double underscore
 *   4. [anchor](url)    — markdown link (https? only)
 *   5. https?://...     — raw URL auto-link
 *   6. plain text       — everything else
 *
 * replaceArrows() is applied to each segment's text AFTER extraction to avoid
 * corrupting URL strings or markdown delimiters before they are parsed.
 *
 * @param {string} rawText
 * @returns {{ text: string, bold: boolean, italic: boolean, underline: boolean,
 *             link: { url: string, anchor: string } | null }[]}
 */
export function parseInlineSegments(rawText) {
  if (!rawText) return [{ text: '', bold: false, italic: false, underline: false, link: null }];

  // Combined regex — order of alternations is the parsing priority.
  // Capture groups:
  //   m[1] — bold content        (**...**)
  //   m[2] — italic content      (*...*)  — [^*\n] prevents consuming **
  //   m[3] — underline content   (__...__)
  //   m[4] — link anchor text    ([anchor](url))
  //   m[5] — link URL
  //   m[6] — raw URL
  const TOKEN = /\*\*(.+?)\*\*|\*([^*\n]+?)\*|__(.+?)__|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s<>"{}|\\^[\]`]+)/g;

  const segments = [];
  let last = 0;

  for (const m of rawText.matchAll(TOKEN)) {
    if (m.index > last) {
      segments.push({
        text: replaceArrows(rawText.slice(last, m.index)),
        bold: false, italic: false, underline: false, link: null,
      });
    }

    if (m[1] !== undefined) {
      segments.push({ text: replaceArrows(m[1]), bold: true,  italic: false, underline: false, link: null });
    } else if (m[2] !== undefined) {
      segments.push({ text: replaceArrows(m[2]), bold: false, italic: true,  underline: false, link: null });
    } else if (m[3] !== undefined) {
      segments.push({ text: replaceArrows(m[3]), bold: false, italic: false, underline: true,  link: null });
    } else if (m[4] !== undefined) {
      // [anchor](url) — anchor text is display text, URL is the href
      segments.push({ text: replaceArrows(m[4]), bold: false, italic: false, underline: false, link: { url: m[5], anchor: m[4] } });
    } else if (m[6] !== undefined) {
      // Raw URL — display the URL as the anchor text
      segments.push({ text: m[6], bold: false, italic: false, underline: false, link: { url: m[6], anchor: m[6] } });
    }

    last = m.index + m[0].length;
  }

  if (last < rawText.length) {
    segments.push({
      text: replaceArrows(rawText.slice(last)),
      bold: false, italic: false, underline: false, link: null,
    });
  }

  return segments.length > 0
    ? segments
    : [{ text: '', bold: false, italic: false, underline: false, link: null }];
}

// ── Inline HTML renderer ───────────────────────────────────────────────────────

/**
 * Render an array of inline segments to an HTML string.
 *
 * Underline color (#374151) is intentionally different from link color (#0EA5E9 /
 * #0F2D52 per document) so underlined plain text is visually distinct from hyperlinks.
 *
 * @param {{ text: string, bold: boolean, italic: boolean, underline: boolean,
 *           link: {url:string}|null }[]} segments
 * @returns {string}
 */
export function renderInlineSegmentsHtml(segments) {
  if (!segments || segments.length === 0) return '';
  return segments.map(seg => {
    if (seg.link) {
      return `<a href="${escapeHtml(seg.link.url)}" class="info-link" target="_blank">${escapeHtml(seg.text)}</a>`;
    }
    let html = escapeHtml(seg.text);
    if (seg.underline) html = `<span style="text-decoration:underline;color:#374151">${html}</span>`;
    if (seg.italic)    html = `<em>${html}</em>`;
    if (seg.bold)      html = `<strong>${html}</strong>`;
    return html;
  }).join('');
}

// ── Structural line parser ─────────────────────────────────────────────────────

/**
 * Parse raw text into an array of typed line objects, each with parsed inline
 * segments ready for rendering.
 *
 * Line types:
 *   'heading' — entire line is **text** (bold sub-heading, no bullet prefix)
 *   'bullet'  — line starts with -, •, or ○ (prefix stripped)
 *   'plain'   — everything else
 *
 * Blank / whitespace-only lines are skipped.
 *
 * @param {string} rawText
 * @returns {{ type: 'heading'|'bullet'|'plain', raw: string, content: string,
 *             segments: object[] }[]}
 */
export function parseFormattedText(rawText) {
  if (!rawText) return [];
  const result = [];

  for (const line of rawText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Full-line bold heading: **text** (entire trimmed line wrapped in **)
    if (/^\*\*.+\*\*$/.test(trimmed)) {
      const content = trimmed.slice(2, -2);
      result.push({ type: 'heading', raw: trimmed, content, segments: parseInlineSegments(content) });
      continue;
    }

    // Bullet: -, •, or ○ at line start
    if (/^[•○\-](\s|$)/.test(trimmed)) {
      const content = trimmed.replace(/^[•○\-]\s*/, '');
      result.push({ type: 'bullet', raw: trimmed, content, segments: parseInlineSegments(content) });
      continue;
    }

    // Plain paragraph
    result.push({ type: 'plain', raw: trimmed, content: trimmed, segments: parseInlineSegments(trimmed) });
  }

  return result;
}

// ── HTML renderer for structured lines ────────────────────────────────────────

/**
 * Render an array of parsed lines to an HTML string.
 *
 * Consecutive bullet lines are grouped into a single <ul> element.
 * Headings render as <p class="block-heading">.
 * Plain lines render as <p>.
 *
 * @param {{ type: string, segments: object[] }[]} parsedLines
 * @param {{ listClass?: string, allowHeadings?: boolean }} options
 * @returns {string}
 */
export function renderFormattedHtml(parsedLines, options = {}) {
  const { listClass = '', allowHeadings = true } = options;
  const parts = [];
  let inList = false;

  const closeList = () => {
    if (inList) { parts.push('</ul>'); inList = false; }
  };

  for (const line of parsedLines) {
    if (line.type === 'heading' && allowHeadings) {
      closeList();
      parts.push(`<p class="block-heading">${renderInlineSegmentsHtml(line.segments)}</p>`);
    } else if (line.type === 'bullet') {
      if (!inList) {
        parts.push(listClass ? `<ul class="${listClass}">` : '<ul>');
        inList = true;
      }
      parts.push(`<li>${renderInlineSegmentsHtml(line.segments)}</li>`);
    } else {
      // plain — or heading with allowHeadings:false
      closeList();
      parts.push(`<p>${renderInlineSegmentsHtml(line.segments)}</p>`);
    }
  }

  closeList();
  return parts.join('\n');
}

// ── PPTX run array builder ─────────────────────────────────────────────────────

/**
 * Build a PptxGenJS rich-text run array from parsed lines.
 *
 * All color values must be 6-digit hex WITHOUT '#' (PptxGenJS format).
 *
 * @param {{ type: string, content: string, segments: object[] }[]} parsedLines
 * @param {{
 *   color?:           string,   default body text color           (default: '374151')
 *   boldColor?:       string,   color applied to bold segments    (default: '1B365D')
 *   fontSize?:        number,   default font size in pt           (default: 9)
 *   headingColor?:    string,   heading line color                (default: '1B365D')
 *   headingFontSize?: number,   heading font size in pt           (default: 10)
 *   underlineColor?:  string,   underline text color              (default: '374151')
 *   linkColor?:       string,   hyperlink text color              (default: '0EA5E9')
 * }} options
 * @returns {{ text: string, options: object }[]}
 */
export function buildPptxRuns(parsedLines, options = {}) {
  const {
    color           = '374151',
    boldColor       = '1B365D',
    fontSize        = 9,
    headingColor    = '1B365D',
    headingFontSize = 10,
    underlineColor  = '374151',
    linkColor       = '0EA5E9',
  } = options;

  const runs = [];

  for (let lineIdx = 0; lineIdx < parsedLines.length; lineIdx++) {
    const line   = parsedLines[lineIdx];
    const isLast = lineIdx === parsedLines.length - 1;
    const nl     = isLast ? '' : '\n';

    if (line.type === 'heading') {
      runs.push({
        text: line.content + nl,
        options: { bold: true, color: headingColor, fontSize: headingFontSize },
      });
      continue;
    }

    if (line.type === 'bullet') {
      runs.push({ text: '\u2022 ', options: { color, fontSize } });
    }

    // Inline segments — last segment on the line gets the newline appended
    for (let si = 0; si < line.segments.length; si++) {
      const seg       = line.segments[si];
      const isLastSeg = si === line.segments.length - 1;
      const segText   = seg.text + (isLastSeg ? nl : '');

      if (seg.link) {
        runs.push({
          text: segText,
          options: {
            color:     linkColor,
            fontSize,
            underline: true,
            hyperlink: { url: seg.link.url },
          },
        });
      } else {
        const runColor = seg.bold ? boldColor : seg.underline ? underlineColor : color;
        runs.push({
          text: segText,
          options: {
            bold:      seg.bold      || false,
            italic:    seg.italic    || false,
            underline: seg.underline || false,
            color:     runColor,
            fontSize,
          },
        });
      }
    }
  }

  return runs.length > 0 ? runs : [{ text: '', options: { color, fontSize } }];
}

// ── Anticipated Concerns dual-format parser ────────────────────────────────────

/**
 * Parse anticipated concerns text using dual-format detection for backward
 * compatibility with existing semicolon-delimited Airtable content.
 *
 * Detection priority:
 *   1. If any lines start with '- ', treat as bullet-list format (new format)
 *   2. Else split by ';' — legacy semicolon-delimited format
 *   3. Else return the full text as a single item
 *
 * The returned strings are raw (not HTML-escaped) — callers are responsible
 * for escaping or passing through renderInlineSegmentsHtml as needed.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseConcernsItems(text) {
  if (!text) return [];
  // Strip ** markers for backward compatibility with Claude-generated content
  const clean = text.replace(/\*\*/g, '').trim();
  if (!clean) return [];

  // New format: lines starting with '- '
  const bulletLines = clean
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => l.replace(/^-\s*/, '').trim())
    .filter(Boolean);

  if (bulletLines.length > 0) return bulletLines;

  // Legacy format: semicolon-delimited
  const semicolonItems = clean.split(';').map(s => s.trim()).filter(Boolean);
  if (semicolonItems.length > 0) return semicolonItems;

  return [clean];
}

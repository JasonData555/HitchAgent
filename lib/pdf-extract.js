/**
 * Resume text extraction from a remote URL.
 *
 * Handles the three formats PMs actually upload to the Airtable Resume field:
 *   PDF   — via pdf-parse (CommonJS package, dynamic-imported to work in ESM)
 *   DOCX  — via a minimal ZIP reader over word/document.xml (no npm dependency)
 *   plain text
 *
 * Format is decided by the buffer's magic bytes, NOT the filename: Airtable
 * attachment URLs carry no extension. Before this existed, a .docx resume was
 * handed straight to pdf-parse, threw "Invalid PDF structure", and the draft was
 * silently generated with zero resume text.
 *
 * extractResumeText(url) → { success, text, error }
 */

import { inflateRawSync } from 'zlib';
import { assertSafeUrl } from './url-validate.js';

const MAX_CHARS = 24000;
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const FETCH_TIMEOUT_MS = 10_000;    // 10 seconds

const UNSUPPORTED = 'Unsupported resume format — upload a PDF, DOCX, or plain-text file';

/** ZIP local-file-header signature: "PK\x03\x04" */
function isZip(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

/** PDF signature: "%PDF" */
function isPdf(buf) {
  return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

/**
 * Pull `word/document.xml` out of a .docx (a ZIP archive) and return its raw XML.
 *
 * Walks the ZIP's local file headers. Word always populates the compressed size in
 * the local header; an archive written by some other tool may set bit 3 of the
 * general-purpose flags and defer the size to a trailing data descriptor, in which
 * case the size is 0 here — we fall back to the central directory for that entry.
 *
 * @returns {string|null} the XML, or null if the entry could not be located
 */
function readDocxDocumentXml(buf) {
  const wanted = 'word/document.xml';

  // Pass 1 — local file headers.
  let off = 0;
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const flags      = buf.readUInt16LE(off + 6);
    const method     = buf.readUInt16LE(off + 8);
    const compSize   = buf.readUInt32LE(off + 18);
    const nameLen    = buf.readUInt16LE(off + 26);
    const extraLen   = buf.readUInt16LE(off + 28);
    const nameStart  = off + 30;
    const dataStart  = nameStart + nameLen + extraLen;
    const name       = buf.toString('utf8', nameStart, nameStart + nameLen);

    // Size deferred to a data descriptor — can't trust compSize; go to the central directory.
    const sizeDeferred = (flags & 0x08) !== 0 || compSize === 0;

    if (name === wanted && !sizeDeferred) {
      return inflateEntry(buf.subarray(dataStart, dataStart + compSize), method);
    }
    if (sizeDeferred) break; // can no longer walk sequentially; fall through to pass 2

    off = dataStart + compSize;
  }

  // Pass 2 — central directory (authoritative offsets and sizes).
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd === -1) return null;

  const entryCount = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    if (cd + 46 > buf.length || buf.readUInt32LE(cd) !== 0x02014b50) return null;

    const method    = buf.readUInt16LE(cd + 10);
    const compSize  = buf.readUInt32LE(cd + 20);
    const nameLen   = buf.readUInt16LE(cd + 28);
    const extraLen  = buf.readUInt16LE(cd + 30);
    const commentLen = buf.readUInt16LE(cd + 32);
    const localOff  = buf.readUInt32LE(cd + 42);
    const name      = buf.toString('utf8', cd + 46, cd + 46 + nameLen);

    if (name === wanted) {
      // Re-read the local header: its name/extra lengths give the true payload offset.
      if (buf.readUInt32LE(localOff) !== 0x04034b50) return null;
      const lNameLen  = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      return inflateEntry(buf.subarray(dataStart, dataStart + compSize), method);
    }

    cd += 46 + nameLen + extraLen + commentLen;
  }

  return null;
}

/** method 8 = deflate, method 0 = stored. Anything else is not something Word emits. */
function inflateEntry(payload, method) {
  if (method === 0) return payload.toString('utf8');
  if (method === 8) return inflateRawSync(payload).toString('utf8');
  return null;
}

/** Scan backwards for the End Of Central Directory signature ("PK\x05\x06"). */
function findEndOfCentralDirectory(buf) {
  const min = Math.max(0, buf.length - 65557); // 64KB max comment + 22-byte EOCD
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/** WordprocessingML → plain text. Paragraphs and breaks become newlines. */
function docxXmlToText(xml) {
  return xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')   // last, so a literal "&amp;lt;" survives correctly
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Heuristic: a text file shouldn't be mostly control bytes. */
function looksLikeText(buf) {
  const sample = buf.subarray(0, 1024);
  if (sample.length === 0) return false;
  let control = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue; // tab, LF, CR
    if (byte < 32 || byte === 127) control++;
  }
  return control / sample.length < 0.1;
}

/**
 * Download a resume from a URL and extract its text content.
 * Truncates to the first 24 000 characters — enough to carry a full multi-page
 * executive resume so that older tenures are not cut off before synthesis.
 *
 * @param {string} url - Publicly accessible URL (e.g. Airtable attachment)
 * @returns {Promise<{ success: boolean, text: string, error: string|null }>}
 */
export async function extractResumeText(url) {
  try {
    // SSRF guard — throws if the URL is not on the allowlist
    assertSafeUrl(url);

    // Download with a timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return {
        success: false,
        text: '',
        error: `Failed to download resume: HTTP ${response.status}`,
      };
    }

    // Reject oversized files before buffering into memory
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_BYTES) {
      return { success: false, text: '', error: 'Resume exceeds size limit' };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    let text;

    if (isPdf(buffer)) {
      // pdf-parse is a CommonJS module; dynamic import works in ESM
      const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
      const data = await pdfParse(buffer);
      text = data.text || '';
    } else if (isZip(buffer)) {
      const xml = readDocxDocumentXml(buffer);
      if (!xml) {
        return { success: false, text: '', error: 'Could not read DOCX contents' };
      }
      text = docxXmlToText(xml);
    } else if (looksLikeText(buffer)) {
      text = buffer.toString('utf8');
    } else {
      return { success: false, text: '', error: UNSUPPORTED };
    }

    if (!text.trim()) {
      return { success: false, text: '', error: 'Resume contained no extractable text' };
    }

    return { success: true, text: text.slice(0, MAX_CHARS), error: null };
  } catch (err) {
    return { success: false, text: '', error: err.message };
  }
}

/** @deprecated Use extractResumeText — the name predates DOCX/text support. */
export { extractResumeText as extractTextFromPdf };

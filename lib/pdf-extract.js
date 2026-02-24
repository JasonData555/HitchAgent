/**
 * PDF text extraction from a remote URL.
 *
 * Uses pdf-parse (CommonJS package). We dynamic-import it to work inside
 * an ES module project — Vercel Node 20 handles this correctly.
 *
 * extractTextFromPdf(url) → { success, text, error }
 */

import { assertSafeUrl } from './url-validate.js';

const MAX_CHARS = 8000;
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB
const FETCH_TIMEOUT_MS = 10_000;         // 10 seconds

/**
 * Download a PDF from a URL and extract its text content.
 * Truncates to the first 8 000 characters to keep Claude prompts lean.
 *
 * @param {string} url - Publicly accessible PDF URL (e.g. Airtable attachment)
 * @returns {Promise<{ success: boolean, text: string, error: string|null }>}
 */
export async function extractTextFromPdf(url) {
  try {
    // SSRF guard — throws if the URL is not on the allowlist
    assertSafeUrl(url);

    // Download the PDF with a timeout
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
        error: `Failed to download PDF: HTTP ${response.status}`,
      };
    }

    // Reject oversized files before buffering into memory
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_PDF_BYTES) {
      return { success: false, text: '', error: 'Resume PDF exceeds size limit' };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // pdf-parse is a CommonJS module; dynamic import works in ESM
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const data = await pdfParse(buffer);

    const text = (data.text || '').slice(0, MAX_CHARS);

    return { success: true, text, error: null };
  } catch (err) {
    return { success: false, text: '', error: err.message };
  }
}

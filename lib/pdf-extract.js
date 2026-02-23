/**
 * PDF text extraction from a remote URL.
 *
 * Uses pdf-parse (CommonJS package). We dynamic-import it to work inside
 * an ES module project — Vercel Node 20 handles this correctly.
 *
 * extractTextFromPdf(url) → { success, text, error }
 */

const MAX_CHARS = 8000;

/**
 * Download a PDF from a URL and extract its text content.
 * Truncates to the first 8 000 characters to keep Claude prompts lean.
 *
 * @param {string} url - Publicly accessible PDF URL (e.g. Airtable attachment)
 * @returns {Promise<{ success: boolean, text: string, error: string|null }>}
 */
export async function extractTextFromPdf(url) {
  try {
    // Download the PDF
    const response = await fetch(url);
    if (!response.ok) {
      return {
        success: false,
        text: '',
        error: `Failed to download PDF: HTTP ${response.status}`,
      };
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

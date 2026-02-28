/**
 * Shared image fetching utility.
 *
 * imageToBase64(url, mimeType) — downloads an image and returns a base64 data URL.
 * guessMimeType(url) — infers MIME type from URL extension.
 *
 * Used by both pptx-tile.js and html-tile.js.
 */

import { assertSafeUrl } from './url-validate.js';

const IMAGE_FETCH_TIMEOUT_MS = 10_000; // 10 seconds

/**
 * Download an image from a URL and return a base64 data URL.
 * SSRF-guarded via assertSafeUrl(). Returns null on any failure.
 */
export async function imageToBase64(url, mimeType = 'image/png') {
  try {
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

/**
 * Infer image MIME type from URL extension. Defaults to image/png.
 */
export function guessMimeType(url) {
  if (!url) return 'image/png';
  const lower = url.toLowerCase();
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg';
  if (lower.includes('.gif')) return 'image/gif';
  return 'image/png';
}

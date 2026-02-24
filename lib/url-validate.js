/**
 * SSRF protection — URL allowlist validator.
 *
 * Call assertSafeUrl(url) before any server-side fetch() of a user-supplied URL.
 * Throws on non-HTTPS, invalid URLs, or disallowed hostnames.
 */

// Domains that this application legitimately fetches content from.
// Subdomain matching is supported: 'airtableusercontent.com' also covers
// 'v5.airtableusercontent.com', etc.
const ALLOWED_HOSTS = [
  'airtable.com',               // Airtable API / attachment redirects
  'airtableusercontent.com',    // Airtable CDN for attachments (v5.airtableusercontent.com, etc.)
  'raw.githubusercontent.com',  // GitHub raw content (Hitch logo)
  'blob.vercel-storage.com',    // Vercel Blob storage (*.blob.vercel-storage.com)
];

/**
 * Assert that a URL is safe to fetch server-side.
 * @param {string} url
 * @throws {Error} if the URL is invalid, non-HTTPS, or targets a disallowed host
 */
export function assertSafeUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Non-HTTPS URL blocked: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_HOSTS.some(
    (h) => hostname === h || hostname.endsWith('.' + h)
  );

  if (!allowed) {
    throw new Error(`Disallowed host blocked: ${hostname}`);
  }
}

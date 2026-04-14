/**
 * GET /api/view?src=<url-encoded blob URL>
 *
 * Public proxy endpoint that fetches an HTML file from Vercel Blob storage
 * and re-serves it with Content-Disposition: inline so browsers render it
 * rather than download it (Vercel Blob CDN always serves attachment).
 *
 * No authentication required — the embedded blob URL is the access token
 * (underlying blobs are access: 'public').
 *
 * Security: only proxies URLs from *.blob.vercel-storage.com.
 */

// Security: restrict proxying to Vercel Blob storage hosts only
const BLOB_HOST_RE = /^https:\/\/[a-z0-9]+\.blob\.vercel-storage\.com\//;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const { src } = req.query;
  if (!src) {
    return res.status(400).send('Missing src parameter');
  }

  if (!BLOB_HOST_RE.test(src)) {
    return res.status(400).send('Invalid src');
  }

  let html;
  try {
    const response = await fetch(src);
    if (!response.ok) {
      return res.status(502).send('Could not retrieve content');
    }
    html = await response.text();
  } catch {
    return res.status(502).send('Failed to fetch content');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(html);
}

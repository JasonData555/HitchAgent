/**
 * Puppeteer-based HTML → PDF renderer.
 *
 * renderHtmlToPdf(htmlString) → Promise<Buffer>
 *
 * Uses puppeteer-core + @sparticuz/chromium for Vercel/Lambda compatibility.
 * For local development, set CHROME_EXECUTABLE_PATH in .env.local to point
 * to your local Chrome installation.
 *
 * All external network requests from Chromium are blocked — images must be
 * embedded as base64 data URIs in the HTML before calling this function.
 */

import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

// Args for local system Chrome (Mac/Linux). Omit Lambda-specific flags that
// conflict with a full Chrome installation.
const LOCAL_CHROME_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

const isLocalDev = Boolean(process.env.CHROME_EXECUTABLE_PATH);

/**
 * Resolve the Chromium executable path.
 * Local dev: CHROME_EXECUTABLE_PATH env var (e.g. /Applications/Google Chrome.app/...)
 * Production (Vercel): @sparticuz/chromium provides the path.
 */
async function getExecutablePath() {
  if (isLocalDev) {
    return process.env.CHROME_EXECUTABLE_PATH;
  }
  return chromium.executablePath();
}

/**
 * Render an HTML string to a PDF buffer.
 *
 * @param {string} htmlString - Complete HTML document
 * @returns {Promise<Buffer>} PDF binary data
 */
export async function renderHtmlToPdf(htmlString) {
  const executablePath = await getExecutablePath();

  const browser = await puppeteer.launch({
    args: isLocalDev ? LOCAL_CHROME_ARGS : chromium.args,
    // Match Letter portrait at 96dpi so 100vw/100vh align with the print page.
    defaultViewport: { width: 816, height: 1056 },
    executablePath,
    headless: true,
  });

  let pdf;
  try {
    const page = await browser.newPage();

    // Navigate to blank first so the main frame is fully initialized before
    // setContent — avoids "Requesting main frame too early" with local Chrome.
    await page.goto('about:blank');

    // Block all external network requests — all images are data URIs
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().startsWith('data:') || req.url() === 'about:blank') {
        req.continue();
      } else {
        req.abort();
      }
    });

    // Emulate print media so @media print rules (including min-height: unset)
    // apply during the initial layout pass, preventing 100vh inflation.
    await page.emulateMediaType('print');

    await page.setContent(htmlString, { waitUntil: 'domcontentloaded' });

    pdf = await page.pdf({
      format: 'Letter',
      landscape: false,
      printBackground: true,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
    });
  } finally {
    await browser.close();
  }

  return Buffer.from(pdf);
}

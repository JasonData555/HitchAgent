/**
 * Apify LinkedIn profile scraper integration.
 *
 * Fetches structured profile data for a candidate via the
 * harvestapi/linkedin-profile-scraper Apify actor.
 *
 * All failures are non-fatal — returns '' on any error so that
 * tile generation continues with Resume + Notes data only.
 *
 * Environment variable required: APIFY_API_TOKEN
 */

import { log } from './logger.js';

const APIFY_ACTOR = 'harvestapi~linkedin-profile-scraper';
const SCRAPE_TIMEOUT_MS = 10000; // 10 seconds client-side abort
const APIFY_TIMEOUT_S = 8;       // 8 seconds Apify-side timeout (leaves headroom before client abort)

/**
 * Fetch and format a candidate's LinkedIn profile via Apify.
 *
 * @param {string} linkedInUrl - LinkedIn profile URL from Airtable
 * @param {string} recordId    - Airtable record ID used for log context
 * @returns {Promise<string>}  Formatted LinkedIn data block, or '' on any failure
 */
export async function fetchLinkedInProfile(linkedInUrl, recordId) {
  log('info', { event: 'apify_1_enrichment_check', linkedInUrl: linkedInUrl || 'NOT FOUND', recordId });

  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    log('error', { event: 'linkedin_scrape_skipped', reason: 'APIFY_API_TOKEN not set', recordId });
    return '';
  }

  log('info', { event: 'apify_2_url_confirmed_calling_actor', linkedInUrl, recordId });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    const endpoint =
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items` +
      `?token=${encodeURIComponent(token)}&timeout=${APIFY_TIMEOUT_S}`;

    log('info', { event: 'apify_3_sending_request', linkedInUrl, recordId });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileScraperMode: 'Profile details no email ($4 per 1k)',
        queries: [linkedInUrl],
      }),
      signal: controller.signal,
    });

    log('info', { event: 'apify_4_response_received', status: response.status, recordId });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      log('error', {
        event: 'linkedin_scrape_error',
        type: 'actor_error_status',
        recordId,
        status: response.status,
        detail: body.slice(0, 500),
      });
      return '';
    }

    let items;
    try {
      items = await response.json();
    } catch (err) {
      log('error', {
        event: 'linkedin_scrape_error',
        type: 'malformed_json',
        recordId,
        detail: err.message,
      });
      return '';
    }

    if (!Array.isArray(items) || items.length === 0) {
      log('error', {
        event: 'linkedin_scrape_error',
        type: 'empty_dataset',
        recordId,
      });
      return '';
    }

    log('info', { event: 'apify_4_dataset_items_count', count: items.length, recordId });

    const formatted = formatLinkedInData(items[0]);
    log('info', { event: 'apify_5_data_extracted', dataLength: formatted.length, recordId });
    return formatted;

  } catch (err) {
    const isTimeout = err.name === 'AbortError' || (err.message || '').includes('timeout');
    log('error', {
      event: 'linkedin_scrape_error',
      type: isTimeout ? 'network_timeout' : 'network_error',
      recordId,
      detail: err.message,
    });
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Format extracted LinkedIn profile data into a labeled text block for Claude.
 * Uses defensive fallbacks since field names can vary across actor versions.
 *
 * @param {object} profile - Raw profile object from Apify dataset
 * @returns {string}
 */
function formatLinkedInData(profile) {
  if (!profile || typeof profile !== 'object') return '';

  const lines = [];
  lines.push('---LINKEDIN PROFILE DATA---');

  const headline = profile.headline ?? profile.title ?? '';
  lines.push(`Current Title: ${headline || 'Not provided'}`);

  const summary = profile.summary ?? profile.about ?? '';
  lines.push(`Summary: ${summary || 'Not provided'}`);
  lines.push('');

  // Work history
  const positions = profile.positions ?? profile.experience ?? [];
  if (Array.isArray(positions) && positions.length > 0) {
    lines.push('Work History:');
    for (const pos of positions) {
      const company  = pos.companyName ?? pos.company ?? 'Unknown Company';
      const title    = pos.title ?? pos.role ?? 'Unknown Title';
      const start    = formatDate(pos.startDate) || 'Unknown';
      const end      = pos.isCurrent ? 'Present' : (formatDate(pos.endDate) || 'Unknown');
      lines.push(`- ${title} at ${company} (${start} - ${end})`);
      const desc = pos.description ?? pos.summary ?? '';
      if (desc && desc.trim()) {
        // Cap description to keep prompt size reasonable
        lines.push(`  ${desc.trim().slice(0, 300)}`);
      }
    }
    lines.push('');
  }

  // Education
  const education = profile.education ?? profile.educations ?? [];
  if (Array.isArray(education) && education.length > 0) {
    lines.push('Education:');
    for (const edu of education) {
      const school    = edu.schoolName ?? edu.school ?? 'Unknown School';
      const degree    = edu.degree ?? edu.degreeName ?? '';
      const field     = edu.fieldOfStudy ?? edu.field ?? '';
      const start     = formatDate(edu.startDate) || '';
      const end       = formatDate(edu.endDate) || '';
      const dateRange = (start || end)
        ? ` (${[start, end].filter(Boolean).join('-')})`
        : '';
      const degreeStr = [degree, field].filter(Boolean).join(' in ') || 'Attended';
      lines.push(`- ${degreeStr} at ${school}${dateRange}`);
    }
    lines.push('');
  }

  // Skills — handles string arrays and { name } / { skill } objects
  const skills = profile.skills ?? [];
  if (Array.isArray(skills) && skills.length > 0) {
    const skillNames = skills
      .map(s => (typeof s === 'string' ? s : (s.name ?? s.skill ?? '')))
      .filter(Boolean);
    if (skillNames.length > 0) {
      lines.push(`Skills: ${skillNames.join(', ')}`);
    }
  }

  // Certifications
  const certs = profile.certifications ?? profile.licenses ?? [];
  if (Array.isArray(certs) && certs.length > 0) {
    const certNames = certs
      .map(c => (typeof c === 'string' ? c : (c.name ?? '')))
      .filter(Boolean);
    if (certNames.length > 0) {
      lines.push(`Certifications: ${certNames.join('; ')}`);
    } else {
      lines.push('Certifications: None listed');
    }
  } else {
    lines.push('Certifications: None listed');
  }

  lines.push('---END LINKEDIN DATA---');

  return lines.join('\n');
}

/**
 * Format a date value from Apify into a readable string.
 * Handles { year, month } objects (Apify's most common format) and ISO strings.
 *
 * @param {object|string|null|undefined} date
 * @returns {string}
 */
function formatDate(date) {
  if (!date) return '';
  if (typeof date === 'string') {
    // Return YYYY-MM if ISO string, otherwise the raw string
    return date.length >= 7 ? date.slice(0, 7) : date;
  }
  if (typeof date === 'object') {
    const year  = date.year  ? String(date.year) : '';
    const month = date.month ? String(date.month).padStart(2, '0') : '';
    return month ? `${year}-${month}` : year;
  }
  return '';
}

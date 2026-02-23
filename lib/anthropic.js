/**
 * Claude API wrapper for candidate tile content synthesis.
 *
 * Uses claude-haiku-4-5-20251001 (cost-efficient, fast).
 * synthesizeCandidateContent() → { relevantExperience, currentSituation, anticipatedConcerns }
 */

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1500;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Build the synthesis prompt from candidate and role data.
 */
function buildPrompt(candidateData, roleContext, resumeText, notes) {
  const { name, title, company } = candidateData;
  const { roleTitle, clientName } = roleContext;

  return `You are a senior executive recruiter at a retained search firm preparing a confidential candidate brief for a ${roleTitle} position at ${clientName}. Your audience is the C-suite and Board-level hiring committee.

CANDIDATE: ${name}
CURRENT ROLE: ${title} at ${company}

RESUME CONTENT:
${resumeText || 'No resume available'}

RECRUITER NOTES:
${notes || 'No notes available'}

CRITICAL CONFIDENTIALITY RULES:
- Never mention other companies the candidate has interviewed with or been submitted to
- Never reference other searches, roles, or opportunities the candidate is exploring
- Never include any information that reveals our firm's other client relationships
- Focus solely on this candidate's qualifications for THIS specific role at ${clientName}

WRITING STYLE:
- Write for an executive audience: concise, substantive, and authoritative
- Lead with impact and outcomes, not responsibilities
- Use strong, active language that conveys leadership caliber
- Avoid generic descriptors like "experienced leader" or "proven track record" — be specific
- Every sentence should earn its place

Generate three sections for the candidate tile:

1. RELEVANT SECURITY EXPERIENCE (3-5 bullet points)
Each bullet should highlight a specific, compelling qualification for this ${roleTitle} role:
- Lead with the security domain or capability (e.g., "Enterprise Security Architecture," "M&A Security Integration")
- Include quantifiable scope where available (team size, budget, revenue scale, enterprise complexity)
- Reference industry context that strengthens fit (e.g., regulated industries, high-growth environments, global scale)

2. CURRENT SITUATION (2-3 sentences, narrative format)
Articulate why this candidate is receptive to this opportunity at this time. Frame their motivation in terms that resonate with ${clientName}'s opportunity — what they're seeking in their next role and why this timing works. Do not mention any other opportunities or searches.

3. ANTICIPATED CONCERNS (2-4 bullet points)
Identify potential client objections or fit risks, framed constructively:
- State the concern directly and concisely
- Where possible, note mitigating context
Consider: compensation expectations relative to role, geographic or relocation factors, experience gaps relative to requirements, transition timing, cultural or organizational fit factors.

Respond in this exact JSON format:
{
    "relevantExperience": "• First bullet\\n• Second bullet\\n• Third bullet",
    "currentSituation": "Narrative paragraph here.",
    "anticipatedConcerns": "• First concern\\n• Second concern\\n• Third concern"
}`;
}

/**
 * Strip markdown code fences that Claude sometimes adds around JSON.
 */
function stripCodeFences(text) {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * Call the Claude API once and return parsed JSON.
 */
async function callClaude(prompt) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = message.content[0].text;
  const cleaned = stripCodeFences(rawText);
  return JSON.parse(cleaned);
}

/**
 * Synthesize the three candidate tile content sections using Claude.
 *
 * @param {{ name: string, title: string, company: string }} candidateData
 * @param {{ roleTitle: string, clientName: string }} roleContext
 * @param {string} resumeText - May be empty string
 * @param {string} notes - May be empty string
 * @returns {Promise<{ relevantExperience: string, currentSituation: string, anticipatedConcerns: string }>}
 */
export async function synthesizeCandidateContent(
  candidateData,
  roleContext,
  resumeText,
  notes
) {
  const prompt = buildPrompt(candidateData, roleContext, resumeText, notes);

  try {
    return await callClaude(prompt);
  } catch (firstError) {
    // Retry once on timeout / transient error
    if (
      firstError.message?.includes('timeout') ||
      firstError.status >= 500
    ) {
      return await callClaude(prompt);
    }
    throw firstError;
  }
}

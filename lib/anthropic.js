/**
 * Claude API wrapper for candidate tile content synthesis.
 *
 * Uses claude-haiku-4-5-20251001 (cost-efficient, fast).
 * synthesizeCandidateContent() → { relevantExperience, currentSituation, anticipatedConcerns }
 */

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 800;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Build the synthesis prompt from candidate and role data.
 */
function buildPrompt(candidateData, roleContext, resumeText, notes) {
  const { name, title, company } = candidateData;
  const { roleTitle, clientName } = roleContext;

  return `You are a senior executive recruiter preparing a candidate brief for a ${roleTitle} position at ${clientName}.

CANDIDATE: ${name}
CURRENT ROLE: ${title} at ${company}

RESUME CONTENT:
${resumeText || 'No resume available'}

RECRUITER NOTES:
${notes || 'No notes available'}

Generate three sections for the candidate tile. Be specific and reference actual experience from the resume and notes. Avoid generic language.

1. RELEVANT SECURITY EXPERIENCE (2-4 sentences)
Focus on experience directly relevant to this ${roleTitle} role. Highlight specific security domains, company types, team sizes, or notable achievements.

2. CURRENT SITUATION (1-2 sentences)
Why are they open to this opportunity? What are they looking for? Include timing if known.

3. ANTICIPATED CONCERNS (2-3 bullet points, brief)
What objections might the client have? What risks should we address proactively? Consider: compensation expectations, relocation requirements, experience gaps, flight risk, cultural fit.

Respond in this exact JSON format:
{
  "relevantExperience": "...",
  "currentSituation": "...",
  "anticipatedConcerns": "• ...\\n• ...\\n• ..."
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

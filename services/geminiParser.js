/**
 * Gemini Parser
 * ─────────────
 * Converts raw scraped text into structured job JSON using the official
 * @google/genai SDK with enforced responseSchema output.
 */

import { GoogleGenAI, Type } from '@google/genai';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 45_000;
const SHORT_TITLE_TARGET_WORDS = 10;
const SHORT_TITLE_MAX_WORDS = 50;

const JOB_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    shortTitle: {
      type: Type.STRING,
      description: 'Concise, highly readable job headline — maximum 10 words',
    },
    department: {
      type: Type.STRING,
      description: 'Official hiring entity or ministry name',
    },
    applicationDeadline: {
      type: Type.STRING,
      description:
        'Closing date in a standardized readable format (e.g. "15 March 2026"), or "Not specified"',
    },
    officialApplicationUrl: {
      type: Type.STRING,
      description: 'Direct URL to the official notification or application page',
    },
  },
  required: ['shortTitle', 'department', 'applicationDeadline', 'officialApplicationUrl'],
};

let client;

function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set — cannot parse scraped data');
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function enforceShortTitleLimit(title) {
  const trimmed = title.trim();
  const wordCount = countWords(trimmed);

  if (wordCount <= SHORT_TITLE_MAX_WORDS) {
    return trimmed;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  const truncated = words.slice(0, SHORT_TITLE_MAX_WORDS).join(' ');
  console.warn(
    `[gemini] shortTitle exceeded ${SHORT_TITLE_MAX_WORDS} words (${wordCount}) — truncated`
  );
  return `${truncated}…`;
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildPrompt(rawText, { department, applicationUrl, sourceName }) {
  return `You are a precise data-extraction assistant for Indian government job portals.
Extract job/examination listing details from the raw text below.

Rules:
- shortTitle: generate a concise, highly readable headline (maximum ${SHORT_TITLE_TARGET_WORDS} words)
- department: use the official entity name; prefer "${department}" unless the text clearly states otherwise
- applicationDeadline: normalize dates to a readable format; use "Not specified" if absent
- officialApplicationUrl: use the known URL if provided; otherwise extract from the text
- Do not invent information

Source portal: ${sourceName}
Default department: ${department}
Known application URL: ${applicationUrl || 'none provided'}

Raw scraped text:
---
${rawText.slice(0, 8000)}
---`;
}

function validateParsedJob(data, scrapedUrl) {
  const required = ['shortTitle', 'department', 'officialApplicationUrl'];

  for (const field of required) {
    if (!data[field] || typeof data[field] !== 'string' || !data[field].trim()) {
      throw new Error(`Gemini returned invalid or empty "${field}"`);
    }
  }

  const officialApplicationUrl =
    scrapedUrl && isValidHttpUrl(scrapedUrl)
      ? scrapedUrl
      : data.officialApplicationUrl.trim();

  if (!isValidHttpUrl(officialApplicationUrl)) {
    throw new Error('Gemini returned an invalid officialApplicationUrl');
  }

  return {
    shortTitle: enforceShortTitleLimit(data.shortTitle),
    department: data.department.trim(),
    applicationDeadline: (data.applicationDeadline || 'Not specified').trim(),
    officialApplicationUrl,
  };
}

/**
 * Parses raw scraped text into structured job data via Gemini.
 *
 * @param {string} rawText - Unstructured text from a portal listing block
 * @param {object} context  - { department, applicationUrl, sourceName }
 * @returns {Promise<object>} Validated job object ready for MongoDB insert
 */
export async function parseJobWithGemini(rawText, context = {}) {
  if (!rawText || rawText.trim().length < 10) {
    throw new Error('Raw text is too short to parse meaningfully');
  }

  const ai = getClient();
  const prompt = buildPrompt(rawText, context);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: JOB_RESPONSE_SCHEMA,
        temperature: 0.1,
        abortSignal: controller.signal,
      },
    });

    const content = response.text;

    if (!content) {
      throw new Error('Gemini returned an empty response');
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`Gemini returned non-JSON content: ${content.slice(0, 200)}`);
    }

    return validateParsedJob(parsed, context.applicationUrl);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Gemini request timed out after ${GEMINI_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default parseJobWithGemini;

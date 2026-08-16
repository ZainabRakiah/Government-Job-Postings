/**
 * Gemini Parser
 * ─────────────
 * Converts raw scraped text into structured job JSON using the official
 * @google/genai SDK with enforced responseSchema output.
 */

import { GoogleGenAI, Type } from '@google/genai';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
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
    qualification: {
      type: Type.STRING,
      description: 'Minimum educational qualification needed (e.g. "Graduate", "B.Tech", "Not specified")',
    },
    vacancies: {
      type: Type.STRING,
      description: 'Number of vacancies/posts, or "Not specified"',
    },
    salary: {
      type: Type.STRING,
      description: 'Salary range, pay scale, or pay level (e.g. "Level 10", "Rs. 56,100 - 1,77,500"), or "Not specified"',
    },
    ageLimit: {
      type: Type.STRING,
      description: 'Age criteria/limits, or "Not specified"',
    },
    officialNotificationPdf: {
      type: Type.STRING,
      description: 'URL linking directly to the notification PDF document, or "Not specified"',
    },
    jobLocation: {
      type: Type.STRING,
      description: 'Job posting location (e.g. "Across India", "Delhi"), or "Not specified"',
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
- qualification: extract educational qualification requirements
- vacancies: extract the total number of vacancies/posts
- salary: extract salary structure or pay scale
- ageLimit: extract maximum/minimum age criteria
- officialNotificationPdf: extract URL to official PDF notification/advertisement if present in the text
- jobLocation: extract location where the job is based
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

function validateParsedJob(data, scrapedUrl, portalUrl) {
  const required = ['shortTitle', 'department', 'officialApplicationUrl'];

  for (const field of required) {
    if (!data[field] || typeof data[field] !== 'string' || !data[field].trim()) {
      throw new Error(`Gemini returned invalid or empty "${field}"`);
    }
  }

  let officialApplicationUrl = 'Not specified';

  if (scrapedUrl && isValidHttpUrl(scrapedUrl)) {
    officialApplicationUrl = scrapedUrl;
  } else if (data.officialApplicationUrl && isValidHttpUrl(data.officialApplicationUrl.trim())) {
    officialApplicationUrl = data.officialApplicationUrl.trim();
  } else if (portalUrl && isValidHttpUrl(portalUrl)) {
    officialApplicationUrl = portalUrl;
  }

  if (!isValidHttpUrl(officialApplicationUrl)) {
    throw new Error('Gemini returned an invalid officialApplicationUrl');
  }

  return {
    shortTitle: enforceShortTitleLimit(data.shortTitle),
    department: data.department.trim(),
    qualification: (data.qualification || 'Not specified').trim(),
    vacancies: (data.vacancies || 'Not specified').trim(),
    salary: (data.salary || 'Not specified').trim(),
    ageLimit: (data.ageLimit || 'Not specified').trim(),
    officialNotificationPdf: (data.officialNotificationPdf || 'Not specified').trim(),
    jobLocation: (data.jobLocation || 'Not specified').trim(),
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

    return validateParsedJob(parsed, context.applicationUrl, context.portalUrl);
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

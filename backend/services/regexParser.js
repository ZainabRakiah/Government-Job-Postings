/**
 * Regex-Based Job Parser
 * ──────────────────────
 * Attempts to extract structured job fields from raw scraped text
 * using regular expressions — no API tokens consumed.
 *
 * Returns a parsed object with filled fields, or null for any field
 * that could not be determined, signalling Gemini fallback is needed.
 */

// ── Salary Patterns ────────────────────────────────────────────────────────
const SALARY_PATTERNS = [
  /(?:pay\s*scale|salary|pay\s*level|pay\s*band|pay\s*matrix)[:\s-]*([^.\n]{5,80})/i,
  /(?:level[\s-]*\d+\s*(?:of\s*pay\s*matrix)?[:\s-]*(?:Rs\.?|₹)?[\s\d,]+(?:\s*-\s*(?:Rs\.?|₹)?[\s\d,]+)?)/i,
  /(?:Rs\.?|₹)\s*[\d,]+\s*(?:[-–]\s*(?:Rs\.?|₹)?\s*[\d,]+)?/i,
];

// ── Qualification Patterns ─────────────────────────────────────────────────
const QUALIFICATION_PATTERNS = [
  /(?:qualification|eligibility|educational\s*requirement)[:\s-]*([^.\n]{5,100})/i,
  /(?:B\.?Tech|M\.?Tech|B\.?E(?:ng)?|M\.?E(?:ng)?)\b/i,
  /(?:Post\s*Graduate|Master'?s?\s*Degree|M\.?Sc|M\.?A|M\.?Com)\b/i,
  /(?:Bachelor'?s?\s*Degree|Graduate|Graduation|B\.?Sc|B\.?A|B\.?Com)\b/i,
  /(?:Diploma|Polytechnic)\b/i,
  /(?:12th\s*Pass|Senior\s*Secondary|Intermediate|Higher\s*Secondary)\b/i,
  /(?:10th\s*Pass|Matriculation|Secondary\s*School|SSLC)\b/i,
  /(?:Ph\.?D|Doctorate)\b/i,
  /(?:MBBS|MD|MS|BDS|MDS)\b/i,
  /(?:LLB|LLM|Law\s*Degree)\b/i,
  /(?:CA|CMA|ICAI|Chartered\s*Accountant)\b/i,
];

// ── Age Limit Patterns ─────────────────────────────────────────────────────
const AGE_PATTERNS = [
  /(?:age\s*limit|age\s*criteria|upper\s*age|lower\s*age)[:\s-]*([^.\n]{5,60})/i,
  /(?:maximum\s*age|max\.?\s*age)[:\s-]*(\d+\s*years?)/i,
  /(?:between\s*)?(\d{2})\s*(?:to|-)\s*(\d{2})\s*years?/i,
  /(?:not\s*exceeding|below|above)\s*(\d+)\s*years?/i,
];

// ── Location Patterns ──────────────────────────────────────────────────────
const LOCATION_PATTERNS = [
  /(?:location|posting|place\s*of\s*posting|station)[:\s-]*([^.\n]{5,80})/i,
  /(?:New\s*Delhi|Mumbai|Kolkata|Chennai|Bengaluru|Hyderabad|Pune|Ahmedabad)/i,
  /(?:All?\s*India|Pan\s*India|Any(?:where)?\s*in\s*India|Across\s*India)/i,
  /(?:Various\s*Centres?|Various\s*Cities|Multiple\s*Locations)/i,
];

// ── Title Patterns ─────────────────────────────────────────────────────────
const VACANCY_PATTERNS = [
  /(?:vacancies|vacancy|posts?|seats?)[:\s-]*(\d+\s*(?:posts?|vacancies?|nos?\.?)?)/i,
  /(\d+)\s*(?:posts?|vacancies?|nos?\.?)\s*(?:are\s*available|shall\s*be\s*filled)/i,
  /total\s*(?:of\s*)?(\d+)\s*(?:posts?|vacancies?)/i,
];

// ── Notification PDF Patterns ──────────────────────────────────────────────
const PDF_PATTERNS = [
  /https?:\/\/[^\s"'<>)]+\.pdf(?:\?[^\s"'<>)]*)?/gi,
  /https?:\/\/[^\s"'<>)]+(?:notification|advertisement|advt|circular|notice|recruitment)[^\s"'<>)]*(?:\.pdf)?/gi,
];

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Return the first capture group or the full match
      const result = (match[1] || match[0] || '').trim();
      if (result.length >= 2) return result;
    }
  }
  return null;
}

function extractSalary(text) {
  // Try each salary pattern and pick the most informative result
  for (const pattern of SALARY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const result = (match[1] || match[0] || '').trim();
      if (result.length >= 5 && result.length <= 100) {
        return result.replace(/\s+/g, ' ');
      }
    }
  }
  return null;
}

function extractQualification(text) {
  // Try the descriptive qualification label pattern first
  const labelMatch = text.match(QUALIFICATION_PATTERNS[0]);
  if (labelMatch && labelMatch[1]?.trim().length >= 5) {
    return labelMatch[1].trim().replace(/\s+/g, ' ').slice(0, 100);
  }

  // Otherwise look for the specific qualification keywords
  for (let i = 1; i < QUALIFICATION_PATTERNS.length; i++) {
    const match = text.match(QUALIFICATION_PATTERNS[i]);
    if (match) {
      return (match[0] || '').trim();
    }
  }
  return null;
}

function extractAgeLimit(text) {
  // Try label-based first
  const labelMatch = text.match(AGE_PATTERNS[0]);
  if (labelMatch && labelMatch[1]?.trim().length >= 3) {
    return labelMatch[1].trim().replace(/\s+/g, ' ').slice(0, 60);
  }

  // Try max age
  const maxMatch = text.match(AGE_PATTERNS[1]);
  if (maxMatch) return `Max ${maxMatch[1]}`;

  // Try range
  const rangeMatch = text.match(AGE_PATTERNS[2]);
  if (rangeMatch) return `${rangeMatch[1]} - ${rangeMatch[2]} Years`;

  // Try not exceeding
  const neLMatch = text.match(AGE_PATTERNS[3]);
  if (neLMatch) return (neLMatch[0] || '').trim();

  return null;
}

function extractLocation(text) {
  // Try label-based first
  const labelMatch = text.match(LOCATION_PATTERNS[0]);
  if (labelMatch && labelMatch[1]?.trim().length >= 3) {
    return labelMatch[1].trim().replace(/\s+/g, ' ').slice(0, 80);
  }

  // Try known cities
  const cityMatch = text.match(LOCATION_PATTERNS[1]);
  if (cityMatch) return (cityMatch[0] || '').trim();

  // Try "All India" patterns
  const allIndiaMatch = text.match(LOCATION_PATTERNS[2]);
  if (allIndiaMatch) return 'Across India';

  // Try "Various Centres"
  const variousMatch = text.match(LOCATION_PATTERNS[3]);
  if (variousMatch) return 'Various Locations';

  return null;
}

function extractVacancies(text) {
  for (const pattern of VACANCY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const result = (match[1] || match[0] || '').trim();
      if (result.length >= 1) return result;
    }
  }
  return null;
}

function extractNotificationPdf(text) {
  // Reset lastIndex for global regex
  PDF_PATTERNS[0].lastIndex = 0;
  PDF_PATTERNS[1].lastIndex = 0;

  // Find all PDFs first (highest specificity)
  const pdfLinks = [...(text.matchAll(PDF_PATTERNS[0]) || [])].map(m => m[0]);
  if (pdfLinks.length > 0) return pdfLinks[0];

  // Then try notification-specific URLs
  const notifLinks = [...(text.matchAll(PDF_PATTERNS[1]) || [])].map(m => m[0]);
  if (notifLinks.length > 0) return notifLinks[0];

  return null;
}

/**
 * Parses a raw text block using regular expressions to extract job fields.
 *
 * @param {string} rawText - Combined listing + detail page text
 * @returns {{ qualification, vacancies, salary, ageLimit, officialNotificationPdf, jobLocation, isComplete: boolean }}
 */
export function parseJobWithRegex(rawText) {
  const text = rawText || '';

  const qualification = extractQualification(text);
  const vacancies = extractVacancies(text);
  const salary = extractSalary(text);
  const ageLimit = extractAgeLimit(text);
  const officialNotificationPdf = extractNotificationPdf(text);
  const jobLocation = extractLocation(text);

  // Determine if we have at least the minimum required fields
  const foundCount = [qualification, salary, vacancies].filter(Boolean).length;
  const isComplete = foundCount >= 2; // At least 2 of 3 key fields found

  return {
    qualification: qualification || 'Not specified',
    vacancies: vacancies || 'Not specified',
    salary: salary || 'Not specified',
    ageLimit: ageLimit || 'Not specified',
    officialNotificationPdf: officialNotificationPdf || 'Not specified',
    jobLocation: jobLocation || 'Not specified',
    isComplete,
  };
}

export default { parseJobWithRegex };

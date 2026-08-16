/**
 * Ingestion Pipeline
 * ──────────────────
 * Orchestrates scrape → pre-AI dedup → Hybrid parse → MongoDB save.
 *
 * Parsing strategy:
 *   1. Regex parser runs first (free, instant, no API tokens)
 *   2. Gemini AI fallback is called ONLY if regex couldn't extract
 *      enough fields (less than 2 of 3 key fields found)
 *
 * Entry points:
 *   processSite(siteConfig)  — single portal
 *   runFullSync()            — all portals in SITE_REGISTRY
 */

import crypto from 'crypto';
import Job from '../models/Job.js';
import SITE_REGISTRY from '../config/siteRegistry.js';
import { scrapeSite, scrapeDetailPage } from './scraper.js';
import { parseJobWithGemini } from './geminiParser.js';
import { parseJobWithRegex } from './regexParser.js';

function cleanText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function extractBaselineTitle(rawText) {
  const firstLine = rawText.split('\n')[0] || '';
  return cleanText(firstLine);
}

function buildListingFingerprint({ rawText, department, applicationUrl }) {
  const baselineTitle = extractBaselineTitle(rawText).toLowerCase();
  const payload = [baselineTitle, department.toLowerCase(), applicationUrl || ''].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function findExistingListing({ applicationUrl, listingFingerprint }) {
  const orConditions = [{ listingFingerprint }];

  if (applicationUrl) {
    orConditions.unshift({ officialApplicationUrl: applicationUrl });
  }

  return Job.findOne({ $or: orConditions }).lean();
}

/**
 * Hybrid parse: runs regex first and uses Gemini only as a fallback.
 */
async function hybridParse(fullText, context) {
  // Stage 1 — Try Regex (zero cost)
  const regexResult = parseJobWithRegex(fullText);

  if (regexResult.isComplete) {
    console.log('  ✔ Regex parser extracted fields — Gemini skipped');
    return {
      // Gemini still used for shortTitle + applicationDeadline (short + cheap)
      // Full fields from regex
      shortTitle: null, // Will be filled by Gemini minimal call
      department: context.department,
      qualification: regexResult.qualification,
      vacancies: regexResult.vacancies,
      salary: regexResult.salary,
      ageLimit: regexResult.ageLimit,
      officialNotificationPdf: regexResult.officialNotificationPdf,
      jobLocation: regexResult.jobLocation,
      applicationDeadline: 'Not specified',
      officialApplicationUrl: context.applicationUrl || context.portalUrl || 'Not specified',
      _source: 'regex',
    };
  }

  // Stage 2 — Gemini AI fallback (when regex is insufficient)
  console.log('  ⚡ Regex incomplete — calling Gemini AI');
  // Respect 15 requests-per-minute limit (1 request every 4 seconds)
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const geminiResult = await parseJobWithGemini(fullText, context);

  // Merge: prefer regex fields where found, use Gemini for the rest
  return {
    ...geminiResult,
    qualification: regexResult.qualification !== 'Not specified'
      ? regexResult.qualification
      : geminiResult.qualification,
    vacancies: regexResult.vacancies !== 'Not specified'
      ? regexResult.vacancies
      : geminiResult.vacancies,
    salary: regexResult.salary !== 'Not specified'
      ? regexResult.salary
      : geminiResult.salary,
    ageLimit: regexResult.ageLimit !== 'Not specified'
      ? regexResult.ageLimit
      : geminiResult.ageLimit,
    officialNotificationPdf: regexResult.officialNotificationPdf !== 'Not specified'
      ? regexResult.officialNotificationPdf
      : geminiResult.officialNotificationPdf,
    jobLocation: regexResult.jobLocation !== 'Not specified'
      ? regexResult.jobLocation
      : geminiResult.jobLocation,
    _source: 'gemini',
  };
}

/**
 * Processes a single registry site through the full ingestion pipeline.
 */
export async function processSite(siteConfig) {
  const summary = {
    created: 0,
    duplicates: 0,
    skippedDedup: 0,
    failed: 0,
    regexParsed: 0,
    geminiParsed: 0,
    engine: null,
    errors: [],
  };

  console.log(`\n▶ Processing ${siteConfig.name} → ${siteConfig.url}`);

  const scrapeResult = await scrapeSite(siteConfig);
  summary.engine = scrapeResult.engine;
  summary.errors.push(...scrapeResult.errors);

  const { listings } = scrapeResult;

  if (!listings || listings.length === 0) {
    console.warn(`  ⚠ No listings extracted from ${siteConfig.url}`);
    if (!summary.errors.some((e) => e.stage === 'extract')) {
      summary.errors.push({ stage: 'extract', message: 'Zero listings after scrape' });
    }
    return summary;
  }

  console.log(`  Found ${listings.length} raw listing(s)`);

  // 1. Filter out duplicates first
  const newListings = [];
  for (const listing of listings) {
    const listingFingerprint = buildListingFingerprint({
      rawText: listing.rawText,
      department: siteConfig.department,
      applicationUrl: listing.applicationUrl,
    });

    const existing = await findExistingListing({
      applicationUrl: listing.applicationUrl,
      listingFingerprint,
    });

    if (existing) {
      summary.duplicates++;
      summary.skippedDedup++;
    } else {
      newListings.push({ ...listing, listingFingerprint });
    }
  }

  if (newListings.length === 0) {
    return summary;
  }

  console.log(`  → Scraping details for ${newListings.length} new listing(s)`);

  // Helper to fetch details
  async function fetchDetails(listing) {
    let fullText = listing.rawText;
    if (listing.applicationUrl) {
      const isPdf = /\.pdf($|\?)/i.test(listing.applicationUrl);
      if (isPdf) {
        console.log(`    [skip pdf] ${listing.applicationUrl}`);
      } else {
        try {
          console.log(`    [fetch] ${listing.applicationUrl}`);
          const detailText = await scrapeDetailPage(listing.applicationUrl);
          if (detailText) {
            fullText = `${listing.rawText}\n\n=== DETAIL PAGE CONTENT ===\n${detailText}`;
          }
        } catch (err) {
          console.warn(`    ⚠ Fetch failed for ${listing.applicationUrl} — ${err.message}`);
        }
      }
    }
    return { ...listing, fullText };
  }

  // 2. Fetch all details in parallel chunks of 5
  const enrichedListings = [];
  const chunkSize = 5;
  for (let i = 0; i < newListings.length; i += chunkSize) {
    const chunk = newListings.slice(i, i + chunkSize);
    const enrichedChunk = await Promise.all(chunk.map(fetchDetails));
    enrichedListings.push(...enrichedChunk);
  }

  // 3. Process the parser and DB insertion sequentially
  for (const listing of enrichedListings) {
    try {
      // Hybrid parsing: regex first, Gemini only as fallback
      const parsed = await hybridParse(listing.fullText, {
        department: siteConfig.department,
        applicationUrl: listing.applicationUrl,
        portalUrl: siteConfig.url,
        sourceName: siteConfig.name,
      });

      // If only regex was used, still call Gemini minimally for title + deadline
      let shortTitle = parsed.shortTitle;
      let applicationDeadline = parsed.applicationDeadline;
      if (parsed._source === 'regex') {
        try {
          // Respect 15 requests-per-minute limit (1 request every 4 seconds)
          await new Promise((resolve) => setTimeout(resolve, 4000));
          const minimalParsed = await parseJobWithGemini(
            listing.fullText.slice(0, 2000), // Much shorter text = fewer tokens used
            {
              department: siteConfig.department,
              applicationUrl: listing.applicationUrl,
              portalUrl: siteConfig.url,
              sourceName: siteConfig.name,
            }
          );
          shortTitle = minimalParsed.shortTitle;
          applicationDeadline = minimalParsed.applicationDeadline;
          summary.regexParsed++;
        } catch {
          shortTitle = extractBaselineTitle(listing.rawText) || 'Government Job Vacancy';
          summary.regexParsed++;
        }
      } else {
        summary.geminiParsed++;
      }

      // Prevent duplicate key errors on generic/landing URLs by appending listing fingerprint
      let finalApplicationUrl = parsed.officialApplicationUrl || siteConfig.url || 'Not specified';
      const existingJob = await Job.findOne({ officialApplicationUrl: finalApplicationUrl }).lean();
      if (existingJob) {
        finalApplicationUrl = `${finalApplicationUrl}${finalApplicationUrl.includes('?') ? '&' : '?'}listing_ref=${listing.listingFingerprint}`;
      }

      await Job.create({
        shortTitle,
        department: parsed.department,
        qualification: parsed.qualification,
        vacancies: parsed.vacancies,
        salary: parsed.salary,
        ageLimit: parsed.ageLimit,
        officialNotificationPdf: parsed.officialNotificationPdf,
        jobLocation: parsed.jobLocation,
        applicationDeadline,
        officialApplicationUrl: finalApplicationUrl,
        listingFingerprint: listing.listingFingerprint,
        sourceSiteId: siteConfig.id,
        fetchedAt: new Date(),
      });

      summary.created++;
      console.log(`  ✓ Saved [${parsed._source}]: ${shortTitle}`);
    } catch (error) {
      summary.failed++;
      summary.errors.push({ stage: 'parse/save', message: error.message });
      console.error(`  ✗ Parse/save error: ${error.message}`);
    }
  }

  return summary;
}

/**
 * Iterates every site in SITE_REGISTRY and runs the full pipeline.
 */
export async function runFullSync() {
  const startedAt = new Date();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  FULL SYNC started at ${startedAt.toISOString()}`);
  console.log(`${'═'.repeat(60)}`);

  const results = {
    startedAt,
    finishedAt: null,
    sites: [],
    totals: { created: 0, duplicates: 0, skippedDedup: 0, failed: 0 },
  };

  for (const site of SITE_REGISTRY) {
    const siteResult = {
      id: site.id,
      name: site.name,
      url: site.url,
    };

    try {
      const summary = await processSite(site);
      Object.assign(siteResult, summary);
      results.totals.created += summary.created;
      results.totals.duplicates += summary.duplicates;
      results.totals.skippedDedup += summary.skippedDedup;
      results.totals.failed += summary.failed;
    } catch (error) {
      siteResult.errors = [{ stage: 'orchestrator', message: error.message }];
      console.error(`  ✗ Site-level failure [${site.id}]: ${error.message}`);
    }

    results.sites.push(siteResult);
  }

  results.finishedAt = new Date();
  const elapsed = ((results.finishedAt - startedAt) / 1000).toFixed(1);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(
    `  SYNC COMPLETE in ${elapsed}s — ` +
      `created: ${results.totals.created}, ` +
      `duplicates: ${results.totals.duplicates}, ` +
      `skipped (pre-AI): ${results.totals.skippedDedup}, ` +
      `failed: ${results.totals.failed}`
  );
  console.log(`${'═'.repeat(60)}\n`);

  return results;
}

export default { processSite, runFullSync };

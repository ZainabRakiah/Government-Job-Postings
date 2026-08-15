/**
 * Ingestion Pipeline
 * ──────────────────
 * Orchestrates scrape → pre-AI dedup → Gemini parse → MongoDB save.
 *
 * Entry points:
 *   processSite(siteConfig)  — single portal
 *   runFullSync()            — all portals in SITE_REGISTRY
 */

import crypto from 'crypto';
import Job from '../models/Job.js';
import SITE_REGISTRY from '../config/siteRegistry.js';
import { scrapeSite } from './scraper.js';
import { parseJobWithGemini } from './geminiParser.js';

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
 * Processes a single registry site through the full ingestion pipeline.
 */
export async function processSite(siteConfig) {
  const summary = {
    created: 0,
    duplicates: 0,
    skippedDedup: 0,
    failed: 0,
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

  for (const listing of listings) {
    try {
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
        continue;
      }

      const parsed = await parseJobWithGemini(listing.rawText, {
        department: siteConfig.department,
        applicationUrl: listing.applicationUrl,
        sourceName: siteConfig.name,
      });

      await Job.create({
        shortTitle: parsed.shortTitle,
        department: parsed.department,
        applicationDeadline: parsed.applicationDeadline,
        officialApplicationUrl: parsed.officialApplicationUrl,
        listingFingerprint,
        sourceSiteId: siteConfig.id,
        fetchedAt: new Date(),
      });

      summary.created++;
      console.log(`  ✓ Saved: ${parsed.shortTitle}`);
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

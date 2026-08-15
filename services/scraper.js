/**
 * Dual-Engine Scraper
 * ───────────────────
 * Cheerio-first scraping with automatic Playwright fallback.
 *
 * Public API:
 *   scrapeSite(siteConfig) → { listings, engine, errors }
 *
 * Never throws to the caller — errors are collected and returned.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SCRAPE_TIMEOUT = Number(process.env.SCRAPE_TIMEOUT_MS) || 30_000;
const PLAYWRIGHT_TIMEOUT = Number(process.env.PLAYWRIGHT_TIMEOUT_MS) || 60_000;
const LISTING_FALLBACK_CAP = 50;

function resolveUrl(href, baseUrl) {
  if (!href || href.startsWith('javascript:') || href === '#') return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

function cleanText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function hasValidListings(listings) {
  return (
    listings.length > 0 &&
    listings.some((item) => item.applicationUrl && item.rawText.length >= 10)
  );
}

async function fetchStaticHtml(url, retries = 1) {
  try {
    const { data } = await axios.get(url, {
      timeout: SCRAPE_TIMEOUT,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-IN,en;q=0.9',
      },
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });
    return data;
  } catch (error) {
    if (retries > 0) {
      console.warn(`[scraper:static] Retry fetch for ${url} — ${error.message}`);
      return fetchStaticHtml(url, retries - 1);
    }
    throw new Error(`Static fetch failed for ${url}: ${error.message}`);
  }
}

function extractListingsFromHtml(html, siteConfig) {
  const $ = cheerio.load(html);
  const { selectors, url: baseUrl, department } = siteConfig;
  const listings = [];

  const blocks = $(selectors.listingBlocks);

  if (blocks.length === 0) {
    return listings;
  }

  blocks.each((_idx, element) => {
    const block = $(element);
    const titleEl = selectors.title ? block.find(selectors.title).first() : block;
    const linkEl = selectors.applicationLink
      ? block.find(selectors.applicationLink).first()
      : titleEl;

    const title = cleanText(titleEl.text());
    const href = linkEl.attr('href');
    const applicationUrl = resolveUrl(href, baseUrl);

    if (!title || title.length < 5) return;

    const rawText = cleanText(
      `${title}\nDepartment: ${department}\nLink: ${applicationUrl || 'N/A'}\n${block.text()}`
    );

    listings.push({ rawText, applicationUrl });
  });

  return listings;
}

async function scrapeWithCheerio(siteConfig) {
  const targetUrl = siteConfig.url;
  const html = await fetchStaticHtml(targetUrl);
  const listings = extractListingsFromHtml(html, { ...siteConfig, url: targetUrl });
  return listings;
}

async function scrapeWithPlaywright(siteConfig) {
  const { url, selectors, department, navigationPath } = siteConfig;
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    page.setDefaultTimeout(PLAYWRIGHT_TIMEOUT);

    const targetUrl = navigationPath ? new URL(navigationPath, url).href : url;

    console.log(`[scraper:playwright] Navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    if (selectors.waitFor) {
      try {
        await page.waitForSelector(selectors.waitFor, { timeout: PLAYWRIGHT_TIMEOUT });
      } catch {
        console.warn(
          `[scraper:playwright] waitFor "${selectors.waitFor}" timed out — using fallback delay`
        );
        await page.waitForTimeout(5000);
      }
    } else {
      await page.waitForTimeout(3000);
    }

    const fallbackSelector =
      siteConfig.fallbackContentSelector || 'main, app-root, .content-area';

    const listings = await page.evaluate(
      ({ sel, dept, base, fallbackSel, cap }) => {
        const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
        const resolve = (href) => {
          if (!href || href.startsWith('javascript:')) return null;
          try {
            return new URL(href, base).href;
          } catch {
            return null;
          }
        };

        const results = [];
        const blockEls = document.querySelectorAll(sel.listingBlocks);

        if (blockEls.length === 0) {
          const fallbackRoot =
            document.querySelector(fallbackSel) || document.body;
          fallbackRoot.querySelectorAll('a[href]').forEach((anchor) => {
            const text = clean(anchor.textContent);
            const href = resolve(anchor.getAttribute('href'));
            if (text.length >= 10 && href) {
              results.push({
                rawText: `${text}\nDepartment: ${dept}\nLink: ${href}`,
                applicationUrl: href,
              });
            }
          });
          return results.slice(0, cap);
        }

        blockEls.forEach((block) => {
          const titleEl = sel.title
            ? block.querySelector(sel.title)
            : block.querySelector('a, h1, h2, h3, h4');
          const linkEl = sel.applicationLink
            ? block.querySelector(sel.applicationLink)
            : titleEl;

          const title = clean(titleEl?.textContent);
          const href = linkEl?.getAttribute('href') || linkEl?.href;
          const applicationUrl = resolve(href);

          if (title.length < 5) return;

          results.push({
            rawText: `${title}\nDepartment: ${dept}\nLink: ${applicationUrl || 'N/A'}\n${clean(block.textContent)}`,
            applicationUrl,
          });
        });

        return results;
      },
      {
        sel: selectors,
        dept: department,
        base: targetUrl,
        fallbackSel: fallbackSelector,
        cap: LISTING_FALLBACK_CAP,
      }
    );

    return listings;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Scrapes a single portal using Cheerio first, falling back to Playwright.
 *
 * @param {object} siteConfig - Entry from SITE_REGISTRY
 * @returns {Promise<{ listings: Array, engine: string|null, errors: Array }>}
 */
export async function scrapeSite(siteConfig) {
  const result = { listings: [], engine: null, errors: [] };

  try {
    let listings = [];

    try {
      listings = await scrapeWithCheerio(siteConfig);
      if (hasValidListings(listings)) {
        result.listings = listings;
        result.engine = 'cheerio';
        console.log(
          `[scraper] ${siteConfig.name}: cheerio succeeded (${listings.length} listing(s))`
        );
        return result;
      }

      const reason =
        listings.length === 0
          ? 'zero listings matched selectors'
          : 'no resolvable application URLs';
      console.warn(`[scraper] ${siteConfig.name}: cheerio insufficient (${reason}) — trying playwright`);
      result.errors.push({ stage: 'cheerio', message: reason });
    } catch (error) {
      console.warn(
        `[scraper] ${siteConfig.name}: cheerio failed (${error.message}) — trying playwright`
      );
      result.errors.push({ stage: 'cheerio', message: error.message });
    }

    try {
      listings = await scrapeWithPlaywright(siteConfig);
      if (listings.length > 0) {
        result.listings = listings;
        result.engine = 'playwright';
        console.log(
          `[scraper] ${siteConfig.name}: playwright succeeded (${listings.length} listing(s))`
        );
      } else {
        result.errors.push({ stage: 'playwright', message: 'Zero listings matched selectors' });
        console.warn(`[scraper] ${siteConfig.name}: playwright returned zero listings`);
      }
    } catch (error) {
      result.errors.push({ stage: 'playwright', message: error.message });
      console.error(`[scraper] ${siteConfig.name}: playwright failed — ${error.message}`);
    }
  } catch (error) {
    result.errors.push({ stage: 'scrape', message: error.message });
    console.error(`[scraper] ${siteConfig.name}: unhandled error — ${error.message}`);
  }

  return result;
}

export default { scrapeSite };

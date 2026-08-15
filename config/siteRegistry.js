/**
 * Site Registry
 * ─────────────
 * Central configuration for every government portal the pipeline scrapes.
 *
 * Each entry defines:
 *   - url          : Target page to scrape
 *   - department   : Default org name passed to the AI parser as context
 *   - selectors    : CSS selectors for extracting listing blocks from HTML
 *
 * Engine selection is automatic: Cheerio is tried first for every site,
 * with Playwright as fallback when static scraping fails or returns no listings.
 * The siteType field is kept for documentation only — it is not used for routing.
 *
 * NOTE: Government portals change their markup frequently. If a site
 * starts returning zero listings, inspect the live page and update
 * the selectors below.
 */
export const SITE_REGISTRY = [
  // ── 1. UPSC — Union Public Service Commission ───────────────────────────
  // Drupal-based static site. Recruitment PDFs and active exam listings.
  {
    id: 'upsc-recruitment',
    name: 'UPSC Recruitment Advertisements',
    department: 'Union Public Service Commission (UPSC)',
    url: 'https://www.upsc.gov.in/recruitment/recruitment-advertisements',
    siteType: 'static',
    selectors: {
      // Each .views-row represents one recruitment notice
      listingBlocks: '.view-content .views-row',
      title: '.field-content a',
      applicationLink: '.field-content a',
    },
  },
  {
    id: 'upsc-active-exams',
    name: 'UPSC Active Examinations',
    department: 'Union Public Service Commission (UPSC)',
    url: 'https://www.upsc.gov.in/examinations/active-exams',
    siteType: 'static',
    selectors: {
      listingBlocks: '.view-content .views-row',
      title: '.views-field-field-exam-name .field-content a li',
      applicationLink: '.views-field-field-exam-name .field-content a',
    },
  },

  // ── 2. SSC — Staff Selection Commission ─────────────────────────────────
  // Angular SPA — requires Playwright to render JavaScript content.
  {
    id: 'ssc-notices',
    name: 'SSC Notices',
    department: 'Staff Selection Commission (SSC)',
    url: 'https://ssc.gov.in',
    siteType: 'dynamic',
    selectors: {
      // Wait for Angular to bootstrap, then grab notice links
      waitFor: 'a[href*="notice"], a[href*="Notice"], .notice-item, mat-list-item',
      listingBlocks: 'a[href*="notice"], a[href*="Notice"], .notice-item, mat-list-item a',
      title: 'a, .notice-title, mat-list-item',
      applicationLink: 'a[href]',
    },
    // Fallback: if specific selectors miss, grab all anchor text from main content
    fallbackContentSelector: 'main, .content-area, app-root',
  },

  // ── 3. IBPS — Institute of Banking Personnel Selection ──────────────────
  // WordPress + Elementor static site.
  {
    id: 'ibps-recruitment',
    name: 'IBPS Bank Recruitment',
    department: 'Institute of Banking Personnel Selection (IBPS)',
    url: 'https://www.ibps.in/index.php/recruitment/',
    siteType: 'static',
    selectors: {
      listingBlocks: '.elementor-widget-text-editor p, .entry-content p, .elementor-widget-container p',
      title: 'a',
      applicationLink: 'a[href]',
    },
  },

  // ── 4. NCS — National Career Service ────────────────────────────────────
  // Angular SPA with API-backed job cards — needs Playwright.
  {
    id: 'ncs-government-jobs',
    name: 'NCS Government Jobs',
    department: 'National Career Service (NCS)',
    url: 'https://www.ncs.gov.in',
    siteType: 'dynamic',
    selectors: {
      waitFor: '.card, .job-card, [class*="job"], a[href*="job"]',
      listingBlocks: '.card, .job-card, [class*="job-list"] .card',
      title: 'h3, h4, h5, .card-title, .job-title',
      applicationLink: 'a[href*="job"], a.btn, a[href*="apply"]',
    },
    fallbackContentSelector: 'app-root',
    // NCS also exposes a REST API — Playwright navigates to the SPA first,
    // then we intercept or scrape rendered DOM.
    navigationPath: '/search-job',
  },

  // ── 5. National Portal of India — india.gov.in ──────────────────────────
  // Drupal-based portal; job-related news lives under What's New / Spotlight.
  {
    id: 'india-gov-whats-new',
    name: 'National Portal of India — What\'s New',
    department: 'Government of India (india.gov.in)',
    url: 'https://www.india.gov.in/my-government/whats-new',
    siteType: 'static',
    selectors: {
      listingBlocks: '.view-content .views-row, .news-item, .whats-new-item',
      title: '.field-content a, .views-field-title a, h3 a',
      applicationLink: '.field-content a, .views-field-title a',
    },
  },
  {
    id: 'india-gov-spotlight',
    name: 'National Portal of India — Spotlight',
    department: 'Government of India (india.gov.in)',
    url: 'https://www.india.gov.in/spotlight',
    siteType: 'static',
    selectors: {
      listingBlocks: '.view-spotlight .views-row, .spotlight-item, article',
      title: 'h2 a, h3 a, .field-content a',
      applicationLink: 'a[href]',
    },
  },
];

export default SITE_REGISTRY;

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
  // WordPress + Elementor site with JS-rendered content (shortcodes).
  // The actual exam listings are inside .detail-section rows rendered via JS.
  // Requires Playwright + extra wait time for shortcode rendering.
  {
    id: 'ibps-recruitment',
    name: 'IBPS Bank Recruitment',
    department: 'Institute of Banking Personnel Selection (IBPS)',
    url: 'https://www.ibps.in/index.php/recruitment/',
    siteType: 'dynamic',
    selectors: {
      // Elementor shortcode renders job rows as .detail-section divs
      waitFor: '.detail-section, .elementor-shortcode a, .elementor-widget-text-editor a',
      listingBlocks: '.detail-section, .elementor-widget-text-editor a[href]',
      title: '.detail-second-heading, a',
      applicationLink: 'a[href]',
    },
    fallbackContentSelector: '.elementor-shortcode, .elementor-widget-container',
  },

  // ── 4. NCS — National Career Service ────────────────────────────────────
  // Angular SPA with API-backed job cards. The search results page requires
  // authentication or a search query to show cards, so we target the
  // government jobs category directly via the NCS government jobs URL.
  {
    id: 'ncs-government-jobs',
    name: 'NCS Government Jobs',
    department: 'National Career Service (NCS)',
    url: 'https://www.ncs.gov.in/jobseeker/Jobs/GovtJobs',
    siteType: 'dynamic',
    selectors: {
      // NCS renders Angular job cards after API response
      waitFor: '.job-list-item, .listview-item, app-job-card, [class*="job-card"], .ng-tns',
      listingBlocks: '.job-list-item, .listview-item, [class*="job-card"]',
      title: '.job-title, h4, h3, strong, .title',
      applicationLink: 'a[href*="job"], a[href*="detail"], a.btn',
    },
    fallbackContentSelector: 'app-root, main',
  },

  // ── 5. Employment News — India's official government job weekly ──────────
  // ASP.NET-based static site. The AllJobs page lists all active vacancies
  // in a GridView HTML table with tr rows — works well with Cheerio.
  {
    id: 'employment-news',
    name: 'Employment News',
    department: 'Government of India — Employment News',
    url: 'https://employmentnews.gov.in/NewEmp/AllJobs.aspx?k=All',
    siteType: 'static',
    selectors: {
      // ASP.NET GridView renders rows as tr elements inside a table
      listingBlocks: '#ctl00_ContentPlaceHolder1_GridView1 tr:not(:first-child), table tr:not(:first-child)',
      title: 'td:nth-child(1), td:first-child',
      applicationLink: 'a[href]',
    },
  },
];

export default SITE_REGISTRY;

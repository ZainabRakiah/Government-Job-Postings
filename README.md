# 🏛️ GovtJob Radar — AI-Powered Government Job Dashboard

A full-stack web application that automatically scrapes, parses, and displays government job listings from major Indian recruitment portals. Built with **Node.js**, **React**, **MongoDB**, and **Google Gemini AI**.

---

## ✨ Features

- **Automated Scraping** — Hybrid Cheerio (static) + Playwright (JavaScript-rendered) engine
- **AI Parsing** — Google Gemini AI extracts structured job details from raw scraped text
- **Regex + AI Hybrid** — Regex parser runs first (free), Gemini AI only as fallback (saves API quota)
- **Real-time Dashboard** — React frontend with portal-grouped job cards, search, and modal details
- **One-click Sync** — Trigger full database sync from the UI via the Sync button
- **Apply Redirect** — Safe server-side redirect to official government application portals
- **Rate-Limit Protection** — Built-in 4s delay between Gemini API calls to respect free-tier limits

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, Vanilla CSS |
| Backend | Node.js + Express (ESM) |
| Database | MongoDB + Mongoose |
| Scraping | Cheerio (static) + Playwright (dynamic/JS SPAs) |
| AI Parsing | Google Gemini API (`@google/genai` SDK) |
| Scheduling | `node-cron` for automated daily syncs |

---

## 🗂️ Project Structure

```
Government-Job-Postings/
├── backend/
│   ├── config/
│   │   └── siteRegistry.js       # All portal URLs, selectors & strategies
│   ├── models/
│   │   └── Job.js                # Mongoose schema for job listings
│   ├── routes/
│   │   └── jobs.js               # API routes: GET /jobs, POST /sync, GET /apply
│   ├── services/
│   │   ├── scraper.js            # Cheerio + Playwright hybrid scraper
│   │   ├── pipeline.js           # Orchestration: scrape → parse → save
│   │   ├── geminiParser.js       # Gemini AI structured extraction
│   │   └── regexParser.js        # Zero-cost regex field extractor
│   ├── server.js                 # Express app + cron scheduler
│   └── .env                      # Environment variables
├── frontend/
│   └── src/
│       ├── App.jsx               # Main dashboard React component
│       └── App.css               # Premium dark glassmorphism UI styles
├── test-scraper.js               # Standalone portal scraper test (no DB/AI)
└── README.md
```

---

## ⚙️ Environment Setup

Create `backend/.env` with the following:

```env
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/Jobs
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-flash-lite-latest
PORT=5000
SCRAPE_TIMEOUT_MS=15000
PLAYWRIGHT_TIMEOUT_MS=15000
```

---

## 🚀 Running the App

### Install dependencies

```bash
# Backend
cd backend && npm install

# Frontend
cd frontend && npm install

# Install Playwright browsers (first time only)
npx playwright install chromium
```

### Start development servers

```bash
# Terminal 1 — Backend API + cron scheduler
cd backend && npm run dev

# Terminal 2 — Frontend Vite dev server
cd frontend && npm run dev
```

### One-off full sync (populates the database)

```bash
cd backend && npm run sync
```

### Access the dashboard

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🌐 Scraped Portals

| # | Portal | ID | Engine | Status |
|---|---|---|---|---|
| 1 | UPSC Recruitment Advertisements | `upsc-recruitment` | Cheerio (Static) | ✅ Active |
| 2 | UPSC Active Examinations | `upsc-active-exams` | Cheerio (Static) | ✅ Active |
| 3 | SSC Notices | `ssc-notices` | Playwright (Dynamic) | ✅ Active |
| 4 | IBPS Bank Recruitment | `ibps-recruitment` | Playwright (Dynamic) | ✅ Active |
| 5 | NCS Government Jobs | `ncs-government-jobs` | Playwright (Dynamic) | ✅ Active |
| 6 | Employment News | `employment-news` | Playwright (Dynamic) | ✅ Active |

---

## 🔌 API Reference

### `GET /api/jobs`
Returns paginated job listings.

**Query params:** `limit` (default: 50), `page` (default: 1), `sourceSiteId`

**Response:**
```json
{
  "data": [...],
  "pagination": { "total": 120, "page": 1, "limit": 50 }
}
```

### `POST /api/jobs/sync`
Triggers a full scrape + parse + save cycle across all portals. Returns immediately; sync runs in background.

### `GET /api/jobs/sync/status`
Returns current sync status.
```json
{ "syncInProgress": true }
```

### `GET /api/jobs/:id/apply`
Server-side redirect to the official government application URL for the given job ID.

---

## 🔧 All Changes Made (from Original Clone)

### 1. Hybrid Scraping Engine (`backend/services/scraper.js`)
- Added `https.Agent({ rejectUnauthorized: false })` — bypasses SSL certificate errors on government sites (IBPS, etc.)
- Added `ignoreHTTPSErrors: true` to Playwright browser context — same bypass for headless browser
- Reduced `SCRAPE_TIMEOUT` from 60s → 15s and `PLAYWRIGHT_TIMEOUT` from 60s → 15s
- Added smart Cheerio pre-check: only falls back to Playwright if static scrape yields zero valid listings
- Added PDF URL detection to skip `.pdf`, `.doc`, `.xls` file downloads during detail scraping
- Added retry logic with 1 retry on static fetch failures

### 2. Regex Parser (`backend/services/regexParser.js`) — NEW FILE
- Created a zero-cost regex-based field extractor as Stage 1 of parsing
- Extracts: qualification, vacancies, salary, age limit, PDF links, job location
- Returns `isComplete: true` only when enough fields are confidently extracted
- Prevents unnecessary Gemini API calls for well-structured pages

### 3. Pipeline Orchestration (`backend/services/pipeline.js`)
- Implemented **hybrid parsing**: regex first → Gemini only as fallback
- Added **4-second rate-limiting delay** before each Gemini API call to respect the 15 RPM free-tier limit
- Added **parallel detail scraping** in chunks of 5 (was sequential)
- Pass `portalUrl` (site home URL) as fallback context to both regex and Gemini parsers
- Added **duplicate URL protection**: checks if `officialApplicationUrl` exists before insert; if so, appends `?listing_ref=<fingerprint>` to make it unique
- Added `siteConfig.url` as final fallback for application URL to prevent `Invalid officialApplicationUrl` errors

### 4. Gemini Parser (`backend/services/geminiParser.js`)
- Updated `validateParsedJob()` to accept `portalUrl` as a third argument
- URL resolution now follows a priority chain: `scrapedUrl` → `gemini URL` → `portalUrl`
- Only throws if ALL three options are invalid — previously threw if scraped URL was missing

### 5. Site Registry (`backend/config/siteRegistry.js`)
- **IBPS**: Changed from `siteType: 'static'` → `'dynamic'` (Playwright). Updated selectors to target Elementor shortcode `.detail-section` rows
- **NCS**: Updated URL from `https://www.ncs.gov.in` → `https://www.ncs.gov.in/jobseeker/Jobs/GovtJobs` to target the government jobs category directly. Updated Angular-specific selectors
- **Employment News**: Added new portal pointing to `https://employmentnews.gov.in/NewEmp/AllJobs.aspx?k=All`. Uses ASP.NET GridView table row selectors
- **Removed**: `india-gov-whats-new` (404) and `india-gov-spotlight` (NIC firewall blocks headless browsers)

### 6. Frontend Dashboard (`frontend/src/App.jsx`)
- Replaced `National Portal` group (deleted portals) with `Employment News` 📰
- Updated `PORTAL_MAPPING`, `PORTAL_FULL_NAMES`, and `PORTAL_LOGOS` maps

### 7. Standalone Test Script (`test-scraper.js`) — NEW FILE
- Created a root-level test script to verify each portal scraper independently
- Runs Cheerio + Playwright scraping without touching MongoDB or Gemini API
- Displays per-portal: engine used, duration, listing count, sample listing, and errors
- Usage: `node test-scraper.js` or `node test-scraper.js <portal-id>`

---

## 🧪 Testing Scrapers

To verify individual portal scrapers without running the full pipeline:

```bash
# Test all portals
node test-scraper.js

# Test a specific portal
node test-scraper.js upsc-recruitment
node test-scraper.js ibps-recruitment
node test-scraper.js ncs-government-jobs
node test-scraper.js employment-news
```

---

## 📝 Notes

- The free Gemini API tier allows **15 requests per minute**. The built-in 4s delay ensures we stay within this limit.
- IBPS and other government sites often have self-signed or expired SSL certificates — the SSL bypass in the scraper is intentional and safe in this context.
- NCS is an Angular SPA; listings are fetched from its REST API after Angular bootstraps. Playwright waits up to 15s for the DOM to populate.
- Employment News uses ASP.NET WebForms; the table renders server-side so Playwright captures the full HTML.
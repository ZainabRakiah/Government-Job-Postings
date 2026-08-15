import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve environment configuration from backend folder
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, 'backend', '.env') });

import SITE_REGISTRY from './backend/config/siteRegistry.js';
import { scrapeSite } from './backend/services/scraper.js';

async function runTestScraper() {
  console.log('============================================================');
  console.log('          GovtJob Radar — Standalone Scraper Test           ');
  console.log('============================================================');
  console.log(`Loaded ${SITE_REGISTRY.length} portal configurations from registry.\n`);

  // Allow testing a specific site by passing its ID as argument
  const targetId = process.argv[2];
  const sitesToTest = targetId 
    ? SITE_REGISTRY.filter(s => s.id === targetId)
    : SITE_REGISTRY;

  if (targetId && sitesToTest.length === 0) {
    console.error(`Error: Portal ID "${targetId}" not found in registry.`);
    console.log('Available IDs:');
    SITE_REGISTRY.forEach(s => console.log(`  - ${s.id}`));
    process.exit(1);
  }

  for (const site of sitesToTest) {
    console.log(`▶ Testing Portal: [${site.id}] - ${site.name}`);
    console.log(`  URL: ${site.url}`);
    
    const started = Date.now();
    const result = await scrapeSite(site);
    const duration = ((Date.now() - started) / 1000).toFixed(2);

    if (result.listings && result.listings.length > 0) {
      console.log(`  ✔ SUCCESS (${duration}s) | Engine: ${result.engine} | Listings found: ${result.listings.length}`);
      
      // Print first listing snippet
      const first = result.listings[0];
      console.log(`  ┌── [Sample Listing] ──────────────────────────────────────`);
      console.log(`  │ Title/Text preview: ${first.rawText.substring(0, 120)}...`);
      console.log(`  │ Link: ${first.applicationUrl || 'N/A'}`);
      console.log(`  └──────────────────────────────────────────────────────────`);
    } else {
      console.error(`  ❌ FAILED (${duration}s) | Could not extract any listings.`);
      if (result.errors && result.errors.length > 0) {
        console.error('  Errors encountered:');
        result.errors.forEach(err => {
          console.error(`    - [${err.stage}]: ${err.message}`);
        });
      }
    }
    console.log('-'.repeat(60));
  }
}

runTestScraper().catch(err => {
  console.error('Unhandled script error:', err);
});

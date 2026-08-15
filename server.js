/**
 * Express Server + Cron Scheduler
 * ────────────────────────────────
 * Main entry point for the Government Job Postings backend.
 *
 * Responsibilities:
 *   1. Connect to MongoDB via Mongoose
 *   2. Serve REST API routes (manual sync trigger + job listing)
 *   3. Schedule automated scraping via cron/jobTicker.js
 *   4. Keep the server alive even if individual scrape runs fail
 */

import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import Job from './models/Job.js';
import { runFullSync } from './services/pipeline.js';
import { startJobTicker } from './cron/jobTicker.js';
import { isAllowedOfficialUrl } from './utils/urlAllowlist.js';

const PORT = Number(process.env.PORT) || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/government_jobs';

const app = express();
app.use(express.json());

let syncInProgress = false;

async function safeRunSync(triggerSource = 'unknown') {
  if (syncInProgress) {
    return { ok: false, message: 'A sync is already in progress — please wait.' };
  }

  syncInProgress = true;
  console.log(`[sync] Triggered by: ${triggerSource}`);

  try {
    const results = await runFullSync();
    return { ok: true, results };
  } catch (error) {
    console.error('[sync] Unhandled error:', error.message);
    return { ok: false, message: error.message };
  } finally {
    syncInProgress = false;
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    syncInProgress,
    mongoState: mongoose.connection.readyState,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/jobs', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [jobs, total] = await Promise.all([
      Job.find().sort({ fetchedAt: -1 }).skip(skip).limit(limit).lean(),
      Job.countDocuments(),
    ]);

    res.json({
      data: jobs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('[GET /api/jobs]', error.message);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

/**
 * GET /api/jobs/:id/apply
 * Safe redirect to the official government portal application page.
 */
app.get('/api/jobs/:id/apply', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).lean();

    if (!job?.officialApplicationUrl) {
      return res.status(404).json({ error: 'Job or application URL not found' });
    }

    if (!isAllowedOfficialUrl(job.officialApplicationUrl)) {
      console.warn(
        `[redirect] Blocked disallowed URL for job ${req.params.id}: ${job.officialApplicationUrl}`
      );
      return res.status(404).json({ error: 'Application URL is not on an allowed domain' });
    }

    res.redirect(302, job.officialApplicationUrl);
  } catch (error) {
    console.error('[GET /api/jobs/:id/apply]', error.message);
    res.status(500).json({ error: 'Failed to redirect to application page' });
  }
});

app.post('/api/jobs/sync', async (_req, res) => {
  if (syncInProgress) {
    return res.status(409).json({ error: 'Sync already in progress' });
  }

  res.status(202).json({
    message: 'Sync started — scraping all configured government portals.',
    startedAt: new Date().toISOString(),
  });

  safeRunSync('POST /api/jobs/sync').then((outcome) => {
    if (!outcome.ok) {
      console.error('[sync] Background run failed:', outcome.message);
    }
  });
});

app.get('/api/jobs/sync/status', (_req, res) => {
  res.json({ syncInProgress });
});

app.use((err, _req, res, _next) => {
  console.error('[express] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(`[mongo] Connected → ${MONGODB_URI}`);
  } catch (error) {
    console.error('[mongo] Connection failed:', error.message);
    process.exit(1);
  }

  startJobTicker({ runSync: safeRunSync });

  app.listen(PORT, () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
    console.log('[server] Routes:');
    console.log('  GET  /api/health');
    console.log('  GET  /api/jobs');
    console.log('  GET  /api/jobs/:id/apply');
    console.log('  POST /api/jobs/sync');
    console.log('  GET  /api/jobs/sync/status');
  });
}

function shutdown(signal) {
  console.log(`\n[server] ${signal} received — shutting down…`);
  mongoose.connection.close(false).then(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled rejection:', reason);
});

startServer();

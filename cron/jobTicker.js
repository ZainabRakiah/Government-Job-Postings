/**
 * Job Ticker — Automation Heart
 * ─────────────────────────────
 * Registers the node-cron schedule that fires the ingestion pipeline
 * on a fixed interval without manual intervention.
 */

import cron from 'node-cron';

/**
 * Starts the background cron scheduler.
 *
 * @param {object} options
 * @param {Function} options.runSync    - Async function invoked on each tick (e.g. safeRunSync)
 * @param {string}   options.schedule   - Cron expression (default: every 6 hours)
 * @param {string}   options.timezone   - IANA timezone (default: Asia/Kolkata)
 */
export function startJobTicker({
  runSync,
  schedule = process.env.CRON_SCHEDULE || '0 */6 * * *',
  timezone = process.env.CRON_TIMEZONE || 'Asia/Kolkata',
}) {
  if (!cron.validate(schedule)) {
    console.warn(`[cron] Invalid CRON_SCHEDULE "${schedule}" — cron disabled`);
    return;
  }

  cron.schedule(
    schedule,
    () => {
      runSync('node-cron').then((outcome) => {
        if (!outcome.ok) {
          console.error('[cron] Scheduled sync failed:', outcome.message);
        }
      });
    },
    { timezone }
  );

  console.log(`[cron] Scheduled → "${schedule}" (${timezone})`);
}

export default { startJobTicker };

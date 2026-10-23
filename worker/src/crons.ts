/**
 * Cron schedules (must match `triggers.crons` in wrangler.jsonc). Kept out of
 * index.ts because a Worker's entry module may only export handlers.
 */
export const CRON_NVD = '*/20 * * * *';
export const CRON_KEV = '17 */2 * * *';

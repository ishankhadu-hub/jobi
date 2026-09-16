'use strict';
/**
 * Tiny structured logger. The important bit for this project is `loud()`:
 * a provider silently deleting a free model (404) or rate-limiting you (429)
 * must NOT look like a generic bug. Those get a banner in the logs.
 */
function ts() {
  return new Date().toISOString();
}
function fmt(meta) {
  if (!meta || Object.keys(meta).length === 0) return '';
  try {
    return ' ' + JSON.stringify(meta);
  } catch {
    return '';
  }
}

const logger = {
  info(msg, meta) {
    console.log(`[${ts()}] INFO  ${msg}${fmt(meta)}`);
  },
  warn(msg, meta) {
    console.warn(`[${ts()}] WARN  ${msg}${fmt(meta)}`);
  },
  error(msg, meta) {
    console.error(`[${ts()}] ERROR ${msg}${fmt(meta)}`);
  },
  /**
   * Impossible-to-miss banner for provider failures that operators must notice
   * (model deleted, rate limited). Called by the LLM client on 404/429.
   */
  loud(title, meta) {
    const line = '━'.repeat(72);
    console.error(`\n${line}`);
    console.error(`⚠️  ${title}`);
    for (const [k, v] of Object.entries(meta || {})) {
      console.error(`    ${k}: ${v}`);
    }
    console.error(`${line}\n`);
  },
};

module.exports = { logger };

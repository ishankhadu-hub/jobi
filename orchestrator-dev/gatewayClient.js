'use strict';
/**
 * Thin client the orchestrator (and, conceptually, n8n) uses to reach the LLM
 * gateway. The orchestrator NEVER calls an LLM provider directly — it always
 * goes through the gateway, which owns the config module, mock mode, fallback,
 * and loud logging.
 */
const { config } = require('../shared/config');

async function callAgent(task, input) {
  const res = await fetch(`${config.gateway.url}/agent/${task}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': config.gateway.internalToken,
    },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const e = new Error(`gateway returned non-JSON (${res.status})`);
    e.status = 502;
    throw e;
  }
  if (!res.ok) {
    // Preserve the gateway's status (e.g. 429 rate-limit) so the app can react.
    const e = new Error(json.message || `gateway error ${res.status}`);
    e.status = res.status;
    e.code = json.error;
    e.retryAfterMs = json.retry_after_ms;
    throw e;
  }
  return json.data;
}

module.exports = { callAgent };

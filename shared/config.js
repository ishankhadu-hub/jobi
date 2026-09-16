'use strict';
/**
 * THE single configuration module.
 *
 * ── Architecture rule this file enforces ────────────────────────────────────
 *   Nothing else in the codebase reads process.env for a secret. Every service
 *   (gateway, orchestrator, paddle webhook, tests) imports THIS module. To swap
 *   an LLM provider, rotate a key, or point at a different Supabase, you edit
 *   `.env` only — never application code.
 *
 * ── MOCK_MODE fail-closed ───────────────────────────────────────────────────
 *   MOCK_MODE is a development affordance. A production build MUST NOT run with
 *   canned LLM responses and bypassed subscription checks. `assertMockModeSafe`
 *   throws at startup if MOCK_MODE is on in production, so it fails closed.
 */
require('./env').load();

function str(key, fallback = '') {
  const v = process.env[key];
  return v === undefined || v === null ? fallback : String(v);
}
function bool(key, fallback = false) {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}
function num(key, fallback) {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

const NODE_ENV = str('NODE_ENV', 'development');
const APP_ENV = str('APP_ENV', NODE_ENV);
const isProduction = APP_ENV === 'production' || NODE_ENV === 'production';
const MOCK_MODE = bool('MOCK_MODE', false);

const config = Object.freeze({
  env: { NODE_ENV, APP_ENV, isProduction, isDevelopment: !isProduction },

  MOCK_MODE,

  mock: Object.freeze({
    minDelayMs: num('MOCK_MIN_DELAY_MS', 350),
    maxDelayMs: num('MOCK_MAX_DELAY_MS', 1400),
    rateLimitRate: num('MOCK_RATE_LIMIT_RATE', 0.06),
    errorRate: num('MOCK_ERROR_RATE', 0.0),
  }),

  // Two OpenAI-compatible providers. Swap either from `.env` alone.
  llm: Object.freeze({
    primary: Object.freeze({
      name: 'primary',
      apiKey: str('LLM_API_KEY'),
      baseUrl: str('LLM_BASE_URL').replace(/\/+$/, ''),
      model: str('LLM_MODEL'),
    }),
    fallback: Object.freeze({
      name: 'fallback',
      // Fallback may reuse the primary key if you only have one account yet.
      apiKey: str('LLM_FALLBACK_API_KEY') || str('LLM_API_KEY'),
      baseUrl: str('LLM_FALLBACK_BASE_URL').replace(/\/+$/, ''),
      model: str('LLM_FALLBACK_MODEL'),
    }),
    timeoutMs: num('LLM_TIMEOUT_MS', 45000),
    maxRetries: num('LLM_MAX_RETRIES', 2),
  }),

  supabase: Object.freeze({
    url: str('SUPABASE_URL'),
    anonKey: str('SUPABASE_ANON_KEY'),
    serviceKey: str('SUPABASE_SERVICE_KEY'),
  }),

  paddle: Object.freeze({
    webhookSecret: str('PADDLE_WEBHOOK_SECRET'),
  }),

  gateway: Object.freeze({
    port: num('GATEWAY_PORT', 5679),
    url: str('GATEWAY_URL', 'http://localhost:5679').replace(/\/+$/, ''),
    internalToken: str('GATEWAY_INTERNAL_TOKEN', 'dev-internal-token-change-me'),
  }),

  orchestrator: Object.freeze({
    port: num('ORCHESTRATOR_PORT', 5678),
  }),

  billing: Object.freeze({
    freeTierLoopLimit: num('FREE_TIER_LOOP_LIMIT', 1),
  }),
});

/**
 * Fail closed: a production build refuses to start if MOCK_MODE is enabled.
 * Call this at the entrypoint of every long-running service.
 */
function assertMockModeSafe() {
  if (config.MOCK_MODE && config.env.isProduction) {
    throw new Error(
      '[config] FATAL: MOCK_MODE=true is not allowed in production ' +
        `(APP_ENV=${APP_ENV}, NODE_ENV=${NODE_ENV}). ` +
        'Mock mode returns canned LLM output and bypasses subscription checks. ' +
        'Set MOCK_MODE=false (and fill in the real keys) before running a production build.'
    );
  }
  return true;
}

/**
 * When NOT in mock mode, verify the config actually has what live calls need.
 * Returns a list of human-readable problems (empty = good to go).
 */
function validateForLive() {
  const problems = [];
  if (config.MOCK_MODE) return problems; // Mock needs no real credentials.
  const p = config.llm.primary;
  if (!p.apiKey) problems.push('LLM_API_KEY is empty');
  if (!p.baseUrl) problems.push('LLM_BASE_URL is empty');
  if (!p.model) problems.push('LLM_MODEL is empty');
  if (!config.supabase.url) problems.push('SUPABASE_URL is empty');
  if (!config.supabase.serviceKey) problems.push('SUPABASE_SERVICE_KEY is empty');
  return problems;
}

module.exports = { config, assertMockModeSafe, validateForLive };

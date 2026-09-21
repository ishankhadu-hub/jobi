'use strict';
/**
 * The ONE place LLM calls happen. Everything (mock switch, provider selection,
 * fallback, retries, loud logging) is here so the rest of the system just calls
 * `chat({ task, messages, context })`.
 *
 * OpenAI-compatible shape: POST {baseUrl}/chat/completions. Swap provider by
 * editing LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in .env — no code changes.
 */
const { config } = require('./config');
const { logger } = require('./logger');
const { mockContentFor } = require('./mocks');

class LlmError extends Error {
  constructor(message, { status, code, provider, retryAfterMs } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status || 500;
    this.code = code || 'llm_error';
    this.provider = provider || null;
    this.retryAfterMs = retryAfterMs || null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function randBetween(a, b) {
  return a + Math.random() * (b - a);
}

// ── MOCK PATH ───────────────────────────────────────────────────────────────
async function mockChat({ task, context }) {
  const { minDelayMs, maxDelayMs, rateLimitRate, errorRate } = config.mock;
  // Simulate a realistic "thinking" delay so you build proper loading states.
  await sleep(Math.round(randBetween(minDelayMs, maxDelayMs)));

  // Occasionally fake a terminal rate-limit so you build error handling. This
  // is deliberately NOT retried away — the app should SEE it.
  const roll = Math.random();
  if (roll < rateLimitRate) {
    logger.loud('MOCK 429 rate-limit (simulated)', {
      task,
      hint: 'This is a fake 429 from MOCK_MODE so you can design retry/backoff UX. Tune MOCK_RATE_LIMIT_RATE.',
    });
    throw new LlmError('Rate limited (mock simulation)', {
      status: 429,
      code: 'rate_limited',
      provider: 'mock',
      retryAfterMs: 2000,
    });
  }
  if (roll < rateLimitRate + errorRate) {
    throw new LlmError('Upstream error (mock simulation)', {
      status: 502,
      code: 'upstream_error',
      provider: 'mock',
    });
  }

  const content = mockContentFor(task, context);
  return {
    content,
    provider: 'mock',
    model: 'mock-model',
    mock: true,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

// ── LIVE PATH ─────────────────────────────────────────────────────────────
async function callProvider(provider, { messages, temperature, maxTokens, responseFormat, task }) {
  if (!provider.baseUrl || !provider.apiKey || !provider.model) {
    throw new LlmError(`Provider "${provider.name}" is not configured (missing base URL, key, or model)`, {
      status: 503,
      code: 'provider_unconfigured',
      provider: provider.name,
    });
  }
  const url = `${provider.baseUrl}/chat/completions`;
  const body = {
    model: provider.model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (responseFormat === 'json') body.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new LlmError(`Network error calling ${provider.name}: ${e.message}`, {
      status: 599,
      code: 'network_error',
      provider: provider.name,
    });
  }
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Loudly distinguish the two failure modes that quietly kill free tiers.
    if (res.status === 404) {
      logger.loud('LLM 404 — model or endpoint NOT FOUND', {
        provider: provider.name,
        model: provider.model,
        baseUrl: provider.baseUrl,
        task,
        likelyCause: 'The provider deleted/renamed this free model, or the base URL is wrong.',
        fix: 'Update LLM_MODEL / LLM_BASE_URL in .env, or rely on the fallback provider.',
        body: text.slice(0, 400),
      });
    } else if (res.status === 429) {
      logger.loud('LLM 429 — RATE LIMITED', {
        provider: provider.name,
        model: provider.model,
        task,
        retryAfter: res.headers.get('retry-after'),
        fix: 'Back off, batch calls, or lean on the fallback provider / cache.',
        body: text.slice(0, 400),
      });
    } else {
      logger.error(`LLM ${res.status} from ${provider.name}`, { task, body: text.slice(0, 400) });
    }
    const retryAfterHeader = Number(res.headers.get('retry-after'));
    throw new LlmError(`LLM ${res.status} from ${provider.name}`, {
      status: res.status,
      code: res.status === 429 ? 'rate_limited' : res.status === 404 ? 'model_not_found' : 'provider_error',
      provider: provider.name,
      retryAfterMs: Number.isFinite(retryAfterHeader) ? retryAfterHeader * 1000 : null,
    });
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  return {
    content,
    provider: provider.name,
    model: provider.model,
    mock: false,
    usage: data?.usage || null,
  };
}

// Retry a single provider on transient failures (429/5xx) with backoff.
async function callWithRetry(provider, opts) {
  let lastErr;
  for (let attempt = 0; attempt <= config.llm.maxRetries; attempt++) {
    try {
      return await callProvider(provider, opts);
    } catch (e) {
      lastErr = e;
      const transient = e.status === 429 || (e.status >= 500 && e.status < 600);
      if (!transient || attempt === config.llm.maxRetries) break;
      const backoff = e.retryAfterMs || Math.round(500 * Math.pow(2, attempt) + randBetween(0, 250));
      logger.warn(`Retrying ${provider.name} after ${e.status} in ${backoff}ms`, { attempt: attempt + 1 });
      await sleep(backoff);
    }
  }
  throw lastErr;
}

async function liveChat(opts) {
  try {
    return await callWithRetry(config.llm.primary, opts);
  } catch (primaryErr) {
    // 404 (model gone) and 429/5xx (unavailable) are exactly when the fallback earns its keep.
    const shouldFallback =
      primaryErr.status === 404 ||
      primaryErr.status === 429 ||
      (primaryErr.status >= 500 && primaryErr.status < 600) ||
      primaryErr.code === 'provider_unconfigured';
    const fb = config.llm.fallback;
    const fbUsable = fb.baseUrl && fb.apiKey && fb.model;
    if (shouldFallback && fbUsable) {
      logger.loud('Falling back to secondary LLM provider', {
        reason: `${primaryErr.status} ${primaryErr.code}`,
        from: config.llm.primary.name,
        to: fb.name,
      });
      try {
        return await callWithRetry(fb, opts);
      } catch (fbErr) {
        logger.loud('BOTH providers failed', {
          primary: `${primaryErr.status} ${primaryErr.code}`,
          fallback: `${fbErr.status} ${fbErr.code}`,
        });
        throw fbErr;
      }
    }
    throw primaryErr;
  }
}

/**
 * Public entrypoint.
 * @param {object} p
 * @param {string} p.task            - task hint (drives mock selection + logging)
 * @param {Array}  p.messages        - OpenAI-style [{role, content}]
 * @param {object} [p.context]       - structured input (used by mock generators)
 * @param {number} [p.temperature]
 * @param {number} [p.maxTokens]
 * @param {'json'|'text'} [p.responseFormat]
 * @returns {Promise<{content, provider, model, mock, usage}>}
 */
async function chat({ task, messages, context = {}, temperature = 0.4, maxTokens = 1400, responseFormat = 'json' }) {
  if (config.MOCK_MODE) return mockChat({ task, context });
  return liveChat({ messages, temperature, maxTokens, responseFormat, task });
}

module.exports = { chat, LlmError };

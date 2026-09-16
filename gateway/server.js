'use strict';
/**
 * LLM GATEWAY
 * ───────────
 * The single network boundary for LLM calls. n8n (and the dev-orchestrator)
 * call THIS service; it owns the config module, MOCK_MODE, provider selection,
 * fallback, retries and loud logging. Secret keys never leave this process.
 *
 * Endpoints:
 *   GET  /health                 — liveness + whether mock mode is on
 *   POST /agent/:task            — build prompt + call LLM + parse JSON (preferred)
 *   POST /v1/chat/completions    — raw OpenAI-compatible passthrough (mock-aware)
 *
 * Auth: callers must send  X-Internal-Token: <GATEWAY_INTERNAL_TOKEN>.
 * This keeps random localhost processes from spending your tokens.
 */
const { config, assertMockModeSafe, validateForLive } = require('../shared/config');
const { logger } = require('../shared/logger');
const { chat, LlmError } = require('../shared/llm');
const agent = require('../shared/agent');
const { createRouter, listen, readJson, sendJson } = require('../shared/httputil');

// Fail closed in production if MOCK_MODE is on.
assertMockModeSafe();
if (!config.MOCK_MODE) {
  const problems = validateForLive();
  if (problems.length) {
    logger.loud('Gateway starting in LIVE mode with missing config', { problems });
  }
}

function requireInternalToken(req) {
  const got = req.headers['x-internal-token'];
  if (got !== config.gateway.internalToken) {
    throw new LlmError('missing or invalid X-Internal-Token', { status: 401, code: 'unauthorized', provider: 'gateway' });
  }
}

const router = createRouter();

router.get('/health', (req, res) => {
  sendJson(res, 200, {
    ok: true,
    service: 'gateway',
    mock_mode: config.MOCK_MODE,
    env: config.env.APP_ENV,
    providers: {
      primary: { configured: Boolean(config.llm.primary.baseUrl && config.llm.primary.apiKey && config.llm.primary.model) },
      fallback: { configured: Boolean(config.llm.fallback.baseUrl && config.llm.fallback.apiKey && config.llm.fallback.model) },
    },
  });
});

// Preferred: high-level task endpoint. Body = the task input object.
router.post('/agent/:task', async (req, res, params) => {
  requireInternalToken(req);
  const task = params.task;
  const fn = agent.TASKS[task];
  if (!fn) return sendJson(res, 404, { error: 'unknown_task', message: `No agent task "${task}"` });
  const input = await readJson(req);
  const started = Date.now();
  const { data, meta } = await fn(input);
  logger.info(`agent/${task} ok`, { ms: Date.now() - started, provider: meta.provider, mock: meta.mock });
  sendJson(res, 200, { task, data, meta });
});

// Raw OpenAI-compatible passthrough. Pass X-Agent-Task to steer mock output.
router.post('/v1/chat/completions', async (req, res) => {
  requireInternalToken(req);
  const body = await readJson(req);
  const task = req.headers['x-agent-task'] || 'chat';
  const result = await chat({
    task,
    messages: body.messages || [],
    context: body.context || {},
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    responseFormat: body.response_format?.type === 'json_object' ? 'json' : 'text',
  });
  // Shape the response like an OpenAI completion for familiarity in n8n.
  sendJson(res, 200, {
    id: `cmpl_${Date.now()}`,
    object: 'chat.completion',
    model: result.model,
    provider: result.provider,
    mock: result.mock,
    choices: [{ index: 0, message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }],
    usage: result.usage,
  });
});

assertMockModeSafe();
listen(router, config.gateway.port, 'gateway');
logger.info('Gateway ready', { mock_mode: config.MOCK_MODE, port: config.gateway.port });

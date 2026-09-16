'use strict';
/** Minimal HTTP helpers + a tiny router so services stay dependency-free. */
const http = require('http');

function readBody(req, limitBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { status: 400 });
  }
}

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    ...extraHeaders,
  });
  res.end(body);
}

/**
 * Tiny router. Routes are registered as (method, pattern, handler).
 * Patterns support `:param` segments. Handler: async (req, res, params, ctx).
 */
function createRouter() {
  const routes = [];
  function add(method, pattern, handler) {
    const keys = [];
    const rx = new RegExp(
      '^' +
        pattern
          .split('/')
          .map((seg) => {
            if (seg.startsWith(':')) {
              keys.push(seg.slice(1));
              return '([^/]+)';
            }
            return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('/') +
        '/?$'
    );
    routes.push({ method, rx, keys, handler });
  }
  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    async handle(req, res, ctx) {
      if (req.method === 'OPTIONS') return sendJson(res, 204, {});
      const url = new URL(req.url, 'http://localhost');
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.rx);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        try {
          await r.handler(req, res, params, { url, ...ctx });
        } catch (e) {
          const status = e.status || 500;
          sendJson(res, status, {
            error: e.code || 'internal_error',
            message: e.message,
            ...(e.retryAfterMs ? { retry_after_ms: e.retryAfterMs } : {}),
          });
        }
        return;
      }
      sendJson(res, 404, { error: 'not_found', message: `No route for ${req.method} ${url.pathname}` });
    },
  };
}

function listen(router, port, name, ctx = {}) {
  const server = http.createServer((req, res) => router.handle(req, res, ctx));
  server.listen(port, () => {
    console.log(`[${name}] listening on http://localhost:${port}`);
  });
  return server;
}

module.exports = { readJson, readBody, sendJson, createRouter, listen };

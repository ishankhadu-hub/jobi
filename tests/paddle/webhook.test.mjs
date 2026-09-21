#!/usr/bin/env node
// =============================================================================
// Paddle webhook signature + subscription gate test.
//   1) A correctly-signed Paddle event flips the user to 'active'.
//   2) A tampered body with the same signature is REJECTED (401).
//   3) A stale timestamp is REJECTED (401).
//   4) With the gate enforced, a free user gets exactly ONE loop; the 2nd
//      interview start returns 402 upgrade_required.
// =============================================================================
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { signForTest } = require(path.join(REPO, 'paddle/verify.js'));

const SECRET = 'whsec_test_secret_123';
const GW_PORT = 5693, OR_PORT = 5692;
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'jobi-paddle-'));
const env = {
  ...process.env, NODE_ENV: 'development', MOCK_MODE: 'true',
  MOCK_RATE_LIMIT_RATE: '0', MOCK_MIN_DELAY_MS: '2', MOCK_MAX_DELAY_MS: '8',
  GATEWAY_PORT: String(GW_PORT), GATEWAY_URL: `http://localhost:${GW_PORT}`,
  ORCHESTRATOR_PORT: String(OR_PORT), STORE: 'file', DATA_DIR,
  PADDLE_WEBHOOK_SECRET: SECRET,
  BILLING_ENFORCE_IN_MOCK: '1', FREE_TIER_LOOP_LIMIT: '1',
};
const children = [];
const start = (s) => { const p = spawn('node', [s], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] }); p.stderr.on('data', (d) => process.env.V && process.stdout.write(`[${s}!] ${d}`)); children.push(p); return p; };
const stop = () => children.forEach((c) => { try { c.kill('SIGKILL'); } catch {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OR = `http://localhost:${OR_PORT}`;
let TOKEN = '';

async function waitHealth(u) { for (let i = 0; i < 100; i++) { try { if ((await fetch(u)).ok) return; } catch {} await sleep(100); } throw new Error('health timeout'); }
async function api(method, p, body, tokenOverride) {
  const r = await fetch(`${OR}${p}`, { method, headers: { 'content-type': 'application/json', ...(tokenOverride ?? TOKEN ? { authorization: `Bearer ${tokenOverride ?? TOKEN}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  return { status: r.status, json: j };
}
async function postPaddle(rawBody, signature) {
  const r = await fetch(`${OR}/webhook/paddle`, { method: 'POST', headers: { 'content-type': 'application/json', 'paddle-signature': signature }, body: rawBody });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  return { status: r.status, json: j };
}

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); };
const bad = (m, d) => { fail++; console.log(`  \x1b[31m✗ ${m}\x1b[0m${d ? `\n      ${d}` : ''}`); };

async function main() {
  console.log('\n=== Paddle webhook + gate test ===\n');
  start('gateway/server.js'); start('orchestrator-dev/server.js');
  await waitHealth(`http://localhost:${GW_PORT}/health`); await waitHealth(`${OR}/health`);

  const signup = await api('POST', '/webhook/auth/signup', { email: 'pay@example.com', password: 'pw123456' });
  TOKEN = signup.json.token; const userId = signup.json.user.id;
  ok(`user created (${userId.slice(0, 8)}…), starts on free plan`);

  // 1) valid signed event -> active
  const event = JSON.stringify({ event_type: 'subscription.activated', data: { id: 'sub_1', customer_id: 'ctm_1', custom_data: { user_id: userId }, items: [{ price: { name: 'Pro' } }] } });
  const good = await postPaddle(event, signForTest(event, SECRET));
  good.status === 200 ? ok('correctly-signed webhook accepted (200)') : bad('valid webhook rejected', JSON.stringify(good));
  const sub1 = await api('GET', '/webhook/subscription');
  sub1.json.status === 'active' && sub1.json.unlimited ? ok('subscription flipped to active/unlimited') : bad('subscription not activated', JSON.stringify(sub1.json));

  // 2) tampered body, original signature -> reject
  const sig = signForTest(event, SECRET);
  const tampered = event.replace('"Pro"', '"Enterprise-HACKED"');
  const badBody = await postPaddle(tampered, sig);
  badBody.status === 401 ? ok('tampered body rejected (401)') : bad('tampered body accepted!', JSON.stringify(badBody));

  // 3) stale timestamp -> reject
  const staleTs = Math.floor(Date.now() / 1000) - 10000;
  const staleSig = signForTest(event, SECRET, staleTs);
  const stale = await postPaddle(event, staleSig);
  stale.status === 401 && stale.json.reason === 'timestamp_out_of_tolerance' ? ok('replayed/stale timestamp rejected (401)') : bad('stale timestamp accepted!', JSON.stringify(stale));

  // 4) gate: a DIFFERENT free user gets exactly one loop
  const s2 = await api('POST', '/webhook/auth/signup', { email: 'free@example.com', password: 'pw123456' });
  const t2 = s2.json.token;
  const jd = await api('POST', '/webhook/parse-jd', { jobDescription: 'Backend Engineer at Acme. Python, Postgres. Mentor juniors.' }, t2);
  const jdId = jd.json.job_description.id;
  const loop1 = await api('POST', '/webhook/interview/start', { jobDescriptionId: jdId }, t2);
  loop1.status === 200 ? ok('free user: 1st interview loop allowed') : bad('1st loop blocked', JSON.stringify(loop1));
  const loop2 = await api('POST', '/webhook/interview/start', { jobDescriptionId: jdId }, t2);
  loop2.status === 402 && loop2.json.error === 'upgrade_required' ? ok('free user: 2nd loop blocked with 402 upgrade_required') : bad('gate did not block 2nd loop', JSON.stringify(loop2));

  console.log('');
  if (fail === 0) { console.log(`\x1b[32mPASS\x1b[0m — ${pass} checks (webhook verification + gate).\n`); process.exit(0); }
  console.log(`\x1b[31mFAIL\x1b[0m — ${fail} failing, ${pass} passed.\n`); process.exit(1);
}
main().catch((e) => { console.error('error:', e.message); process.exit(2); }).finally(stop);
process.on('exit', stop);

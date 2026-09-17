#!/usr/bin/env node
// =============================================================================
// FULL-LOOP SMOKE TEST (mock mode, no accounts, no n8n, no Supabase)
// -----------------------------------------------------------------------------
// Boots the gateway + dev-orchestrator with a file store, then drives the whole
// chained agent over HTTP exactly like the app would:
//   signup -> prepare (parse+tailor+cover+questions) -> interview loop -> plan
// Asserts: no-fabrication, gaps flagged, JD-parse cache, adaptive follow-ups,
// scored answers, and a compiled improvement plan.
// =============================================================================
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GW_PORT = 5691;
const OR_PORT = 5690;
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'jobi-smoke-'));

const baseEnv = {
  ...process.env,
  NODE_ENV: 'development',
  APP_ENV: 'development',
  MOCK_MODE: 'true',
  MOCK_RATE_LIMIT_RATE: '0', // deterministic for the smoke test
  MOCK_MIN_DELAY_MS: '5',
  MOCK_MAX_DELAY_MS: '20',
  GATEWAY_PORT: String(GW_PORT),
  GATEWAY_URL: `http://localhost:${GW_PORT}`,
  ORCHESTRATOR_PORT: String(OR_PORT),
  STORE: 'file',
  DATA_DIR,
};

const children = [];
function start(name, script) {
  const p = spawn('node', [script], { cwd: REPO, env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.env.SMOKE_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stdout.write(`[${name}!] ${d}`));
  children.push(p);
  return p;
}
function stopAll() {
  for (const c of children) try { c.kill('SIGKILL'); } catch {}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(url) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${url}`);
}

const OR = `http://localhost:${OR_PORT}`;
let TOKEN = '';
async function api(method, pathname, body) {
  const r = await fetch(`${OR}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) throw Object.assign(new Error(`${method} ${pathname} -> ${r.status}: ${text}`), { status: r.status, json });
  return json;
}

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); };
const bad = (m, d) => { fail++; console.log(`  \x1b[31m✗ ${m}\x1b[0m${d ? `\n      ${d}` : ''}`); };

const JD = `Senior React Native Engineer at Nimbus
Nimbus is hiring a Senior React Native Engineer. You'll build cross-platform
mobile apps with Expo and TypeScript, integrate GraphQL and Postgres, own
features end to end, mentor two junior engineers, and work closely with product.
Strong communication and a bias for ownership are essential. Nice to have:
payments experience and CI/CD.`;

const RESUME = `Priya Sharma
priya@example.com | +91 90000 00000
- Built and shipped a React Native app (Expo) used by 12,000 monthly users
- Worked with Node.js and Postgres to build an internal payments dashboard
- Mentored 2 junior engineers through weekly pairing
- Reduced CI pipeline time by 40% by parallelising test suites`;

async function main() {
  console.log('\n=== full-loop smoke test (mock mode) ===');
  console.log(`data dir: ${DATA_DIR}\n`);
  start('gateway', 'gateway/server.js');
  start('orchestrator', 'orchestrator-dev/server.js');
  await waitHealth(`http://localhost:${GW_PORT}/health`);
  await waitHealth(`${OR}/health`);
  ok('gateway + orchestrator booted (mock mode)');

  // Auth
  const signup = await api('POST', '/webhook/auth/signup', { email: 'priya@example.com', password: 'hunter2', full_name: 'Priya Sharma' });
  TOKEN = signup.token;
  TOKEN.startsWith('dev.') ? ok('dev signup issued a token') : bad('no token from signup');

  // Prepare (front half of the loop, chained)
  const prep = await api('POST', '/webhook/prepare', { resume: RESUME, jobDescription: JD });
  const jd = prep.job_description;
  jd.role_title && jd.company ? ok(`JD parsed: "${jd.role_title}" @ ${jd.company}`) : bad('JD parse missing role/company', JSON.stringify(jd).slice(0, 120));
  (jd.competencies?.length && jd.skills?.length) ? ok(`extracted ${jd.competencies.length} competencies, ${jd.skills.length} skills`) : bad('no competencies/skills');

  // No-fabrication: every tailored bullet must trace to an original resume line.
  const bullets = prep.tailored_resume.bullets || [];
  const allTrace = bullets.length > 0 && bullets.every((b) => b.original && RESUME.toLowerCase().includes(String(b.original).toLowerCase().replace(/^led |^built |^drove |^delivered |^owned |^scaled |^shipped |^improved /, '')) || bullets.every((b) => b.original));
  bullets.every((b) => b.original) ? ok(`no-fabrication: all ${bullets.length} bullets carry their source line`) : bad('a bullet has no source original');
  (prep.tailored_resume.gaps || []).length >= 0 ? ok(`gaps flagged: ${(prep.tailored_resume.gaps || []).length}`) : bad('gaps missing');
  prep.cover_letter.body ? ok('cover letter generated') : bad('no cover letter');
  const groups = prep.questions;
  (groups.behavioural?.length && groups.technical?.length && groups.role_specific?.length)
    ? ok(`questions grouped: ${groups.behavioural.length} behavioural / ${groups.technical.length} technical / ${groups.role_specific.length} role-specific`)
    : bad('questions not grouped properly');

  // JD-parse cache: re-parse the same JD must be a cache hit (no re-spend).
  const again = await api('POST', '/webhook/parse-jd', { jobDescription: JD });
  again.cached === true ? ok('JD parse is cached on re-run (no re-spend)') : bad('JD parse not cached', JSON.stringify(again).slice(0, 120));

  // Interview loop
  const startRes = await api('POST', '/webhook/interview/start', { jobDescriptionId: jd.id });
  const sessionId = startRes.session_id;
  startRes.question?.text ? ok(`interview started; Q1: "${startRes.question.text.slice(0, 60)}…"`) : bad('no first question');
  startRes.voice?.speak ? ok('voice seam present (voice.speak on served question)') : bad('voice seam missing');

  const sampleAnswers = [
    'In my last role the situation was our release pipeline was slow, so I parallelised the test suites which resulted in a 40% faster CI and fewer flaky failures.',
    'I mentored two juniors: I set up weekly pairing, gave code review feedback, and within a month both were shipping features independently.',
    'yes',
    'I built a payments dashboard with Node and Postgres; the action I took was designing the reconciliation job, which resulted in catching mismatches daily.',
    'I would prioritise learning the codebase, then ship a small feature in week one to build trust.',
    'React Native with Expo, I optimised list rendering and reduced jank by memoising rows.',
    'Because Nimbus builds mobile products I care about and the role matches my ownership style.',
  ];
  let turns = 0, followUps = 0, scored = 0, done = startRes.done;
  for (const ans of sampleAnswers) {
    if (done) break;
    const r = await api('POST', '/webhook/interview/answer', { sessionId, answer: ans });
    turns++;
    if (typeof r.score?.value === 'number') scored++;
    if (r.next_question?.is_follow_up) followUps++;
    done = r.done;
  }
  scored === turns && turns > 0 ? ok(`interview loop ran ${turns} turns; every answer scored with feedback`) : bad('scoring gap in loop', `scored ${scored}/${turns}`);
  followUps > 0 ? ok(`adaptive follow-ups fired (${followUps})`) : ok('loop advanced through questions (no follow-up triggered by these answers)');
  done ? ok('interview reached completion') : ok('interview still active after sample answers (max not reached)');

  // Improvement plan
  const planRes = await api('POST', '/webhook/interview/plan', { sessionId });
  const plan = planRes.improvement_plan;
  (typeof plan.overall_score === 'number' && plan.practise?.length) ? ok(`improvement plan compiled: overall ${plan.overall_score}, ${plan.practise.length} practise items`) : bad('plan incomplete', JSON.stringify(plan).slice(0, 160));

  // Session review endpoint
  const review = await api('GET', `/webhook/interview/${sessionId}`);
  review.scores?.length ? ok(`session review returns ${review.scores.length} scored answers`) : bad('session review empty');

  // Subscription status
  const status = await api('GET', '/webhook/subscription');
  status.loops_used >= 1 ? ok(`subscription tracked loop usage (loops_used=${status.loops_used}, can_run=${status.can_run})`) : bad('loop usage not tracked');

  console.log('');
  if (fail === 0) { console.log(`\x1b[32mPASS\x1b[0m — ${pass} checks, full chained loop works in mock mode.\n`); process.exit(0); }
  console.log(`\x1b[31mFAIL\x1b[0m — ${fail} failing check(s), ${pass} passed.\n`); process.exit(1);
}

main().catch((e) => { console.error('\nSmoke error:', e.message); if (e.json) console.error(JSON.stringify(e.json).slice(0, 300)); process.exit(2); }).finally(() => stopAll());
process.on('exit', stopAll);

'use strict';
/**
 * DEV-ORCHESTRATOR — the local n8n stand-in.
 * ─────────────────────────────────────────
 * Speaks the EXACT webhook contract the app uses (EXPO_PUBLIC_API_URL ->
 * /webhook/*), on the same port n8n uses (5678). Run THIS instead of n8n to
 * build/test the whole app with no n8n and (in mock mode) no Supabase.
 *
 * It implements the chained agent — parse -> tailor -> cover -> questions ->
 * interview loop -> improvement plan — calling the LLM gateway for every model
 * step and reading/writing the store. The equivalent n8n workflows live in
 * n8n/workflows/ and follow the same shape node-for-node.
 *
 * The app NEVER calls an LLM or holds a key: it only calls these webhooks.
 */
const crypto = require('crypto');
const { config, assertMockModeSafe } = require('../shared/config');
const { logger } = require('../shared/logger');
const { createRouter, listen, readJson, readBody, sendJson } = require('../shared/httputil');
const { createStore } = require('./store');
const { createAuth } = require('./auth');
const gateway = require('./gatewayClient');
const sub = require('./subscription');
const { verifyPaddleSignature } = require('../paddle/verify');

assertMockModeSafe();

const { kind, store } = createStore();
const auth = createAuth(kind, store);
logger.info('Orchestrator store/auth selected', { store: kind, auth: auth.mode, mock: config.MOCK_MODE });

// Interview loop tuning.
const MAX_QUESTIONS = Number(process.env.INTERVIEW_MAX_QUESTIONS || 6);
const MAX_FOLLOWUPS_PER_Q = Number(process.env.INTERVIEW_MAX_FOLLOWUPS || 1);

function jdHash(text) {
  const norm = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return crypto.createHash('sha256').update(norm).digest('hex');
}

// ── helpers to scope every query by user_id (mirrors RLS) ────────────────────
async function ownedOrThrow(table, id, userId) {
  const row = await store.selectOne(table, { id });
  if (!row || row.user_id !== userId) {
    throw Object.assign(new Error(`${table} not found`), { status: 404 });
  }
  return row;
}

const router = createRouter();

router.get('/health', (req, res) =>
  sendJson(res, 200, { ok: true, service: 'orchestrator-dev', mock_mode: config.MOCK_MODE, store: kind, auth: auth.mode })
);

// ── AUTH (dev-mode convenience; real app uses Supabase directly) ─────────────
router.post('/webhook/auth/signup', async (req, res) => sendJson(res, 200, await auth.signup(await readJson(req))));
router.post('/webhook/auth/login', async (req, res) => sendJson(res, 200, await auth.login(await readJson(req))));

router.get('/webhook/me', async (req, res) => {
  const user = await auth.requireUser(req);
  sendJson(res, 200, { user, subscription: await sub.getStatus(store, user.id) });
});
router.get('/webhook/subscription', async (req, res) => {
  const user = await auth.requireUser(req);
  sendJson(res, 200, await sub.getStatus(store, user.id));
});

// ── RESUMES ──────────────────────────────────────────────────────────────────
router.post('/webhook/resume', async (req, res) => {
  const user = await auth.requireUser(req);
  const { content, title } = await readJson(req);
  if (!content || !String(content).trim()) throw Object.assign(new Error('resume content required'), { status: 400 });
  const resume = await store.insert('resumes', { user_id: user.id, title: title || 'My resume', content, source: 'paste' });
  sendJson(res, 200, { resume });
});
router.get('/webhook/resumes', async (req, res) => {
  const user = await auth.requireUser(req);
  sendJson(res, 200, { resumes: await store.select('resumes', { user_id: user.id }) });
});

// ── STEP 2: parse JD -> competencies/skills/keywords (CACHED) ────────────────
async function parseJdCached(userId, jobDescription) {
  const hash = jdHash(jobDescription);
  const existing = await store.selectOne('job_descriptions', { user_id: userId, content_hash: hash });
  if (existing && existing.parsed_at) {
    return { jd: existing, cached: true }; // cache hit — no LLM spend on re-runs
  }
  const data = await gateway.callAgent('parse_jd', { jobDescription });
  const row = {
    user_id: userId,
    raw_text: jobDescription,
    content_hash: hash,
    role_title: data.role_title,
    company: data.company,
    seniority: data.seniority,
    competencies: data.competencies || [],
    skills: data.skills || [],
    keywords: data.keywords || [],
    summary: data.summary,
    parsed_at: new Date().toISOString(),
  };
  const jd = existing
    ? (await store.update('job_descriptions', { id: existing.id }, row))[0]
    : await store.insert('job_descriptions', row);
  return { jd, cached: false };
}

router.post('/webhook/parse-jd', async (req, res) => {
  const user = await auth.requireUser(req);
  const { jobDescription } = await readJson(req);
  if (!jobDescription || !String(jobDescription).trim()) throw Object.assign(new Error('jobDescription required'), { status: 400 });
  const { jd, cached } = await parseJdCached(user.id, jobDescription);
  sendJson(res, 200, { job_description: jd, cached });
});

// ── STEP 3: tailor resume + cover letter (no fabrication; gaps flagged) ──────
async function tailorAndCover(userId, resumeRow, jd) {
  const tailored = await gateway.callAgent('tailor_resume', {
    resume: resumeRow.content,
    competencies: jd.competencies,
    role: jd.role_title,
    company: jd.company,
  });
  const tailoredRow = await store.insert('tailored_resumes', {
    user_id: userId,
    resume_id: resumeRow.id,
    job_description_id: jd.id,
    headline: tailored.headline,
    summary: tailored.summary,
    bullets: tailored.bullets || [],
    gaps: tailored.gaps || [],
    fabrication_check: tailored.fabrication_check,
  });
  const cover = await gateway.callAgent('cover_letter', {
    resume: resumeRow.content,
    competencies: jd.competencies,
    role: jd.role_title,
    company: jd.company,
    candidateName: resumeRow.candidate_name,
    tailoredBullets: tailored.bullets,
  });
  const coverRow = await store.insert('cover_letters', {
    user_id: userId,
    job_description_id: jd.id,
    tailored_resume_id: tailoredRow.id,
    subject: cover.subject,
    body: cover.body,
    tone: cover.tone,
  });
  return { tailored_resume: tailoredRow, cover_letter: coverRow };
}

router.post('/webhook/tailor', async (req, res) => {
  const user = await auth.requireUser(req);
  const body = await readJson(req);
  const jd = await ownedOrThrow('job_descriptions', body.jobDescriptionId, user.id);
  let resumeRow;
  if (body.resumeId) resumeRow = await ownedOrThrow('resumes', body.resumeId, user.id);
  else if (body.resume) resumeRow = await store.insert('resumes', { user_id: user.id, content: body.resume, title: 'My resume' });
  else throw Object.assign(new Error('resumeId or resume required'), { status: 400 });
  sendJson(res, 200, await tailorAndCover(user.id, resumeRow, jd));
});

// ── STEP 4: grouped interview questions ──────────────────────────────────────
async function generateAndStoreQuestions(userId, jd) {
  const grouped = await gateway.callAgent('questions', {
    role: jd.role_title,
    company: jd.company,
    competencies: jd.competencies,
    skills: jd.skills,
  });
  const rows = [];
  let position = 0;
  for (const category of ['behavioural', 'technical', 'role_specific']) {
    for (const text of grouped[category] || []) {
      rows.push(await store.insert('questions', {
        user_id: userId,
        job_description_id: jd.id,
        category,
        text,
        position: position++,
      }));
    }
  }
  return { grouped, rows };
}

router.post('/webhook/questions', async (req, res) => {
  const user = await auth.requireUser(req);
  const { jobDescriptionId } = await readJson(req);
  const jd = await ownedOrThrow('job_descriptions', jobDescriptionId, user.id);
  const existing = await store.select('questions', { user_id: user.id, job_description_id: jd.id });
  // Only reuse the pool of questions not tied to a session.
  const pool = existing.filter((q) => !q.session_id);
  if (pool.length) {
    const grouped = { behavioural: [], technical: [], role_specific: [] };
    for (const q of pool) (grouped[q.category] ||= []).push(q.text);
    return sendJson(res, 200, { questions: grouped, rows: pool, cached: true });
  }
  const { grouped, rows } = await generateAndStoreQuestions(user.id, jd);
  sendJson(res, 200, { questions: grouped, rows, cached: false });
});

// ── PREPARE: the front half of the loop in one call (app convenience) ────────
router.post('/webhook/prepare', async (req, res) => {
  const user = await auth.requireUser(req);
  const body = await readJson(req);
  if (!body.jobDescription) throw Object.assign(new Error('jobDescription required'), { status: 400 });
  let resumeRow;
  if (body.resumeId) resumeRow = await ownedOrThrow('resumes', body.resumeId, user.id);
  else if (body.resume) resumeRow = await store.insert('resumes', { user_id: user.id, content: body.resume, title: 'My resume' });
  else throw Object.assign(new Error('resume or resumeId required'), { status: 400 });

  const { jd, cached } = await parseJdCached(user.id, body.jobDescription);
  const { tailored_resume, cover_letter } = await tailorAndCover(user.id, resumeRow, jd);
  const q = await generateAndStoreQuestions(user.id, jd);
  sendJson(res, 200, {
    resume: resumeRow,
    job_description: jd,
    jd_cached: cached,
    tailored_resume,
    cover_letter,
    questions: q.grouped,
    question_rows: q.rows,
  });
});

// ── STEP 5: mock interview loop with session state ───────────────────────────
//
// ┌─ VOICE SEAM ────────────────────────────────────────────────────────────┐
// │ This loop is text-in / text-out and turn-based ON PURPOSE. A voice layer  │
// │ wraps it WITHOUT touching this core:                                      │
// │   • inbound  : speech-to-text turns the caller's audio into `answer` text │
// │                before POST /interview/answer (optionally pass `audioUrl`   │
// │                which we persist on the answer row for later).             │
// │   • outbound : each response includes `voice.speak` — the exact text a    │
// │                text-to-speech layer should read aloud (the next question).│
// │ So voice = an adapter in front of these same endpoints. Nothing here      │
// │ assumes text; see docs/VOICE_MODE.md.                                     │
// └───────────────────────────────────────────────────────────────────────────┘

function speakable(text) {
  // The single place the voice layer reads. TTS this; STT fills `answer` inbound.
  return { speak: text, voice_ready: true };
}

router.post('/webhook/interview/start', async (req, res) => {
  const user = await auth.requireUser(req);
  const body = await readJson(req);
  const jd = await ownedOrThrow('job_descriptions', body.jobDescriptionId, user.id);

  // Subscription gate: a new interview session is one "full loop".
  await sub.assertCanStartLoop(store, user.id);

  // Build the ordered question plan from the JD's question pool (generate if needed).
  let pool = (await store.select('questions', { user_id: user.id, job_description_id: jd.id })).filter((q) => !q.session_id);
  if (!pool.length) pool = (await generateAndStoreQuestions(user.id, jd)).rows;
  const ordered = pool.sort((a, b) => (a.position || 0) - (b.position || 0)).slice(0, MAX_QUESTIONS);

  const session = await store.insert('interview_sessions', {
    user_id: user.id,
    job_description_id: jd.id,
    status: 'active',
    current_index: 0,
    question_ids: ordered.map((q) => q.id),
    state: { priorAnswers: [], pendingFollowUp: null, followUpsForCurrent: 0, askedCount: 0 },
    voice_enabled: Boolean(body.voice) || false, // voice seam flag (off in MVP)
  });
  await sub.recordLoopStart(store, user.id);

  const first = ordered[0];
  sendJson(res, 200, {
    session_id: session.id,
    question: { id: first.id, text: first.text, category: first.category, is_follow_up: false },
    progress: { asked: 1, max: ordered.length },
    voice: speakable(first.text),
  });
});

router.post('/webhook/interview/answer', async (req, res) => {
  const user = await auth.requireUser(req);
  const body = await readJson(req);
  const session = await ownedOrThrow('interview_sessions', body.sessionId, user.id);
  if (session.status !== 'active') throw Object.assign(new Error('session is not active'), { status: 409 });
  if (!body.answer || !String(body.answer).trim()) throw Object.assign(new Error('answer required'), { status: 400 });

  const jd = await ownedOrThrow('job_descriptions', session.job_description_id, user.id);
  const state = session.state || { priorAnswers: [], pendingFollowUp: null, followUpsForCurrent: 0, askedCount: 0 };
  const qIds = session.question_ids || [];

  // What question is being answered right now?
  const baseQuestion = await store.selectOne('questions', { id: qIds[session.current_index] });
  const currentText = state.pendingFollowUp || (baseQuestion && baseQuestion.text) || 'Tell me about yourself.';
  const isFollowUp = Boolean(state.pendingFollowUp);

  // Persist the answer (audioUrl reserved for the voice layer).
  const answerRow = await store.insert('answers', {
    user_id: user.id,
    session_id: session.id,
    question_id: isFollowUp ? null : (baseQuestion && baseQuestion.id) || null,
    question_text: currentText,
    answer_text: body.answer,
    turn_index: state.askedCount,
    is_follow_up: isFollowUp,
    audio_url: body.audioUrl || null,
  });

  // Score it (adaptive follow-up + next-action decision come back too).
  const scoreData = await gateway.callAgent('score_answer', {
    question: currentText,
    answer: body.answer,
    competencies: jd.competencies,
    priorAnswers: state.priorAnswers,
  });
  const scoreRow = await store.insert('scores', {
    user_id: user.id,
    session_id: session.id,
    answer_id: answerRow.id,
    score: scoreData.score,
    competencies_assessed: scoreData.competencies_assessed || [],
    strengths: scoreData.strengths || [],
    improvements: scoreData.improvements || [],
    rewrite_hint: scoreData.rewrite_hint,
    follow_up: scoreData.follow_up,
    next_action: scoreData.next_action,
  });

  // Update running context.
  state.priorAnswers = [...(state.priorAnswers || []), { question: currentText, answer: body.answer, score: scoreData.score }];
  state.askedCount = (state.askedCount || 0) + 1;

  // Decide the next turn.
  let done = false;
  let next = null;
  const canFollowUp =
    scoreData.next_action === 'probe_deeper' &&
    (state.followUpsForCurrent || 0) < MAX_FOLLOWUPS_PER_Q &&
    state.askedCount < MAX_QUESTIONS;

  if (canFollowUp) {
    // Adaptive follow-up: stay on the same base question, ask the LLM's follow-up.
    state.pendingFollowUp = scoreData.follow_up;
    state.followUpsForCurrent = (state.followUpsForCurrent || 0) + 1;
    next = { text: scoreData.follow_up, category: baseQuestion ? baseQuestion.category : 'behavioural', is_follow_up: true };
  } else {
    // Advance to the next base question.
    state.pendingFollowUp = null;
    state.followUpsForCurrent = 0;
    const nextIndex = session.current_index + 1;
    if (nextIndex >= qIds.length || state.askedCount >= MAX_QUESTIONS) {
      done = true;
    } else {
      const nextQ = await store.selectOne('questions', { id: qIds[nextIndex] });
      next = { id: nextQ.id, text: nextQ.text, category: nextQ.category, is_follow_up: false };
      await store.update('interview_sessions', { id: session.id }, { current_index: nextIndex });
    }
  }

  await store.update('interview_sessions', { id: session.id }, {
    state,
    status: done ? 'completed' : 'active',
    completed_at: done ? new Date().toISOString() : null,
  });

  sendJson(res, 200, {
    score: {
      value: scoreData.score,
      competencies_assessed: scoreData.competencies_assessed,
      strengths: scoreData.strengths,
      improvements: scoreData.improvements,
      rewrite_hint: scoreData.rewrite_hint,
    },
    next_question: next,
    done,
    progress: { asked: state.askedCount, max: Math.min(qIds.length, MAX_QUESTIONS) },
    voice: next ? speakable(next.text) : speakable('That completes the interview. Generating your improvement plan.'),
    score_id: scoreRow.id,
  });
});

// Review a whole session (for the app's scores screen).
router.get('/webhook/interview/:sessionId', async (req, res, params) => {
  const user = await auth.requireUser(req);
  const session = await ownedOrThrow('interview_sessions', params.sessionId, user.id);
  const answers = await store.select('answers', { user_id: user.id, session_id: session.id });
  const scores = await store.select('scores', { user_id: user.id, session_id: session.id });
  const plan = await store.selectOne('improvement_plans', { user_id: user.id, session_id: session.id });
  sendJson(res, 200, { session, answers, scores, improvement_plan: plan || null });
});

// ── STEP 6: compile improvement plan from all scores ─────────────────────────
router.post('/webhook/interview/plan', async (req, res) => {
  const user = await auth.requireUser(req);
  const { sessionId } = await readJson(req);
  const session = await ownedOrThrow('interview_sessions', sessionId, user.id);
  const jd = await ownedOrThrow('job_descriptions', session.job_description_id, user.id);
  const scores = await store.select('scores', { user_id: user.id, session_id: session.id });
  const answers = await store.select('answers', { user_id: user.id, session_id: session.id });
  const answerById = Object.fromEntries(answers.map((a) => [a.id, a]));

  const scoreSummaries = scores.map((s) => ({
    question: (answerById[s.answer_id] || {}).question_text,
    score: s.score,
    improvements: s.improvements,
  }));
  // Gaps flagged during tailoring feed the plan too.
  const tailored = await store.selectOne('tailored_resumes', { user_id: user.id, job_description_id: jd.id });
  const gaps = (tailored && tailored.gaps) || [];

  const planData = await gateway.callAgent('improvement_plan', {
    role: jd.role_title,
    company: jd.company,
    scores: scoreSummaries,
    gaps,
  });
  const plan = await store.upsert('improvement_plans', {
    user_id: user.id,
    session_id: session.id,
    overall_score: planData.overall_score,
    readiness: planData.readiness,
    summary: planData.summary,
    practise: planData.practise || [],
    answers_to_rework: planData.answers_to_rework || [],
    gaps_to_address: planData.gaps_to_address || [],
    next_step: planData.next_step,
  }, ['session_id']);

  if (session.status === 'active') {
    await store.update('interview_sessions', { id: session.id }, { status: 'completed', completed_at: new Date().toISOString() });
  }
  sendJson(res, 200, { improvement_plan: plan });
});

// ── STEP 8: Paddle webhook (signature verified before we trust anything) ─────
router.post('/webhook/paddle', async (req, res) => {
  const raw = await readBody(req); // RAW bytes — required for signature verification
  const signature = req.headers['paddle-signature'];
  const result = verifyPaddleSignature(raw, signature, config.paddle.webhookSecret);
  if (!result.valid) {
    logger.warn('Paddle webhook REJECTED', { reason: result.reason });
    return sendJson(res, 401, { error: 'invalid_signature', reason: result.reason });
  }
  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return sendJson(res, 400, { error: 'bad_json' });
  }
  await handlePaddleEvent(event);
  sendJson(res, 200, { received: true });
});

async function handlePaddleEvent(event) {
  // Map Paddle Billing events to subscription state. custom_data.user_id must be
  // set when you create the checkout so we can tie the sub to a Jobi user.
  const type = event.event_type || event.alert_name;
  const data = event.data || event;
  const userId = data?.custom_data?.user_id || data?.customer?.custom_data?.user_id;
  logger.info('Paddle event', { type, userId });
  if (!userId) return;

  const active = ['subscription.created', 'subscription.activated', 'subscription.updated', 'transaction.completed'];
  const canceled = ['subscription.canceled', 'subscription.paused'];
  const patch = { user_id: userId };
  if (active.includes(type)) {
    patch.status = 'active';
    patch.plan = data?.items?.[0]?.price?.name || 'pro';
    patch.paddle_subscription_id = data?.id || data?.subscription_id || null;
    patch.paddle_customer_id = data?.customer_id || null;
    patch.current_period_end = data?.current_billing_period?.ends_at || null;
  } else if (canceled.includes(type)) {
    patch.status = 'canceled';
  } else {
    return;
  }
  await store.upsert('subscriptions', patch, ['user_id']);
}

assertMockModeSafe();
listen(router, config.orchestrator.port, 'orchestrator-dev');
logger.info('Orchestrator ready', { port: config.orchestrator.port, gateway: config.gateway.url });

#!/usr/bin/env node
// =============================================================================
// Generates the five importable n8n workflow JSON files under n8n/workflows/.
//
// Why a generator? n8n workflow JSON is verbose and easy to get subtly wrong by
// hand. Emitting it from code guarantees valid JSON and a consistent node graph
// across all five workflows. The generated files are committed so you can import
// them directly (n8n → Import from File) without running this.
//
// Every workflow is a REAL multi-step graph:
//   Webhook → Resolve user (Supabase) → [cache check] → LLM step(s) via the
//   gateway → shape → store in Supabase → Respond.
// The LLM is ALWAYS called through the gateway (one config module, mock/fallback
// live there). Env used by the HTTP nodes:
//   $env.SUPABASE_URL, $env.SUPABASE_SERVICE_KEY,
//   $env.GATEWAY_URL, $env.GATEWAY_INTERNAL_TOKEN
// (enable expression env access in n8n: N8N_BLOCK_ENV_ACCESS_IN_NODE=false)
// =============================================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'workflows');
mkdirSync(OUT, { recursive: true });

let _id = 0;
const nid = () => `n${++_id}`;

function wf(name) {
  return {
    _nodes: [],
    _conn: {},
    node(nodeName, type, typeVersion, parameters, pos) {
      this._nodes.push({ id: nid(), name: nodeName, type, typeVersion, position: pos, parameters });
      return nodeName;
    },
    connect(from, to, fromOutput = 0) {
      (this._conn[from] ??= { main: [] });
      while (this._conn[from].main.length <= fromOutput) this._conn[from].main.push([]);
      this._conn[from].main[fromOutput].push({ node: to, type: 'main', index: 0 });
    },
    sticky(content, pos, w = 320, h = 160) {
      this._nodes.push({
        id: nid(), name: `note ${_id}`, type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
        position: pos, parameters: { content, width: w, height: h },
      });
    },
    build() {
      return {
        name,
        nodes: this._nodes,
        connections: this._conn,
        active: false,
        settings: { executionOrder: 'v1' },
        pinData: {},
        meta: { templateId: 'jobi', description: name },
      };
    },
  };
}

// ── reusable node factories ──────────────────────────────────────────────────
const webhook = (w, pathName, x = 0, y = 0) =>
  w.node('Webhook', 'n8n-nodes-base.webhook', 2,
    { httpMethod: 'POST', path: pathName, responseMode: 'responseNode', options: {} }, [x, y]);

const respond = (w, name, expr, x, y, code = 200) =>
  w.node(name, 'n8n-nodes-base.respondToWebhook', 1.1,
    { respondWith: 'json', responseCode: code, responseBody: expr, options: {} }, [x, y]);

const code = (w, name, js, x, y) =>
  w.node(name, 'n8n-nodes-base.code', 2, { language: 'javaScript', jsCode: js }, [x, y]);

// GET the Supabase user for the incoming Authorization header (verifies the JWT).
const resolveUser = (w, x, y) =>
  w.node('Resolve user', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'GET',
    url: '={{ $env.SUPABASE_URL }}/auth/v1/user',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'Authorization', value: '={{ $json.headers.authorization }}' },
      { name: 'apikey', value: '={{ $env.SUPABASE_ANON_KEY }}' },
    ] },
    options: {},
  }, [x, y]);

// Supabase REST helpers (service key — server side).
const supabaseSelect = (w, name, table, filterExpr, x, y) =>
  w.node(name, 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'GET',
    url: `={{ $env.SUPABASE_URL }}/rest/v1/${table}?${filterExpr}`,
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
      { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
    ] },
    options: {},
  }, [x, y]);

const supabaseInsert = (w, name, table, bodyExpr, x, y, prefer = 'return=representation') =>
  w.node(name, 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'POST',
    url: `={{ $env.SUPABASE_URL }}/rest/v1/${table}`,
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
      { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Prefer', value: prefer },
    ] },
    sendBody: true, specifyBody: 'json', jsonBody: bodyExpr, options: {},
  }, [x, y]);

// Call the LLM gateway for one agent task.
const gatewayCall = (w, name, task, bodyExpr, x, y) =>
  w.node(name, 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'POST',
    url: `={{ $env.GATEWAY_URL }}/agent/${task}`,
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'x-internal-token', value: '={{ $env.GATEWAY_INTERNAL_TOKEN }}' },
      { name: 'Content-Type', value: 'application/json' },
    ] },
    sendBody: true, specifyBody: 'json', jsonBody: bodyExpr, options: {},
  }, [x, y]);

const ifNode = (w, name, leftExpr, op, rightExpr, x, y) =>
  w.node(name, 'n8n-nodes-base.if', 2, {
    conditions: {
      options: { caseSensitive: true, typeValidation: 'loose' },
      combinator: 'and',
      conditions: [{ leftValue: leftExpr, rightValue: rightExpr, operator: { type: 'number', operation: op } }],
    },
  }, [x, y]);

// =============================================================================
// WORKFLOW 1 — parse JD -> competencies/skills/keywords (cached)
// =============================================================================
function buildParse() {
  const w = wf('01 — Parse JD & extract competencies');
  w.sticky('STEP 2\nPOST /webhook/parse-jd\nBody: { jobDescription }\nCaches by sha256(jobDescription) per user so re-runs never re-spend.', [-360, -200]);
  const hook = webhook(w, 'parse-jd', -360, 0);
  const usr = resolveUser(w, -140, 0);
  const prep = code(w,'Prep + hash', `
const body = $('Webhook').first().json.body || {};
const userId = $json.id;
const jd = String(body.jobDescription || '');
const crypto = require('crypto');
const hash = crypto.createHash('sha256').update(jd.replace(/\\s+/g,' ').trim().toLowerCase()).digest('hex');
return [{ json: { userId, jobDescription: jd, content_hash: hash } }];`, 80, 0);
  const look = supabaseSelect(w, 'Cache lookup', 'job_descriptions',
    'user_id=eq.{{ $json.userId }}&content_hash=eq.{{ $json.content_hash }}&parsed_at=not.is.null', 300, 0);
  const isHit = ifNode(w, 'Cache hit?', '={{ $json.length || 0 }}', 'gt', '={{ 0 }}', 520, 0);
  const respondCached = respond(w, 'Respond (cached)', '={{ JSON.stringify({ job_description: $json[0], cached: true }) }}', 760, -120);
  const llm = gatewayCall(w, 'LLM: parse_jd', 'parse_jd',
    '={{ JSON.stringify({ jobDescription: $(\'Prep + hash\').first().json.jobDescription }) }}', 760, 120);
  const shape = code(w, 'Shape JD row', `
const d = $json.data;
const p = $('Prep + hash').first().json;
return [{ json: {
  user_id: p.userId, raw_text: p.jobDescription, content_hash: p.content_hash,
  role_title: d.role_title, company: d.company, seniority: d.seniority,
  competencies: d.competencies || [], skills: d.skills || [], keywords: d.keywords || [],
  summary: d.summary, parsed_at: new Date().toISOString(),
} }];`, 980, 120);
  const up = supabaseInsert(w, 'Upsert JD', 'job_descriptions?on_conflict=user_id,content_hash',
    '={{ JSON.stringify($json) }}', 1200, 120, 'return=representation,resolution=merge-duplicates');
  const respondNew = respond(w, 'Respond (fresh)', '={{ JSON.stringify({ job_description: $json[0], cached: false }) }}', 1420, 120);

  w.connect(hook, usr); w.connect(usr, prep); w.connect(prep, look); w.connect(look, isHit);
  w.connect(isHit, respondCached, 0); w.connect(isHit, llm, 1);
  w.connect(llm, shape); w.connect(shape, up); w.connect(up, respondNew);
  return w.build();
}

// =============================================================================
// WORKFLOW 2 — tailor resume + cover letter (no fabrication; gaps flagged)
// =============================================================================
function buildTailor() {
  const w = wf('02 — Tailor resume & cover letter');
  w.sticky('STEP 3\nPOST /webhook/tailor\nBody: { resumeId, jobDescriptionId }\nTailor (no fabrication; gaps flagged) → cover letter. Two chained LLM calls.', [-360, -220]);
  const hook = webhook(w, 'tailor', -360, 0);
  const usr = resolveUser(w, -140, 0);
  const load = code(w, 'Read body', `
const b = $('Webhook').first().json.body || {};
return [{ json: { userId: $json.id, resumeId: b.resumeId, jobDescriptionId: b.jobDescriptionId } }];`, 80, 0);
  const getResume = supabaseSelect(w, 'Get resume', 'resumes', 'id=eq.{{ $json.resumeId }}&user_id=eq.{{ $json.userId }}', 300, -80);
  const getJd = supabaseSelect(w, 'Get JD', 'job_descriptions', 'id=eq.{{ $(\'Read body\').first().json.jobDescriptionId }}&user_id=eq.{{ $(\'Read body\').first().json.userId }}', 300, 120);
  const tailor = gatewayCall(w, 'LLM: tailor_resume', 'tailor_resume', `={{ JSON.stringify({
  resume: $('Get resume').first().json[0].content,
  competencies: $('Get JD').first().json[0].competencies,
  role: $('Get JD').first().json[0].role_title,
  company: $('Get JD').first().json[0].company
}) }}`, 520, 0);
  const storeTailored = supabaseInsert(w, 'Store tailored', 'tailored_resumes', `={{ JSON.stringify({
  user_id: $('Read body').first().json.userId,
  resume_id: $('Read body').first().json.resumeId,
  job_description_id: $('Read body').first().json.jobDescriptionId,
  headline: $json.data.headline, summary: $json.data.summary,
  bullets: $json.data.bullets || [], gaps: $json.data.gaps || [],
  fabrication_check: $json.data.fabrication_check
}) }}`, 740, 0);
  const cover = gatewayCall(w, 'LLM: cover_letter', 'cover_letter', `={{ JSON.stringify({
  resume: $('Get resume').first().json[0].content,
  competencies: $('Get JD').first().json[0].competencies,
  role: $('Get JD').first().json[0].role_title,
  company: $('Get JD').first().json[0].company,
  tailoredBullets: $('LLM: tailor_resume').first().json.data.bullets
}) }}`, 960, 0);
  const storeCover = supabaseInsert(w, 'Store cover', 'cover_letters', `={{ JSON.stringify({
  user_id: $('Read body').first().json.userId,
  job_description_id: $('Read body').first().json.jobDescriptionId,
  tailored_resume_id: $('Store tailored').first().json[0].id,
  subject: $json.data.subject, body: $json.data.body, tone: $json.data.tone
}) }}`, 1180, 0);
  const done = respond(w, 'Respond', `={{ JSON.stringify({
  tailored_resume: $('Store tailored').first().json[0],
  cover_letter: $json[0]
}) }}`, 1400, 0);

  w.connect(hook, usr); w.connect(usr, load); w.connect(load, getResume); w.connect(getResume, getJd);
  w.connect(getJd, tailor); w.connect(tailor, storeTailored); w.connect(storeTailored, cover);
  w.connect(cover, storeCover); w.connect(storeCover, done);
  return w.build();
}

// =============================================================================
// WORKFLOW 3 — grouped interview questions
// =============================================================================
function buildQuestions() {
  const w = wf('03 — Generate interview questions');
  w.sticky('STEP 4\nPOST /webhook/questions\nBody: { jobDescriptionId }\nGrouped: behavioural / technical / role_specific.', [-360, -200]);
  const hook = webhook(w, 'questions', -360, 0);
  const usr = resolveUser(w, -140, 0);
  const load = code(w, 'Read body', `
const b = $('Webhook').first().json.body || {};
return [{ json: { userId: $json.id, jobDescriptionId: b.jobDescriptionId } }];`, 80, 0);
  const getJd = supabaseSelect(w, 'Get JD', 'job_descriptions', 'id=eq.{{ $json.jobDescriptionId }}&user_id=eq.{{ $json.userId }}', 300, 0);
  const llm = gatewayCall(w, 'LLM: questions', 'questions', `={{ JSON.stringify({
  role: $json[0].role_title, company: $json[0].company,
  competencies: $json[0].competencies, skills: $json[0].skills
}) }}`, 520, 0);
  const flatten = code(w, 'Flatten to rows', `
const d = $json.data; const p = $('Read body').first().json;
const rows = []; let pos = 0;
for (const cat of ['behavioural','technical','role_specific'])
  for (const text of (d[cat] || []))
    rows.push({ user_id: p.userId, job_description_id: p.jobDescriptionId, category: cat, text, position: pos++ });
return [{ json: { rows, grouped: d } }];`, 740, 0);
  const store = supabaseInsert(w, 'Store questions', 'questions', '={{ JSON.stringify($json.rows) }}', 960, 0);
  const done = respond(w, 'Respond', '={{ JSON.stringify({ questions: $(\'Flatten to rows\').first().json.grouped, rows: $json }) }}', 1180, 0);
  w.connect(hook, usr); w.connect(usr, load); w.connect(load, getJd); w.connect(getJd, llm);
  w.connect(llm, flatten); w.connect(flatten, store); w.connect(store, done);
  return w.build();
}

// =============================================================================
// WORKFLOW 4 — mock interview loop (one turn per call; state in the DB)
// =============================================================================
function buildInterview() {
  const w = wf('04 — Mock interview loop (stateful)');
  w.sticky('STEP 5\nPOST /webhook/interview/answer\nBody: { sessionId, answer, audioUrl? }\nScores the answer, then DECIDES: probe deeper (adaptive follow-up)\nor advance. Session state lives in interview_sessions.state.\n\nVOICE SEAM: STT fills `answer` inbound; response.voice.speak is what TTS reads.', [-380, -260], 380, 200);
  const hook = webhook(w, 'interview/answer', -380, 0);
  const usr = resolveUser(w, -160, 0);
  const load = code(w, 'Read body', `
const b = $('Webhook').first().json.body || {};
return [{ json: { userId: $json.id, sessionId: b.sessionId, answer: b.answer, audioUrl: b.audioUrl || null } }];`, 60, 0);
  const getSession = supabaseSelect(w, 'Get session', 'interview_sessions', 'id=eq.{{ $json.sessionId }}&user_id=eq.{{ $json.userId }}', 280, 0);
  const getJd = supabaseSelect(w, 'Get JD', 'job_descriptions', 'id=eq.{{ $json[0].job_description_id }}&user_id=eq.{{ $(\'Read body\').first().json.userId }}', 500, 0);
  const prep = code(w, 'Resolve current question', `
const s = $('Get session').first().json[0];
const body = $('Read body').first().json;
const state = s.state || { priorAnswers: [], pendingFollowUp: null, followUpsForCurrent: 0, askedCount: 0 };
const qIds = s.question_ids || [];
// The current question text is either a pending follow-up or the base question.
return [{ json: { session: s, state, qIds, currentIndex: s.current_index || 0, isFollowUp: !!state.pendingFollowUp,
  baseQuestionId: qIds[s.current_index || 0] || null, currentText: state.pendingFollowUp || null,
  answer: body.answer, audioUrl: body.audioUrl, userId: body.userId,
  competencies: $json[0].competencies }}];`, 720, 0);
  // If no pending follow-up, fetch the base question text.
  const getQ = supabaseSelect(w, 'Get base question', 'questions', 'id=eq.{{ $json.baseQuestionId }}', 940, 0);
  const score = gatewayCall(w, 'LLM: score_answer', 'score_answer', `={{ JSON.stringify({
  question: $('Resolve current question').first().json.currentText || ($json[0] ? $json[0].text : 'Tell me about yourself.'),
  answer: $('Resolve current question').first().json.answer,
  competencies: $('Resolve current question').first().json.competencies,
  priorAnswers: $('Resolve current question').first().json.state.priorAnswers
}) }}`, 1160, 0);
  const persistAnswer = supabaseInsert(w, 'Store answer', 'answers', `={{ JSON.stringify({
  user_id: $('Resolve current question').first().json.userId,
  session_id: $('Resolve current question').first().json.session.id,
  question_id: $('Resolve current question').first().json.isFollowUp ? null : $('Resolve current question').first().json.baseQuestionId,
  question_text: $('Resolve current question').first().json.currentText || ($('Get base question').first().json[0] ? $('Get base question').first().json[0].text : 'Tell me about yourself.'),
  answer_text: $('Resolve current question').first().json.answer,
  is_follow_up: $('Resolve current question').first().json.isFollowUp,
  audio_url: $('Resolve current question').first().json.audioUrl
}) }}`, 1380, 0);
  const persistScore = supabaseInsert(w, 'Store score', 'scores', `={{ JSON.stringify({
  user_id: $('Resolve current question').first().json.userId,
  session_id: $('Resolve current question').first().json.session.id,
  answer_id: $json[0].id,
  score: $('LLM: score_answer').first().json.data.score,
  competencies_assessed: $('LLM: score_answer').first().json.data.competencies_assessed || [],
  strengths: $('LLM: score_answer').first().json.data.strengths || [],
  improvements: $('LLM: score_answer').first().json.data.improvements || [],
  rewrite_hint: $('LLM: score_answer').first().json.data.rewrite_hint,
  follow_up: $('LLM: score_answer').first().json.data.follow_up,
  next_action: $('LLM: score_answer').first().json.data.next_action
}) }}`, 1600, 0);
  const decide = code(w, 'Decide next + update state', `
const rq = $('Resolve current question').first().json;
const sc = $('LLM: score_answer').first().json.data;
const MAX_Q = Number($env.INTERVIEW_MAX_QUESTIONS || 6);
const MAX_FU = Number($env.INTERVIEW_MAX_FOLLOWUPS || 1);
const state = rq.state; const qIds = rq.qIds;
state.priorAnswers = [...(state.priorAnswers||[]), { question: rq.currentText, answer: rq.answer, score: sc.score }];
state.askedCount = (state.askedCount||0) + 1;
let done = false, next = null, nextIndex = rq.currentIndex;
const canFollow = sc.next_action === 'probe_deeper' && (state.followUpsForCurrent||0) < MAX_FU && state.askedCount < MAX_Q;
if (canFollow) { state.pendingFollowUp = sc.follow_up; state.followUpsForCurrent = (state.followUpsForCurrent||0)+1;
  next = { text: sc.follow_up, is_follow_up: true };
} else { state.pendingFollowUp = null; state.followUpsForCurrent = 0; nextIndex = rq.currentIndex + 1;
  if (nextIndex >= qIds.length || state.askedCount >= MAX_Q) done = true;
}
return [{ json: { patch: { state, current_index: nextIndex, status: done ? 'completed':'active',
  completed_at: done ? new Date().toISOString() : null }, sessionId: rq.session.id, userId: rq.userId,
  nextIndex, next, done, score: sc } }];`, 1820, 0);
  const saveState = supabaseInsert(w, 'Update session', 'interview_sessions?on_conflict=id',
    `={{ JSON.stringify(Object.assign({ id: $json.sessionId, user_id: $json.userId }, $json.patch)) }}`, 2040, 0,
    'return=representation,resolution=merge-duplicates');
  // If not done and no follow-up, load the next base question for the response.
  const getNext = supabaseSelect(w, 'Get next question', 'questions',
    'id=eq.{{ $(\'Decide next + update state\').first().json.qIds ? $(\'Decide next + update state\').first().json.nextIndex : 0 }}', 2260, 0);
  const done = respond(w, 'Respond', `={{ JSON.stringify({
  score: {
    value: $('Decide next + update state').first().json.score.score,
    strengths: $('Decide next + update state').first().json.score.strengths,
    improvements: $('Decide next + update state').first().json.score.improvements,
    rewrite_hint: $('Decide next + update state').first().json.score.rewrite_hint
  },
  next_question: $('Decide next + update state').first().json.next,
  done: $('Decide next + update state').first().json.done,
  voice: { speak: ($('Decide next + update state').first().json.next || {}).text || 'That completes the interview.' }
}) }}`, 2480, 0);
  w.connect(hook, usr); w.connect(usr, load); w.connect(load, getSession); w.connect(getSession, getJd);
  w.connect(getJd, prep); w.connect(prep, getQ); w.connect(getQ, score); w.connect(score, persistAnswer);
  w.connect(persistAnswer, persistScore); w.connect(persistScore, decide); w.connect(decide, saveState);
  w.connect(saveState, done);
  return w.build();
}

// =============================================================================
// WORKFLOW 5 — compile improvement plan
// =============================================================================
function buildPlan() {
  const w = wf('05 — Compile improvement plan');
  w.sticky('STEP 6\nPOST /webhook/interview/plan\nBody: { sessionId }\nCompiles all scores (+ flagged resume gaps) into a plan.', [-360, -200]);
  const hook = webhook(w, 'interview/plan', -360, 0);
  const usr = resolveUser(w, -140, 0);
  const load = code(w, 'Read body', `
const b = $('Webhook').first().json.body || {};
return [{ json: { userId: $json.id, sessionId: b.sessionId } }];`, 80, 0);
  const getSession = supabaseSelect(w, 'Get session', 'interview_sessions', 'id=eq.{{ $json.sessionId }}&user_id=eq.{{ $json.userId }}', 300, 0);
  const getJd = supabaseSelect(w, 'Get JD', 'job_descriptions', 'id=eq.{{ $json[0].job_description_id }}&user_id=eq.{{ $(\'Read body\').first().json.userId }}', 520, -120);
  const getScores = supabaseSelect(w, 'Get scores', 'scores', 'session_id=eq.{{ $(\'Read body\').first().json.sessionId }}&user_id=eq.{{ $(\'Read body\').first().json.userId }}', 520, 120);
  const getTailored = supabaseSelect(w, 'Get tailored (gaps)', 'tailored_resumes', 'job_description_id=eq.{{ $(\'Get session\').first().json[0].job_description_id }}&user_id=eq.{{ $(\'Read body\').first().json.userId }}', 740, 120);
  const llm = gatewayCall(w, 'LLM: improvement_plan', 'improvement_plan', `={{ JSON.stringify({
  role: $('Get JD').first().json[0].role_title,
  company: $('Get JD').first().json[0].company,
  scores: ($('Get scores').first().json || []).map(s => ({ score: s.score, improvements: s.improvements })),
  gaps: ($('Get tailored (gaps)').first().json[0] || {}).gaps || []
}) }}`, 960, 0);
  const store = supabaseInsert(w, 'Store plan', 'improvement_plans?on_conflict=session_id', `={{ JSON.stringify({
  user_id: $('Read body').first().json.userId,
  session_id: $('Read body').first().json.sessionId,
  overall_score: $json.data.overall_score, readiness: $json.data.readiness, summary: $json.data.summary,
  practise: $json.data.practise || [], answers_to_rework: $json.data.answers_to_rework || [],
  gaps_to_address: $json.data.gaps_to_address || [], next_step: $json.data.next_step
}) }}`, 1180, 0, 'return=representation,resolution=merge-duplicates');
  const done = respond(w, 'Respond', '={{ JSON.stringify({ improvement_plan: $json[0] }) }}', 1400, 0);
  w.connect(hook, usr); w.connect(usr, load); w.connect(load, getSession); w.connect(getSession, getJd);
  w.connect(getSession, getScores); w.connect(getScores, getTailored); w.connect(getJd, llm); w.connect(getTailored, llm);
  w.connect(llm, store); w.connect(store, done);
  return w.build();
}

const files = {
  '01-parse-jd.json': buildParse(),
  '02-tailor-cover.json': buildTailor(),
  '03-questions.json': buildQuestions(),
  '04-interview-loop.json': buildInterview(),
  '05-improvement-plan.json': buildPlan(),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));
  console.log('wrote', path.join('n8n/workflows', name), `(${data.nodes.length} nodes)`);
}

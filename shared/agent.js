'use strict';
/**
 * The atomic agent steps. Each one: builds messages (from prompts.js), calls
 * the LLM boundary (llm.js — mock/live/fallback), and parses the structured
 * result. The CHAINING (which step feeds which, session state, the interview
 * loop) lives in the orchestrator (n8n, or orchestrator-dev as its stand-in) —
 * these are the reusable building blocks it calls.
 */
const { chat } = require('./llm');
const { prompts } = require('./prompts');

/** Parse model output that should be JSON, tolerating code fences / stray prose. */
function parseJson(content, task) {
  if (content && typeof content === 'object') return content;
  let text = String(content || '').trim();
  // Strip ```json ... ``` fences if a model added them.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    // Last resort: grab the outermost {...}.
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {
        /* fall through */
      }
    }
    const err = new Error(`Model returned non-JSON for task "${task}"`);
    err.status = 502;
    err.code = 'bad_model_output';
    err.raw = text.slice(0, 500);
    throw err;
  }
}

async function run(task, promptInput, context, opts = {}) {
  const messages = prompts[task](promptInput);
  const result = await chat({ task, messages, context, ...opts });
  const data = parseJson(result.content, task);
  return { data, meta: { provider: result.provider, model: result.model, mock: result.mock, usage: result.usage } };
}

// ── Step functions (each returns { data, meta }) ────────────────────────────

// Step 2: parse JD -> competencies / skills / keywords
function parseJobDescription({ jobDescription }) {
  return run('parse_jd', { jobDescription }, { jobDescription });
}

// Step 3a: tailor resume (no fabrication; gaps flagged)
function tailorResume({ resume, competencies, role, company }) {
  return run('tailor_resume', { resume, competencies, role, company }, { resume, competencies, role, company });
}

// Step 3b: cover letter
function coverLetter({ resume, competencies, role, company, candidateName, tailoredBullets }) {
  return run(
    'cover_letter',
    { resume, competencies, role, company, candidateName, tailoredBullets },
    { resume, competencies, role, company, candidateName, tailoredBullets }
  );
}

// Step 4: grouped interview questions
function generateQuestions({ role, company, competencies, skills }) {
  return run('questions', { role, company, competencies, skills }, { role, company, competencies, skills });
}

// Step 5: score an answer + adaptive follow-up + next-action decision
function scoreAnswer({ question, answer, competencies, priorAnswers }) {
  return run(
    'score_answer',
    { question, answer, competencies, priorAnswers },
    { question, answer, competencies, priorAnswers },
    { temperature: 0.3 }
  );
}

// Step 6: compile improvement plan
function improvementPlan({ role, company, scores, gaps }) {
  return run('improvement_plan', { role, company, scores, gaps }, { role, company, scores, gaps });
}

const TASKS = {
  parse_jd: parseJobDescription,
  tailor_resume: tailorResume,
  cover_letter: coverLetter,
  questions: generateQuestions,
  score_answer: scoreAnswer,
  improvement_plan: improvementPlan,
};

module.exports = {
  parseJson,
  parseJobDescription,
  tailorResume,
  coverLetter,
  generateQuestions,
  scoreAnswer,
  improvementPlan,
  TASKS,
};

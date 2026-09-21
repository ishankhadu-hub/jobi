'use strict';
/**
 * ALL prompts live here, in one place, so they can be reviewed and tuned
 * without hunting through n8n nodes. Each task returns OpenAI-style messages.
 *
 * Every prompt demands strict JSON output (we also pass response_format:
 * json_object to providers that support it) so the parsing path is stable.
 */

const JSON_ONLY = 'Respond with ONLY valid minified JSON. No prose, no markdown, no code fences.';

const prompts = {
  parse_jd({ jobDescription }) {
    return [
      {
        role: 'system',
        content:
          'You are an expert technical recruiter. Extract what a job description is REALLY asking for. ' +
          JSON_ONLY,
      },
      {
        role: 'user',
        content:
          `Analyse this job description. Return JSON with keys: ` +
          `role_title (string), company (string), seniority (string), ` +
          `competencies (array of 5-8 short strings — the underlying abilities), ` +
          `skills (array of concrete skills/tools), keywords (array for ATS matching), ` +
          `summary (2 sentences).\n\nJOB DESCRIPTION:\n"""\n${jobDescription}\n"""`,
      },
    ];
  },

  tailor_resume({ resume, competencies, role, company }) {
    return [
      {
        role: 'system',
        content:
          'You are a resume coach. You REORDER, REWORD and SURFACE the candidate\'s existing experience ' +
          'to match a target role. ABSOLUTE RULE: never invent experience, employers, titles, dates, ' +
          'metrics or skills the candidate does not already have. If a required competency has no support ' +
          'in the resume, DO NOT fake it — flag it as a gap. ' +
          JSON_ONLY,
      },
      {
        role: 'user',
        content:
          `Target role: ${role} at ${company}.\n` +
          `Target competencies: ${JSON.stringify(competencies)}.\n\n` +
          `Rewrite the resume tailored to this role. Return JSON with keys: ` +
          `headline (string), summary (string), ` +
          `bullets (array of {text, original, aligned_competency|null, surfaced:boolean} — "original" MUST be the ` +
          `source line the bullet came from, proving no fabrication), ` +
          `gaps (array of {competency, note} for competencies with NO evidence in the resume), ` +
          `fabrication_check (string confirming every bullet traces to the source).\n\n` +
          `CANDIDATE RESUME:\n"""\n${resume}\n"""`,
      },
    ];
  },

  cover_letter({ resume, competencies, role, company, candidateName, tailoredBullets }) {
    return [
      {
        role: 'system',
        content:
          'You write concise, specific cover letters grounded ONLY in the candidate\'s real experience. ' +
          'No fabrication. ' +
          JSON_ONLY,
      },
      {
        role: 'user',
        content:
          `Write a cover letter for ${role} at ${company}. Candidate name: ${candidateName || '[Your name]'}.\n` +
          `Lean on these real strengths: ${JSON.stringify((tailoredBullets || []).slice(0, 3))}.\n` +
          `Target competencies: ${JSON.stringify(competencies)}.\n` +
          `Return JSON with keys: subject (string), body (string, 3 short paragraphs, signed), tone (string).\n\n` +
          `RESUME (for grounding, do not invent beyond it):\n"""\n${resume}\n"""`,
      },
    ];
  },

  questions({ role, company, competencies, skills }) {
    return [
      {
        role: 'system',
        content:
          'You are an interviewer preparing a candidate. Generate likely questions for a SPECIFIC role and company. ' +
          JSON_ONLY,
      },
      {
        role: 'user',
        content:
          `Role: ${role} at ${company}. Competencies: ${JSON.stringify(competencies)}. Skills: ${JSON.stringify(skills)}.\n` +
          `Return JSON with keys: behavioural (array), technical (array), role_specific (array). ` +
          `3-5 questions per group, tailored to this exact role and company.`,
      },
    ];
  },

  score_answer({ question, answer, competencies, priorAnswers }) {
    return [
      {
        role: 'system',
        content:
          'You are a rigorous but constructive interview coach. Score an answer against the role competencies ' +
          'and give SPECIFIC, ACTIONABLE feedback — never just a number. Then decide the next move. ' +
          JSON_ONLY,
      },
      {
        role: 'user',
        content:
          `Question: ${question}\nCompetencies this probes: ${JSON.stringify(competencies)}\n` +
          (priorAnswers && priorAnswers.length ? `Context from earlier answers: ${JSON.stringify(priorAnswers)}\n` : '') +
          `Candidate answer:\n"""\n${answer}\n"""\n\n` +
          `Return JSON with keys: score (0-100 int), competencies_assessed (array), ` +
          `strengths (array of strings), improvements (array of specific fixes), ` +
          `rewrite_hint (string), follow_up (string — an adaptive follow-up question based on THIS answer), ` +
          `next_action ("advance" | "probe_deeper").`,
      },
    ];
  },

  improvement_plan({ role, company, scores, gaps }) {
    return [
      {
        role: 'system',
        content:
          'You are a coach compiling a pre-interview improvement plan from a candidate\'s mock-interview scores. ' +
          JSON_ONLY,
      },
      {
        role: 'user',
        content:
          `Role: ${role} at ${company}.\nScores: ${JSON.stringify(scores)}\nFlagged resume gaps: ${JSON.stringify(gaps)}\n\n` +
          `Return JSON with keys: overall_score (int), readiness (string), summary (string), ` +
          `practise (array of concrete actions), answers_to_rework (array of {question, why}), ` +
          `gaps_to_address (array of strings), next_step (string).`,
      },
    ];
  },
};

module.exports = { prompts };

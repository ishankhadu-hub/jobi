'use strict';
/**
 * Canned-but-realistic LLM responses for MOCK_MODE.
 *
 * These run at the LLM-call boundary: `llm.chat()` returns one of these instead
 * of hitting a provider. Crucially they are derived from the REAL input (JD
 * text, resume, the user's actual answer) and returned as the SAME JSON shape a
 * live model would produce — so the parsing/UI path is identical in mock and
 * live, and the canned data feels real while you build.
 *
 * Every generator returns a STRING (the assistant message content). The agent
 * layer JSON.parses it exactly as it would a real completion.
 */

// A small, extensible dictionary of skills/keywords we recognise in free text.
const SKILL_DICTIONARY = [
  'javascript', 'typescript', 'python', 'go', 'golang', 'java', 'kotlin', 'swift',
  'ruby', 'rust', 'c++', 'react', 'react native', 'expo', 'node', 'node.js',
  'express', 'next.js', 'vue', 'angular', 'postgres', 'postgresql', 'mysql',
  'mongodb', 'redis', 'sql', 'graphql', 'rest', 'grpc', 'kafka', 'rabbitmq',
  'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'terraform', 'ci/cd',
  'microservices', 'distributed systems', 'machine learning', 'nlp', 'llm',
  'data pipeline', 'etl', 'agile', 'scrum', 'leadership', 'mentoring',
  'stakeholder management', 'product', 'roadmap', 'a/b testing', 'analytics',
  'figma', 'design systems', 'accessibility', 'testing', 'jest', 'cypress',
  'observability', 'monitoring', 'security', 'oauth', 'jwt', 'payments',
  'stripe', 'communication', 'collaboration', 'ownership', 'customer',
];

function lc(s) {
  return String(s || '').toLowerCase();
}
function uniq(arr) {
  return [...new Set(arr)];
}
function titleCase(s) {
  return String(s || '')
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function extractSkills(text) {
  const t = lc(text);
  const found = SKILL_DICTIONARY.filter((k) => t.includes(k));
  // Also grab a few Capitalised Multiword Phrases that look like tech/competencies.
  const caps = (String(text).match(/\b([A-Z][a-zA-Z0-9+.#]+(?:\s+[A-Z][a-zA-Z0-9+.#]+){0,2})\b/g) || [])
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && !/^(The|And|You|We|Our|Your|A|An|In|On|For|With|To)$/i.test(s));
  return uniq([...found.map(titleCase), ...caps]).slice(0, 18);
}

function guessRole(jd) {
  const ROLE = '([A-Z][\\w/+-]*(?:[ \\t]+[A-Za-z][\\w/+-]*){0,4})';
  const m =
    String(jd).match(new RegExp('^\\s*' + ROLE + '(?:\\n| at | -| –)')) ||
    String(jd).match(new RegExp('(?:hiring|seeking|looking for)\\s+(?:an?\\s+)?' + ROLE)) ||
    String(jd).match(new RegExp('(?:role|position)\\s+of\\s+(?:an?\\s+)?' + ROLE));
  let role = (m && m[1] ? m[1] : 'the role').trim().replace(/\s+/g, ' ');
  // Trim a trailing clause the greedy match may pick up.
  role = role.replace(/\s+(to|who|that|for|at|in|involves?|will|is|are|and|with)\b.*$/i, '');
  return role;
}
function guessCompany(jd) {
  // Inner word separators are spaces/tabs only, so a match never crosses a newline.
  const CO = '([A-Z][A-Za-z0-9&]+(?:[ \\t]+[A-Z][A-Za-z0-9&]+){0,3})';
  const m =
    String(jd).match(new RegExp('\\bat[ \\t]+' + CO)) ||
    String(jd).match(new RegExp(CO + '[ \\t]+is[ \\t]+(?:hiring|looking|seeking)'));
  return (m && m[1] ? m[1] : 'the company').split(/[\r\n]/)[0].trim().replace(/[.,]$/, '');
}

// Split a resume into "experience lines" we can reorder/reword (never invent).
// We skip header/contact lines (name, email, phone) so they aren't reframed as
// achievement bullets.
function resumeLines(resume) {
  const HEADER = /@|https?:|www\.|\+?\d[\d ()-]{6,}|linkedin|github/i;
  return String(resume)
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s•\-*]+/, '').trim())
    .filter((l) => {
      if (l.length <= 3) return false;
      if (HEADER.test(l)) return false; // contact lines
      const words = l.split(/\s+/).length;
      const hasDigit = /\d/.test(l);
      // A real achievement bullet: several words, or contains a metric.
      return words >= 4 || hasDigit;
    });
}

function relevanceScore(line, competencies) {
  const t = lc(line);
  return competencies.reduce((acc, c) => (t.includes(lc(c)) ? acc + 1 : acc), 0);
}

const STRONG_VERBS = ['Led', 'Built', 'Drove', 'Delivered', 'Owned', 'Scaled', 'Shipped', 'Improved'];

const generators = {
  parse_jd(context) {
    const jd = context.jobDescription || context.jd || '';
    const skills = extractSkills(jd);
    const role = guessRole(jd);
    const company = guessCompany(jd);
    const competencies = uniq(
      skills
        .slice(0, 8)
        .map((s) => `${s} proficiency`)
        .concat(['Clear communication', 'Ownership & autonomy', 'Collaboration across teams'])
    ).slice(0, 8);
    return JSON.stringify({
      role_title: role,
      company: company,
      seniority: /senior|staff|lead|principal/i.test(jd) ? 'senior' : 'mid',
      competencies,
      skills: skills.slice(0, 12),
      keywords: uniq(skills.concat(competencies.map((c) => c.split(' ')[0]))).slice(0, 20),
      summary: `This role at ${company} centres on ${skills.slice(0, 3).join(', ') || 'core delivery skills'}. ` +
        `It expects someone who can ${competencies[0] ? competencies[0].toLowerCase() : 'own outcomes'} ` +
        `and work closely with other teams.`,
    });
  },

  tailor_resume(context) {
    const competencies = context.competencies || [];
    const lines = resumeLines(context.resume);
    // Reorder by relevance to the extracted competencies. DO NOT invent lines.
    const ranked = lines
      .map((line, i) => ({ line, i, score: relevanceScore(line, competencies) }))
      .sort((a, b) => b.score - a.score || a.i - b.i);

    const bullets = ranked.map((r, idx) => {
      // Reframe only: keep the original content, front-load a strong verb if the
      // line doesn't already start with one. No new facts are added.
      const startsWithVerb = STRONG_VERBS.some((v) => new RegExp('^' + v, 'i').test(r.line));
      const reframed = startsWithVerb ? r.line : `${STRONG_VERBS[idx % STRONG_VERBS.length]} ${r.line[0].toLowerCase()}${r.line.slice(1)}`;
      return {
        text: reframed,
        original: r.line,
        aligned_competency: competencies.find((c) => lc(r.line).includes(lc(c.split(' ')[0]))) || null,
        surfaced: r.score > 0,
      };
    });

    // Gaps = competencies with NO supporting evidence in the resume. Flagged,
    // never fabricated.
    const gaps = competencies
      .filter((c) => !lines.some((l) => lc(l).includes(lc(c.split(' ')[0]))))
      .map((c) => ({
        competency: c,
        note: `No direct evidence of "${c}" in your resume. Do not fabricate it — ` +
          `either add a real example if you have one, or prepare to address it as a growth area.`,
      }));

    return JSON.stringify({
      headline: `${titleCase(context.role || 'Candidate')} — tailored for ${context.company || 'this role'}`,
      summary:
        `Reordered and reframed your existing experience to lead with what ${context.company || 'this company'} ` +
        `is asking for. Nothing below was invented; gaps are flagged separately.`,
      bullets,
      gaps,
      fabrication_check: 'PASS — all bullets trace to a line in the source resume (see each bullet.original).',
    });
  },

  cover_letter(context) {
    const company = context.company || 'your company';
    const role = context.role || 'this role';
    const top = (context.competencies || []).slice(0, 3);
    const strengths = (context.tailoredBullets || []).slice(0, 2).map((b) => (b.text || b)).filter(Boolean);
    return JSON.stringify({
      subject: `Application for ${role} at ${company}`,
      body:
        `Dear Hiring Team at ${company},\n\n` +
        `I'm excited to apply for the ${role} position. Your emphasis on ${top.join(', ') || 'strong delivery'} ` +
        `maps closely to how I've worked.\n\n` +
        (strengths.length
          ? `A couple of relevant highlights from my background: ${strengths.join('; ')}.\n\n`
          : '') +
        `I'd welcome the chance to go deeper on how I can contribute to ${company}'s goals. ` +
        `Thank you for your consideration.\n\nSincerely,\n${context.candidateName || '[Your name]'}`,
      tone: 'confident, specific, no fabrication',
    });
  },

  questions(context) {
    const role = context.role || 'the role';
    const company = context.company || 'the company';
    const comps = context.competencies || [];
    const skills = context.skills || [];
    const pick = (arr, i, d) => arr[i] || d;
    return JSON.stringify({
      behavioural: [
        `Tell me about a time you demonstrated ${pick(comps, 0, 'ownership')} under pressure.`,
        `Describe a conflict with a teammate and how you resolved it.`,
        `Walk me through a project you're most proud of and your specific contribution.`,
        `Tell me about a time you failed and what you changed afterward.`,
      ],
      technical: [
        `How would you approach building a feature that relies on ${pick(skills, 0, 'our core stack')}?`,
        `Explain a tradeoff you made involving ${pick(skills, 1, 'performance vs. simplicity')}.`,
        `How do you ensure quality with ${pick(skills, 2, 'testing and reviews')}?`,
        `Design a small system for ${company}'s use case — what components and why?`,
      ],
      role_specific: [
        `Why ${company} specifically, and why the ${role} role now?`,
        `What would your first 90 days as ${role} at ${company} look like?`,
        `Which of the competencies we listed (${comps.slice(0, 3).join(', ') || 'the core ones'}) is your strongest, and how do you know?`,
      ],
    });
  },

  score_answer(context) {
    const answer = String(context.answer || '');
    const competencies = context.competencies || [];
    const words = answer.trim().split(/\s+/).filter(Boolean).length;
    const usesSTAR = /(situation|task|action|result|because|so that|led to|resulted)/i.test(answer);
    const overlap = competencies.filter((c) => lc(answer).includes(lc(c.split(' ')[0])));
    // Deterministic-ish score from real signal in the answer.
    let score = 40 + Math.min(30, words) + (usesSTAR ? 12 : 0) + overlap.length * 5;
    score = Math.max(10, Math.min(96, score));

    const strengths = [];
    const improvements = [];
    if (words >= 40) strengths.push('Good level of detail — you gave a concrete, non-generic answer.');
    else improvements.push('Answer was short. Add a concrete example with specifics (numbers, outcome).');
    if (usesSTAR) strengths.push('Nice structure — situation → action → result came through.');
    else improvements.push('Use a STAR structure: Situation, Task, Action, Result. Right now the result is unclear.');
    if (overlap.length) strengths.push(`You touched the target competency "${overlap[0]}".`);
    else if (competencies.length) improvements.push(`Tie the answer back to "${competencies[0]}", which this role cares about.`);

    return JSON.stringify({
      score,
      competencies_assessed: competencies.slice(0, 3),
      strengths,
      improvements,
      rewrite_hint:
        'Open with the situation in one line, state the action YOU took (not "we"), and end with a measurable result. ' +
        (overlap.length ? '' : `Explicitly name how it shows ${competencies[0] || 'the target competency'}.`),
      // Follow-up is kept consistent with next_action so the loop reads coherently.
      follow_up:
        score >= 70
          ? `Good — what would you do differently if you had to do it again, and why?`
          : `Can you give a specific example with a concrete outcome? What changed as a result of what you did?`,
      // The follow-up decision is separate data the interview loop can act on.
      next_action: score >= 70 ? 'advance' : 'probe_deeper',
    });
  },

  improvement_plan(context) {
    const scores = context.scores || [];
    const avg = scores.length ? Math.round(scores.reduce((a, s) => a + (s.score || 0), 0) / scores.length) : 0;
    const weak = scores.filter((s) => (s.score || 0) < 70);
    const gaps = context.gaps || [];
    return JSON.stringify({
      overall_score: avg,
      readiness: avg >= 80 ? 'strong' : avg >= 65 ? 'nearly ready' : 'needs work',
      summary:
        `Across ${scores.length} answer(s) you averaged ${avg}/100. ` +
        (weak.length
          ? `${weak.length} answer(s) fell below the bar and are worth reworking before the real interview.`
          : `Solid consistency — tighten the edges and you're ready.`),
      practise: [
        'Re-record your two weakest answers using strict STAR and time yourself to 90 seconds.',
        'Prepare one concrete metric-backed story per target competency.',
        gaps.length
          ? `Prepare an honest way to address these flagged gaps: ${gaps.map((g) => g.competency || g).join(', ')}.`
          : 'Prepare a thoughtful "why this company" answer with specifics from their product.',
      ],
      answers_to_rework: weak.map((s) => ({
        question: s.question || '(question)',
        why: (s.improvements && s.improvements[0]) || 'Below target — add specifics and a clear result.',
      })),
      gaps_to_address: gaps.map((g) => g.competency || g),
      next_step: avg >= 80 ? 'Do one full timed mock, then rest before the interview.' : 'Rework the flagged answers, then run the mock again.',
    });
  },
};

/**
 * Return a canned assistant message for a task, derived from context.
 * Falls back to a generic JSON echo if the task is unknown.
 */
function mockContentFor(task, context = {}) {
  const gen = generators[task];
  if (gen) return gen(context);
  return JSON.stringify({ note: `mock response for task "${task}"`, echo: context });
}

module.exports = {
  mockContentFor,
  // exported for reuse/testing
  extractSkills,
  guessRole,
  guessCompany,
  resumeLines,
  SKILL_DICTIONARY,
};

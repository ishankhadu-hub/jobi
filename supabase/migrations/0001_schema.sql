-- =============================================================================
-- 0001_schema.sql — all tables for Jobi.
--
-- Supabase-native: this assumes the `auth` schema, `auth.users`, `auth.uid()`
-- and the `authenticated` role already exist (they do on Supabase, local or
-- hosted). RLS + policies are in 0002; triggers in 0003.
--
-- Ownership model: every user-data table carries `user_id uuid` referencing
-- auth.users(id). RLS (0002) restricts every row to its owner.
-- =============================================================================

-- gen_random_uuid() is built into Postgres 13+ (and Supabase). No extension needed.

-- ─────────────────────────────────────────────────────────────────────────────
-- users — a public profile row, 1:1 with auth.users. Kept separate from the
-- auth schema so the app can store profile fields without touching auth.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.users is 'Public profile, 1:1 with auth.users.';

-- ─────────────────────────────────────────────────────────────────────────────
-- resumes — the user's pasted resume(s). PII lives here.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.resumes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'My resume',
  content     text not null,                 -- raw pasted resume text
  source      text not null default 'paste', -- paste | upload | import
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists resumes_user_idx on public.resumes(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- job_descriptions — pasted JD + the extracted competencies/skills/keywords.
-- content_hash + unique(user_id, content_hash) gives us the JD-parse CACHE:
-- re-submitting an identical JD reuses the stored parse instead of re-spending.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.job_descriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  raw_text      text not null,
  content_hash  text not null,               -- sha256 of normalized raw_text
  role_title    text,
  company       text,
  seniority     text,
  competencies  jsonb not null default '[]'::jsonb,
  skills        jsonb not null default '[]'::jsonb,
  keywords      jsonb not null default '[]'::jsonb,
  summary       text,
  parsed_at     timestamptz,                 -- null until the parse workflow runs
  created_at    timestamptz not null default now(),
  unique (user_id, content_hash)
);
create index if not exists jd_user_idx on public.job_descriptions(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- tailored_resumes — output of the tailoring step. bullets + gaps are JSON.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.tailored_resumes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  resume_id           uuid not null references public.resumes(id) on delete cascade,
  job_description_id  uuid not null references public.job_descriptions(id) on delete cascade,
  headline            text,
  summary             text,
  bullets             jsonb not null default '[]'::jsonb, -- [{text, original, aligned_competency, surfaced}]
  gaps                jsonb not null default '[]'::jsonb, -- [{competency, note}] — flagged, never fabricated
  fabrication_check   text,
  created_at          timestamptz not null default now()
);
create index if not exists tailored_user_idx on public.tailored_resumes(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- cover_letters
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.cover_letters (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  job_description_id  uuid not null references public.job_descriptions(id) on delete cascade,
  tailored_resume_id  uuid references public.tailored_resumes(id) on delete set null,
  subject             text,
  body                text,
  tone                text,
  created_at          timestamptz not null default now()
);
create index if not exists cover_user_idx on public.cover_letters(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- interview_sessions — holds the mock-interview state BETWEEN turns.
-- `state` is the running context the loop reads/writes each turn.
-- `voice_enabled` is the VOICE SEAM flag (text-only for MVP; see 0003 / docs).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.interview_sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  job_description_id  uuid not null references public.job_descriptions(id) on delete cascade,
  status              text not null default 'active', -- active | completed | abandoned
  current_index       int  not null default 0,
  question_ids        jsonb not null default '[]'::jsonb, -- ordered plan of question ids
  state               jsonb not null default '{}'::jsonb, -- {asked:[], priorAnswers:[], pendingFollowUp:null}
  voice_enabled       boolean not null default false,     -- voice seam (off in MVP)
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  constraint interview_sessions_status_chk check (status in ('active','completed','abandoned'))
);
create index if not exists sessions_user_idx on public.interview_sessions(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- questions — generated interview questions, grouped by category.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.questions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  job_description_id  uuid not null references public.job_descriptions(id) on delete cascade,
  session_id          uuid references public.interview_sessions(id) on delete cascade,
  category            text not null, -- behavioural | technical | role_specific
  text                text not null,
  position            int not null default 0,
  created_at          timestamptz not null default now(),
  constraint questions_category_chk check (category in ('behavioural','technical','role_specific'))
);
create index if not exists questions_user_idx on public.questions(user_id);
create index if not exists questions_session_idx on public.questions(session_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- answers — the user's typed answers. audio_url reserved for the voice layer.
-- parent_answer_id links a follow-up answer back to the answer it probed.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.answers (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  session_id        uuid not null references public.interview_sessions(id) on delete cascade,
  question_id       uuid references public.questions(id) on delete set null,
  question_text     text not null,           -- snapshot (follow-ups have no question row)
  answer_text       text not null,
  turn_index        int not null default 0,
  is_follow_up      boolean not null default false,
  parent_answer_id  uuid references public.answers(id) on delete set null,
  audio_url         text,                     -- voice seam: STT source / recording
  created_at        timestamptz not null default now()
);
create index if not exists answers_user_idx on public.answers(user_id);
create index if not exists answers_session_idx on public.answers(session_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- scores — one per answer. Actionable feedback, not just a number.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.scores (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  session_id            uuid not null references public.interview_sessions(id) on delete cascade,
  answer_id             uuid not null references public.answers(id) on delete cascade,
  score                 int not null,
  competencies_assessed jsonb not null default '[]'::jsonb,
  strengths             jsonb not null default '[]'::jsonb,
  improvements          jsonb not null default '[]'::jsonb,
  rewrite_hint          text,
  follow_up             text,
  next_action           text,                -- advance | probe_deeper
  created_at            timestamptz not null default now(),
  constraint scores_range_chk check (score between 0 and 100)
);
create index if not exists scores_user_idx on public.scores(user_id);
create index if not exists scores_session_idx on public.scores(session_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- improvement_plans — compiled from all scores in a session.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.improvement_plans (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  session_id        uuid not null references public.interview_sessions(id) on delete cascade,
  overall_score     int,
  readiness         text,
  summary           text,
  practise          jsonb not null default '[]'::jsonb,
  answers_to_rework jsonb not null default '[]'::jsonb,
  gaps_to_address   jsonb not null default '[]'::jsonb,
  next_step         text,
  created_at        timestamptz not null default now(),
  unique (session_id)   -- one plan per session (enables upsert on session_id)
);
create index if not exists plans_user_idx on public.improvement_plans(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- subscriptions — 1:1 with user. Written by the Paddle webhook (service role).
-- loops_used drives the free-tier gate.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null unique references auth.users(id) on delete cascade,
  status                  text not null default 'free', -- free | active | past_due | canceled
  plan                    text,
  paddle_subscription_id  text,
  paddle_customer_id      text,
  current_period_end      timestamptz,
  loops_used              int not null default 0,
  updated_at              timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  constraint subscriptions_status_chk check (status in ('free','active','past_due','canceled'))
);
create index if not exists subs_user_idx on public.subscriptions(user_id);

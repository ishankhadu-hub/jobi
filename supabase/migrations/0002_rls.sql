-- =============================================================================
-- 0002_rls.sql — Row-Level Security. Every table gets RLS ENABLED and explicit
-- policies. Default-deny is the safety net: with RLS on and no matching policy,
-- access is refused. We still write explicit policies for every action so the
-- intent is auditable.
--
-- Rule: a user can read and write ONLY their own rows (auth.uid() = user_id).
-- The Paddle webhook uses the service role, which BYPASSES RLS — so
-- subscriptions have no client write policy (writes are server-only).
-- =============================================================================

-- Enable RLS on everything.
alter table public.users              enable row level security;
alter table public.resumes            enable row level security;
alter table public.job_descriptions   enable row level security;
alter table public.tailored_resumes   enable row level security;
alter table public.cover_letters      enable row level security;
alter table public.interview_sessions enable row level security;
alter table public.questions          enable row level security;
alter table public.answers            enable row level security;
alter table public.scores             enable row level security;
alter table public.improvement_plans  enable row level security;
alter table public.subscriptions      enable row level security;

-- Belt and braces: force RLS even for the table owner (except superuser/service
-- which bypass). Prevents accidental owner-context leaks.
alter table public.resumes            force row level security;
alter table public.job_descriptions   force row level security;
alter table public.tailored_resumes   force row level security;
alter table public.cover_letters      force row level security;
alter table public.interview_sessions force row level security;
alter table public.questions          force row level security;
alter table public.answers            force row level security;
alter table public.scores             force row level security;
alter table public.improvement_plans  force row level security;

-- ── users (keyed on id, not user_id) ────────────────────────────────────────
drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users
  for select to authenticated using (auth.uid() = id);
drop policy if exists users_insert_own on public.users;
create policy users_insert_own on public.users
  for insert to authenticated with check (auth.uid() = id);
drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- ── Helper note ─────────────────────────────────────────────────────────────
-- For every table below we create four explicit policies scoped to the
-- `authenticated` role: select/insert/update/delete, all keyed on
-- (auth.uid() = user_id). Anonymous users match no policy => denied.

-- resumes
drop policy if exists resumes_select_own on public.resumes;
create policy resumes_select_own on public.resumes for select to authenticated using (auth.uid() = user_id);
drop policy if exists resumes_insert_own on public.resumes;
create policy resumes_insert_own on public.resumes for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists resumes_update_own on public.resumes;
create policy resumes_update_own on public.resumes for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists resumes_delete_own on public.resumes;
create policy resumes_delete_own on public.resumes for delete to authenticated using (auth.uid() = user_id);

-- job_descriptions
drop policy if exists jd_select_own on public.job_descriptions;
create policy jd_select_own on public.job_descriptions for select to authenticated using (auth.uid() = user_id);
drop policy if exists jd_insert_own on public.job_descriptions;
create policy jd_insert_own on public.job_descriptions for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists jd_update_own on public.job_descriptions;
create policy jd_update_own on public.job_descriptions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists jd_delete_own on public.job_descriptions;
create policy jd_delete_own on public.job_descriptions for delete to authenticated using (auth.uid() = user_id);

-- tailored_resumes
drop policy if exists tailored_select_own on public.tailored_resumes;
create policy tailored_select_own on public.tailored_resumes for select to authenticated using (auth.uid() = user_id);
drop policy if exists tailored_insert_own on public.tailored_resumes;
create policy tailored_insert_own on public.tailored_resumes for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists tailored_update_own on public.tailored_resumes;
create policy tailored_update_own on public.tailored_resumes for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists tailored_delete_own on public.tailored_resumes;
create policy tailored_delete_own on public.tailored_resumes for delete to authenticated using (auth.uid() = user_id);

-- cover_letters
drop policy if exists cover_select_own on public.cover_letters;
create policy cover_select_own on public.cover_letters for select to authenticated using (auth.uid() = user_id);
drop policy if exists cover_insert_own on public.cover_letters;
create policy cover_insert_own on public.cover_letters for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists cover_update_own on public.cover_letters;
create policy cover_update_own on public.cover_letters for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists cover_delete_own on public.cover_letters;
create policy cover_delete_own on public.cover_letters for delete to authenticated using (auth.uid() = user_id);

-- interview_sessions
drop policy if exists sessions_select_own on public.interview_sessions;
create policy sessions_select_own on public.interview_sessions for select to authenticated using (auth.uid() = user_id);
drop policy if exists sessions_insert_own on public.interview_sessions;
create policy sessions_insert_own on public.interview_sessions for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists sessions_update_own on public.interview_sessions;
create policy sessions_update_own on public.interview_sessions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists sessions_delete_own on public.interview_sessions;
create policy sessions_delete_own on public.interview_sessions for delete to authenticated using (auth.uid() = user_id);

-- questions
drop policy if exists questions_select_own on public.questions;
create policy questions_select_own on public.questions for select to authenticated using (auth.uid() = user_id);
drop policy if exists questions_insert_own on public.questions;
create policy questions_insert_own on public.questions for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists questions_update_own on public.questions;
create policy questions_update_own on public.questions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists questions_delete_own on public.questions;
create policy questions_delete_own on public.questions for delete to authenticated using (auth.uid() = user_id);

-- answers
drop policy if exists answers_select_own on public.answers;
create policy answers_select_own on public.answers for select to authenticated using (auth.uid() = user_id);
drop policy if exists answers_insert_own on public.answers;
create policy answers_insert_own on public.answers for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists answers_update_own on public.answers;
create policy answers_update_own on public.answers for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists answers_delete_own on public.answers;
create policy answers_delete_own on public.answers for delete to authenticated using (auth.uid() = user_id);

-- scores
drop policy if exists scores_select_own on public.scores;
create policy scores_select_own on public.scores for select to authenticated using (auth.uid() = user_id);
drop policy if exists scores_insert_own on public.scores;
create policy scores_insert_own on public.scores for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists scores_update_own on public.scores;
create policy scores_update_own on public.scores for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists scores_delete_own on public.scores;
create policy scores_delete_own on public.scores for delete to authenticated using (auth.uid() = user_id);

-- improvement_plans
drop policy if exists plans_select_own on public.improvement_plans;
create policy plans_select_own on public.improvement_plans for select to authenticated using (auth.uid() = user_id);
drop policy if exists plans_insert_own on public.improvement_plans;
create policy plans_insert_own on public.improvement_plans for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists plans_update_own on public.improvement_plans;
create policy plans_update_own on public.improvement_plans for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists plans_delete_own on public.improvement_plans;
create policy plans_delete_own on public.improvement_plans for delete to authenticated using (auth.uid() = user_id);

-- ── subscriptions: READ-ONLY to the user; writes are server-only ────────────
-- The user may read their own subscription. There is deliberately NO insert/
-- update/delete policy for `authenticated`, so a client can never grant itself
-- a plan. The Paddle webhook writes via the service role (bypasses RLS).
drop policy if exists subs_select_own on public.subscriptions;
create policy subs_select_own on public.subscriptions for select to authenticated using (auth.uid() = user_id);

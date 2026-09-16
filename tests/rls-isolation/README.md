# RLS isolation test

Proves a logged-in user can **never** read, modify, or delete another user's
rows — resumes, job descriptions, interview sessions, questions, answers,
scores — and cannot spoof-insert rows as someone else or self-upgrade billing.

It runs the way Supabase evaluates RLS: `SET ROLE authenticated` with
`request.jwt.claims` carrying the user's id as `sub`, so `auth.uid()` resolves
to that user, then runs real queries and checks the results.

## Run it (no Supabase account needed)

**Option A — throwaway Docker Postgres (recommended, self-contained):**
```bash
./tests/rls-isolation/docker-run.sh
```
Spins up `postgres:16`, applies the Supabase shim + the real migrations +
grants, runs the test, and tears the container down.

**Option B — against local Supabase (`supabase start`):**
```bash
supabase start
supabase db reset            # applies supabase/migrations
DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
  node tests/rls-isolation/run.mjs
```
Here you OMIT `RLS_LOCAL_BOOTSTRAP` — Supabase already provides the `auth`
schema, `auth.uid()`, roles, and grants. The **same assertions** run.

## What's what

| File | Applied on Supabase? | Purpose |
|------|:--:|---------|
| `../../supabase/migrations/*.sql` | ✅ | The real schema, RLS policies, triggers |
| `00_bootstrap_pre.sql` | ❌ (shim) | Recreates `auth` schema/roles/`auth.uid()` for **plain** Postgres |
| `90_grants.sql` | ❌ (shim) | Table grants Supabase gives roles by default |
| `10_helpers.sql` | ✅ | `create_test_user()` to make throwaway users |
| `run.mjs` | — | The assertions |

Expected result: `PASS — 16 isolation checks passed, 0 leaks.`

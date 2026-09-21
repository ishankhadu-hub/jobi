# Jobi — AI job-hunt coaching agent

Paste a job description and your resume. Jobi runs a **chained agent**:

```
parse JD → extract competencies/skills/keywords → tailor resume (no fabrication;
gaps flagged) → cover letter → grouped interview questions → mock interview
(scored, adaptive follow-ups) → improvement plan
```

**Stack:** Expo/React Native · Supabase (Postgres + Auth + RLS) · n8n
(orchestration + all LLM calls) · Paddle (subscriptions).

**You can build and test the whole thing in `MOCK_MODE` with no accounts and no
API keys.** Nothing reads a secret except through one config module; you go live
by editing `.env` only.

---

## Prerequisites

- **Node 20+** (the backend is zero-dependency; uses global `fetch`).
- For the app: the **Expo** toolchain (`npx expo`), and a phone with **Expo Go**
  or an Android emulator.
- Optional (for the real DB): **Docker** + the **Supabase CLI**.
- Optional (for real orchestration): **n8n** (`npx n8n`).

## 1) Run it in mock mode (no accounts, no keys)

```bash
cp .env.example .env          # MOCK_MODE=true by default; leave everything blank

# terminal A — the LLM gateway + the orchestrator (n8n stand-in)
npm run dev                   # gateway :5679  +  orchestrator :5678

# terminal B — the app
cd app
npm install
npx expo install              # aligns native module versions to your Expo SDK
npx expo start                # press "a" for Android, "w" for web, or scan in Expo Go
```

That's the entire loop working: sign up, paste a JD + resume (there are "use
sample" buttons), get a tailored resume + cover letter, run the mock interview,
see scores and a plan, export `.docx`. LLM calls are canned, uploads hit local
disk, subscription checks pass — and the mock **simulates delays and occasional
rate-limit (429) errors** so you design loading/error states from day one.

> Talking to the app from a device? `localhost` won't resolve on the phone.
> Use your machine's LAN IP (`EXPO_PUBLIC_API_URL=http://192.168.x.x:5678`), or
> `http://10.0.2.2:5678` from the Android emulator. Set it in `app/.env`.

### Prefer real n8n instead of the stand-in?
Run `npm run gateway`, then start n8n and import the five workflows — see
[`n8n/README.md`](n8n/README.md). The app doesn't change (same webhooks).

## 2) Tests (run them — they pass)

```bash
npm run test:rls:docker   # RLS: user A cannot read/modify user B's data (needs Docker)
npm run smoke             # full chained loop over HTTP in mock mode
npm run test:paddle       # Paddle signature verify + free-tier gate
```

- **RLS isolation** — `tests/rls-isolation/`. Logs in as user A and confirms it
  can't touch user B's resumes/sessions/answers/scores, can't spoof-insert as B,
  and can't self-upgrade billing. Runs against a throwaway Docker Postgres, or
  against local Supabase (`DATABASE_URL=… npm run test:rls`). Expect
  `PASS — 16 isolation checks passed, 0 leaks.`
- **Full loop smoke** — `tests/agent-smoke/`. Boots gateway + orchestrator and
  drives signup → prepare → interview → plan. Checks no-fabrication, JD cache,
  adaptive follow-ups, scoring, plan. Expect `PASS — 17 checks`.
- **Paddle** — `tests/paddle/`. Valid signature accepted; tampered/stale
  rejected; 2nd free loop blocked with 402.

## 3) The database

```bash
supabase start        # local Postgres + Auth + Studio in Docker (no account)
supabase db reset     # applies supabase/migrations/*.sql (schema + RLS + triggers)
```
11 tables, RLS enabled + forced on every one, explicit per-user policies. See
`supabase/migrations/`. Isolation proven by the test above.

## 4) Going live

Edit `.env` only — never application code. Full order (DB → LLM → n8n → Paddle →
Android) with checkboxes: **[`docs/GO_LIVE_CHECKLIST.md`](docs/GO_LIVE_CHECKLIST.md)**.

The provider is swappable from one place: `LLM_BASE_URL` / `LLM_API_KEY` /
`LLM_MODEL` (OpenAI-compatible), plus a `LLM_FALLBACK_*` provider used
automatically on 404/429. `MOCK_MODE=true` in a production build **refuses to
start** (fail-closed).

## 5) Android build (EAS)

You must be logged into an **Expo (EAS) account**. Publishing to Play also needs
a **Google Play Console** account + a service-account key.

```bash
cd app
npm i -g eas-cli          # or: npx eas-cli@latest
eas login                 # log into your Expo account
eas build:configure       # links this app to an EAS project (writes the projectId)

# Internal test APK (installable directly on a device/emulator):
eas build --platform android --profile preview

# Production App Bundle (.aab) for the Play Store:
eas build --platform android --profile production

# (optional) submit to Google Play — needs the Play Console + service account:
eas submit --platform android --profile production
```
Profiles are in `app/eas.json`. Set each profile's `EXPO_PUBLIC_API_URL` to a
host your phone can reach (a tunnel like `cloudflared`/`ngrok`, or your deployed
webhook host) — a device can't reach your laptop's `localhost`.

## Repo layout

```
.env.example            every credential, labelled, blank (copy to .env; git-ignored)
shared/                 the ONE config module + LLM client (mock/fallback/logging) + prompts + agent steps
gateway/                LLM gateway — the single boundary for model calls; holds the LLM secret
orchestrator-dev/       local n8n stand-in: same /webhook/* contract, runs the chain with no n8n
n8n/                    the five importable workflows (build order steps 2–6) + generator + README
supabase/               migrations (schema + RLS + triggers), config.toml, seed
app/                    Expo / React Native app (only EXPO_PUBLIC_API_URL required)
paddle/                 webhook signature verification
tests/                  rls-isolation · agent-smoke · paddle
docs/                   ARCHITECTURE · GO_LIVE_CHECKLIST · PADDLE_WEBHOOK · VOICE_MODE · ASSUMPTIONS
```

## Build order (as requested — testable at each step)

1. **Schema + RLS + isolation test** — `supabase/`, `tests/rls-isolation/`
2. **Parse JD → competencies** (cached) — `n8n/workflows/01-parse-jd.json`
3. **Tailor resume + cover letter** (no fabrication) — `02-tailor-cover.json`
4. **Grouped interview questions** — `03-questions.json`
5. **Mock interview loop** (stateful, adaptive) — `04-interview-loop.json`
6. **Improvement plan** — `05-improvement-plan.json`
7. **Expo app** — `app/`
8. **Paddle gate + webhook** — `paddle/`, `docs/PADDLE_WEBHOOK.md`
9. **eas.json + docs** — `app/eas.json`, `docs/`, this README

Each is a separate commit; `git log --oneline` walks the order.

## Voice mode

Not built (text interview first), but the loop is structured so a speech layer
wraps it without a rewrite. The seam: **[`docs/VOICE_MODE.md`](docs/VOICE_MODE.md)**.

## Read before you rely on it

**[`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md)** — the decisions I made and the
things worth confirming (the gateway choice, Paddle Billing vs Classic, what
counts as a "loop", PII/retention, provider `response_format`, etc.).

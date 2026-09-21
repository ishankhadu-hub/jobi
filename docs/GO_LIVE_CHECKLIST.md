# Go-live checklist — which `.env` values to fill, in what order

You built and tested everything in **MOCK_MODE** with zero accounts. Here's the
order to switch to real services. Do them one at a time and re-run the app after
each — nothing else changes but `.env` (and, for n8n, the shell that launches it).

Everything below is edited in **`.env`** (backend) and **`app/.env`** (client).
No application code changes.

### 0. Baseline (already done in mock)
- [x] `MOCK_MODE=true`, app runs end to end via `orchestrator-dev`.
- [x] RLS isolation test passes (`npm run test:rls:docker`).

### 1. Database — Supabase (local first, no account)
1. Install the Supabase CLI, then in the repo root: `supabase start`.
2. From its output, copy into `.env`:
   - [ ] `SUPABASE_URL` (API URL, e.g. `http://localhost:54321`)
   - [ ] `SUPABASE_ANON_KEY`
   - [ ] `SUPABASE_SERVICE_KEY` (service_role)
3. `supabase db reset` to apply the migrations.
4. Re-run the isolation test against it:
   `DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' npm run test:rls`
5. In `app/.env`, set `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   to switch the app to **real Supabase Auth**. (Anon key is safe in the client.)

> Still `MOCK_MODE=true` here — data is real, the LLM is still mocked. Good
> checkpoint: real auth + real RLS, no LLM spend.

### 2. LLM provider (turn off the LLM mock)
Pick a provider with a **no-training** policy that exposes an OpenAI-compatible
API (Groq, Together, Fireworks, DeepInfra, OpenRouter…).
1. [ ] `LLM_API_KEY` = your key
2. [ ] `LLM_BASE_URL` = e.g. `https://api.groq.com/openai/v1`
3. [ ] `LLM_MODEL` = e.g. `llama-3.3-70b-versatile`
4. [ ] **Fallback** (different provider, so one deleting a free model doesn't
   take you down): `LLM_FALLBACK_API_KEY`, `LLM_FALLBACK_BASE_URL`,
   `LLM_FALLBACK_MODEL`.
5. Flip `MOCK_MODE=false`. Start the gateway; watch the logs — a 404 (model
   gone) or 429 (rate limit) prints a loud banner, not a generic error.

### 3. Orchestration — real n8n (optional but the intended prod path)
1. Start the gateway: `npm run gateway`.
2. Launch n8n with the env it needs (see `n8n/README.md`), import the five
   workflows from `n8n/workflows/`, and **Activate** them.
3. Point `app/.env` `EXPO_PUBLIC_API_URL` at n8n (`http://localhost:5678`, or a
   tunnel/host for a device).

### 4. Payments — Paddle
1. [ ] Create the product/price + a subscription checkout in Paddle.
2. [ ] `PADDLE_WEBHOOK_SECRET` from Paddle → your notification endpoint secret.
3. [ ] Point the Paddle webhook at `…/webhook/paddle` (use a tunnel for local).
4. [ ] `app/.env` `EXPO_PUBLIC_PADDLE_CHECKOUT_URL` = your hosted checkout URL.
5. Verify: `npm run test:paddle` (locally) and a real Paddle test event.
   The checkout must pass `custom_data.user_id` (the Paywall screen does this).

### 5. Android build (EAS)
See the README "Android build" section. You must be logged into an **Expo
(EAS) account** (`eas login`); publishing to Play requires a **Google Play
Console** account and a service-account key for `eas submit`.

### Production safety
- [ ] Set `APP_ENV=production` (or `NODE_ENV=production`) on your servers.
      With that set, a stray `MOCK_MODE=true` makes the gateway/orchestrator
      **refuse to start** (fail-closed). Confirmed by the config test.
- [ ] Rotate `GATEWAY_INTERNAL_TOKEN` off the dev default.
- [ ] `SUPABASE_SERVICE_KEY` lives only server-side (never in `app/.env`).

## Minimal "just make the AI real" path
If all you want is the mock app talking to a real model: do **step 2 only**,
keep `orchestrator-dev` + the file store, and leave Supabase/Paddle for later.

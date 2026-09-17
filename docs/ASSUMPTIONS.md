# Assumptions to check

Things I decided or assumed so you can sanity-check them. Ordered by how much
they'd matter if I guessed wrong.

### 1. The LLM gateway (the one real architecture decision)
The brief said "n8n for all LLM calls" **and** "one config module" **and**
MOCK_MODE + fallback + loud logging. I put the single config module + LLM client
in a tiny **gateway** service that n8n calls per model step, instead of
reimplementing mock/fallback/logging inside every n8n node. n8n still owns all
orchestration. If you'd rather have each n8n node call the provider directly
(and lose the single-module guarantee for LLM calls), say so and I'll refactor.
Details: `docs/ARCHITECTURE.md`.

### 2. Paddle **Billing**, not Classic
The signature verifier implements Paddle Billing (HMAC `Paddle-Signature`). If
your account is **Classic** Paddle (RSA public key + `p_signature`), the verifier
needs swapping — tell me and I'll do it. `docs/PADDLE_WEBHOOK.md`.

### 3. "One full loop" = one mock-interview session
The free-tier gate counts a **loop** as starting one interview session
(`/interview/start`). Generating the tailored resume/cover letter/questions is
not itself gated. If you want the gate at "generate outputs" instead (or count a
loop only when the plan is produced), it's a one-line change in
`orchestrator-dev/subscription.js`. Default `FREE_TIER_LOOP_LIMIT=1`.

### 4. dev-orchestrator + file store is a **dev convenience**, not production
To let you run with *zero* accounts, the orchestrator has a JSON-file store and
a local dev auth. That's for building/testing. Production is **n8n + Supabase**
(same webhook contract). Don't ship the file store / dev auth.

### 5. The app needs only `EXPO_PUBLIC_API_URL` (mock path)
For real Supabase Auth you add `EXPO_PUBLIC_SUPABASE_URL` +
`EXPO_PUBLIC_SUPABASE_ANON_KEY` to `app/.env`. Those are **public by design** (the
anon key is meant to ship in clients; RLS protects the data). The service key is
never in the app.

### 6. Provider must be OpenAI-compatible and honour `response_format: json_object`
The gateway asks for JSON via `response_format` on tasks that expect JSON
(Groq/OpenAI/Together support it). If your chosen provider rejects that field,
tell me — I'll make it prompt-only. Also: **you** pick a provider with a
no-training policy; data leaves your infra to whatever provider you configure.

### 7. n8n workflows target n8n 1.x
Generated for core nodes at current versions (webhook v2, httpRequest v4.2, code
v2, if v2, respondToWebhook v1.1). On a very different n8n version an import may
ask you to open/re-save a node once. Also set
`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` so the HTTP nodes can read `$env.*`.
The `orchestrator-dev` is the tested reference for the same logic.

### 8. `.docx` export is clean but plain
Exports open in Word/Google Docs/Pages, but the OOXML is intentionally minimal
(headings + paragraphs, no fancy templates). Enough for a resume/cover letter;
say if you want a styled template.

### 9. Mock heuristics are deliberately simple
The canned role/company/skill extraction in `shared/mocks.js` uses light regex/
keyword matching so mock output *feels* real. The **live** model does the real
extraction — don't judge quality from mock mode.

### 10. PII handling beyond RLS is your policy call
Resumes hold names/addresses/phones/history. RLS keeps rows owner-only (tested),
and Supabase encrypts at rest. Data **retention/deletion** (e.g. auto-purge old
resumes) and whether to send full resumes to a third-party model are policy
decisions you should make deliberately given the no-training requirement.

### 11. Runtime
Backend is **zero-dependency** and needs **Node 20+** (uses global `fetch`).
The app uses Expo SDK 52 pins; run `npx expo install` to align native module
versions to whatever SDK you land on.

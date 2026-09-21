# Architecture

```
┌────────────────────┐        HTTPS (webhooks only)         ┌───────────────────────────┐
│   Expo / RN app    │  ─────────────────────────────────▶ │  n8n  (orchestration)      │
│                    │   POST /webhook/parse-jd, /tailor,   │  OR orchestrator-dev        │
│ knows ONLY         │        /questions, /interview/*,     │  (local n8n stand-in)       │
│ EXPO_PUBLIC_API_URL│        /interview/plan, /paddle       │                             │
│ (+ optional public │                                      │  • chains the steps         │
│  Supabase anon)    │                                      │  • reads/writes Supabase    │
│ holds NO secret    │                                      │  • caches JD parse          │
└─────────┬──────────┘                                      │  • interview state machine  │
          │ Supabase Auth (JWT)                             │  • subscription gate        │
          ▼                                                 │  • verifies Paddle signature │
┌────────────────────┐                                      └───────┬───────────┬─────────┘
│  Supabase          │   RLS: every row scoped to its owner         │           │
│  Postgres + Auth   │ ◀────────────────────────────────────────────┘           │ HTTP (+ x-internal-token)
│  (local via CLI or │                                                           ▼
│   hosted)          │                                            ┌───────────────────────────┐
└────────────────────┘                                            │  LLM Gateway              │
                                                                  │  (the ONE config module)   │
   Paddle (external web checkout) ──webhook──▶ orchestrator       │  • MOCK_MODE (canned +     │
                                                                  │    delays + 429s)          │
                                                                  │  • primary + fallback      │
                                                                  │    provider (OpenAI shape) │
                                                                  │  • loud 404/429 logging    │
                                                                  │  holds the LLM secret only │
                                                                  └───────────┬────────────────┘
                                                                              ▼
                                                                   LLM provider (Groq/Together/…)
                                                                   or nothing, in MOCK_MODE
```

## Why the LLM gateway exists (the one architectural call to check)

The brief said "n8n for orchestration and all LLM calls" **and** "everything
goes through one config module" **and** MOCK_MODE with delays + rate-limit
simulation, a fallback provider, and loud 404/429 logging. Those are
cross-cutting concerns that are painful and error-prone to reimplement inside
every n8n HTTP node.

So the **single config module + LLM client** live in one tiny zero-dependency
service — the **gateway**. n8n still owns *all orchestration and chaining*; it
just calls the gateway for each model step (`POST /agent/<task>`). This keeps
secrets in one place, makes the provider swappable from `.env` alone, and means
mock mode / fallback / logging are implemented once and used everywhere.

The app never sees any of this — it only ever calls `/webhook/*`.

## Two run modes

| | Fastest (no accounts) | Production-shaped |
|---|---|---|
| Orchestration | `orchestrator-dev` (Node) | **n8n** (import workflows) |
| Data | file store (`.data/`) | **Supabase** (local or hosted) |
| Auth | dev tokens | **Supabase Auth** |
| LLM | gateway MOCK_MODE | gateway → real provider |
| Payments | gate always passes | Paddle live |

Both speak the identical `/webhook/*` contract, so the app doesn't change.
`orchestrator-dev` is the executable reference for the n8n workflows: same
paths, same gateway calls, same Supabase reads/writes, same interview state
machine. The automated smoke test drives it end to end.

## The chain (the whole point)

```
parse JD ─▶ extract competencies/skills/keywords  (cached by sha256 per user)
        └▶ tailor resume (no fabrication; gaps flagged) ─▶ cover letter
        └▶ grouped questions (behavioural/technical/role-specific)
                                   │
             interview loop:  serve Q ─▶ take answer ─▶ score vs competencies
                                   ▲                        │
                                   └──── adaptive follow-up ─┘  (state in DB)
                                   │
                              compile improvement plan
```

Each step's output feeds the next. See `shared/agent.js` (steps) and
`shared/prompts.js` (prompts, all in one place).

## Cost discipline (free-tier friendly)

- The JD parse + competency extraction is **cached** (`job_descriptions`
  unique on `(user_id, content_hash)`), so re-runs never re-spend.
- The gateway retries with backoff and falls back to a second provider on
  404/429 rather than failing the whole chain.
- One full loop is a bounded number of calls: 1 parse (cached) + 1 tailor +
  1 cover + 1 questions + N interview turns + 1 plan.

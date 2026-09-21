# n8n workflows (orchestration + all LLM calls)

Five importable workflows implement the chained agent. Each is a **real
multi-step graph** — not one giant prompt — and every LLM step goes through the
**gateway** (which owns the one config module, mock mode, provider fallback, and
loud logging). n8n owns the orchestration, chaining, caching and session state.

| File | Step | Webhook (POST) | Does |
|------|------|----------------|------|
| `workflows/01-parse-jd.json` | 2 | `/webhook/parse-jd` | Parse JD → competencies/skills/keywords, **cached** by sha256 per user |
| `workflows/02-tailor-cover.json` | 3 | `/webhook/tailor` | Tailor resume (no fabrication; gaps flagged) → cover letter |
| `workflows/03-questions.json` | 4 | `/webhook/questions` | Grouped questions: behavioural / technical / role-specific |
| `workflows/04-interview-loop.json` | 5 | `/webhook/interview/answer` | Score answer → decide follow-up vs advance; **state in the DB** |
| `workflows/05-improvement-plan.json` | 6 | `/webhook/interview/plan` | Compile all scores (+ gaps) → improvement plan |

> The `orchestrator-dev/` service implements this **identical** logic in plain
> Node and is what the automated smoke test exercises. Treat it as the executable
> reference for these workflows: same webhook paths, same gateway calls, same
> Supabase reads/writes, same interview state machine.

## Run n8n locally (on your laptop, not a server)

```bash
# 1) Start the gateway (holds the config module + secrets; mock-aware)
npm run gateway            # -> http://localhost:5679

# 2) Start n8n with the env it needs to reach Supabase + the gateway.
#    Enable env access in expressions so the HTTP nodes can read $env.*.
export N8N_BLOCK_ENV_ACCESS_IN_NODE=false
export SUPABASE_URL=...          # from `supabase start` output (API URL)
export SUPABASE_ANON_KEY=...
export SUPABASE_SERVICE_KEY=...  # service_role key — server side only
export GATEWAY_URL=http://localhost:5679
export GATEWAY_INTERNAL_TOKEN=dev-internal-token-change-me   # match your .env
npx n8n                    # -> http://localhost:5678
```

Then in the n8n UI: **Workflows → Import from File**, import each JSON, and
**Activate** it. The webhook URLs become `http://localhost:5678/webhook/<path>`,
which is exactly what `EXPO_PUBLIC_API_URL` points at.

## Auth

Each workflow's first real node is **Resolve user**: it calls Supabase
`/auth/v1/user` with the incoming `Authorization: Bearer <token>` to verify the
JWT and get the user id. The app sends its Supabase access token; nothing trusts
a client-supplied user id.

## Env the HTTP nodes read

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `GATEWAY_URL`,
`GATEWAY_INTERNAL_TOKEN`, and (loop tuning) `INTERVIEW_MAX_QUESTIONS`,
`INTERVIEW_MAX_FOLLOWUPS`. These come from the same `.env` — set them in the
shell that launches n8n.

## Regenerating

The JSON is generated from `build-workflows.mjs` (guarantees valid JSON and a
consistent graph). Edit that and run `node n8n/build-workflows.mjs` to rebuild,
or just edit the JSON / the workflow in the n8n UI and re-export.

## Version note

Generated for n8n 1.x core nodes (`webhook` v2, `httpRequest` v4.2, `code` v2,
`if` v2, `respondToWebhook` v1.1). If your n8n is much older/newer and an import
complains about a node version, open the node once in the UI and re-save — n8n
migrates it. The graph and logic are the part that matters.

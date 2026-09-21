# Paddle webhook — how signature verification works

You asked to be able to check this. Here's exactly what happens, in
`paddle/verify.js` (verified by `tests/paddle/webhook.test.mjs`).

## The flow

1. Paddle sends a `POST` to `…/webhook/paddle` with a header:
   ```
   Paddle-Signature: ts=1737057600;h1=eb1c2f…       (unix timestamp + HMAC)
   ```
2. We read the **raw request body bytes** — before any JSON parsing. This is the
   critical bit: the signature is over the exact bytes Paddle sent. If you
   parse the JSON and re-serialize it, the bytes change and verification fails.
   In the orchestrator route we call `readBody(req)` (raw Buffer), verify, and
   only then `JSON.parse`.
3. We build the signed payload string:  `` `${ts}:${rawBody}` ``.
4. We compute `HMAC-SHA256(PADDLE_WEBHOOK_SECRET, signedPayload)` and compare it
   to `h1` using `crypto.timingSafeEqual` (constant-time — no timing side channel).
5. We reject if the timestamp is older than 5 minutes (`toleranceSec`), which
   blunts replay attacks.
6. **Only if all of that passes** do we trust the payload and update the
   subscription. A failure returns `401` and changes nothing.

## Why each check matters

| Check | Stops |
|-------|-------|
| HMAC over raw body | Forged payloads (attacker doesn't know the secret) |
| Constant-time compare | Leaking the correct signature byte-by-byte via timing |
| Raw bytes (not re-serialized) | Silent mismatches / accidentally trusting modified bodies |
| Timestamp tolerance | Replaying a previously-valid webhook later |

## Tying a payment to a Jobi user

Paddle checkout is an **external web checkout**. When you create the checkout you
must pass `custom_data: { user_id: "<the Jobi/Supabase user id>" }`. The webhook
reads `data.custom_data.user_id` to know whose subscription to update. The app's
Paywall screen already appends this to the checkout URL.

## Events handled

- `subscription.created` / `subscription.activated` / `subscription.updated` /
  `transaction.completed` → set `status = active` (unlimited loops).
- `subscription.canceled` / `subscription.paused` → set `status = canceled`
  (back to the free-tier gate).

Writes happen with the **service role**, which bypasses RLS — clients can never
write the `subscriptions` table themselves (see `supabase/migrations/0002_rls.sql`;
there is deliberately no client insert/update policy).

## Classic Paddle note

The above is **Paddle Billing** (the current product). If you're on **Classic**
Paddle, webhooks are signed differently: an RSA public key + a PHP-serialized
`p_signature` field. That's a different verifier — tell me if you're on Classic
and I'll swap `paddle/verify.js` for the RSA scheme.

## Local test

```bash
npm run test:paddle
```
Signs a fake event with a test secret and asserts: valid → accepted; tampered →
401; stale timestamp → 401; and that the free-tier gate blocks a 2nd loop.

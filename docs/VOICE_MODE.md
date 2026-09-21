# Voice mode — the seam (built later, stubbed now)

The MVP interview is **text-in / text-out**. Voice is deliberately NOT built.
But the loop is structured so a voice layer wraps it **without rewriting the
core**. Here's exactly where it attaches.

## The core is already voice-shaped

The interview loop is a pure request/response turn machine:

```
POST /webhook/interview/answer  { sessionId, answer, audioUrl? }
  → { score, next_question, done, voice: { speak, voice_ready } }
```

- **Inbound** is just an `answer` string. A voice layer runs speech-to-text on
  the caller's audio and passes the transcript as `answer`. Nothing in scoring
  or the state machine assumes the text was typed.
- **Outbound** already includes `voice.speak` — the exact text a text-to-speech
  layer should read aloud (the next question or the closing line). The UI reads
  the same field for display.
- `answers.audio_url` and `interview_sessions.voice_enabled` columns exist in
  the schema, unused in the MVP, reserved for the voice layer.

So voice = an adapter in front of these endpoints. No change to the chain.

## How you'd add it later

```
 caller audio ──▶ [STT]  ──answer──▶  POST /interview/answer  ──▶ core (unchanged)
                                                    │
 caller hears ◀── [TTS] ◀──voice.speak────────────┘
```

Two clean options for where the adapter lives:

1. **In the app** (simplest first step): use `expo-speech` for TTS and an
   on-device or cloud STT for the mic. The app still calls the same webhook. A
   mic button in `InterviewScreen.tsx` (there's a `VOICE SEAM` comment marking
   the spot) fills `answer`; on response, speak `voice.speak`.
2. **As a telephony/realtime workflow** (for actual "voice interviews"): a new
   n8n workflow (or a small media service) receives audio, calls an STT
   provider, POSTs to `/interview/answer` via the gateway pattern, then streams
   `voice.speak` to a TTS provider. The scoring/state code is untouched.

## What NOT to do

Don't fold STT/TTS into the scoring prompt or the interview state machine. Keep
them as an adapter so the text path stays the source of truth and remains
independently testable (the smoke test drives the text path today).

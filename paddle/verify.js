'use strict';
/**
 * Paddle (Billing) webhook signature verification.
 *
 * HOW PADDLE SIGNS (and how we verify) — explained so you can check it:
 *  1. Paddle sends a `Paddle-Signature` header shaped like:
 *        ts=1737057600;h1=eb1c2...      (a unix timestamp + an HMAC)
 *  2. The signed payload is the string  `${ts}:${rawRequestBody}`  — the RAW,
 *     unparsed JSON body. You MUST verify against the exact bytes received; if
 *     you re-serialize the parsed JSON the bytes differ and it won't match.
 *  3. We compute HMAC-SHA256 over that signed payload using your webhook
 *     secret (PADDLE_WEBHOOK_SECRET from the Paddle dashboard) and compare it to
 *     `h1` with a constant-time comparison (crypto.timingSafeEqual) so we don't
 *     leak timing information.
 *  4. We also reject stale timestamps (default: older than 5 minutes) to blunt
 *     replay attacks.
 *
 * Only after all of that do we trust the payload and act on it.
 *
 * Ref: https://developer.paddle.com/webhooks/signature-verification
 * (If you're on CLASSIC Paddle instead of Paddle Billing, that uses an RSA
 *  public-key + PHP-serialized `p_signature` scheme — see docs/PADDLE_WEBHOOK.md.)
 */
const crypto = require('crypto');

function parseSignatureHeader(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const [k, v] = part.split('=');
    if (k && v) out[k.trim()] = v.trim();
  }
  return out; // { ts, h1 }
}

/**
 * @param {Buffer|string} rawBody  the EXACT bytes of the request body
 * @param {string} signatureHeader value of the Paddle-Signature header
 * @param {string} secret          PADDLE_WEBHOOK_SECRET
 * @param {object} [opts]
 * @param {number} [opts.toleranceSec=300]
 * @returns {{valid:boolean, reason?:string}}
 */
function verifyPaddleSignature(rawBody, signatureHeader, secret, opts = {}) {
  const toleranceSec = opts.toleranceSec ?? 300;
  if (!secret) return { valid: false, reason: 'no_secret_configured' };
  const { ts, h1 } = parseSignatureHeader(signatureHeader);
  if (!ts || !h1) return { valid: false, reason: 'malformed_signature_header' };

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > toleranceSec) return { valid: false, reason: 'timestamp_out_of_tolerance' };

  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const signedPayload = `${ts}:${raw}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(h1, 'hex');
  if (a.length !== b.length) return { valid: false, reason: 'signature_mismatch' };
  if (!crypto.timingSafeEqual(a, b)) return { valid: false, reason: 'signature_mismatch' };
  return { valid: true };
}

/**
 * Produce a valid Paddle-Signature header for a body — used ONLY by tests to
 * simulate Paddle locally (never in production).
 */
function signForTest(rawBody, secret, ts = Math.floor(Date.now() / 1000)) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const h1 = crypto.createHmac('sha256', secret).update(`${ts}:${raw}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

module.exports = { verifyPaddleSignature, signForTest, parseSignatureHeader };

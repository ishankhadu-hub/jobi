'use strict';
/**
 * Subscription gate. Free users get FREE_TIER_LOOP_LIMIT full coaching loops
 * (a "loop" = one mock-interview session run). Paid users are unlimited.
 *
 * MOCK_MODE: "subscription checks always pass" (per spec). To design/test the
 * paywall UX without leaving mock mode, set BILLING_ENFORCE_IN_MOCK=1.
 */
const { config } = require('../shared/config');

function enforcing() {
  if (!config.MOCK_MODE) return true;
  return String(process.env.BILLING_ENFORCE_IN_MOCK || '').toLowerCase() === 'true' ||
    process.env.BILLING_ENFORCE_IN_MOCK === '1';
}

async function getOrCreateSub(store, userId) {
  let sub = await store.selectOne('subscriptions', { user_id: userId });
  if (!sub) sub = await store.upsert('subscriptions', { user_id: userId, status: 'free', loops_used: 0 }, ['user_id']);
  return sub;
}

function isPaid(sub) {
  return sub && (sub.status === 'active');
}

async function getStatus(store, userId) {
  const sub = await getOrCreateSub(store, userId);
  const limit = config.billing.freeTierLoopLimit;
  const unlimited = isPaid(sub);
  const used = sub.loops_used || 0;
  const canRun = !enforcing() || unlimited || used < limit;
  return {
    status: sub.status,
    plan: sub.plan || (unlimited ? 'pro' : 'free'),
    loops_used: used,
    free_loop_limit: limit,
    unlimited,
    can_run: canRun,
    enforced: enforcing(),
    current_period_end: sub.current_period_end || null,
  };
}

async function assertCanStartLoop(store, userId) {
  const s = await getStatus(store, userId);
  if (s.can_run) return s;
  const e = new Error(
    `Free plan allows ${s.free_loop_limit} full coaching loop(s). Upgrade to continue.`
  );
  e.status = 402; // Payment Required
  e.code = 'upgrade_required';
  e.details = { checkout_hint: 'Open the Paddle checkout (see /webhook/subscription).', ...s };
  throw e;
}

async function recordLoopStart(store, userId) {
  const sub = await getOrCreateSub(store, userId);
  await store.update('subscriptions', { user_id: userId }, { loops_used: (sub.loops_used || 0) + 1 });
}

module.exports = { getStatus, assertCanStartLoop, recordLoopStart, enforcing };

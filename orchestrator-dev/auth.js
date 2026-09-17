'use strict';
/**
 * Auth for the dev-orchestrator.
 *
 * Two modes, chosen by config:
 *   * DEV (file store / mock): a lightweight local auth so the whole app runs
 *     with NO Supabase account. Tokens are `dev.<userId>` — clearly not real
 *     JWTs; dev-only. Users live in the file store.
 *   * SUPABASE: the app authenticates against Supabase directly and sends its
 *     Supabase access token as `Authorization: Bearer <token>`. We verify it by
 *     asking Supabase `/auth/v1/user` (no JWT secret needed here).
 *
 * The rest of the orchestrator just calls `requireUser(req)` and gets a userId.
 */
const crypto = require('crypto');
const { config } = require('../shared/config');

function bearer(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function unauthorized(msg) {
  const e = new Error(msg || 'unauthorized');
  e.status = 401;
  e.code = 'unauthorized';
  return e;
}

function makeDevAuth(store) {
  return {
    mode: 'dev',
    async signup({ email, password, full_name }) {
      if (!email || !password) throw Object.assign(new Error('email and password required'), { status: 400 });
      const existing = await store.selectOne('users', { email });
      if (existing) throw Object.assign(new Error('user already exists'), { status: 409 });
      const id = crypto.randomUUID();
      // NOTE: dev-only password handling. Real auth is Supabase's job.
      const salt = crypto.randomBytes(8).toString('hex');
      const hash = crypto.scryptSync(password, salt, 32).toString('hex');
      await store.insert('users', { id, email, full_name: full_name || email.split('@')[0], _salt: salt, _hash: hash });
      await store.upsert('subscriptions', { user_id: id, status: 'free', loops_used: 0 }, ['user_id']);
      return { token: `dev.${id}`, user: { id, email, full_name: full_name || email.split('@')[0] } };
    },
    async login({ email, password }) {
      const u = await store.selectOne('users', { email });
      if (!u) throw unauthorized('invalid credentials');
      const hash = crypto.scryptSync(password || '', u._salt || '', 32).toString('hex');
      if (hash !== u._hash) throw unauthorized('invalid credentials');
      return { token: `dev.${u.id}`, user: { id: u.id, email: u.email, full_name: u.full_name } };
    },
    async requireUser(req) {
      const t = bearer(req);
      if (!t || !t.startsWith('dev.')) throw unauthorized();
      const id = t.slice(4);
      const u = await store.selectOne('users', { id });
      if (!u) throw unauthorized();
      return { id: u.id, email: u.email };
    },
  };
}

function makeSupabaseAuth() {
  const base = `${config.supabase.url.replace(/\/+$/, '')}/auth/v1`;
  return {
    mode: 'supabase',
    async signup() {
      const e = new Error('sign up via Supabase directly from the app (this endpoint is dev-only)');
      e.status = 400;
      throw e;
    },
    async login() {
      const e = new Error('log in via Supabase directly from the app (this endpoint is dev-only)');
      e.status = 400;
      throw e;
    },
    async requireUser(req) {
      const t = bearer(req);
      if (!t) throw unauthorized();
      const res = await fetch(`${base}/user`, {
        headers: { authorization: `Bearer ${t}`, apikey: config.supabase.anonKey },
      });
      if (!res.ok) throw unauthorized('invalid Supabase token');
      const u = await res.json();
      return { id: u.id, email: u.email };
    },
  };
}

function createAuth(kind, store) {
  return kind === 'supabase' ? makeSupabaseAuth() : makeDevAuth(store);
}

module.exports = { createAuth };

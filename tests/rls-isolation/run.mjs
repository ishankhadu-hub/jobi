#!/usr/bin/env node
// =============================================================================
// RLS ISOLATION TEST
// -----------------------------------------------------------------------------
// Proves that user A can NEVER read, modify, or delete user B's rows — resumes,
// interview sessions, answers, scores — and cannot spoof-insert rows as B.
//
// It runs exactly the way Supabase evaluates RLS: SET ROLE authenticated, with
// request.jwt.claims carrying the user's id as `sub` (so auth.uid() resolves to
// that user), then runs real queries and checks the results.
//
// Run it two ways (both run the identical assertions):
//   * Against a bare Docker Postgres (this repo can spin one up):
//       ./tests/rls-isolation/docker-run.sh
//   * Against local Supabase (`supabase start`):
//       DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//         node tests/rls-isolation/run.mjs
//
// Env:
//   DATABASE_URL           postgres connection string (required)
//   RLS_LOCAL_BOOTSTRAP=1  also apply the Supabase shim + migrations + grants
//                          (use for a bare Postgres; OMIT on Supabase where the
//                          migrations are already applied by `supabase db reset`)
// =============================================================================
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const DB = process.env.DATABASE_URL;
const BOOTSTRAP = process.env.RLS_LOCAL_BOOTSTRAP === '1';

if (!DB) {
  console.error('DATABASE_URL is required. See the header of this file.');
  process.exit(2);
}

let pass = 0;
let fail = 0;
function ok(msg) {
  pass++;
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}
function bad(msg, detail) {
  fail++;
  console.log(`  \x1b[31m✗ ${msg}\x1b[0m${detail ? `\n      ${detail}` : ''}`);
}

// Run a SQL string, return trimmed stdout. Throws on SQL error (ON_ERROR_STOP).
// -q suppresses command tags ("INSERT 0 1") so RETURNING scalars come back clean.
function psql(sql) {
  return execFileSync('psql', [DB, '-q', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function psqlFile(file) {
  return execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-f', file], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Run `sql` in one transaction as the given user (authenticated role + JWT sub).
function asUser(sub, sql) {
  const claims = JSON.stringify({ sub, role: 'authenticated' }).replace(/'/g, "''");
  const wrapped =
    `do $$ begin perform set_config('request.jwt.claims', '${claims}', true); end $$;\n` +
    `set local role authenticated;\n` +
    sql;
  return psql(wrapped);
}
// As above, but for the anon (logged-out) role.
function asAnon(sql) {
  const wrapped =
    `do $$ begin perform set_config('request.jwt.claims', '', true); end $$;\n` +
    `set local role anon;\n` +
    sql;
  return psql(wrapped);
}
// Expect the query to be REFUSED (RLS violation). Returns true if it was denied.
function expectDenied(fn) {
  try {
    fn();
    return false;
  } catch (e) {
    const out = `${e.stderr || ''}${e.stdout || ''}`;
    return /row-level security|violates row-level security|permission denied/i.test(out);
  }
}

function applyMigrationsAndBootstrap() {
  if (!BOOTSTRAP) return;
  console.log('Applying Supabase shim + migrations + grants (RLS_LOCAL_BOOTSTRAP=1)…');
  psqlFile(path.join(__dirname, '00_bootstrap_pre.sql'));
  const migDir = path.join(REPO, 'supabase', 'migrations');
  for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    psqlFile(path.join(migDir, f));
  }
  psqlFile(path.join(__dirname, '90_grants.sql'));
}

// Seed a full data chain for a user, AS that user (also tests INSERT policies).
function seedFor(userId, tag) {
  const s = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const rid = asUser(userId, `insert into public.resumes(user_id, content) values(${s(userId)}, ${s(tag + ' resume PII: 555-1234')}) returning id;`);
  const jid = asUser(userId, `insert into public.job_descriptions(user_id, raw_text, content_hash) values(${s(userId)}, ${s(tag + ' JD')}, ${s('hash-' + userId)}) returning id;`);
  const sid = asUser(userId, `insert into public.interview_sessions(user_id, job_description_id) values(${s(userId)}, ${s(jid)}) returning id;`);
  const qid = asUser(userId, `insert into public.questions(user_id, job_description_id, session_id, category, text) values(${s(userId)}, ${s(jid)}, ${s(sid)}, 'behavioural', ${s('Tell me about X')}) returning id;`);
  const aid = asUser(userId, `insert into public.answers(user_id, session_id, question_id, question_text, answer_text) values(${s(userId)}, ${s(sid)}, ${s(qid)}, ${s('Tell me about X')}, ${s(tag + ' secret answer')}) returning id;`);
  const scid = asUser(userId, `insert into public.scores(user_id, session_id, answer_id, score) values(${s(userId)}, ${s(sid)}, ${s(aid)}, 77) returning id;`);
  return { rid, jid, sid, qid, aid, scid };
}

async function main() {
  console.log('\n=== RLS isolation test ===');
  console.log(`DB: ${DB.replace(/:[^:@/]*@/, ':****@')}  bootstrap=${BOOTSTRAP}\n`);

  applyMigrationsAndBootstrap();
  psqlFile(path.join(__dirname, '10_helpers.sql'));

  const A = randomUUID();
  const B = randomUUID();
  psql(`select public.create_test_user('${A}', 'alice@example.com');`);
  psql(`select public.create_test_user('${B}', 'bob@example.com');`);
  console.log(`user A (alice) = ${A}`);
  console.log(`user B (bob)   = ${B}\n`);

  const a = seedFor(A, 'ALICE');
  const b = seedFor(B, 'BOB');
  console.log('Seeded a full data chain for each user (insert policies allowed own rows).\n');

  const s = (v) => `'${String(v).replace(/'/g, "''")}'`;

  console.log('As USER A (alice):');

  // Trigger-provisioned profile + subscription visible to self only.
  {
    const own = asUser(A, `select count(*) from public.users where id = ${s(A)};`);
    const other = asUser(A, `select count(*) from public.users where id = ${s(B)};`);
    own === '1' && other === '0' ? ok('sees only her own profile row (users)') : bad('profile visibility wrong', `own=${own} other=${other}`);
  }
  {
    const subs = asUser(A, `select count(*) from public.subscriptions;`);
    subs === '1' ? ok('sees exactly one subscription (her own free plan)') : bad('subscription visibility wrong', `count=${subs}`);
  }

  // The core PII test: resumes.
  {
    const total = asUser(A, `select count(*) from public.resumes;`);
    total === '1' ? ok('resumes: sees only 1 row total (hers), not both') : bad('resumes leak', `A sees ${total} resume rows (expected 1)`);
    const bById = asUser(A, `select count(*) from public.resumes where id = ${s(b.rid)};`);
    bById === '0' ? ok("cannot SELECT bob's resume by id") : bad("READ B's resume!", `rows=${bById}`);
    const canReadContent = asUser(A, `select coalesce(string_agg(content, ','), '') from public.resumes where id = ${s(b.rid)};`);
    canReadContent === '' ? ok("cannot read bob's resume PII content") : bad('READ B PII', canReadContent);
  }

  // Interview data isolation.
  for (const [name, table, id] of [
    ['interview_sessions', 'interview_sessions', b.sid],
    ['answers', 'answers', b.aid],
    ['scores', 'scores', b.scid],
    ['questions', 'questions', b.qid],
    ['job_descriptions', 'job_descriptions', b.jid],
  ]) {
    const seen = asUser(A, `select count(*) from public.${table} where id = ${s(id)};`);
    seen === '0' ? ok(`cannot SELECT bob's ${name}`) : bad(`READ B's ${name}!`, `rows=${seen}`);
  }

  // Writes to B's rows must affect 0 rows (RLS makes them invisible to UPDATE/DELETE).
  {
    const upd = asUser(A, `with u as (update public.resumes set content='HACKED' where id = ${s(b.rid)} returning 1) select count(*) from u;`);
    upd === '0' ? ok("UPDATE of bob's resume affects 0 rows") : bad('MODIFIED B resume', `affected=${upd}`);
    const del = asUser(A, `with d as (delete from public.answers where id = ${s(b.aid)} returning 1) select count(*) from d;`);
    del === '0' ? ok("DELETE of bob's answer affects 0 rows") : bad('DELETED B answer', `affected=${del}`);
  }

  // Confirm bob's row is actually still intact (as bob).
  {
    const stillThere = asUser(B, `select content from public.resumes where id = ${s(b.rid)};`);
    /BOB resume/.test(stillThere) ? ok("bob's resume is untouched after A's attempts") : bad('bob resume changed!', stillThere);
  }

  // Spoofed insert: A tries to create a row owned by B -> WITH CHECK denies it.
  {
    const denied = expectDenied(() =>
      asUser(A, `insert into public.resumes(user_id, content) values(${s(B)}, 'spoofed by alice');`)
    );
    denied ? ok("cannot INSERT a resume owned by bob (WITH CHECK blocks spoofing)") : bad('SPOOFED insert as B succeeded!');
  }
  // A tries to upgrade her own subscription (client writes are server-only).
  // With no UPDATE policy, RLS makes the row invisible to UPDATE: 0 rows change,
  // no error. Verify nothing actually changed.
  {
    const affected = asUser(A, `with u as (update public.subscriptions set status='active' where user_id = ${s(A)} returning 1) select count(*) from u;`);
    const after = asUser(A, `select status from public.subscriptions where user_id = ${s(A)};`);
    affected === '0' && after === 'free'
      ? ok('cannot self-upgrade subscription (client UPDATE affects 0 rows; plan stays free)')
      : bad('SELF-UPGRADED subscription!', `affected=${affected} after=${after}`);
  }

  console.log('\nAs ANONYMOUS (logged out):');
  {
    const seen = asAnon(`select count(*) from public.resumes;`);
    seen === '0' ? ok('anon sees 0 resumes') : bad('anon can read resumes!', `count=${seen}`);
  }

  console.log('');
  if (fail === 0) {
    console.log(`\x1b[32mPASS\x1b[0m — ${pass} isolation checks passed, 0 leaks.\n`);
    process.exit(0);
  } else {
    console.log(`\x1b[31mFAIL\x1b[0m — ${fail} failing check(s), ${pass} passed.\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\nTest harness error:', e.message);
  if (e.stderr) console.error(e.stderr.toString());
  process.exit(2);
});

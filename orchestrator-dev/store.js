'use strict';
/**
 * Pluggable data store for the dev-orchestrator (the local n8n stand-in).
 *
 * Two implementations behind one tiny interface (insert/selectOne/select/
 * update/upsert):
 *
 *   FileStore     — JSON files under .data/. Zero dependencies, zero accounts.
 *                   This is the default in MOCK_MODE so the WHOLE app runs with
 *                   no Supabase, no n8n, no keys ("uploads write to local disk").
 *   SupabaseStore — PostgREST calls with the service key, used when Supabase is
 *                   configured and you're not in file mode. This is the path the
 *                   real n8n workflows use (via Supabase nodes).
 *
 * NOTE: FileStore is a single-process dev convenience. Real multi-user
 * isolation is enforced by Postgres RLS (see supabase/migrations + the isolation
 * test). Handlers still always scope queries by user_id, mirroring RLS.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('../shared/config');

function newId() {
  return crypto.randomUUID();
}
function nowIso() {
  return new Date().toISOString();
}
function matches(row, match) {
  return Object.entries(match || {}).every(([k, v]) => row[k] === v);
}

// ── FileStore ───────────────────────────────────────────────────────────────
class FileStore {
  constructor(dir) {
    this.dir = dir || path.join(process.cwd(), '.data');
    fs.mkdirSync(this.dir, { recursive: true });
    this.uploadsDir = path.join(this.dir, 'uploads');
    fs.mkdirSync(this.uploadsDir, { recursive: true });
  }
  _file(table) {
    return path.join(this.dir, `${table}.json`);
  }
  _read(table) {
    try {
      return JSON.parse(fs.readFileSync(this._file(table), 'utf8'));
    } catch {
      return [];
    }
  }
  _write(table, rows) {
    fs.writeFileSync(this._file(table), JSON.stringify(rows, null, 2));
  }
  async insert(table, row) {
    const rows = this._read(table);
    const full = { id: row.id || newId(), created_at: nowIso(), ...row };
    rows.push(full);
    this._write(table, rows);
    return full;
  }
  async select(table, match) {
    return this._read(table).filter((r) => matches(r, match));
  }
  async selectOne(table, match) {
    return this._read(table).find((r) => matches(r, match)) || null;
  }
  async update(table, match, patch) {
    const rows = this._read(table);
    const updated = [];
    for (const r of rows) {
      if (matches(r, match)) {
        Object.assign(r, patch, { updated_at: nowIso() });
        updated.push(r);
      }
    }
    this._write(table, rows);
    return updated;
  }
  async upsert(table, row, conflictKeys) {
    const match = {};
    for (const k of conflictKeys) match[k] = row[k];
    const existing = await this.selectOne(table, match);
    if (existing) {
      const [u] = await this.update(table, { id: existing.id }, row);
      return u;
    }
    return this.insert(table, row);
  }
  // "uploads write to local disk" in mock mode.
  async putUpload(userId, filename, buffer) {
    const safe = `${userId}_${Date.now()}_${filename.replace(/[^\w.-]/g, '_')}`;
    const dest = path.join(this.uploadsDir, safe);
    fs.writeFileSync(dest, buffer);
    return `file://${dest}`;
  }
}

// ── SupabaseStore (PostgREST) ───────────────────────────────────────────────
// Used with real (local or hosted) Supabase. Uses the service key server-side.
class SupabaseStore {
  constructor({ url, serviceKey }) {
    this.base = `${url.replace(/\/+$/, '')}/rest/v1`;
    this.headers = {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    };
  }
  _qs(match) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(match || {})) p.append(k, `eq.${v}`);
    return p.toString();
  }
  async insert(table, row) {
    const res = await fetch(`${this.base}/${table}`, {
      method: 'POST',
      headers: { ...this.headers, prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`supabase insert ${table}: ${res.status} ${await res.text()}`);
    return (await res.json())[0];
  }
  async select(table, match) {
    const res = await fetch(`${this.base}/${table}?${this._qs(match)}`, { headers: this.headers });
    if (!res.ok) throw new Error(`supabase select ${table}: ${res.status} ${await res.text()}`);
    return res.json();
  }
  async selectOne(table, match) {
    return (await this.select(table, match))[0] || null;
  }
  async update(table, match, patch) {
    const res = await fetch(`${this.base}/${table}?${this._qs(match)}`, {
      method: 'PATCH',
      headers: { ...this.headers, prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`supabase update ${table}: ${res.status} ${await res.text()}`);
    return res.json();
  }
  async upsert(table, row, conflictKeys) {
    const res = await fetch(`${this.base}/${table}?on_conflict=${conflictKeys.join(',')}`, {
      method: 'POST',
      headers: { ...this.headers, prefer: 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`supabase upsert ${table}: ${res.status} ${await res.text()}`);
    return (await res.json())[0];
  }
  async putUpload(userId, filename, buffer) {
    // In live mode you'd use Supabase Storage; kept simple here.
    throw new Error('putUpload not implemented for SupabaseStore (use Supabase Storage)');
  }
}

function createStore() {
  const forceFile = (process.env.STORE || '').toLowerCase() === 'file';
  const hasSupabase = config.supabase.url && config.supabase.serviceKey;
  // Default: file store in mock mode or when Supabase isn't configured.
  if (forceFile || config.MOCK_MODE || !hasSupabase) {
    const dir = process.env.DATA_DIR || path.join(process.cwd(), '.data');
    return { kind: 'file', store: new FileStore(dir) };
  }
  return { kind: 'supabase', store: new SupabaseStore(config.supabase) };
}

module.exports = { createStore, FileStore, SupabaseStore, newId, nowIso };

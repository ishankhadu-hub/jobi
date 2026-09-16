'use strict';
/**
 * Minimal, zero-dependency .env loader.
 *
 * Why hand-rolled instead of `dotenv`? The whole backend is intentionally
 * dependency-free so `git clone && node ...` runs with no `npm install`. This
 * loader is deliberately tiny and only does what this project needs.
 *
 * It walks up from this file to find the repo-root `.env` (so it works no
 * matter which service's cwd you launch from), parses KEY="value" / KEY=value,
 * and DOES NOT overwrite variables already present in process.env (so real
 * shell/CI env always wins over the file).
 */
const fs = require('fs');
const path = require('path');

function findEnvFile(startDir) {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseValue(raw) {
  let s = raw.trim();
  if (!s) return '';
  const q = s[0];
  if (q === '"' || q === "'") {
    // Quoted: take everything up to the matching closing quote; anything after
    // (e.g. an inline comment) is ignored.
    const end = s.indexOf(q, 1);
    return end === -1 ? s.slice(1) : s.slice(1, end);
  }
  // Unquoted: strip an inline comment that is preceded by whitespace.
  const hash = s.search(/\s#/);
  if (hash !== -1) s = s.slice(0, hash);
  return s.trim();
}

function parse(contents) {
  const out = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // Allow an optional leading `export `.
    const withoutExport = line.replace(/^export\s+/, '');
    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;
    out[key] = parseValue(withoutExport.slice(eq + 1));
  }
  return out;
}

let loaded = false;
function load() {
  if (loaded) return;
  loaded = true;
  const file = findEnvFile(__dirname);
  if (!file) return; // No .env — rely purely on process.env (e.g. CI, Docker).
  const parsed = parse(fs.readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

module.exports = { load, findEnvFile, parse };

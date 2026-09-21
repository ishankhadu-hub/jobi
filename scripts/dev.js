'use strict';
/**
 * `npm run dev` — boots the gateway + dev-orchestrator together for local work.
 * This is the "no n8n needed" path: the orchestrator answers the same webhooks
 * n8n would. Run `npm run gateway` + `npx n8n` instead to use real n8n.
 */
const { spawn } = require('child_process');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
function run(name, script, color) {
  const p = spawn('node', [script], { cwd: REPO, env: process.env });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  p.stdout.on('data', (d) => process.stdout.write(tag + d.toString().replace(/\n(?!$)/g, '\n' + tag)));
  p.stderr.on('data', (d) => process.stderr.write(tag + d));
  p.on('exit', (c) => { console.log(`${tag}exited (${c})`); shutdown(); });
  return p;
}
const procs = [];
function shutdown() { for (const p of procs) try { p.kill('SIGINT'); } catch {} process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

procs.push(run('gateway', 'gateway/server.js', '36'));
procs.push(run('orchestrator', 'orchestrator-dev/server.js', '35'));
console.log('\nBoth services starting. App should point EXPO_PUBLIC_API_URL at the orchestrator (http://localhost:5678).\nCtrl+C to stop.\n');

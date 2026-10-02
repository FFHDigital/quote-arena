#!/usr/bin/env node
// MCP over stdio. With FK_BASE_URL set it proxies to the hosted /mcp endpoint (recommended);
// without it, it runs the whole insurer in-process against a local database.
import readline from 'node:readline';

const base = process.env.FK_BASE_URL;
const key = process.env.FK_API_KEY;
const write = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

let handle;
if (base) {
  handle = async (msg) => {
    const r = await fetch(`${base.replace(/\/$/, '')}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(msg) });
    if (r.status === 202) return null;
    return r.json();
  };
} else {
  process.removeAllListeners('warning');
  const { openDb } = await import('../src/db.js');
  const { handleMcpMessage } = await import('../src/api/mcp.js');
  const { resolveActor } = await import('../src/services/auth.js');
  openDb();
  const port = process.env.PORT || 8787;
  handle = (msg) => handleMcpMessage(msg, { baseUrl: `http://localhost:${port}`, ip: 'stdio', actor: resolveActor(key ? { authorization: `Bearer ${key}` } : {}) });
  log('[fairkarl-mcp] running in-process (set FK_BASE_URL to use a hosted server)');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  try {
    const out = await handle(msg);
    if (out) write(out);
  } catch (e) {
    if (msg.id !== undefined) write({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } });
  }
});

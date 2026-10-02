// Agent2Agent (A2A) JSON-RPC endpoint. Skills = our MCP tools. Send a DataPart
// {"skill": "create_quote", "input": {...}}; plain text gets a guided reply.
import { OPS_BY_NAME, runOperation } from './operations.js';
import { ApiError, id } from '../util.js';

const tasks = new Map();

function textHelp(text) {
  const t = String(text || '').toLowerCase();
  const hint = /claim|accident|crash|stolen|damage/.test(t) ? 'To claim, send {"skill":"create_claim","input":{"policy_id":"...","incident_type":"collision","description":"..."}} with a mandate token.'
    : /cancel/.test(t) ? 'To cancel, send {"skill":"quote_cancellation","input":{"policy_id":"..."}} then {"skill":"cancel_policy",...}.'
      : 'To get a price, send {"skill":"create_quote","input":{"country":"IE","vehicle":{"make":"Toyota","model":"Corolla","year":2021},"drivers":[{"age":38}]}}.';
  return `I am the FairKarl car insurance agent. I act on structured requests: send a DataPart with "skill" (any tool from our agent card) and "input". ${hint}`;
}

export async function handleA2a(msg, ctx) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message, data) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message, data } });
  if (msg?.jsonrpc !== '2.0') return fail(-32600, 'Invalid Request');
  if (msg.method === 'tasks/get') {
    const t = tasks.get(msg.params?.id);
    return t ? reply(t) : fail(-32001, 'Task not found');
  }
  if (msg.method === 'tasks/cancel') return fail(-32002, 'Task cannot be canceled (tasks complete synchronously).');
  if (msg.method !== 'message/send' && msg.method !== 'message/stream') return fail(-32601, `Method not found: ${msg.method}`);
  const m = msg.params?.message || {};
  const parts = m.parts || [];
  let data = parts.find((p) => p.kind === 'data' || p.type === 'data')?.data;
  const text = parts.filter((p) => p.kind === 'text' || p.type === 'text').map((p) => p.text).join('\n');
  if (!data && text) { try { const j = JSON.parse(text); if (j.skill || j.operation) data = j; } catch { /* plain text */ } }
  const contextId = m.contextId || id('ctx');
  if (!data) {
    return reply({ kind: 'message', role: 'agent', messageId: id('msg'), contextId, parts: [{ kind: 'text', text: textHelp(text) }] });
  }
  const skill = data.skill || data.operation || data.tool;
  const op = OPS_BY_NAME[skill];
  const task = { kind: 'task', id: id('task'), contextId, status: { state: 'working', timestamp: new Date().toISOString() }, history: [m], artifacts: [] };
  if (!op || op.internal) {
    task.status = { state: 'failed', timestamp: new Date().toISOString(), message: { kind: 'message', role: 'agent', messageId: id('msg'), parts: [{ kind: 'text', text: `Unknown skill "${skill}". See the skills list in /.well-known/agent-card.json.` }] } };
  } else {
    try {
      const result = await runOperation(op, data.input || data.arguments || {}, ctx);
      const needsHuman = result?.status === 'pending' && result?.action;
      task.status = { state: needsHuman ? 'input-required' : 'completed', timestamp: new Date().toISOString(), ...(needsHuman ? { message: { kind: 'message', role: 'agent', messageId: id('msg'), parts: [{ kind: 'text', text: result.human_message }] } } : {}) };
      task.artifacts = [{ artifactId: id('art'), name: `${skill}_result`, parts: [{ kind: 'data', data: result }] }];
    } catch (e) {
      const err = e instanceof ApiError ? e.toJSON() : { status: 500, code: 'internal_error', detail: 'Unexpected error; safe to retry.' };
      task.status = { state: 'failed', timestamp: new Date().toISOString(), message: { kind: 'message', role: 'agent', messageId: id('msg'), parts: [{ kind: 'data', data: { error: err } }, { kind: 'text', text: err.detail }] } };
    }
  }
  tasks.set(task.id, task);
  if (tasks.size > 5000) tasks.delete(tasks.keys().next().value);
  return reply(task);
}

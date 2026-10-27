// npm run e2e  (PM-run, live end-to-end: AC14)
//
// This drives a real local n8n through the public REST API against a mock
// Statuspage server and a local SMTP sink. It is written to be run by the PM after
// the unit tests pass. It never runs unless N8N_URL is set, and it never touches
// the production feeds.
//
// Required env:
//   N8N_URL       base URL of the local n8n, e.g. http://localhost:5678
//   N8N_API_KEY   an n8n public API key
// Optional env:
//   MOCK_PORT     port for the mock Statuspage server (default 8099)
//   SMTP_PORT     port for the local SMTP sink (default 2525)
//
// Flow: import workflow.json, create an SMTP credential pointing at the sink, patch
// only the config values and the trigger interval in the imported copy, activate,
// then drive the mock through baseline, new incident, update, resolution, outage
// (HTTP 500) and recovery, asserting the emails captured by the sink.

import net from 'node:net';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const N8N_URL = process.env.N8N_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;

if (!N8N_URL || !N8N_API_KEY) {
  process.stdout.write(
    'e2e needs a live n8n. Set N8N_URL and N8N_API_KEY to run it.\n' +
    'This script is intended for the PM after the unit tests pass; it is not run by `npm test`.\n',
  );
  process.exit(0);
}

const MOCK_PORT = Number(process.env.MOCK_PORT || 8099);
const SMTP_PORT = Number(process.env.SMTP_PORT || 2525);

// ---- Mock Statuspage server -------------------------------------------------
// Serves whatever incidents.json body we set, or a 500 to simulate an outage.
let mockState = { status: 200, body: { page: { name: 'Mock' }, incidents: [] } };
const mock = http.createServer((req, res) => {
  if (!req.url.endsWith('/api/v2/incidents.json')) {
    res.writeHead(404).end('not found');
    return;
  }
  if (mockState.status !== 200) {
    res.writeHead(mockState.status, { 'content-type': 'text/html' }).end('<html>outage</html>');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(mockState.body));
});

// ---- Minimal SMTP sink ------------------------------------------------------
// Accepts one message and records it. Just enough SMTP to capture DATA.
const captured = [];
const sink = net.createServer((socket) => {
  let mode = 'cmd';
  let buffer = '';
  let data = '';
  socket.write('220 sink\r\n');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (mode === 'data') {
        if (line === '.') {
          captured.push(data);
          data = '';
          mode = 'cmd';
          socket.write('250 ok\r\n');
        } else {
          data += line + '\n';
        }
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250 hello\r\n');
      else if (cmd === 'MAIL') socket.write('250 ok\r\n');
      else if (cmd === 'RCPT') socket.write('250 ok\r\n');
      else if (cmd === 'DATA') { mode = 'data'; socket.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
      else socket.write('250 ok\r\n');
    }
  });
});

// ---- n8n REST helpers -------------------------------------------------------
async function api(path, options = {}) {
  const res = await fetch(N8N_URL + '/api/v1' + path, {
    ...options,
    headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'content-type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(path + ' -> ' + res.status + ' ' + (await res.text()));
  return res.status === 204 ? null : res.json();
}

function patchConfig(workflow) {
  // Patch ONLY the config values and the trigger interval in the imported copy.
  const copy = JSON.parse(JSON.stringify(workflow));
  for (const node of copy.nodes) {
    if (node.type === 'n8n-nodes-base.set') {
      for (const a of node.parameters.assignments.assignments) {
        if (a.name === 'pages') a.value = 'Mock | http://127.0.0.1:' + MOCK_PORT;
        if (a.name === 'fromEmail') a.value = 'alerts@example.com';
        if (a.name === 'toEmail') a.value = 'me@example.com';
        if (a.name === 'failuresBeforeAlert') a.value = 1;
      }
    }
    if (node.type === 'n8n-nodes-base.scheduleTrigger') {
      node.parameters.rule.interval = [{ field: 'seconds', secondsInterval: 5 }];
    }
  }
  return copy;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await new Promise((r) => mock.listen(MOCK_PORT, r));
  await new Promise((r) => sink.listen(SMTP_PORT, r));
  process.stdout.write('Mock on ' + MOCK_PORT + ', SMTP sink on ' + SMTP_PORT + '\n');

  const file = JSON.parse(readFileSync(join(root, 'workflow.json'), 'utf8'));
  const patched = patchConfig(file);

  const cred = await api('/credentials', {
    method: 'POST',
    body: JSON.stringify({
      name: 'SMTP account',
      type: 'smtp',
      data: { user: 'x', password: 'x', host: '127.0.0.1', port: SMTP_PORT, secure: false, disableStartTls: true },
    }),
  });
  for (const node of patched.nodes) {
    if (node.type === 'n8n-nodes-base.emailSend') node.credentials = { smtp: { id: cred.id, name: 'SMTP account' } };
  }

  const created = await api('/workflows', { method: 'POST', body: JSON.stringify({ name: patched.name, nodes: patched.nodes, connections: patched.connections, settings: patched.settings }) });
  await api('/workflows/' + created.id + '/activate', { method: 'POST' });

  const incident = (status, impact, updatedAt) => ({
    id: 'e2e-1', name: 'Mock incident', status, impact, started_at: '2026-10-27T10:00:00Z', created_at: '2026-10-27T10:00:00Z', updated_at: updatedAt,
    incident_updates: [{ id: 'u', status, body: 'State is now ' + status, created_at: updatedAt }],
  });

  const steps = [
    ['baseline (no incidents)', () => { mockState = { status: 200, body: { page: {}, incidents: [] } }; }, 0],
    ['new incident', () => { mockState.body.incidents = [incident('investigating', 'major', '2026-10-27T10:00:00Z')]; }, 1],
    ['update', () => { mockState.body.incidents = [incident('identified', 'major', '2026-10-27T10:10:00Z')]; }, 1],
    ['resolution', () => { mockState.body.incidents = [incident('resolved', 'major', '2026-10-27T10:20:00Z')]; }, 1],
    ['outage (HTTP 500)', () => { mockState = { status: 500, body: null }; }, 1],
    ['recovery', () => { mockState = { status: 200, body: { page: {}, incidents: [incident('resolved', 'major', '2026-10-27T10:20:00Z')] } }; }, 1],
  ];

  let expectedTotal = 0;
  for (const [label, apply, expectDelta] of steps) {
    const before = captured.length;
    apply();
    await api('/workflows/' + created.id + '/run', { method: 'POST' }).catch(() => {});
    await wait(8000); // allow the scheduled run and the email to arrive
    expectedTotal += expectDelta;
    const got = captured.length - before;
    process.stdout.write('step "' + label + '": ' + got + ' email(s), expected ' + expectDelta + '\n');
    if (got !== expectDelta) throw new Error('step "' + label + '" expected ' + expectDelta + ' email(s), got ' + got);
  }

  await api('/workflows/' + created.id + '/deactivate', { method: 'POST' }).catch(() => {});
  process.stdout.write('e2e passed: ' + captured.length + ' emails captured, expected ' + expectedTotal + '\n');
  mock.close();
  sink.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write('e2e failed: ' + err.stack + '\n');
  mock.close();
  sink.close();
  process.exit(1);
});

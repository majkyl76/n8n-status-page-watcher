// npm run e2e  (live end-to-end, AC14)
//
// Drives a real local n8n through its public REST API. Two mock Statuspage servers
// and a tiny SMTP sink run on this machine. Nothing leaves localhost.
//
//   N8N_URL      base URL of the local n8n, e.g. http://127.0.0.1:5678
//   N8N_API_KEY  an n8n public API key
//   TICK_SECONDS optional, schedule interval used for the test (default 10)
//
// The imported copy is patched in three places only: the config values, the trigger
// interval and the SMTP credential. Every phase waits for the first execution that
// started after the mock was switched, then reads the mail the sink received.

import net from 'node:net';
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { N8N_URL, N8N_API_KEY } = process.env;
if (!N8N_URL || !N8N_API_KEY) {
  console.log('e2e needs a live n8n. Set N8N_URL and N8N_API_KEY to run it. It is not part of `npm test`.');
  process.exit(0);
}
// 10 s, not 6: a run where a page returns HTML 500 retries and takes about 6 s, so a
// 6 s tick made runs of the same workflow overlap and mail landed on the wrong phase.
const TICK = Number(process.env.TICK_SECONDS || 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- mock Statuspage servers ----------
const fixtureB = JSON.parse(readFileSync(join(root, 'fixtures/githubstatus.incidents.json'), 'utf8'));
const mockA = { status: 200, body: { page: {}, incidents: [] } };
const hits = { a: 0, b: 0 };
const statuspage = (key, get) =>
  http.createServer((req, res) => {
    if (!req.url.endsWith('/api/v2/incidents.json')) return res.writeHead(404).end('nope');
    hits[key]++;
    const s = get();
    if (s.status !== 200) return res.writeHead(s.status, { 'content-type': 'text/html' }).end('<html>outage</html>');
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(s.body));
  });
const serverA = statuspage('a', () => mockA);
const serverB = statuspage('b', () => ({ status: 200, body: fixtureB }));
const serverC = http.createServer((req, res) => res.writeHead(404, { 'content-type': 'text/html' }).end('<html><body>Not a status page</body></html>'));
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

// ---------- SMTP sink ----------
const mails = [];
const sink = net.createServer((socket) => {
  let mode = 'cmd', buffer = '', data = '';
  socket.write('220 sink ESMTP\r\n');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      if (mode === 'data') {
        if (line === '.') { mails.push({ at: Date.now(), raw: data }); data = ''; mode = 'cmd'; socket.write('250 queued\r\n'); }
        else data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') socket.write('250-sink\r\n250 8BITMIME\r\n');
      else if (cmd === 'DATA') { mode = 'data'; socket.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
      else socket.write('250 ok\r\n');
    }
  });
});

// Very small MIME reader: enough for subject, text part and html part.
function decodePart(headers, body) {
  const enc = (/content-transfer-encoding:\s*(\S+)/i.exec(headers) || [, '7bit'])[1].toLowerCase();
  if (enc === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (enc === 'quoted-printable') {
    const bytes = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bytes, 'latin1').toString('utf8');
  }
  return body;
}
function parseMail(raw) {
  const [head, ...rest] = raw.split('\n\n');
  const unfolded = head.replace(/\n[ \t]+/g, ' ');
  // RFC 2047: join neighbouring encoded words, then decode B and Q forms.
  const subjectHead = (/^subject:\s*(.*)$/im.exec(unfolded) || [, ''])[1].replace(/(\?=)\s+(=\?utf-8\?[bq]\?)/gi, '$1$2');
  const subject = subjectHead.replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_, t, v) =>
    t.toLowerCase() === 'b'
      ? Buffer.from(v, 'base64').toString('utf8')
      : Buffer.from(v.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'));
  const boundary = (/boundary="?([^"\s;]+)"?/i.exec(unfolded) || [])[1];
  const out = { subject, to: (/^to:\s*(.*)$/im.exec(unfolded) || [, ''])[1], from: (/^from:\s*(.*)$/im.exec(unfolded) || [, ''])[1], text: '', html: '', raw };
  const body = rest.join('\n\n');
  const parts = boundary ? body.split('--' + boundary).slice(1, -1) : [raw.slice(head.length + 2)];
  for (const p of parts) {
    const [ph, ...pb] = p.replace(/^\n/, '').split('\n\n');
    const content = decodePart(ph, pb.join('\n\n'));
    if (/text\/html/i.test(ph) || (!boundary && /text\/html/i.test(unfolded))) out.html += content;
    else if (/text\/plain/i.test(ph) || !boundary) out.text += content;
  }
  return out;
}

// ---------- n8n REST ----------
const api = async (path, init = {}) => {
  const r = await fetch(`${N8N_URL.replace(/\/$/, '')}/api/v1${path}`, {
    ...init, headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'content-type': 'application/json' },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${r.status} ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : null;
};
async function waitForRun(workflowId, afterMs, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { data } = await api(`/executions?workflowId=${workflowId}&limit=10&includeData=true`);
    const fresh = data.filter((e) => e.stoppedAt && new Date(e.startedAt).getTime() > afterMs)
      .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
    if (fresh.length) return fresh[0];
    await sleep(500);
  }
  throw new Error('timed out waiting for an execution');
}
// Wait until no execution of this workflow is still running (used after deactivating a
// workflow, so a late run cannot add mail to the next workflow's phase; REVIEW-2 item 3).
async function waitIdle(workflowId, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { data } = await api(`/executions?workflowId=${workflowId}&status=running&limit=10`);
    if (!data.length) return;
    await sleep(200);
  }
  throw new Error('timed out waiting for running executions to finish');
}
async function runPhase(workflowId, name) {
  // The mock was switched just before this call, so take the start time now. Sleeping first
  // lost the mail of an execution that started during the sleep (seen once in a live run).
  // Mail is attributed to the awaited execution by receive time: only mail that arrived
  // between its start and 500 ms after its stop counts. A run that started on the old mock
  // state and finished late can no longer leak mail into this phase (REVIEW-2 item 2).
  const T = Date.now();
  const exec = await waitForRun(workflowId, T);
  await sleep(500);
  const from = new Date(exec.startedAt).getTime();
  const to = new Date(exec.stoppedAt).getTime() + 500;
  const mine = mails.filter((m) => m.at >= from && m.at <= to).map((m) => m.raw);
  const parsed = mine.map(parseMail);
  console.log(`-- phase ${name}: execution ${exec.id} ${exec.status} (${to - 500 - from} ms), emails=${parsed.length}${parsed.map((m) => '\n     subject: ' + m.subject).join('')}`);
  if (exec.status !== 'success') console.log('   error:', JSON.stringify(exec.data?.resultData?.error ?? {}).slice(0, 2500), "lastNode=", exec.data?.resultData?.lastNodeExecuted);
  return { exec, mails: parsed, raw: mine };
}

const results = [];
const samples = {};
const check = (name, fn) => {
  try { fn(); results.push(1); console.log('PASS', name); }
  catch (e) { results.push(0); console.log('FAIL', name, '\n   ', String(e.message).split('\n').slice(0, 6).join('\n    ')); }
};

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const incident = (status, impact, updatedAgo, title = 'Elevated errors on the mock API', body = 'We are looking into it.') => ({
  id: 'e2e-1', name: title, status, impact, shortlink: 'https://stspg.io/e2e1',
  started_at: iso(30 * 60000), created_at: iso(30 * 60000), updated_at: iso(updatedAgo),
  components: [{ id: 'c1', name: 'API' }],
  incident_updates: [{ id: 'u1', status, body, created_at: iso(updatedAgo) }],
});

async function main() {
  const portA = await listen(serverA);
  const portB = await listen(serverB);
  const smtpPort = await listen(sink);
  const portC = await listen(serverC);
  const created = { workflow: null, credential: null };
  try {
    const cred = await api('/credentials', {
      method: 'POST',
      body: JSON.stringify({ name: 'e2e SMTP account', type: 'smtp', data: { user: '', password: '', host: '127.0.0.1', port: smtpPort, secure: false, disableStartTls: true } }),
    });
    created.credential = cred.id;
    const wf = JSON.parse(readFileSync(join(root, process.env.WORKFLOW_FILE || 'workflow.json'), 'utf8'));
    for (const n of wf.nodes) {
      if (n.type === 'n8n-nodes-base.set') {
        const set = (k, v) => { n.parameters.assignments.assignments.find((a) => a.name === k).value = v; };
        set('pages', `Mock A | http://127.0.0.1:${portA}\nGitHub fixture | http://127.0.0.1:${portB}`);
        set('fromEmail', 'alerts@example.com');
        set('toEmail', 'me@example.com');
        set('failuresBeforeAlert', 2);
        set('minimumImpact', 'minor');
      }
      if (n.type === 'n8n-nodes-base.scheduleTrigger') n.parameters.rule.interval = [{ field: 'seconds', secondsInterval: TICK }];
      if (n.type === 'n8n-nodes-base.emailSend') n.credentials = { smtp: { id: cred.id, name: cred.name } };
    }
    const w = await api('/workflows', { method: 'POST', body: JSON.stringify({ name: 'e2e ' + wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }) });
    created.workflow = w.id;
    console.log('imported workflow', w.id, 'with', w.nodes.length, 'nodes');
    await api(`/workflows/${w.id}/activate`, { method: 'POST', body: '{}' });
    console.log(`activated, schedule every ${TICK}s; mock A :${portA}, mock B (real GitHub fixture) :${portB}, SMTP sink :${smtpPort}`);

    let r = await runPhase(w.id, 'baseline');
    check('baseline: execution succeeded and both pages were fetched', () => { assert.equal(r.exec.status, 'success'); assert.ok(hits.a > 0 && hits.b > 0, 'pages fetched: ' + JSON.stringify(hits)); });
    check('baseline: no emails (only resolved history on the real fixture, nothing on mock A)', () => assert.equal(r.mails.length, 0));

    mockA.body.incidents = [incident('investigating', 'major', 60000, 'Errors <script>alert(1)</script> & "quotes"')];
    r = await runPhase(w.id, 'new');
    check('new: one email for the new incident', () => {
      assert.equal(r.mails.length, 1);
      const m = r.mails[0];
      assert.match(m.subject, /^\[Status\] Mock A: new incident - /);
      assert.ok(m.to.includes('me@example.com') && m.from.includes('alerts@example.com'));
      assert.match(m.text, /https:\/\/stspg\.io\/e2e1/);
      assert.match(m.text, /API/);
      assert.match(m.text, /UTC/);
    });
    check('new: HTML body escapes hostile incident text', () => {
      const m = r.mails[0];
      assert.ok(m.html.length > 0, 'no html part found');
      assert.ok(!m.html.includes('<script>'), 'raw <script> in html');
      assert.ok(m.html.includes('&lt;script&gt;'));
      assert.ok(!/<\/?(p|br|div|html|body|table|b|a)[\s>]/i.test(m.text), 'markup added to plain text? ' + m.text.slice(0, 300));
    });
    samples.new = r.mails[0];

    r = await runPhase(w.id, 'nochange');
    check('nochange: static data persisted, nothing repeated', () => assert.equal(r.mails.length, 0));

    mockA.body.incidents = [incident('identified', 'major', 20000, 'Errors <script>alert(1)</script> & "quotes"', 'We found the cause.')];
    r = await runPhase(w.id, 'update');
    check('update: one email for the update', () => {
      assert.equal(r.mails.length, 1);
      assert.match(r.mails[0].text, /We found the cause/);
      assert.match(r.mails[0].subject, /^\[Status\] Mock A: update - /);
    });

    mockA.body.incidents = [incident('resolved', 'major', 5000, 'Errors <script>alert(1)</script> & "quotes"', 'All fixed.')];
    r = await runPhase(w.id, 'resolved');
    check('resolved: one resolved email', () => {
      assert.equal(r.mails.length, 1);
      assert.match(r.mails[0].subject, /^\[Status\] Mock A: resolved - /);
    });
    samples.resolved = r.mails[0];
    r = await runPhase(w.id, 'resolved-again');
    check('resolved-again: nothing repeated', () => assert.equal(r.mails.length, 0));

    mockA.status = 500;
    r = await runPhase(w.id, 'outage-1');
    check('outage 1 of 2: no email yet, other page still checked', () => { assert.equal(r.exec.status, 'success'); assert.equal(r.mails.length, 0); });
    r = await runPhase(w.id, 'outage-2');
    check('outage 2 of 2: one "unreachable" email for Mock A only', () => {
      assert.equal(r.mails.length, 1);
      assert.match(r.mails[0].subject, /Mock A/);
      assert.match(r.mails[0].subject, /^\[Status\] Mock A: page unreachable - /);
    });
    samples.unreachable = r.mails[0];
    r = await runPhase(w.id, 'outage-3');
    check('outage 3: still down, no repeat', () => assert.equal(r.mails.length, 0));
    mockA.status = 200;
    r = await runPhase(w.id, 'recovery');
    check('recovery: one "recovered" email and no repeated old incident', () => {
      assert.equal(r.mails.length, 1);
      assert.match(r.mails[0].subject, /^\[Status\] Mock A: page recovered - /);
    });
    samples.recovered = r.mails[0];
    r = await runPhase(w.id, 'steady');
    check('steady: quiet again', () => assert.equal(r.mails.length, 0));

    // ---- a second copy pointed at a closed port: real network-error items from the HTTP node ----
    await api(`/workflows/${w.id}/deactivate`, { method: 'POST', body: '{}' });
    await waitIdle(w.id); // a late run of w must not add mail to the next phase (REVIEW-2 item 3)
    // A port that is known to be closed: listen on an ephemeral port, then close it (REVIEW-2 item 4).
    const probe = net.createServer();
    const deadPort = await listen(probe);
    await new Promise((r) => probe.close(r));
    const dead = JSON.parse(JSON.stringify(wf));
    for (const n of dead.nodes) {
      if (n.type === 'n8n-nodes-base.set') {
        const set = (k, v) => { n.parameters.assignments.assignments.find((a) => a.name === k).value = v; };
        set('pages', `Dead host | http://127.0.0.1:${deadPort}\nHTML 404 | http://127.0.0.1:${portC}`);
        set('failuresBeforeAlert', 1);
      }
    }
    const w2 = await api('/workflows', { method: 'POST', body: JSON.stringify({ name: 'e2e dead ' + wf.name, nodes: dead.nodes, connections: dead.connections, settings: dead.settings }) });
    created.workflow2 = w2.id;
    await api(`/workflows/${w2.id}/activate`, { method: 'POST', body: '{}' });
    r = await runPhase(w2.id, 'connection-refused');
    check('closed port and HTML 404 body: run still succeeds and each page gets one "unreachable" email', () => {
      assert.equal(r.exec.status, 'success');
      assert.equal(r.mails.length, 2, JSON.stringify(r.mails.map((m) => m.subject)));
      const subjects = r.mails.map((m) => m.subject).join('\n');
      assert.match(subjects, /Dead host/);
      assert.match(subjects, /HTML 404/);
      assert.ok(r.mails.every((m) => /unreachable/i.test(m.subject)));
    });

    mkdirSync(join(root, 'samples'), { recursive: true });
    writeFileSync(join(root, 'samples/e2e-emails.txt'),
      Object.entries(samples).map(([k, m]) => `===== ${k} =====\nSubject: ${m.subject}\nTo: ${m.to}\nFrom: ${m.from}\n\n${m.text}`).join('\n\n'));
  } finally {
    if (created.workflow) {
      await api(`/workflows/${created.workflow}/deactivate`, { method: 'POST', body: '{}' }).catch(() => {});
      await api(`/workflows/${created.workflow}`, { method: 'DELETE' }).catch(() => {});
    }
    if (created.workflow2) {
      await api(`/workflows/${created.workflow2}/deactivate`, { method: 'POST', body: '{}' }).catch(() => {});
      await api(`/workflows/${created.workflow2}`, { method: 'DELETE' }).catch(() => {});
    }
    if (created.credential) await api(`/credentials/${created.credential}`, { method: 'DELETE' }).catch(() => {});
    serverA.close(); serverB.close(); serverC.close(); sink.close();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`\ne2e summary: ${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('e2e crashed:', e); process.exit(2); });

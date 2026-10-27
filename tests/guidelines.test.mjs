// AC1, AC2, AC3, AC5: structure, sticky note guidelines, no secrets, node naming.
// These tests parse workflow.json only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorkflow, ROOT } from './helpers.mjs';

const workflow = loadWorkflow();
const stickyType = 'n8n-nodes-base.stickyNote';
const triggerTypes = ['n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.manualTrigger'];

const nodes = workflow.nodes;
const stickies = nodes.filter((n) => n.type === stickyType);
const functional = nodes.filter((n) => n.type !== stickyType);

function rect(node) {
  const [x, y] = node.position;
  return { x, y, w: node.parameters.width, h: node.parameters.height };
}

function covers(sticky, node) {
  const r = rect(sticky);
  const [x, y] = node.position;
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

test('AC1: valid JSON with name, nodes, connections, settings', () => {
  assert.equal(typeof workflow.name, 'string');
  assert.ok(workflow.name.length > 0);
  assert.ok(Array.isArray(workflow.nodes));
  assert.equal(typeof workflow.connections, 'object');
  assert.equal(typeof workflow.settings, 'object');
});

test('AC1: workflow title is plain, at most 80 chars, no emoji', () => {
  assert.ok(workflow.name.length <= 80);
  // Emoji live well above the basic multilingual plane plus common symbol ranges.
  assert.ok(!/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/u.test(workflow.name));
});

test('AC1: active is false', () => {
  assert.equal(workflow.active, false);
});

test('AC1: no instance-specific top-level fields', () => {
  assert.ok(!('id' in workflow), 'workflow should have no top-level id');
  assert.ok(!('versionId' in workflow), 'no versionId');
  assert.ok(!('pinData' in workflow), 'no pinData');
  if (workflow.meta) {
    assert.ok(!('instanceId' in workflow.meta), 'no meta.instanceId');
  }
});

test('AC1: unique node names and ids', () => {
  const names = nodes.map((n) => n.name);
  const ids = nodes.map((n) => n.id);
  assert.equal(new Set(names).size, names.length, 'node names must be unique');
  assert.equal(new Set(ids).size, ids.length, 'node ids must be unique');
  for (const id of ids) assert.ok(id && typeof id === 'string', 'every node has a string id');
});

test('AC1: no disabled nodes', () => {
  for (const n of nodes) assert.ok(!n.disabled, 'node must not be disabled: ' + n.name);
});

test('AC1: every connection endpoint exists', () => {
  const names = new Set(nodes.map((n) => n.name));
  for (const [source, conn] of Object.entries(workflow.connections)) {
    assert.ok(names.has(source), 'connection source exists: ' + source);
    for (const outputs of Object.values(conn)) {
      for (const group of outputs) {
        for (const link of group) {
          assert.ok(names.has(link.node), 'connection target exists: ' + link.node);
        }
      }
    }
  }
});

test('AC1: every non-sticky non-trigger node is reachable from a trigger', () => {
  const triggers = nodes.filter((n) => triggerTypes.includes(n.type)).map((n) => n.name);
  const reached = new Set(triggers);
  let changed = true;
  while (changed) {
    changed = false;
    for (const source of reached) {
      const conn = workflow.connections[source];
      if (!conn) continue;
      for (const outputs of Object.values(conn)) {
        for (const group of outputs) {
          for (const link of group) {
            if (!reached.has(link.node)) {
              reached.add(link.node);
              changed = true;
            }
          }
        }
      }
    }
  }
  for (const n of functional) {
    if (triggerTypes.includes(n.type)) continue;
    assert.ok(reached.has(n.name), 'node reachable from a trigger: ' + n.name);
  }
});

test('AC1: no orphan functional nodes (each has a connection in or out)', () => {
  const hasOut = new Set(Object.keys(workflow.connections));
  const hasIn = new Set();
  for (const conn of Object.values(workflow.connections)) {
    for (const outputs of Object.values(conn)) {
      for (const group of outputs) {
        for (const link of group) hasIn.add(link.node);
      }
    }
  }
  for (const n of functional) {
    assert.ok(hasOut.has(n.name) || hasIn.has(n.name), 'node is connected: ' + n.name);
  }
});

test('AC1: every node type and typeVersion exists in installed n8n-nodes-base', () => {
  const base = '/workspace/n8n-local/node_modules/n8n-nodes-base/dist/nodes';
  if (!existsSync(base)) {
    console.log('AC1: installed n8n-nodes-base not found, skipping version existence check');
    return;
  }
  const fileFor = {
    'n8n-nodes-base.scheduleTrigger': 'Schedule/ScheduleTrigger.node.js',
    'n8n-nodes-base.manualTrigger': 'ManualTrigger/ManualTrigger.node.js',
    'n8n-nodes-base.set': 'Set/Set.node.js',
    'n8n-nodes-base.code': 'Code/Code.node.js',
    'n8n-nodes-base.httpRequest': 'HttpRequest/HttpRequest.node.js',
    'n8n-nodes-base.if': 'If/If.node.js',
    'n8n-nodes-base.emailSend': 'EmailSend/EmailSend.node.js',
    'n8n-nodes-base.stickyNote': 'StickyNote/StickyNote.node.js',
  };
  for (const n of nodes) {
    const rel = fileFor[n.type];
    assert.ok(rel, 'known file for type ' + n.type);
    const file = join(base, rel);
    assert.ok(existsSync(file), 'node file exists for ' + n.type);
    const src = readFileSync(file, 'utf8');
    // Collect the version numbers declared by the node (version:[...] / version:N / defaultVersion:N).
    const available = [];
    for (const m of src.matchAll(/(?:default)?[vV]ersion:\s*(\[[^\]]*\]|[0-9.]+)/g)) {
      const token = m[1];
      for (const num of token.replace(/[[\]]/g, '').split(',')) {
        const v = Number(num.trim());
        if (Number.isFinite(v)) available.push(v);
      }
    }
    const max = Math.max(...available);
    assert.ok(n.typeVersion >= 1 && n.typeVersion <= max, n.type + ' typeVersion ' + n.typeVersion + ' within [1,' + max + ']');
  }
});

test('AC2: exactly one yellow main sticky, top-left', () => {
  const yellow = stickies.filter((s) => s.parameters.color === 1);
  assert.equal(yellow.length, 1, 'exactly one yellow overview sticky');
  const main = yellow[0];
  const minX = Math.min(...nodes.map((n) => n.position[0]));
  const minY = Math.min(...nodes.map((n) => n.position[1]));
  assert.equal(main.position[0], minX, 'main sticky x is the minimum of all nodes');
  assert.equal(main.position[1], minY, 'main sticky y is the minimum of all nodes');
});

test('AC2: main sticky is 100 to 300 words with required headings', () => {
  const main = stickies.find((s) => s.parameters.color === 1);
  const words = wordCount(main.parameters.content);
  assert.ok(words >= 100 && words <= 300, 'main sticky word count ' + words + ' in [100,300]');
  assert.ok(main.parameters.content.includes('### How it works'), 'has How it works heading');
  assert.ok(main.parameters.content.includes('### Setup'), 'has Setup heading');
});

test('AC2: Setup section names credential, config, test and static-data limit', () => {
  const main = stickies.find((s) => s.parameters.color === 1);
  const c = main.parameters.content;
  assert.ok(c.includes('SMTP account'), 'names the SMTP credential');
  assert.ok(/pages/i.test(c) && /minimumImpact/.test(c), 'names config values to edit');
  assert.ok(/manual/i.test(c) && /test/i.test(c), 'says how to test');
  assert.ok(/static data/i.test(c) && /active/i.test(c), 'states the static-data limitation');
});

test('AC2: white section stickies each cover >=2 nodes and not the main sticky', () => {
  const main = stickies.find((s) => s.parameters.color === 1);
  const white = stickies.filter((s) => s.parameters.color === 7);
  assert.ok(white.length >= 1, 'has white section stickies');
  for (const s of white) {
    const covered = functional.filter((n) => covers(s, n));
    assert.ok(covered.length >= 2, s.name + ' covers at least two nodes (got ' + covered.length + ')');
    assert.ok(wordCount(s.parameters.content) < 50, s.name + ' under 50 words');
    assert.ok(/^###?\s|\n###?\s/.test(s.parameters.content) || s.parameters.content.startsWith('#'), s.name + ' has a heading');
    assert.ok(!covers(s, main), s.name + ' does not cover the main sticky');
  }
});

test('AC2: white section stickies cover every functional node', () => {
  const white = stickies.filter((s) => s.parameters.color === 7);
  for (const n of functional) {
    const covered = white.some((s) => covers(s, n));
    assert.ok(covered, 'functional node covered by a section sticky: ' + n.name);
  }
});

test('AC2: at most one red sticky, covering exactly one node (the Send Email node)', () => {
  const red = stickies.filter((s) => s.parameters.color === 3);
  assert.ok(red.length <= 1, 'at most one red sticky');
  for (const s of red) {
    const covered = functional.filter((n) => covers(s, n));
    assert.equal(covered.length, 1, 'red sticky covers exactly one node');
    assert.equal(covered[0].type, 'n8n-nodes-base.emailSend', 'red sticky is on the Send Email node');
  }
});

test('AC2: no stickies other than yellow(1), white(7), red(3)', () => {
  for (const s of stickies) {
    assert.ok([1, 3, 7].includes(s.parameters.color), 'sticky colour is 1, 3 or 7: ' + s.name);
  }
});

test('AC3: no secrets anywhere in the workflow', () => {
  const raw = JSON.stringify(workflow);
  const forbidden = [
    /Bearer\s/i,
    /api[_-]?key/i,
    /smtp\.gmail\.com/i,
    /smtp\.sendgrid/i,
    /\bmajkyl76\b/i,
    /patyjewicz/i,
    /\bmichal\b/i,
    /password"\s*:\s*"[^"]+"/i,
  ];
  for (const re of forbidden) {
    assert.ok(!re.test(raw), 'no secret matching ' + re);
  }
});

test('AC3: Send Email references smtp credential by name, no id', () => {
  const send = nodes.find((n) => n.type === 'n8n-nodes-base.emailSend');
  assert.ok(send.credentials && send.credentials.smtp, 'has smtp credential reference');
  assert.equal(send.credentials.smtp.name, 'SMTP account');
  assert.ok(!('id' in send.credentials.smtp), 'no credential id');
});

test('AC3: email placeholders are obvious placeholders in the Set node', () => {
  const set = nodes.find((n) => n.type === 'n8n-nodes-base.set');
  const assignments = set.parameters.assignments.assignments;
  const from = assignments.find((a) => a.name === 'fromEmail').value;
  const to = assignments.find((a) => a.name === 'toEmail').value;
  assert.equal(from, 'YOUR_SENDER_ADDRESS');
  assert.equal(to, 'YOUR_RECIPIENT_ADDRESS');
});

test('AC3: the HTTP Request node needs no credential', () => {
  const http = nodes.find((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.ok(!http.credentials, 'HTTP node has no credentials');
});

test('AC5: no default n8n node names', () => {
  const defaults = [
    'HTTP Request', 'Set', 'Edit Fields', 'Code', 'If', 'Send Email',
    'Schedule Trigger', 'Manual Trigger',
  ];
  // A default name is the base word optionally followed by a number (e.g. "Code1").
  const re = new RegExp('^(' + defaults.map((d) => d.replace(/[()]/g, '')).join('|') + ')\\d*$');
  for (const n of functional) {
    assert.ok(!re.test(n.name), 'not a default name: ' + n.name);
  }
});

test('AC5: functional node names are at most 50 characters', () => {
  for (const n of functional) {
    assert.ok(n.name.length <= 50, n.name + ' is <= 50 chars');
  }
});

test('Code nodes avoid globals that the n8n Code node sandbox does not provide (URL, Buffer, structuredClone)', () => {
  // Found in the live run: `new URL(...)` threw "URL is not defined" inside n8n.
  const wf = JSON.parse(readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
  for (const node of wf.nodes.filter((n) => n.type === 'n8n-nodes-base.code')) {
    assert.doesNotMatch(node.parameters.jsCode, /\b(new URL|URLSearchParams|Buffer|structuredClone|TextEncoder|TextDecoder)\b/, node.name);
  }
});

// AC13: one seeded randomised property test and one golden-output test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadWorkflow, runDetect, okResponse, defaultSettings, incident, ROOT, DEFAULT_NOW,
} from './helpers.mjs';

const workflow = loadWorkflow();
const PAGE = { pageKey: 'https://x.example', label: 'X', apiUrl: 'https://x.example/api/v2/incidents.json' };
const RESOLVED = ['resolved', 'postmortem', 'completed'];
const RANK = { none: 0, minor: 1, major: 2, critical: 3 };

// Small deterministic PRNG (mulberry32) with a fixed seed.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Independent reference model of the event rules (success responses, one page,
// minimumImpact=minor, no component filter, alertOnResolved=true).
function referenceRun(state, incidents, settings) {
  const events = [];
  const next = Object.create(null);
  for (const inc of incidents) {
    const id = String(inc.id);
    const status = String(inc.status);
    const impact = typeof inc.impact === 'string' ? inc.impact : 'none';
    const updatedAt = String(inc.updated_at);
    const resolved = RESOLVED.includes(status.toLowerCase());
    const passes = (RANK[impact] || 0) >= (RANK[settings.minimumImpact] || 0);
    const prev = state.incidents[id];
    if (prev === undefined) {
      if (resolved) {
        next[id] = { status, updatedAt, impact, notified: false };
      } else {
        next[id] = { status, updatedAt, impact, notified: passes };
        if (passes) events.push('new');
      }
    } else {
      // AC16: only a strictly later updated_at counts; AC15: resolved only after a real alert.
      const later = Date.parse(updatedAt) > Date.parse(prev.updatedAt);
      const changed = prev.status !== status || prev.impact !== impact || later;
      const keptAt = Date.parse(updatedAt) < Date.parse(prev.updatedAt) ? prev.updatedAt : updatedAt;
      let notified = prev.notified === true;
      if (changed) {
        if (resolved) {
          // AC15: only alert once per resolution; a stored status that was
          // already resolved (resolved/postmortem/completed) must not re-alert.
          const prevResolved = RESOLVED.includes(prev.status.toLowerCase());
          if (settings.alertOnResolved && prev.notified === true && !prevResolved) events.push('resolved');
        } else if (passes) {
          events.push('update');
          notified = true;
        }
      }
      next[id] = { status, updatedAt: keptAt, impact, notified };
    }
  }
  state.incidents = next;
  return events.sort();
}

function nodeEventTypes(out) {
  const types = [];
  for (const it of out) {
    for (const line of it.json.text.split('\n')) {
      const m = line.match(/^\d+\.\s([A-Z]+)\s-\s/);
      if (m) types.push(m[1].toLowerCase());
    }
  }
  return types.sort();
}

test('AC13: random poll sequences match the reference model', () => {
  const rand = mulberry32(987654321);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  // Includes postmortem/completed so a resolved incident moving between resolved
  // statuses (F-A) is exercised, not just open -> resolved.
  const statuses = ['investigating', 'identified', 'monitoring', 'resolved', 'postmortem', 'completed'];
  const impacts = ['none', 'minor', 'major', 'critical'];
  const ids = ['a', 'b', 'c'];
  const base = Date.parse('2026-10-27T00:00:00Z');
  const settings = defaultSettings();

  for (let trial = 0; trial < 40; trial++) {
    const nodeState = { pages: {} };
    const refState = { incidents: Object.create(null) };
    for (let run = 0; run < 8; run++) {
      const incidents = [];
      for (const id of ids) {
        if (rand() < 0.3) continue; // sometimes the incident is absent this run
        const revision = Math.floor(rand() * 6); // controls whether updated_at changes, including bumps after resolution
        incidents.push(incident({
          id,
          name: 'Incident ' + id,
          status: pick(statuses),
          impact: pick(impacts),
          updated_at: new Date(base + revision * 3600 * 1000).toISOString(),
        }));
      }
      const out = runDetect(workflow, { pages: [PAGE], responses: [okResponse({ page: {}, incidents })], settings, staticData: nodeState, now: DEFAULT_NOW });
      const expected = referenceRun(refState, incidents, settings);
      assert.deepEqual(nodeEventTypes(out), expected, 'trial ' + trial + ' run ' + run);
    }
  }
});

test('AC13: golden sequence produces the expected events JSON', () => {
  const goldenPath = join(ROOT, 'tests', 'golden', 'expected-events.json');
  assert.ok(existsSync(goldenPath), 'golden file exists');
  const expected = JSON.parse(readFileSync(goldenPath, 'utf8'));

  const name = 'Database latency';
  const sequence = [
    [incident({ id: 'A', name, status: 'investigating', impact: 'major', updated_at: '2026-10-27T10:00:00Z' })],
    [incident({ id: 'A', name, status: 'identified', impact: 'major', updated_at: '2026-10-27T10:30:00Z' })],
    [incident({ id: 'A', name, status: 'resolved', impact: 'major', updated_at: '2026-10-27T11:00:00Z' })],
    [incident({ id: 'A', name, status: 'resolved', impact: 'major', updated_at: '2026-10-27T11:00:00Z' })],
  ];

  const state = { pages: {} };
  const runs = [];
  for (const incidents of sequence) {
    const out = runDetect(workflow, { pages: [PAGE], responses: [okResponse({ page: {}, incidents })], settings: defaultSettings(), staticData: state, now: DEFAULT_NOW });
    runs.push(out.map((it) => ({
      label: it.json.label,
      subject: it.json.subject,
      eventCount: it.json.eventCount,
      events: nodeEventTypes([it]),
    })));
  }
  assert.deepEqual(runs, expected);
});

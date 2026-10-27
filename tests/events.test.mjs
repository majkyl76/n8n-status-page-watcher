// AC6: new/updated/resolved logic. AC9: state hygiene and caps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadWorkflow, loadFixture, runDetect, okResponse, defaultSettings, incident,
} from './helpers.mjs';

const workflow = loadWorkflow();

const PAGE = { pageKey: 'https://x.example', label: 'X', apiUrl: 'https://x.example/api/v2/incidents.json' };

// Count emitted events of each type across all output items.
function eventTypes(items) {
  // The detect node emits one item per page with a text body listing the events.
  // We recover the per-event types from the plain-text body lines "N. TYPE - ...".
  const types = [];
  for (const it of items) {
    for (const line of it.json.text.split('\n')) {
      const m = line.match(/^\d+\.\s([A-Z]+)\s-\s/);
      if (m) types.push(m[1].toLowerCase());
    }
  }
  return types;
}

function detect(responses, settings, staticData) {
  return runDetect(workflow, {
    pages: [PAGE],
    responses,
    settings: settings || defaultSettings(),
    staticData: staticData || { pages: {} },
  });
}

test('AC6: first run with only resolved incidents yields no events but stores state', () => {
  const body = { page: {}, incidents: [incident({ id: 'r1', status: 'resolved', impact: 'minor' })] };
  const state = { pages: {} };
  const out = detect([okResponse(body)], defaultSettings(), state);
  assert.equal(out.length, 0, 'no email');
  const ps = state.pages[PAGE.pageKey];
  assert.ok(ps.initialised, 'page initialised');
  assert.ok(ps.incidents.r1, 'resolved incident stored as history');
  assert.equal(ps.incidents.r1.notified, false);
});

test('AC6: an unresolved incident on the first run yields one new event', () => {
  const body = { page: {}, incidents: [incident({ id: 'o1', status: 'investigating', impact: 'major' })] };
  const state = { pages: {} };
  const out = detect([okResponse(body)], defaultSettings(), state);
  assert.deepEqual(eventTypes(out), ['new']);
  assert.equal(state.pages[PAGE.pageKey].incidents.o1.notified, true);
});

test('AC6: a repeat run with no change yields no events', () => {
  const body = { page: {}, incidents: [incident({ id: 'o1', status: 'investigating', impact: 'major' })] };
  const state = { pages: {} };
  detect([okResponse(body)], defaultSettings(), state);
  const out = detect([okResponse(body)], defaultSettings(), state);
  assert.equal(out.length, 0);
});

test('AC6: a changed updated_at or status yields an update event', () => {
  const state = { pages: {} };
  const first = { page: {}, incidents: [incident({ id: 'o1', status: 'investigating', impact: 'major', updated_at: '2026-10-27T10:00:00Z' })] };
  detect([okResponse(first)], defaultSettings(), state);
  const second = { page: {}, incidents: [incident({ id: 'o1', status: 'identified', impact: 'major', updated_at: '2026-10-27T11:00:00Z' })] };
  const out = detect([okResponse(second)], defaultSettings(), state);
  assert.deepEqual(eventTypes(out), ['update']);
});

test('AC6: resolution yields one resolved event and then none', () => {
  const state = { pages: {} };
  const open = { page: {}, incidents: [incident({ id: 'o1', status: 'investigating', impact: 'major', updated_at: '2026-10-27T10:00:00Z' })] };
  detect([okResponse(open)], defaultSettings(), state);
  const resolved = { page: {}, incidents: [incident({ id: 'o1', status: 'resolved', impact: 'major', updated_at: '2026-10-27T11:00:00Z' })] };
  const out1 = detect([okResponse(resolved)], defaultSettings(), state);
  assert.deepEqual(eventTypes(out1), ['resolved']);
  const out2 = detect([okResponse(resolved)], defaultSettings(), state);
  assert.equal(out2.length, 0, 'no repeat resolution');
});

test('AC6: alertOnResolved false suppresses resolved events', () => {
  const state = { pages: {} };
  const open = { page: {}, incidents: [incident({ id: 'o1', status: 'investigating', impact: 'major', updated_at: '2026-10-27T10:00:00Z' })] };
  detect([okResponse(open)], defaultSettings({ alertOnResolved: false }), state);
  const resolved = { page: {}, incidents: [incident({ id: 'o1', status: 'resolved', impact: 'major', updated_at: '2026-10-27T11:00:00Z' })] };
  const out = detect([okResponse(resolved)], defaultSettings({ alertOnResolved: false }), state);
  assert.equal(out.length, 0);
});

test('AC6: resolved events are suppressed for never-notified incidents', () => {
  // Incident below the impact filter is seen, stored but never notified. When it
  // later resolves, no resolution email (we never told the user about it).
  const state = { pages: {} };
  const settings = defaultSettings({ minimumImpact: 'critical' });
  const open = { page: {}, incidents: [incident({ id: 'o1', status: 'investigating', impact: 'minor', updated_at: '2026-10-27T10:00:00Z' })] };
  const o1 = detect([okResponse(open)], settings, state);
  assert.equal(o1.length, 0, 'minor incident does not pass critical filter');
  assert.equal(state.pages[PAGE.pageKey].incidents.o1.notified, false);
  const resolved = { page: {}, incidents: [incident({ id: 'o1', status: 'resolved', impact: 'minor', updated_at: '2026-10-27T11:00:00Z' })] };
  const out = detect([okResponse(resolved)], settings, state);
  assert.equal(out.length, 0, 'no resolution for a never-notified incident');
});

test('AC6: real fixtures are all resolved so first run emits nothing', () => {
  for (const name of ['githubstatus.incidents.json', 'cloudflarestatus.incidents.json', 'openai.incidents.json']) {
    const body = loadFixture(name);
    const state = { pages: {} };
    const out = detect([okResponse(body)], defaultSettings(), state);
    assert.equal(out.length, 0, name + ' first run emits nothing');
    assert.ok(state.pages[PAGE.pageKey].initialised, name + ' initialised');
  }
});

test('AC9: state is pruned to incident ids present in the latest response', () => {
  const state = { pages: {} };
  const first = { page: {}, incidents: [incident({ id: 'a', status: 'investigating', impact: 'major' }), incident({ id: 'b', status: 'investigating', impact: 'major' })] };
  detect([okResponse(first)], defaultSettings(), state);
  const second = { page: {}, incidents: [incident({ id: 'b', status: 'investigating', impact: 'major' })] };
  detect([okResponse(second)], defaultSettings(), state);
  const ids = Object.keys(state.pages[PAGE.pageKey].incidents);
  assert.deepEqual(ids, ['b'], 'incident a pruned');
});

test('AC9: per-page cap and the "+N more" line', () => {
  const incidents = [];
  for (let i = 0; i < 15; i++) {
    incidents.push(incident({ id: 'n' + i, status: 'investigating', impact: 'major', name: 'Incident ' + i }));
  }
  const state = { pages: {} };
  const out = detect([okResponse({ page: {}, incidents })], defaultSettings({ maxIncidentsPerPage: 10 }), state);
  assert.equal(out.length, 1);
  assert.equal(out[0].json.eventCount, 15);
  assert.ok(out[0].json.text.includes('+5 more events not shown'), 'shows +5 more');
  assert.equal(eventTypes(out).length, 10, 'only 10 events listed');
  // State still tracks all 15.
  assert.equal(Object.keys(state.pages[PAGE.pageKey].incidents).length, 15);
});

test('AC9: two pages with identical incident ids never collide', () => {
  const pages = [
    { pageKey: 'https://a.example', label: 'A', apiUrl: 'https://a.example/api/v2/incidents.json' },
    { pageKey: 'https://b.example', label: 'B', apiUrl: 'https://b.example/api/v2/incidents.json' },
  ];
  const state = { pages: {} };
  const body = { page: {}, incidents: [incident({ id: 'shared', status: 'investigating', impact: 'major' })] };
  const out = runDetect(workflow, { pages, responses: [okResponse(body), okResponse(body)], settings: defaultSettings(), staticData: state });
  assert.equal(out.length, 2, 'both pages emit');
  assert.ok(state.pages['https://a.example'].incidents.shared);
  assert.ok(state.pages['https://b.example'].incidents.shared);
});

test('AC9: running twice with the same input produces no repeated events', () => {
  const body = { page: {}, incidents: [incident({ id: 'o1', status: 'investigating', impact: 'major' })] };
  const state = { pages: {} };
  const first = detect([okResponse(body)], defaultSettings(), state);
  assert.equal(first.length, 1);
  const second = detect([okResponse(body)], defaultSettings(), state);
  assert.equal(second.length, 0);
});

test('AC9: odd keys like __proto__ and constructor do not pollute or break', () => {
  const state = { pages: {} };
  const body = {
    page: {},
    incidents: [
      incident({ id: '__proto__', status: 'investigating', impact: 'major', name: 'Proto incident' }),
      incident({ id: 'constructor', status: 'investigating', impact: 'major', name: 'Ctor incident' }),
    ],
  };
  const out = detect([okResponse(body)], defaultSettings(), state);
  assert.equal(out.length, 1);
  assert.equal(eventTypes(out).length, 2);
  // Object.prototype is untouched.
  assert.equal(({}).polluted, undefined);
  assert.ok(Object.hasOwn(state.pages[PAGE.pageKey].incidents, '__proto__'));
});

test('AC9: odd page labels do not break the run', () => {
  const pages = [{ pageKey: 'https://odd.example', label: '__proto__', apiUrl: 'https://odd.example/api/v2/incidents.json' }];
  const body = { page: {}, incidents: [incident({ id: 'o1', status: 'investigating', impact: 'major' })] };
  const out = runDetect(workflow, { pages, responses: [okResponse(body)], settings: defaultSettings(), staticData: { pages: {} } });
  assert.equal(out.length, 1);
  assert.equal(out[0].json.label, '__proto__');
});

test('AC15: a resolved incident first seen as history, then edited later, emits nothing', () => {
  const state = { pages: {} };
  const resolvedAt = (updated) => ({ page: {}, incidents: [incident({ id: 'h1', status: 'resolved', impact: 'major', updated_at: updated, resolved_at: '2026-10-27T09:00:00Z' })] });
  assert.equal(detect([okResponse(resolvedAt('2026-10-27T09:00:00Z'))], defaultSettings(), state).length, 0);
  const out = detect([okResponse(resolvedAt('2026-10-27T11:00:00Z'))], defaultSettings(), state);
  assert.equal(out.length, 0, 'history edit must not alert');
  assert.equal(state.pages[PAGE.pageKey].incidents.h1.notified, false);
});

test('AC15: an incident alerted as open and then resolved still emits one resolved event', () => {
  const state = { pages: {} };
  const open = { page: {}, incidents: [incident({ id: 'o1', status: 'investigating', impact: 'major', updated_at: '2026-10-27T10:00:00Z' })] };
  detect([okResponse(open)], defaultSettings(), state);
  const done = { page: {}, incidents: [incident({ id: 'o1', status: 'resolved', impact: 'major', updated_at: '2026-10-27T11:00:00Z' })] };
  assert.deepEqual(eventTypes(detect([okResponse(done)], defaultSettings(), state)), ['resolved']);
  assert.equal(detect([okResponse(done)], defaultSettings(), state).length, 0);
});

test('AC15: an incident that never passed the filter while open does not emit resolved', () => {
  const state = { pages: {} };
  const settings = defaultSettings({ minimumImpact: 'major' });
  const open = { page: {}, incidents: [incident({ id: 'm1', status: 'investigating', impact: 'minor', updated_at: '2026-10-27T10:00:00Z' })] };
  assert.equal(detect([okResponse(open)], settings, state).length, 0);
  const done = { page: {}, incidents: [incident({ id: 'm1', status: 'resolved', impact: 'major', updated_at: '2026-10-27T11:00:00Z' })] };
  assert.equal(detect([okResponse(done)], settings, state).length, 0);
});

test('AC16: an older updated_at than the stored one emits nothing and does not move state back', () => {
  const state = { pages: {} };
  const at = (u) => ({ page: {}, incidents: [incident({ id: 'o1', status: 'investigating', impact: 'major', updated_at: u })] });
  detect([okResponse(at('2026-10-27T11:00:00Z'))], defaultSettings(), state);
  const out = detect([okResponse(at('2026-10-27T10:00:00Z'))], defaultSettings(), state);
  assert.equal(out.length, 0);
  assert.equal(state.pages[PAGE.pageKey].incidents.o1.updatedAt, '2026-10-27T11:00:00Z');
  assert.equal(detect([okResponse(at('2026-10-27T11:00:00Z'))], defaultSettings(), state).length, 0, 'no flip-flop alert when the newer value returns');
});

test('AC16: a strictly later updated_at, or a changed status or impact, still counts', () => {
  const state = { pages: {} };
  const at = (u, status, impact) => ({ page: {}, incidents: [incident({ id: 'o1', status: status || 'investigating', impact: impact || 'major', updated_at: u })] });
  detect([okResponse(at('2026-10-27T10:00:00Z'))], defaultSettings(), state);
  assert.deepEqual(eventTypes(detect([okResponse(at('2026-10-27T11:00:00Z'))], defaultSettings(), state)), ['update']);
  assert.deepEqual(eventTypes(detect([okResponse(at('2026-10-27T10:30:00Z', 'identified'))], defaultSettings(), state)), ['update'], 'status change counts even with an older timestamp');
  assert.deepEqual(eventTypes(detect([okResponse(at('2026-10-27T10:30:00Z', 'identified', 'critical'))], defaultSettings(), state)), ['update'], 'impact change counts');
});

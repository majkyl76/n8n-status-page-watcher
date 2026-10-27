// AC7: minimum impact ranking and component keyword filtering.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadWorkflow, loadFixture, runDetect, okResponse, defaultSettings, incident,
} from './helpers.mjs';

const workflow = loadWorkflow();
const PAGE = { pageKey: 'https://x.example', label: 'X', apiUrl: 'https://x.example/api/v2/incidents.json' };

function detect(body, settings, state) {
  return runDetect(workflow, {
    pages: [PAGE],
    responses: [okResponse(body)],
    settings: settings || defaultSettings(),
    staticData: state || { pages: {} },
  });
}

function emitted(out) {
  return out.length > 0;
}

test('AC7: minimumImpact ranks none<minor<major<critical', () => {
  const ranks = ['none', 'minor', 'major', 'critical'];
  for (let min = 0; min < ranks.length; min++) {
    for (let imp = 0; imp < ranks.length; imp++) {
      const body = { page: {}, incidents: [incident({ id: 'i', status: 'investigating', impact: ranks[imp] })] };
      const out = detect(body, defaultSettings({ minimumImpact: ranks[min] }), { pages: {} });
      assert.equal(emitted(out), imp >= min, `impact ${ranks[imp]} vs min ${ranks[min]}`);
    }
  }
});

test('AC7: unknown or missing impact is treated as none', () => {
  const body = { page: {}, incidents: [incident({ id: 'i', status: 'investigating', impact: 'weird' })] };
  // none rank with a minor minimum => filtered out.
  assert.equal(emitted(detect(body, defaultSettings({ minimumImpact: 'minor' }), { pages: {} })), false);
  // with a none minimum => passes.
  assert.equal(emitted(detect(body, defaultSettings({ minimumImpact: 'none' }), { pages: {} })), true);

  const noImpact = { page: {}, incidents: [incident({ id: 'i', status: 'investigating', impact: undefined })] };
  assert.equal(emitted(detect(noImpact, defaultSettings({ minimumImpact: 'minor' }), { pages: {} })), false);
});

test('AC7: component keyword matches incident components', () => {
  const body = { page: {}, incidents: [incident({ id: 'i', status: 'investigating', impact: 'minor', components: [{ name: 'API Requests' }] })] };
  assert.equal(emitted(detect(body, defaultSettings({ componentKeywords: ['api'] }), { pages: {} })), true);
  assert.equal(emitted(detect(body, defaultSettings({ componentKeywords: ['database'] }), { pages: {} })), false);
});

test('AC7: component keyword matches affected_components in updates', () => {
  const body = {
    page: {},
    incidents: [incident({
      id: 'i', status: 'investigating', impact: 'minor', components: [],
      incident_updates: [{ id: 'u', status: 'investigating', body: 'x', affected_components: [{ name: 'Dashboard' }] }],
    })],
  };
  assert.equal(emitted(detect(body, defaultSettings({ componentKeywords: ['dashboard'] }), { pages: {} })), true);
});

test('AC7: component keyword also matches the incident name', () => {
  const body = { page: {}, incidents: [incident({ id: 'i', name: 'Webhooks degraded', status: 'investigating', impact: 'minor', components: [] })] };
  assert.equal(emitted(detect(body, defaultSettings({ componentKeywords: ['webhooks'] }), { pages: {} })), true);
});

test('AC7: keyword matching is case-insensitive', () => {
  const body = { page: {}, incidents: [incident({ id: 'i', status: 'investigating', impact: 'minor', components: [{ name: 'API Requests' }] })] };
  assert.equal(emitted(detect(body, defaultSettings({ componentKeywords: ['API'] }), { pages: {} })), true);
});

test('AC7: status feed payload with no components does not crash', () => {
  const body = loadFixture('status feed.incidents.json');
  // Force one incident open so the filter path with a keyword runs over a component-less payload.
  body.incidents = body.incidents.map((i, idx) => (idx === 0 ? Object.assign({}, i, { status: 'investigating' }) : i));
  const out = detect(body, defaultSettings({ componentKeywords: ['api'] }), { pages: {} });
  // No throw is the real assertion; result shape is a valid array.
  assert.ok(Array.isArray(out));
});

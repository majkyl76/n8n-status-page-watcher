// AC8: failure counting, one unreachable alert at the threshold, one recovered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadWorkflow, runDetect, okResponse, httpStatusResponse, errorResponse, defaultSettings, incident,
} from './helpers.mjs';

const workflow = loadWorkflow();
const PAGE = { pageKey: 'https://x.example', label: 'X', apiUrl: 'https://x.example/api/v2/incidents.json' };

function detect(response, settings, state) {
  return runDetect(workflow, {
    pages: [PAGE],
    responses: [response],
    settings: settings || defaultSettings(),
    staticData: state,
  });
}

function hasEventType(out, type) {
  return out.some((it) => new RegExp('\\b' + type.toUpperCase() + '\\b').test(it.json.text));
}

const failureKinds = {
  '404 with HTML body': httpStatusResponse(404, '<html>Not found</html>'),
  'network error item': errorResponse('getaddrinfo ENOTFOUND status.example'),
  'invalid JSON (string body)': httpStatusResponse(200, 'not json at all'),
  'JSON without incidents array': httpStatusResponse(200, { page: {}, something: true }),
};

for (const [label, response] of Object.entries(failureKinds)) {
  test('AC8: ' + label + ' counts as a failure and alerts once at the threshold', () => {
    const state = { pages: {} };
    const settings = defaultSettings({ failuresBeforeAlert: 3 });
    // Two failures: no alert yet.
    assert.equal(detect(response, settings, state).length, 0);
    assert.equal(detect(response, settings, state).length, 0);
    assert.equal(state.pages[PAGE.pageKey].failures, 2);
    // Third failure: one unreachable alert.
    const out = detect(response, settings, state);
    assert.ok(hasEventType(out, 'unreachable'), 'unreachable alert at threshold');
    assert.equal(state.pages[PAGE.pageKey].failureAlerted, true);
    // Fourth failure: no repeat alert.
    assert.equal(detect(response, settings, state).length, 0, 'no repeat unreachable');
    assert.equal(state.pages[PAGE.pageKey].failures, 4);
  });
}

test('AC8: a success after an alert emits exactly one recovered event', () => {
  const state = { pages: {} };
  const settings = defaultSettings({ failuresBeforeAlert: 1 });
  const out1 = detect(httpStatusResponse(500, 'boom'), settings, state);
  assert.ok(hasEventType(out1, 'unreachable'));
  const body = { page: {}, incidents: [incident({ id: 'o1', status: 'resolved', impact: 'minor' })] };
  const out2 = detect(okResponse(body), settings, state);
  assert.ok(hasEventType(out2, 'recovered'), 'recovered on first success');
  assert.equal(state.pages[PAGE.pageKey].failureAlerted, false);
  const out3 = detect(okResponse(body), settings, state);
  assert.equal(out3.length, 0, 'no repeat recovered');
});

test('AC8: incident state is kept through failures', () => {
  const state = { pages: {} };
  const settings = defaultSettings();
  const open = { page: {}, incidents: [incident({ id: 'o1', status: 'investigating', impact: 'major' })] };
  detect(okResponse(open), settings, state);
  assert.ok(state.pages[PAGE.pageKey].incidents.o1, 'stored before failure');
  detect(httpStatusResponse(503, 'down'), settings, state);
  assert.ok(state.pages[PAGE.pageKey].incidents.o1, 'incident state survives the failure');
});

test('AC8: one broken page does not stop the others', () => {
  const pages = [
    { pageKey: 'https://good.example', label: 'Good', apiUrl: 'https://good.example/api/v2/incidents.json' },
    { pageKey: 'https://bad.example', label: 'Bad', apiUrl: 'https://bad.example/api/v2/incidents.json' },
  ];
  const good = { page: {}, incidents: [incident({ id: 'o1', status: 'investigating', impact: 'major' })] };
  const out = runDetect(workflow, {
    pages,
    responses: [okResponse(good), errorResponse('boom')],
    settings: defaultSettings({ failuresBeforeAlert: 1 }),
    staticData: { pages: {} },
  });
  // Good page emits its new event; bad page emits an unreachable alert.
  assert.equal(out.length, 2);
  const labels = out.map((it) => it.json.label).sort();
  assert.deepEqual(labels, ['Bad', 'Good']);
});

test('AC8: an error item is handled without throwing', () => {
  assert.doesNotThrow(() => detect(errorResponse('socket hang up'), defaultSettings(), { pages: {} }));
});

test('AC8: a corrupt non-numeric stored failure counter still reaches the unreachable alert (review 3 F2)', () => {
  const state = { pages: { [PAGE.pageKey]: { incidents: {}, failures: 'lots', failureAlerted: false, initialised: true } } };
  const settings = defaultSettings({ failuresBeforeAlert: 3 });
  const response = httpStatusResponse(500, 'boom');
  for (let i = 0; i < 2; i++) {
    assert.equal(detect(response, settings, state).length, 0);
  }
  const out = detect(response, settings, state);
  assert.ok(hasEventType(out, 'unreachable'), 'unreachable alert fires despite the corrupt stored counter');
  assert.equal(state.pages[PAGE.pageKey].failureAlerted, true);
});

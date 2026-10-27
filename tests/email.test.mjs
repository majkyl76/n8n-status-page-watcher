// AC10: email subject and body content, escaping, length limits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadWorkflow, runDetect, okResponse, defaultSettings, incident,
} from './helpers.mjs';

const workflow = loadWorkflow();
const PAGE = { pageKey: 'https://x.example', label: 'X', apiUrl: 'https://x.example/api/v2/incidents.json' };

function detectOne(body, settings) {
  const out = runDetect(workflow, {
    pages: [PAGE],
    responses: [okResponse(body)],
    settings: settings || defaultSettings(),
    staticData: { pages: {} },
  });
  assert.equal(out.length, 1, 'expected one email');
  return out[0].json;
}

test('AC10: subject follows the format and stays under 150 chars with no newlines', () => {
  const body = { page: {}, incidents: [incident({ id: 'o1', name: 'API errors', status: 'investigating', impact: 'major' })] };
  const email = detectOne(body);
  assert.match(email.subject, /^\[Status\] X: 1 new event - API errors$/);
  assert.ok(email.subject.length < 150);
  assert.ok(!email.subject.includes('\n'));
});

test('AC10: subject pluralises and names the most severe event', () => {
  const body = {
    page: {},
    incidents: [
      incident({ id: 'a', name: 'Minor blip', status: 'investigating', impact: 'minor' }),
      incident({ id: 'b', name: 'Big outage', status: 'investigating', impact: 'critical' }),
    ],
  };
  const email = detectOne(body);
  assert.match(email.subject, /^\[Status\] X: 2 new events - Big outage$/);
});

test('AC10: a very long title keeps the subject under 150 chars', () => {
  const body = { page: {}, incidents: [incident({ id: 'o1', name: 'z'.repeat(300), status: 'investigating', impact: 'major' })] };
  const email = detectOne(body);
  assert.ok(email.subject.length < 150, 'subject length ' + email.subject.length);
});

test('AC10: body lists event type, impact, status, components, update, times and link', () => {
  const body = {
    page: {},
    incidents: [incident({
      id: 'o1', name: 'API errors', status: 'investigating', impact: 'major',
      started_at: '2026-10-27T10:00:00Z', updated_at: '2026-10-27T10:30:00Z',
      components: [{ name: 'API Requests' }],
      shortlink: 'https://stspg.io/abc',
      incident_updates: [{ id: 'u', status: 'investigating', body: 'We are investigating the API errors.', created_at: '2026-10-27T10:30:00Z' }],
    })],
  };
  const email = detectOne(body);
  assert.match(email.text, /NEW - API errors/);
  assert.match(email.text, /Impact: major/);
  assert.match(email.text, /Status: investigating/);
  assert.match(email.text, /Components: API Requests/);
  assert.match(email.text, /Update: We are investigating the API errors\./);
  assert.match(email.text, /Started: 2026-10-27 10:00 UTC/);
  assert.match(email.text, /Updated: 2026-10-27 10:30 UTC/);
  assert.match(email.text, /Link: https:\/\/stspg\.io\/abc/);
});

test('AC10: link falls back to origin + /incidents/<id> when no shortlink', () => {
  const body = { page: {}, incidents: [incident({ id: 'xyz', name: 'No link', status: 'investigating', impact: 'major', shortlink: undefined })] };
  const email = detectOne(body);
  assert.match(email.text, /Link: https:\/\/x\.example\/incidents\/xyz/);
});

test('AC10: update text is cut to 500 chars at a word boundary', () => {
  const longBody = ('word '.repeat(400)).trim(); // 2000 chars of words
  const body = { page: {}, incidents: [incident({ id: 'o1', status: 'investigating', impact: 'major', incident_updates: [{ id: 'u', status: 'investigating', body: longBody }] })] };
  const email = detectOne(body);
  const m = email.text.match(/Update: (.*)/);
  assert.ok(m, 'has an update line');
  const text = m[1];
  assert.ok(text.endsWith('...'), 'ends with an ellipsis');
  assert.ok(text.length <= 503, 'cut near 500 chars (got ' + text.length + ')');
  assert.ok(!text.slice(0, -3).endsWith(' '), 'cut at a word boundary');
});

test('AC10: HTML body escapes hostile dynamic text', () => {
  const body = {
    page: {},
    incidents: [incident({
      id: 'o1', name: '<script>alert("x")</script> & "quotes"', status: 'investigating', impact: 'major',
      components: [{ name: 'A & B <tag>' }],
    })],
  };
  const email = detectOne(body);
  assert.ok(!email.html.includes('<script>'), 'no raw script tag');
  assert.ok(email.html.includes('&lt;script&gt;'), 'script is escaped');
  assert.ok(email.html.includes('&amp;'), 'ampersand is escaped');
  assert.ok(email.html.includes('&quot;') || email.html.includes('&#39;'), 'quotes are escaped');
});

test('AC10: plain-text body contains no HTML tags', () => {
  const body = {
    page: {},
    incidents: [incident({
      id: 'o1', name: 'Clean', status: 'investigating', impact: 'major',
      incident_updates: [{ id: 'u', status: 'investigating', body: 'Line one.<br />Line two with <b>bold</b>.' }],
    })],
  };
  const email = detectOne(body);
  assert.ok(!/<[a-z/][^>]*>/i.test(email.text), 'no HTML tags in the plain-text body');
});

test('AC10: both bodies stay under 20000 characters', () => {
  const incidents = [];
  for (let i = 0; i < 10; i++) {
    incidents.push(incident({ id: 'n' + i, name: 'Incident ' + i, status: 'investigating', impact: 'major', incident_updates: [{ id: 'u', status: 'investigating', body: 'x'.repeat(2000) }] }));
  }
  const email = detectOne({ page: {}, incidents });
  assert.ok(email.text.length < 20000, 'text under 20000');
  assert.ok(email.html.length < 20000, 'html under 20000');
});

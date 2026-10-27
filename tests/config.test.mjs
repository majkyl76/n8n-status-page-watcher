// AC4: config validation in the "Check settings and list status pages" node.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkflow, runCheckSettings } from './helpers.mjs';

const workflow = loadWorkflow();

function base(overrides = {}) {
  return Object.assign(
    {
      pages: 'GitHub | https://www.githubstatus.com',
      minimumImpact: 'minor',
      componentKeywords: '',
      alertOnResolved: true,
      fromEmail: 'alerts@example.com',
      toEmail: 'me@example.com',
      failuresBeforeAlert: 3,
      ignoreIncidentsOlderThanHours: 48,
      maxIncidentsPerPage: 10,
    },
    overrides,
  );
}

function run(overrides) {
  return runCheckSettings(workflow, base(overrides));
}

test('AC4: rejects placeholder fromEmail', () => {
  assert.throws(() => run({ fromEmail: 'YOUR_SENDER_ADDRESS' }), /fromEmail/);
});

test('AC4: rejects placeholder toEmail', () => {
  assert.throws(() => run({ toEmail: 'YOUR_RECIPIENT_ADDRESS' }), /toEmail/);
});

test('AC4: rejects empty fromEmail', () => {
  assert.throws(() => run({ fromEmail: '' }), /fromEmail/);
});

test('AC4: rejects email without @', () => {
  assert.throws(() => run({ toEmail: 'not-an-email' }), /toEmail/);
});

test('AC4: rejects no pages', () => {
  assert.throws(() => run({ pages: '' }), /No status pages/);
});

test('AC4: rejects an unparsable page line, naming the offending text', () => {
  assert.throws(() => run({ pages: 'Broken | ||| not a url with spaces' }), /Broken/);
});

test('AC4: a line with a label but no URL is rejected', () => {
  assert.throws(() => run({ pages: 'JustALabel |' }), /JustALabel/);
});

test('AC4: rejects minimumImpact not in the allowed list', () => {
  assert.throws(() => run({ minimumImpact: 'huge' }), /minimumImpact/);
});

test('AC4: rejects non-positive numbers', () => {
  assert.throws(() => run({ failuresBeforeAlert: 0 }), /failuresBeforeAlert/);
  assert.throws(() => run({ maxIncidentsPerPage: -1 }), /maxIncidentsPerPage/);
  assert.throws(() => run({ ignoreIncidentsOlderThanHours: 0 }), /ignoreIncidentsOlderThanHours/);
});

test('AC4: accepts a full label and URL', () => {
  const items = run({ pages: 'GitHub | https://www.githubstatus.com/' });
  assert.equal(items.length, 1);
  assert.equal(items[0].json.label, 'GitHub');
  assert.equal(items[0].json.pageKey, 'https://www.githubstatus.com');
  assert.equal(items[0].json.apiUrl, 'https://www.githubstatus.com/api/v2/incidents.json');
});

test('AC4: accepts a bare host and adds https', () => {
  const items = run({ pages: 'githubstatus.com' });
  assert.equal(items[0].json.pageKey, 'https://githubstatus.com');
  assert.equal(items[0].json.label, 'githubstatus.com');
});

test('AC4: reduces a full API URL to its origin', () => {
  const items = run({ pages: 'https://www.githubstatus.com/api/v2/incidents.json' });
  assert.equal(items[0].json.pageKey, 'https://www.githubstatus.com');
  assert.equal(items[0].json.apiUrl, 'https://www.githubstatus.com/api/v2/incidents.json');
});

test('AC4: ignores blank lines and # comments', () => {
  const items = run({ pages: '\n# a comment\nGitHub | https://www.githubstatus.com\n\n' });
  assert.equal(items.length, 1);
});

test('AC4: de-duplicates by origin', () => {
  const items = run({ pages: 'GitHub | https://www.githubstatus.com\nGH again | https://www.githubstatus.com/api/v2/incidents.json' });
  assert.equal(items.length, 1);
});

test('AC4: allows http as well as https', () => {
  const items = run({ pages: 'Local | http://status.internal.example' });
  assert.equal(items[0].json.pageKey, 'http://status.internal.example');
});

test('AC4: parses settings onto each page item', () => {
  const items = run({ pages: 'A | https://a.example\nB | https://b.example', componentKeywords: 'API\nDashboard' });
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].json.settings.componentKeywords, ['api', 'dashboard']);
  assert.equal(items[0].json.settings.minimumImpact, 'minor');
});

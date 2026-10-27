// The limits are documented and the copy passes the writing checks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorkflow, ROOT } from './helpers.mjs';
import { lintText, stickyTexts } from '../scripts/lint-lib.mjs';

const workflow = loadWorkflow();

function read(name) {
  const p = join(ROOT, name);
  assert.ok(existsSync(p), name + ' exists');
  return readFileSync(p, 'utf8');
}

test('README passes the copy checks', () => {
  assert.deepEqual(lintText('README', read('README.md')), []);
});

test('sticky note text passes the copy checks', () => {
  const issues = [];
  for (const text of stickyTexts(workflow)) issues.push(...lintText('sticky', text));
  assert.deepEqual(issues, []);
});

test('lint flags the noun "license" but not the verb "to license"', () => {
  const nounCases = [
    'This project is released under the MIT license.',
    'See the license for details.',
    'Our license terms apply to everyone.',
    "The software's license is permissive.",
    'An expired license must be renewed.',
  ];
  for (const text of nounCases) {
    const issues = lintText('test', text);
    assert.ok(issues.some((i) => i.includes('license')), 'should flag noun use: ' + text);
  }

  const verbCases = [
    'You may license this software to others.',
    'Vendors license their data to third parties.',
    'We plan to license the technology next year.',
  ];
  for (const text of verbCases) {
    const issues = lintText('test', text);
    assert.deepEqual(issues.filter((i) => i.includes('license')), [], 'should not flag verb use: ' + text);
  }
});

test('lint flags license noun uses missed before the fix', () => {
  const missedNounCases = [
    'This has a permissive open source software license.',
    'License terms are at the end.',
  ];
  for (const text of missedNounCases) {
    const issues = lintText('test', text);
    assert.ok(issues.some((i) => i.includes('license')), 'should flag noun use: ' + text);
  }
});

test('lint does not flag verb uses marked by a preceding modal or pronoun', () => {
  const verbCases = [
    'You must license the software before use.',
    'They will license it next month.',
    'We can license this technology to partners.',
    'I shall license the code under these terms.',
    'Should we license this component separately?',
  ];
  for (const text of verbCases) {
    const issues = lintText('test', text);
    assert.deepEqual(issues.filter((i) => i.includes('license')), [], 'should not flag verb use: ' + text);
  }
});

function statesLimits(label, text) {
  const t = text.toLowerCase();
  assert.ok(/statuspage v2/.test(t), label + ' names Statuspage v2 support');
  assert.ok(/github/.test(t) && /cloudflare/.test(t) && /npm/.test(t), label + ' lists the three tested vendors');
  assert.ok(/maintenance/.test(t), label + ' notes maintenance windows are ignored');
  assert.ok(/static data/.test(t) && /active/.test(t), label + ' notes the static-data limit');
  assert.ok(/first run/.test(t), label + ' notes first-run behaviour');
}

test('README documents the honest limits', () => {
  const t = read('README.md').toLowerCase();
  statesLimits('README', read('README.md'));
  assert.ok(/not real ?time|polling/.test(t), 'README notes polling is not real time');
});

test('the main sticky documents the key limits', () => {
  const main = stickyTexts(workflow).find((t) => t.includes('### How it works'));
  assert.ok(main, 'main sticky found');
  const t = main.toLowerCase();
  assert.ok(/statuspage v2/.test(t), 'sticky names Statuspage v2');
  assert.ok(/static data/.test(t) && /active/.test(t), 'sticky notes static-data limit');
  assert.ok(/maintenance/.test(t), 'sticky notes maintenance ignored');
});

// AC11: honest limits are documented. AC12: copy quality.

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

test('AC12: README passes the copy checks', () => {
  assert.deepEqual(lintText('README', read('README.md')), []);
});

test('AC12: LISTING passes the copy checks', () => {
  assert.deepEqual(lintText('LISTING', read('LISTING.md')), []);
});

test('AC12: sticky note text passes the copy checks', () => {
  const issues = [];
  for (const text of stickyTexts(workflow)) issues.push(...lintText('sticky', text));
  assert.deepEqual(issues, []);
});

function statesLimits(label, text) {
  const t = text.toLowerCase();
  assert.ok(/statuspage v2/.test(t), label + ' names Statuspage v2 support');
  assert.ok(/github/.test(t) && /cloudflare/.test(t) && /status feed/.test(t), label + ' lists the three tested vendors');
  assert.ok(/maintenance/.test(t), label + ' notes maintenance windows are ignored');
  assert.ok(/static data/.test(t) && /active/.test(t), label + ' notes the static-data limit');
  assert.ok(/first run/.test(t), label + ' notes first-run behaviour');
}

test('AC11: README documents the honest limits', () => {
  const t = read('README.md').toLowerCase();
  statesLimits('README', read('README.md'));
  assert.ok(/not real ?time|polling/.test(t), 'README notes polling is not real time');
});

test('AC11: LISTING documents the honest limits', () => {
  statesLimits('LISTING', read('LISTING.md'));
});

test('AC11: the main sticky documents the key limits', () => {
  const main = stickyTexts(workflow).find((t) => t.includes('### How it works'));
  assert.ok(main, 'main sticky found');
  const t = main.toLowerCase();
  assert.ok(/statuspage v2/.test(t), 'sticky names Statuspage v2');
  assert.ok(/static data/.test(t) && /active/.test(t), 'sticky notes static-data limit');
  assert.ok(/maintenance/.test(t), 'sticky notes maintenance ignored');
});

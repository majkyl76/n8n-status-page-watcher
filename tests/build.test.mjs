// Build integrity: workflow.json must be exactly what scripts/build.mjs produces,
// so the shipped artefact can never drift from src/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWorkflow, serialise } from '../scripts/build.mjs';
import { ROOT } from './helpers.mjs';

test('workflow.json is not stale (matches a fresh build)', () => {
  const onDisk = readFileSync(join(ROOT, 'workflow.json'), 'utf8');
  const fresh = serialise(buildWorkflow());
  assert.equal(onDisk, fresh, 'run `npm run build` to refresh workflow.json');
});

test('each Code node ships exactly its src file', () => {
  const workflow = buildWorkflow();
  const pairs = [
    ['Check settings and list status pages', 'check-settings.js'],
    ['Detect new, updated and resolved incidents', 'detect-incidents.js'],
  ];
  for (const [nodeName, file] of pairs) {
    const node = workflow.nodes.find((n) => n.name === nodeName);
    const src = readFileSync(join(ROOT, 'src', file), 'utf8');
    assert.equal(node.parameters.jsCode, src, nodeName + ' ships ' + file);
  }
});

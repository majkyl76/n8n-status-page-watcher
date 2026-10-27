// npm run lint:copy
// Checks README.md and the sticky note text in workflow.json against the writing
// rules in lint-lib.mjs (no em dashes, no banned words, British spelling).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lintText, stickyTexts } from './lint-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const workflow = JSON.parse(readFileSync(join(root, 'workflow.json'), 'utf8'));

const targets = [
  ['README.md', readFileSync(join(root, 'README.md'), 'utf8')],
  ['sticky notes', stickyTexts(workflow).join('\n\n')],
];

let issues = [];
for (const [label, text] of targets) {
  issues = issues.concat(lintText(label, text));
}

if (issues.length) {
  process.stdout.write('\nCopy issues:\n' + issues.map((i) => '  - ' + i).join('\n') + '\n');
  process.exit(1);
}
process.stdout.write('\nCopy checks passed.\n');

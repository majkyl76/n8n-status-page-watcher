// npm run lint:copy
// Checks README.md, LISTING.md and the sticky note text in workflow.json for the
// writing rules (no em dashes, no banned words, British spelling). Runs the shared
// JS checks, and also the team writing linter at /workspace/team/lint-writing.py
// when it is available.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { lintText, stickyTexts } from './lint-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const workflow = JSON.parse(readFileSync(join(root, 'workflow.json'), 'utf8'));
const stickyCombined = stickyTexts(workflow).join('\n\n');

const targets = [
  ['README.md', readFileSync(join(root, 'README.md'), 'utf8')],
  ['LISTING.md', readFileSync(join(root, 'LISTING.md'), 'utf8')],
  ['sticky notes', stickyCombined],
];

let issues = [];
for (const [label, text] of targets) {
  issues = issues.concat(lintText(label, text));
}

// Also run the team linter, if present, over each file plus the sticky text.
const teamLinter = '/workspace/team/lint-writing.py';
if (existsSync(teamLinter)) {
  const stickyFile = join(root, 'docs', '.sticky-text.tmp');
  writeFileSync(stickyFile, stickyCombined);
  const files = [
    [join(root, 'README.md'), '400'],
    [join(root, 'LISTING.md'), '400'],
    [stickyFile, '60'],
  ];
  for (const [file, words] of files) {
    const res = spawnSync('python3', [teamLinter, file, '--words', words], { encoding: 'utf8' });
    process.stdout.write('\n[lint-writing.py] ' + file + '\n' + (res.stdout || '') + (res.stderr || ''));
    if (res.status !== 0) issues.push('team linter flagged ' + file);
  }
}

if (issues.length) {
  process.stdout.write('\nCopy issues:\n' + issues.map((i) => '  - ' + i).join('\n') + '\n');
  process.exit(1);
}
process.stdout.write('\nCopy checks passed.\n');

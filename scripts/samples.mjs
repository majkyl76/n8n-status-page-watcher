// npm run samples
// Produces sample outputs under samples/ using the same harness the unit tests use,
// driven by the captured fixtures. These are illustrations, not test fixtures.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  loadWorkflow, loadFixture, runCheckSettings, runDetect, okResponse, defaultSettings, DEFAULT_NOW,
} from '../tests/helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = (name, text) => writeFileSync(join(root, 'samples', name), text);

const workflow = loadWorkflow();

// 1. The settings node turning the default pages box into page items.
const config = {
  pages: 'GitHub | https://www.githubstatus.com\nCloudflare | https://www.cloudflarestatus.com\nstatus feed | https://status.status feed.com',
  minimumImpact: 'minor',
  componentKeywords: '',
  alertOnResolved: true,
  fromEmail: 'alerts@example.com',
  toEmail: 'me@example.com',
  failuresBeforeAlert: 3,
  ignoreIncidentsOlderThanHours: 48,
  maxIncidentsPerPage: 10,
};
const pages = runCheckSettings(workflow, config);
out('parsed-pages.json', JSON.stringify(pages.map((p) => p.json), null, 2) + '\n');

// 2. A sample alert email. The captured GitHub feed is all resolved, so we take its
//    most recent incident and present it as still open, which is what a real new
//    incident would look like.
const github = loadFixture('githubstatus.incidents.json');
const open = Object.assign({}, github.incidents[0], { status: 'investigating', resolved_at: null });
const body = { page: github.page, incidents: [open].concat(github.incidents.slice(1)) };
const page = { pageKey: 'https://www.githubstatus.com', label: 'GitHub', apiUrl: 'https://www.githubstatus.com/api/v2/incidents.json' };
const emails = runDetect(workflow, {
  pages: [page], responses: [okResponse(body)], settings: defaultSettings(), staticData: { pages: {} }, now: DEFAULT_NOW,
});
const email = emails[0].json;
out('alert-email.txt', 'Subject: ' + email.subject + '\n\n' + email.text + '\n');
out('alert-email.html', email.html + '\n');

// 3. A resolution alert, on a second run where the incident is resolved.
const state = { pages: {} };
runDetect(workflow, { pages: [page], responses: [okResponse(body)], settings: defaultSettings(), staticData: state, now: DEFAULT_NOW });
const resolvedBody = { page: github.page, incidents: [Object.assign({}, github.incidents[0], { updated_at: '2026-10-27T09:00:00Z' })].concat(github.incidents.slice(1)) };
const resolvedEmails = runDetect(workflow, { pages: [page], responses: [okResponse(resolvedBody)], settings: defaultSettings(), staticData: state, now: DEFAULT_NOW });
if (resolvedEmails.length) {
  out('resolved-email.txt', 'Subject: ' + resolvedEmails[0].json.subject + '\n\n' + resolvedEmails[0].json.text + '\n');
}

process.stdout.write('Wrote samples/parsed-pages.json, alert-email.txt, alert-email.html, resolved-email.txt\n');

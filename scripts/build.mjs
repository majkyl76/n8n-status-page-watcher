// Assemble workflow.json from node definitions plus the Code node sources in src/.
// The code shipped in the JSON is exactly the code in src/, so the tests exercise
// the real artefact. Run with `npm run build`; a test fails if the file is stale.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function readSrc(name) {
  return readFileSync(join(root, 'src', name), 'utf8');
}

const checkSettingsCode = readSrc('check-settings.js');
const detectCode = readSrc('detect-incidents.js');

// Node names (also used as connection keys). Keep in sync with src/detect-incidents.js
// which references "Check settings and list status pages" by name.
const N = {
  schedule: 'Run every 5 minutes',
  manual: 'Run manually',
  config: 'Set up your status pages and email',
  check: 'Check settings and list status pages',
  fetch: 'Fetch incidents from status page',
  detect: 'Detect new, updated and resolved incidents',
  gate: 'Anything to email?',
  send: 'Send incident email',
};

const DEFAULT_PAGES = [
  'GitHub | https://www.githubstatus.com',
  'Cloudflare | https://www.cloudflarestatus.com',
  'npm | https://status.npmjs.org',
  '# Add one page per line as "Label | https://host". Lines starting with # are ignored.',
].join('\n');

function assignment(id, name, value, type) {
  return { id: id, name: name, value: value, type: type };
}

// Sticky colours in n8n: 1 = yellow (default), 3 = red, 7 = white/neutral.
// I read these off the editor's stylesheet for n8n 2.44.7.
const MAIN_STICKY = [
  '## Vendor status page watcher',
  '',
  'Checks the public Statuspage v2 JSON feed of each vendor you list and emails you when there is a new incident, an update or a resolution. It remembers what it has already sent in the workflow static data, so you are told once per event.',
  '',
  '### How it works',
  'The schedule trigger runs every 5 minutes and the settings node holds your pages and filters. The first code node checks the settings and works out each API URL. The HTTP node fetches /api/v2/incidents.json for each page. The second code node compares each response with the stored state and writes one email per page that has news.',
  '',
  '### Setup',
  '1. Open "Set up your status pages and email" and edit: pages (one per line, "Label | https://host"), minimumImpact, componentKeywords, alertOnResolved, failuresBeforeAlert, and the from/to addresses (replace YOUR_SENDER_ADDRESS and YOUR_RECIPIENT_ADDRESS).',
  '2. On "Send incident email", pick your SMTP credential named "SMTP account".',
  '3. To test, run once with the manual trigger. Static data is only saved for an active workflow started by its trigger, so manual runs repeat the alerts. Activate the workflow to stop that.',
  '',
  '### Customization',
  'To get Slack or Microsoft Teams messages, replace the send node. It only works with Atlassian Statuspage v2 JSON pages, and maintenance windows are ignored.',
].join('\n');

function node(def) {
  return Object.assign({ id: def.id, name: def.name, type: def.type, typeVersion: def.typeVersion, position: def.position, parameters: def.parameters }, def.extra || {});
}

export function buildWorkflow() {
  const nodes = [
    node({
      id: 'sticky-overview', name: 'Overview', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [-40, 40],
      parameters: { content: MAIN_STICKY, height: 210, width: 1700, color: 1 },
    }),
    node({
      id: 'sticky-settings', name: 'Section: triggers and settings', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [120, 270],
      parameters: {
        content: '### Triggers and settings\nRuns on a schedule or by hand. The settings node is the only one you edit: pages, filters and the from and to addresses.',
        height: 260, width: 360, color: 7,
      },
    }),
    node({
      id: 'sticky-detect', name: 'Section: fetch and detect', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [600, 270],
      parameters: {
        content: '### Fetch and detect\nCheck the settings, fetch each incidents.json, then compare it with the stored state to find new, updated and resolved incidents.',
        height: 160, width: 720, color: 7,
      },
    }),
    node({
      id: 'sticky-send', name: 'Section: send the email', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [1340, 270],
      parameters: {
        content: '### Send the email\nIf there is something to report, send one email per page (plain text and HTML) through your SMTP credential.',
        height: 160, width: 460, color: 7,
      },
    }),
    node({
      id: 'sticky-warning', name: 'Warning: set credentials first', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [1560, 300],
      parameters: {
        content: '### Set this up first\nAdd an SMTP credential called "SMTP account" and real from and to addresses before you activate. Without them the send step fails.',
        height: 120, width: 280, color: 3,
      },
    }),
    node({
      id: 'trigger-schedule', name: N.schedule, type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [160, 300],
      parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } },
    }),
    node({
      id: 'trigger-manual', name: N.manual, type: 'n8n-nodes-base.manualTrigger', typeVersion: 1,
      position: [160, 480],
      parameters: {},
    }),
    node({
      id: 'config-settings', name: N.config, type: 'n8n-nodes-base.set', typeVersion: 3.4,
      position: [400, 380],
      parameters: {
        assignments: {
          assignments: [
            assignment('a-pages', 'pages', DEFAULT_PAGES, 'string'),
            assignment('a-impact', 'minimumImpact', 'minor', 'string'),
            assignment('a-keywords', 'componentKeywords', '', 'string'),
            assignment('a-resolved', 'alertOnResolved', true, 'boolean'),
            assignment('a-from', 'fromEmail', 'YOUR_SENDER_ADDRESS', 'string'),
            assignment('a-to', 'toEmail', 'YOUR_RECIPIENT_ADDRESS', 'string'),
            assignment('a-failures', 'failuresBeforeAlert', 3, 'number'),
            assignment('a-age', 'ignoreIncidentsOlderThanHours', 48, 'number'),
            assignment('a-max', 'maxIncidentsPerPage', 10, 'number'),
          ],
        },
        options: {},
      },
    }),
    node({
      id: 'code-check', name: N.check, type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [640, 380],
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: checkSettingsCode },
    }),
    node({
      id: 'http-fetch', name: N.fetch, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [880, 380],
      parameters: {
        method: 'GET',
        url: '={{ $json.apiUrl }}',
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'User-Agent', value: 'n8n status page watcher' }] },
        options: {
          batching: { batch: { batchSize: 1, batchInterval: 1000 } },
          response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
          timeout: 20000,
        },
      },
      extra: { onError: 'continueRegularOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 1000 },
    }),
    node({
      id: 'code-detect', name: N.detect, type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1120, 380],
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: detectCode },
    }),
    node({
      id: 'if-gate', name: N.gate, type: 'n8n-nodes-base.if', typeVersion: 2.2,
      position: [1360, 380],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          combinator: 'and',
          conditions: [
            {
              id: 'cond-hasEvents',
              leftValue: '={{ $json.hasEvents }}',
              rightValue: true,
              operator: { type: 'boolean', operation: 'true', singleValue: true },
            },
          ],
        },
        options: {},
      },
    }),
    node({
      id: 'email-send', name: N.send, type: 'n8n-nodes-base.emailSend', typeVersion: 2.1,
      position: [1600, 380],
      parameters: {
        fromEmail: '={{ $json.fromEmail }}',
        toEmail: '={{ $json.toEmail }}',
        subject: '={{ $json.subject }}',
        emailFormat: 'both',
        text: '={{ $json.text }}',
        html: '={{ $json.html }}',
        options: {},
      },
      extra: {
        credentials: { smtp: { name: 'SMTP account' } },
        retryOnFail: true,
        maxTries: 4,
        waitBetweenTries: 2000,
      },
    }),
  ];

  const connections = {
    [N.schedule]: { main: [[{ node: N.config, type: 'main', index: 0 }]] },
    [N.manual]: { main: [[{ node: N.config, type: 'main', index: 0 }]] },
    [N.config]: { main: [[{ node: N.check, type: 'main', index: 0 }]] },
    [N.check]: { main: [[{ node: N.fetch, type: 'main', index: 0 }]] },
    [N.fetch]: { main: [[{ node: N.detect, type: 'main', index: 0 }]] },
    [N.detect]: { main: [[{ node: N.gate, type: 'main', index: 0 }]] },
    [N.gate]: { main: [[{ node: N.send, type: 'main', index: 0 }]] },
  };

  return {
    name: 'Email me when a vendor status page reports an incident',
    nodes: nodes,
    connections: connections,
    active: false,
    settings: { executionOrder: 'v1' },
  };
}

export function serialise(workflow) {
  return JSON.stringify(workflow, null, 2) + '\n';
}

// Write the file when run directly (not when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const workflow = buildWorkflow();
  writeFileSync(join(root, 'workflow.json'), serialise(workflow));
  process.stdout.write('Wrote workflow.json (' + workflow.nodes.length + ' nodes)\n');
}

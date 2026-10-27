// Test harness. Loads the shipped workflow.json, pulls each Code node's jsCode out
// of it and runs that code in node:vm with stubbed n8n globals. The tests exercise
// the real artefact, not a copy.

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');

export function loadWorkflow() {
  return JSON.parse(readFileSync(join(ROOT, 'workflow.json'), 'utf8'));
}

export function loadFixture(name) {
  return JSON.parse(readFileSync(join(ROOT, 'fixtures', name), 'utf8'));
}

export function getNode(workflow, name) {
  const node = workflow.nodes.find((n) => n.name === name);
  if (!node) throw new Error('Node not found: ' + name);
  return node;
}

export function getCode(workflow, name) {
  const node = getNode(workflow, name);
  if (!node.parameters || typeof node.parameters.jsCode !== 'string') {
    throw new Error('Node has no jsCode: ' + name);
  }
  return node.parameters.jsCode;
}

// A Date stand-in bound to a fixed "now", so time-dependent logic is deterministic.
// new Date(x) still parses x normally; only the no-arg form and Date.now() are frozen.
export function fixedDate(nowMs) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(nowMs);
      } else {
        super(...args);
      }
    }
    static now() {
      return nowMs;
    }
  }
  return FakeDate;
}

// Default "now" used by the detect tests: just after the captured fixtures, so
// their resolved incidents are inside the default 48 hour history window.
export const DEFAULT_NOW = Date.parse('2026-10-27T12:00:00Z');

// Run a Code node's jsCode with the given n8n globals. Returns whatever the code
// returns (an array of items). The code uses top-level `return`, so we wrap it in
// a function expression and evaluate that.
export function runCode(jsCode, globals) {
  const sandbox = Object.assign({ console, Date: globals.Date || Date }, globals);
  vm.createContext(sandbox);
  const wrapped = '(function () {\n' + jsCode + '\n})()';
  const result = vm.runInContext(wrapped, sandbox, { timeout: 3000, filename: 'code-node.js' });
  // The result is built with the vm realm's constructors; clone it into this
  // realm so deepEqual against native literals compares by value, not prototype.
  return result === undefined ? result : structuredClone(result);
}

// Build the n8n globals for the "Check settings" node from one config object.
export function checkSettingsGlobals(config, opts = {}) {
  return {
    Date: opts.Date,
    $input: {
      first: () => ({ json: config }),
      all: () => [{ json: config }],
    },
  };
}

// Run the "Check settings and list status pages" node.
export function runCheckSettings(workflow, config, opts = {}) {
  const code = getCode(workflow, 'Check settings and list status pages');
  return runCode(code, checkSettingsGlobals(config, opts));
}

// Wrap an incidents.json body as a successful HTTP response item (fullResponse shape).
export function okResponse(body) {
  return { json: { statusCode: 200, headers: {}, body } };
}

// A non-2xx response (e.g. 404 with an HTML body).
export function httpStatusResponse(statusCode, body) {
  return { json: { statusCode, headers: {}, body } };
}

// An error item, as the HTTP node emits one on a network error with onError=continue.
export function errorResponse(message) {
  return { json: { error: message } };
}

// Run the "Detect new, updated and resolved incidents" node.
//   pages:     array of { pageKey, label, apiUrl } (settings is attached automatically)
//   responses: array of HTTP response items, aligned with pages by index
//   settings:  parsed settings object (as produced by the check node)
//   staticData: the workflow static data object (mutated in place)
export function runDetect(workflow, { pages, responses, settings, staticData, now = DEFAULT_NOW }) {
  const code = getCode(workflow, 'Detect new, updated and resolved incidents');
  const pageItems = pages.map((p) => ({ json: Object.assign({}, p, { settings }) }));
  const globals = {
    Date: fixedDate(now),
    $input: { all: () => responses },
    $: (name) => {
      if (name === 'Check settings and list status pages') {
        return { all: () => pageItems };
      }
      throw new Error('Unexpected $() call for node: ' + name);
    },
    $getWorkflowStaticData: () => staticData,
  };
  return runCode(code, globals);
}

// Default parsed settings, matching the Set node defaults.
export function defaultSettings(overrides = {}) {
  return Object.assign(
    {
      minimumImpact: 'minor',
      componentKeywords: [],
      alertOnResolved: true,
      failuresBeforeAlert: 3,
      ignoreIncidentsOlderThanHours: 48,
      maxIncidentsPerPage: 10,
      fromEmail: 'alerts@example.com',
      toEmail: 'me@example.com',
    },
    overrides,
  );
}

// Build a minimal incident object for synthetic tests.
export function incident(fields = {}) {
  return Object.assign(
    {
      id: 'inc-1',
      name: 'Example incident',
      status: 'investigating',
      impact: 'minor',
      created_at: '2026-10-27T10:00:00Z',
      started_at: '2026-10-27T10:00:00Z',
      updated_at: '2026-10-27T10:05:00Z',
      incident_updates: [
        { id: 'u1', status: 'investigating', body: 'We are looking into this.', created_at: '2026-10-27T10:05:00Z' },
      ],
    },
    fields,
  );
}

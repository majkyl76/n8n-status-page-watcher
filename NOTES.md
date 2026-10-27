# NOTES

Build notes: ambiguities, the choices made, and what could not be verified without
a live n8n. Nothing here weakened a test to pass; where the spec left a choice it is
recorded below.

## Decisions on ambiguous points

- **Subject format.** First draft read AC10's `<N> new event(s)` literally. After review
  the subject names the event type instead: `[Status] <Label>: <summary> - <title>`, where
  the summary is `new incident`, `update`, `resolved`, `page unreachable` or `page recovered`
  for one event, and `N events` for several. The subject is at most 149 characters (AC17).
- **`ignoreIncidentsOlderThanHours`.** Per the event rules, an already-resolved
  incident seen for the first time is history and never alerts, so the setting
  cannot change which events fire. I kept it as a storage bound: a first-seen
  resolved incident is stored only if its `resolved_at` (or `updated_at`) is within
  the window, which keeps the stored history from growing. Documented as a storage
  limit in README and the sticky, as the spec allowed.
- **Retry counts.** The HTTP node uses `retryOnFail: true, maxTries: 3` (the initial
  try plus two retries, matching "retry on fail 2 times"); the Send Email node uses
  `maxTries: 4` ("retry 3 times"). n8n's field is labelled "Max. Tries", so these
  are my reading of "retry N times" as N retries after the first attempt. Easy to
  change in `scripts/build.mjs` if the PM prefers the literal number.
- **Email format.** `emailFormat: 'both'` so every email carries plain text and
  HTML. The workflow always builds both bodies.
- **Update text truncation.** At most 500 characters including the ellipsis, cut at a
  word boundary. HTML and plain text both strip the vendor's inline HTML (for example
  `<br />`) first; the HTML body then escapes everything, so hostile input cannot inject
  markup.
- **"Customization" heading.** AC2 lists the optional sticky heading as
  `### Customization` (n8n's own spelling). I kept that exact heading to match the
  guideline; the copy linter does not flag it.

## Node versions and parameters

- typeVersions used, all present in the installed n8n-nodes-base 2.44.7:
  scheduleTrigger 1.2, manualTrigger 1, set 3.4, code 2, httpRequest 4.2, if 2.2,
  emailSend 2.1, stickyNote 1. These are stable versions at or below each node's
  `defaultVersion`. Evidence read from the `.node.js` files under
  `/workspace/n8n-local/node_modules/n8n-nodes-base/dist/nodes`.
- Set node assignments use `type: "string" | "number" | "boolean"` in the
  `assignmentCollection`, confirmed from
  `Set/v2/helpers/interfaces.d.ts` and `manual.mode.js`.
- Sticky colours: 1 = yellow, 3 = red, 7 = white. Evidence in
  `docs/sticky-colours.md` (node default plus the editor CSS variant variables).

## Credentials (AC3)

- The Send Email node references the SMTP credential by name only:
  `credentials: { smtp: { name: "SMTP account" } }`, with no `id`. n8n's importer
  accepts a name-only reference and asks the user to pick the matching credential on
  first open. If the PM finds the live importer needs an `id` key present (even if
  empty), add it in `scripts/build.mjs`; I left it out to keep the file free of
  instance-specific values.

## Architecture notes

- The detect node pairs each page (from the settings node, read by name) with the
  HTTP response at the same index. Batch size 1 keeps input and output aligned. If a
  future change reorders HTTP output, this assumption would need revisiting.
- The HTTP node is set to never error on non-2xx (`neverError`), return the full
  response (`fullResponse`), and continue on error (`onError:
  continueRegularOutput`), so a broken page becomes an item the detect node can
  classify as a failure rather than stopping the run.

## Could not verify without a live n8n (PM to confirm via `npm run e2e`)

- That the exact error-item shape from the HTTP node on a network error uses an
  `error` field. The detect node treats "has `error`", "statusCode is a number and
  not 200", and "body is not an object with an `incidents` array" all as failures,
  so it should cope with the common shapes, but the live shape was not observed.
- That the chosen typeVersions and the name-only SMTP credential import cleanly
  through the public REST API and activate.
- End-to-end delivery through SMTP. `scripts/e2e.mjs` drives a mock Statuspage and a
  local SMTP sink through baseline, new, update, resolution, outage and recovery; it
  is written for the PM and exits with a clear message when `N8N_URL` is unset.

## Environment note

- CLAUDE.md says the default node is v20; in this environment both the default
  `node` and the pinned Node 24 report v24.22.1. The unit tests run offline in well
  under a second on v24.

## Exact `npm test` output (counts)

`npm test` runs `node scripts/build.mjs && node --test`:

```
tests 87
suites 0
pass 87
fail 0
skipped 0
todo 0
```

Mapping of test files to acceptance criteria:

- tests/guidelines.test.mjs : AC1, AC2, AC3, AC5
- tests/config.test.mjs     : AC4
- tests/events.test.mjs      : AC6, AC9
- tests/filters.test.mjs     : AC7
- tests/failures.test.mjs    : AC8
- tests/email.test.mjs       : AC10
- tests/copy.test.mjs        : AC11, AC12
- tests/property-golden.test.mjs : AC13
- tests/build.test.mjs       : workflow.json freshness and src/ parity
- AC14 is the PM-run live test, `scripts/e2e.mjs`.

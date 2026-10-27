# Verification

Run on 2026-10-27 (Europe/Warsaw) with Node 24.22.1 and a local n8n 2.44.7.

| AC | What | Command | Result | Evidence |
|---|---|---|---|---|
| AC1, AC2, AC3, AC5 | Structure, sticky notes, no secrets, node names | `npm test` | pass | `tests/guidelines.test.mjs` |
| AC4 | Config validation | `npm test` | pass | `tests/config.test.mjs` |
| AC6, AC9 | New, update and resolved events, state caps | `npm test` | pass | `tests/events.test.mjs`, real GitHub, Cloudflare and OpenAI fixtures |
| AC7 | Impact and component filters | `npm test` | pass | `tests/filters.test.mjs` |
| AC8 | Failures, one unreachable email, recovery | `npm test` | pass | `tests/failures.test.mjs` |
| AC10 | Email subject, text and escaped HTML | `npm test` | pass | `tests/email.test.mjs`, `samples/alert-email.*` |
| AC11, AC12 | Honest limits, copy quality | `npm test`, `npm run lint:copy` | pass, 0 issues | `tests/copy.test.mjs` |
| AC13 | Property and golden tests | `npm test` | pass | `tests/property-golden.test.mjs` |
| AC14 | Live run in local n8n | `N8N_URL=... N8N_API_KEY=... npm run e2e` | 14 of 14 checks pass | `samples/e2e-run.txt`, `samples/e2e-emails.txt` |

Unit tests: 88 run, 88 pass, 0 fail.

## What the live run exercised

- Real n8n nodes: Schedule Trigger, Set, Code (task runner sandbox), HTTP Request, If, Send Email, with workflow static data across scheduled runs.
- Two mock Statuspage servers (one serves the real captured GitHub feed) and a local SMTP sink.
- Phases: baseline, new incident, no change, update, resolved, resolved again, outage 1 and 2 of 2, outage 3, recovery, steady, and a closed port (connection refused).

## What was not exercised

- Real SMTP delivery or a real SMTP credential. The sink accepts anything.
- Live vendor pages. The fixtures are real captures taken during the build.
- n8n Cloud. Only the self-hosted 2.44.7 package was used.

## Bugs the live run found

| Bug | Why unit tests missed it | Fix |
|---|---|---|
| `new URL(...)` throws "URL is not defined" in the n8n Code node, so every run failed | The test sandbox was given `URL` | Origin read with a pattern. Test sandbox no longer provides `URL`. New static test bans `URL`, `Buffer` and similar globals |

The screenshot is `screenshots/canvas.png`, taken from an unmodified import of `workflow.json`.

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
| AC14, AC19 | Live run in local n8n | `N8N_URL=... N8N_API_KEY=... npm run e2e` | 14 of 14 checks pass, two runs in a row after review 2 | `samples/e2e-run.txt`, `samples/e2e-emails.txt` |

Unit tests: 108 run, 108 pass, 0 fail (`npm test`, 27 Oct 2026, after review 3 fixes).

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

## Review 2 e2e changes (27 Oct 2026)

`docs/REVIEW-2.md` Step 3 listed four problems in the hand-edited `scripts/e2e.mjs`. The PM applied them:

| Item | Change |
|---|---|
| 1 vacuous `assert.ok(true)` | baseline now asserts both mock pages were fetched (`hits.a > 0 && hits.b > 0`) |
| 2 mail not tied to the awaited execution | each mail is stamped on receipt; a phase counts only mail received between its execution's start and 500 ms after its stop |
| 3 late mail from the first workflow | after deactivating it, the script waits until it has no running execution |
| 4 port 9 assumed closed | the dead host is an ephemeral port that was opened and closed |

The first two live runs after these edits failed: 13 of 14 checks passed and the script then crashed writing samples (run 1 used a drain-before-phase variant of item 2; outage 2 got 0 mails), and run 2 (receive-time version) had outage 2 and recovery with 0 mails. The log showed why: a run where a page answers HTML 500 takes about 5 s, so with a 6 s tick runs of the same workflow overlapped, and the alert came from a run the phase did not wait for. The old shared-buffer code passed only because it counted that run's mail by accident. Default tick is now 10 s; the log prints each execution's duration. Two runs after that: 14 of 14, 14 of 14 (`samples/e2e-run.txt` is the second).

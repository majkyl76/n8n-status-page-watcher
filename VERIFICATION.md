# Verification

Run on 2026-10-27 (Europe/Warsaw) with Node 24.22.1 and a local n8n 2.44.7.

| AC | What | Command | Result | Evidence |
|---|---|---|---|---|
| AC1 | Importable structure, no instance-specific fields | `npm test` | pass | `tests/guidelines.test.mjs` |
| AC2 | Sticky note guidelines (main yellow, white sections, red warning) | `npm test` | pass | `tests/guidelines.test.mjs`, `docs/sticky-colours.md` |
| AC3 | No secrets, SMTP credential by name only | `npm test` | pass | `tests/guidelines.test.mjs` |
| AC4 | Config validation | `npm test` | pass | `tests/config.test.mjs` |
| AC5 | Node naming | `npm test` | pass | `tests/guidelines.test.mjs` |
| AC6 | New, update and resolved event logic | `npm test` | pass | `tests/events.test.mjs`, real GitHub, Cloudflare and OpenAI fixtures |
| AC7 | Impact and component filters | `npm test` | pass | `tests/filters.test.mjs` |
| AC8 | Failures, one unreachable email, recovery | `npm test` | pass | `tests/failures.test.mjs` |
| AC9 | State hygiene, caps, odd-character keys | `npm test` | pass | `tests/events.test.mjs` |
| AC10 | Email content, body cap and footer preserved under oversized events | `npm test` | pass | `tests/email.test.mjs`, `samples/alert-email.*` |
| AC11 | Honest limits documented | `npm test`, manual read of README/LISTING/sticky | pass | `tests/copy.test.mjs`, README.md, LISTING.md |
| AC12 | Copy quality, British spelling | `npm test`, `npm run lint:copy` | pass, 0 issues | `tests/copy.test.mjs` |
| AC13 | Property and golden tests | `npm test` | pass | `tests/property-golden.test.mjs` |
| AC14 | Live end-to-end (PM-run) | `N8N_URL=... N8N_API_KEY=... npm run e2e` | 14 of 14 checks pass | `samples/e2e-run.txt`, `samples/e2e-emails.txt` |
| AC15 | Resolution only after a real alert | `npm test` | pass | `tests/events.test.mjs`, `tests/property-golden.test.mjs` |
| AC16 | Out-of-order and missing/unparsable timestamps | `npm test` | pass | `tests/events.test.mjs`, `tests/property-golden.test.mjs` |
| AC17 | Subject and text limits, no split surrogate pair | `npm test` | pass | `tests/email.test.mjs` |
| AC18 | Sandbox globals (no `URL`, `Buffer`, `structuredClone`) | `npm test` | pass | `tests/guidelines.test.mjs` |
| AC19 | Live e2e covers a closed port and an HTML 404 body | `npm run e2e` | pass, part of the 14 of 14 | `samples/e2e-run.txt` |

Unit tests: 118 run, 118 pass, 0 fail (`npm test`, 27 Oct 2026, after review 3
F1/F2 fixes and F3/F4 triage).

`npm run lint:copy`: 0 issues (27 Oct 2026).

`npm run e2e`: 14 of 14 checks pass against local n8n 2.44.7 (27 Oct 2026,
`samples/e2e-run.txt`; mail capture refreshed in `samples/e2e-emails.txt`).

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

## Final review rounds (27 Oct 2026)

Three fresh, independent reviewer sessions ran against the finished workflow, each with no knowledge of the others' findings. Full write-ups and PM triage tables are in `docs/REVIEW-FINAL.md`, `docs/REVIEW-FINAL-2.md` and `docs/REVIEW-FINAL-3.md`; the earlier audit of the hand-made commits `5df6df2`, `09970a1` and `4c1839f` is in `docs/REVIEW-2.md`. Every accepted finding was fixed with a regression test committed before the fix. Summary:

| Round | Verdict | Accepted (fixed) | Rejected |
|---|---|---|---|
| Review 2 (audit) | n/a | subject-150 boundary test, missing-`updated_at` flip-flop, split-surrogate truncation, entity-only blank update line (`67c4b62`, `087b7b6`, `acee6b3`) | none |
| Final review | PASS, fix-before-submission items | F1 body-cap footer loss (`184c56b`), F2 property-model independence in part (`7980266`), F3 licence lint gap (`7980266`/`184c56b`) | F4 (`VERIFICATION.md` exists; reviewer's clone had it removed) |
| Final review 2 | FAIL | F1 footer still lost in the hard-cut fallback (`2d4d3fd`), F2 crash on a non-object stored incident record (`2d4d3fd`), F3 licence lint multi-adjective gap (`2d4d3fd`) | F4 O(n²) render cost, no stated performance requirement |
| Final review 3 | FAIL | F1 HTML hard-cut could split a surrogate pair (`940943a`), F2 corrupt failure counter silently disabled alerting (`940943a`), F4 AC15/16/17/18 missing from mapping tables (`f515646`) | F3 licence lint adverb gap, recorded in `NOTES.md` under "Known limits" |

No blocker or major finding is open after these three rounds.

# Add the vendor status page watcher template

Adds the workflow, its Code node sources, tests, docs and a live end-to-end script. Local n8n 2.44.7 imports it unchanged and the e2e run passes 14 of 14 checks.

Status: not merged. A fresh reviewer session still has to run (Claude Code is paused team-wide).

## How it was verified

- `npm test`: 88 run, 88 pass, 0 fail.
- `npm run lint:copy`: 0 issues.
- `npm run e2e` against local n8n: 14 of 14 pass (`samples/e2e-run.txt`). SMTP was a local sink, status pages were local mocks (one serving the real GitHub capture).
- Full table in `VERIFICATION.md`. Canvas screenshot in `screenshots/canvas.png`.

## Findings so far

Developer self-review (Claude Code build session): 87 tests passing. It listed as unverified: the HTTP error item shape on a network failure, a clean import and activation through the API, and real SMTP. The first two are now verified live; real SMTP is not.

PM live-run finding (fixed, regression test added):

1. `new URL(...)` threw "URL is not defined" in the n8n Code node, so every run failed at the first Code node. The unit sandbox had supplied `URL`, which hid it. The origin is now read with a pattern, the sandbox no longer provides `URL`, and a static test bans `URL`, `Buffer`, `structuredClone` and similar.

Fresh-session reviewer: not run yet. Planned prompt is in `/workspace/team/cc-run-review.sh`.

PM skeptical review, open items for the fix round:

- The subject says "1 new event" even for an update, a resolution or an unreachable page. It follows the spec but reads oddly. Consider "1 event" or the event type.
- Only Statuspage v2 feeds work. Maintenance windows are ignored. Both are documented.
- Real SMTP (TLS, auth, a provider that rejects the From address) is not covered.
- State lives in workflow static data, so manual runs repeat alerts. Documented.

## Definition of done

- [x] Spec: SPEC.md has AC1 to AC14, each mapped to a test file (`VERIFICATION.md`).
- [x] Tests written first and seen failing: commit `daf673d` "Add failing acceptance tests and test harness" precedes the implementation.
- [x] Full suite re-run by me: `npm test` gives pass 88, fail 0.
- [ ] Fresh reviewer session run, findings table attached. Pending, Claude Code paused.
- [ ] Every reviewer finding fixed with a regression test. Pending.
- [x] Real end-to-end run: real GitHub, Cloudflare and OpenAI captures through real n8n nodes; SMTP is a sink.
- [x] Each AC checked one by one (`VERIFICATION.md`).
- [x] Failure behaviour checked: HTTP 500 outage, connection refused, recovery, bad config (`tests/failures.test.mjs`, `tests/config.test.mjs`, e2e).
- [x] No secrets: AC3 test. SMTP credential is referenced by name only.
- [x] README and listing lint: 0 issues.
- [x] Limits listed in README, LISTING and the main sticky.
- [x] Submission to n8n is NOT done. It needs Michal's approval and a creator account.

Verdict: FIX FIRST. The workflow runs end to end, but the fresh-reviewer step is missing and the open items above are not done.

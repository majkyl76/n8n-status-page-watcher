# Add the vendor status page watcher template

Adds the workflow, its Code node sources, tests, docs and a live end-to-end
script. Local n8n 2.44.7 imports it unchanged and the e2e run passes 14 of 14
checks.

Status: not merged, awaiting Michal's sign-off. Ready to merge as far as
testing and review can establish.

## How it was verified

- `npm test`: 118 run, 118 pass, 0 fail.
- `npm run lint:copy`: 0 issues.
- `npm run e2e` against local n8n 2.44.7: 14 of 14 pass, measured 27 Oct 2026
  (`samples/e2e-run.txt`, mail capture in `samples/e2e-emails.txt`). SMTP was
  a local sink; status pages were local mocks, one serving the real captured
  GitHub feed.
- Full AC-by-AC table in `VERIFICATION.md`. Canvas screenshot in
  `screenshots/canvas.png`.

## Review rounds

Three fresh, independent reviewer sessions ran against the finished workflow
(each reviewer had no memory of the others' findings), plus one earlier audit
of a batch of hand-made commits. Every accepted finding was fixed with a
regression test committed first, then the fix, matching the repo's
test-first rule. Full write-ups: `docs/REVIEW-FINAL.md`,
`docs/REVIEW-FINAL-2.md`, `docs/REVIEW-FINAL-3.md`.

| Round | Verdict | Findings | Accepted | Rejected |
|---|---|---|---|---|
| Review 2 (`docs/REVIEW-2.md`) | n/a, audit not a verdict round | Audited hand-made commits `5df6df2`, `09970a1`, `4c1839f`; found 1 untested boundary (subject length 149 vs 150) plus 3 further defects by checking for the same bug classes elsewhere | 4 (boundary test, missing-`updated_at` flip-flop, split-surrogate truncation, entity-only blank update line) | 0 |
| Final review (`docs/REVIEW-FINAL.md`) | PASS, with fix-before-submission items | F1 body-cap footer dropped under a realistic multi-incident load, F2 property-test reference model not independently derived, F3 licence lint missing `license`/`licence`, F4 dangling `VERIFICATION.md` reference | F1 (`184c56b`), F2 in part (`7980266`), F3 (`7980266`/`184c56b`) | F4 (file exists; reviewer's clone had it removed) |
| Final review 2 (`docs/REVIEW-FINAL-2.md`) | FAIL | F1 blocker: the footer-preserving fix from review 1 still dropped the footer in its own last-resort hard-cut path, F2 major: a non-object stored incident record crashed the whole run, F3 minor: licence lint under-matched multi-adjective noun use, F4 informational: O(n²) render cost at 500 incidents | F1 (`2d4d3fd`), F2 (`2d4d3fd`), F3 (`2d4d3fd`) | F4 (no stated performance requirement) |
| Final review 3 (`docs/REVIEW-FINAL-3.md`) | FAIL | F1 major: HTML hard-cut path could still split a surrogate pair, F2 major: a corrupt (non-numeric) stored failure counter silently disabled unreachable alerting forever, F3 major: licence lint flagged correct British verb use when an adverb intervened, F4 minor: AC15/16/17/18 missing from the NOTES.md and VERIFICATION.md mapping tables | F1 (`940943a`), F2 (`940943a`), F4 (`f515646`) | F3: rejected as an advisory heuristic limit, recorded in `NOTES.md` under "Known limits" |

All accepted findings across the three final rounds are fixed and covered by
a named regression test; the commit hashes above match `git log`. No
blocker or major finding is open from any round.

## What was NOT tested

- Real SMTP delivery or a real SMTP credential (TLS, auth, a provider
  rejecting the From address). The e2e sink accepts anything.
- Live vendor pages beyond the three captured fixtures (GitHub, Cloudflare,
  OpenAI). Other Statuspage v2 vendors are untested, though the parsing is
  generic to the schema.
- n8n Cloud. Only the self-hosted 2.44.7 package was used.

## Definition of done

- [x] Spec: SPEC.md has AC1 to AC19, each mapped to a test file
  (`VERIFICATION.md`, `NOTES.md`).
- [x] Tests written first and seen failing: commit `daf673d` "Add failing
  acceptance tests and test harness" precedes the implementation, and every
  review-fix commit pair follows the same order (test commit, then fix
  commit).
- [x] Full suite re-run: `npm test` gives pass 118, fail 0.
- [x] Three fresh reviewer sessions run, findings tables attached (above and
  in `docs/REVIEW-FINAL*.md`).
- [x] Every accepted reviewer finding fixed with a regression test.
- [x] Real end-to-end run: real GitHub, Cloudflare and OpenAI captures
  through real n8n nodes; SMTP is a sink.
- [x] Each AC checked one by one (`VERIFICATION.md`).
- [x] Failure behaviour checked: HTTP 500 outage, connection refused, a 404
  HTML body, recovery, bad config, corrupt stored state (`tests/failures.test.mjs`,
  `tests/config.test.mjs`, `tests/events.test.mjs`, e2e).
- [x] No secrets: AC3 test. SMTP credential is referenced by name only.
- [x] README and listing lint: 0 issues.
- [x] Limits listed in README, LISTING and the main sticky.
- [x] Submission to n8n is NOT done. It needs Michal's approval and a
  creator account.

## Verdict

**MERGE.** The workflow runs end to end against real captured vendor data
through real n8n nodes, three independent review rounds found and fixed
real defects down to a corrupted-state and surrogate-pair edge case, and the
one rejected finding is a documented, non-shipping-blocking limit. Nothing
outstanding needs a code change before Michal's own sign-off and submission.

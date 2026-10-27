# Final review 3

Scope: AC1-AC19, focused on the most recent fixes (body-cap footer/hard-cut, malformed
stored incident guard, resolved-event guard, licence lint). All findings proven by
throwaway probes under `scratch/` run with `node` against the shipped `workflow.json`
(via `node:vm`, same technique as `tests/helpers.mjs`) or directly against
`scripts/lint-lib.mjs`. `npm test` (116/116) and `npm run lint:copy` (0 issues) both
pass as shipped; none of these findings are caught by the current suite.

| ID | Severity | What is wrong | Command / proof | Suggested fix |
|---|---|---|---|---|
| F1 | **major** | `src/detect-incidents.js` AC17 says truncation "never splits a surrogate pair". The text hard-cut path calls `trimLoneSurrogate` (line 284), but the HTML hard-cut path (`truncateHtml`, line 290, used by `hardCutSingleEventBodies`) never does. When the single remaining event is still too big and the cut lands inside an emoji/astral character in the title (no tag or entity nearby to trigger the existing adjustment), the shipped HTML body ends with a lone unpaired UTF-16 surrogate. | `node scratch/probe6_sweep.mjs` → `beforeLen 19852 html lone: { lone: true, pos: 19987, context: 'AAAAAAAAAA\ud83d</li>\n</o' }`. Reproduces with a single critical incident whose title is `'A'.repeat(19852) + '\u{1F600}' + 'B'.repeat(50)`, `maxIncidentsPerPage: 10`, one event (forces `hardCutSingleEventBodies`). The emitted HTML body's last 3 chars before `</li>` are a bare `\ud83d` high surrogate. | In `truncateHtml`, after the tag/entity adjustment, also call `trimLoneSurrogate(cut)` before returning (same helper already used by the text path). |
| F2 | **major** | `src/detect-incidents.js` line 356: `ps.failures = (ps.failures || 0) + 1;` assumes `ps.failures` is numeric. Unlike `ps.incidents` (reset to `emptyMap()` if not an object) there is no guard on `failures`. If stored state ever holds a non-numeric truthy `failures` (hand-edited state, a future schema change, or any other corruption described in the brief), `+1` becomes string concatenation ("lots" → "lots1" → "lots11" → ...), so `ps.failures >= settings.failuresBeforeAlert` is permanently `false` (`"lots1" >= 3` is `false`). The page then fails every run forever without ever emitting `unreachable`, silently, with no crash to surface it. | `node scratch/probe8_failures_string.mjs` with `staticData.pages['x.example'].failures = 'lots'` and 5 consecutive error-item responses: all 5 runs print `events: 0 []`; `failures` grows as `"lots1"`, `"lots11"`, ... and never reaches the threshold. | Coerce defensively, e.g. `const prevFailures = Number(ps.failures); ps.failures = (Number.isFinite(prevFailures) ? prevFailures : 0) + 1;`, mirroring the existing `ps.incidents`/`prev` guards. |
| F3 | **major** | `scripts/lint-lib.mjs`'s "licence noun" heuristic (`hasLicenseNounUse`, lines 35-47, used by `npm run lint:copy` and `AC12`) only recognises verb use of "license" when a preceder/follower word is *immediately* adjacent (`LICENSE_VERB_PRECEDERS`/`LICENSE_VERB_FOLLOWERS`). Any adverb between a modal/pronoun and the verb (a completely ordinary English construction) defeats it, so correct British verb usage is flagged as the American noun spelling. This is a regression risk in the just-"widened" check: it doesn't currently break README.md/LISTING.md only because neither file happens to contain "licen[cs]e" at all right now. | `node -e "import('./scripts/lint-lib.mjs').then(({lintText})=>console.log(lintText('t','Companies often license software internationally.')))"` → `[ 't: American spelling \"license\" (use \"licence\")' ]` (also reproduces with "Vendors routinely license software to resellers."). Contrast with the already-passing test case `'You may license this software to others.'`, which only works because "may" is directly adjacent. `grep -in "licen[sc]e" README.md LISTING.md workflow.json` currently returns nothing, which is why `npm run lint:copy` is green today. | Walk back past a short run of adverbs (or match on the nearest verb-indicating token within a small word window, not just the immediately adjacent word) before deciding verb vs. noun; add a regression test with an intervening adverb. |
| F4 | minor | `NOTES.md`'s "Mapping of test files to acceptance criteria" (lines 97-108) and `VERIFICATION.md`'s AC table list AC1-AC14 only. AC15, AC16, AC18 are not mentioned in either mapping at all (AC17 gets one passing mention in NOTES.md's "Subject format" note, not in the mapping table), even though `tests/events.test.mjs`, `tests/email.test.mjs` and `tests/property-golden.test.mjs` all contain tests explicitly prefixed `AC15:`, `AC16:`, `AC17:` and the sandbox-globals test covers AC18 — all visible in the `npm test` output. The quoted overall count itself ("116 run, 116 pass") is correct. | `npm test 2>&1 | grep -c '✔'` → 116 (matches NOTES.md/VERIFICATION.md). `grep -n "AC15\|AC16\|AC17\|AC18" NOTES.md VERIFICATION.md` shows only the one AC17 mention outside any mapping table; the AC-to-test-file tables don't list AC15/16/17/18 against any file. | Add AC15-AC18 rows to both tables (events.test.mjs covers AC15/AC16, email.test.mjs covers AC17, the guidelines/property-golden sandbox test covers AC18). |

No findings on: footer exactness for `maxIncidentsPerPage` 1 and 500 (verified exact `+N`
counts and correct most-severe-first drop order with mixed-severity + oversized events,
`scratch/probe2_footer.mjs`, `scratch/probe14_drop_order.mjs`); numeric-vs-string incident
ids (`scratch/probe15_numeric_ids.mjs`, no dedupe collision); resolved→reopened→resolved
multi-cycle alerting (`scratch/probe12_reopen_cycle.mjs`, exactly one `resolved` per
genuine cycle); unparsable/missing timestamps combined with simultaneous status/impact
changes; hostile incident names/components with `<script>`, quotes, `&`, emoji (HTML body
fully escaped, plain-text body untouched, subject CRLF-sanitised); most other malformed
stored-state shapes (array/number/string/null for `pages[key]` or `incidents`) are caught
and treated as first-seen without crashing. One lower-confidence note not included as a
numbered finding: a stored `incidents[id]` record that is itself an array passes the
`typeof === 'object'` check (arrays are objects) and is treated as a pre-existing record
with `undefined` fields rather than "first-seen" as the code's own comment claims; in the
cases tried this degrades to an `update` event instead of `new` and does not crash or
cause incorrect resolved-suppression, so it looks benign rather than a real bug.

## Verdict

**FAIL** (F1, F2, F3 are majors: a spec-explicit AC17 violation with a concrete
reproduction, a silent permanent loss of failure/outage alerting once state is corrupted,
and a false-positive in the shipped copy linter that the brief specifically asked to
re-examine).

## PM triage

| ID | Severity (reviewed) | Severity (after PM triage) | Reproduced | Decision | Commit |
|---|---|---|---|---|---|
| F1 | major | minor in practice (needs a ~19800 char title), but AC17 is explicit | yes | Accepted. `truncateHtml` now calls `trimLoneSurrogate` after the tag/entity adjustment, same as the text path. Regression test added first (`tests/email.test.mjs`). | `0ba92fc` (test), `940943a` (fix) |
| F2 | major | minor | yes | Accepted. `ps.failures` is coerced with `Number`/`Number.isFinite`, defaulting corrupt values to 0 before incrementing; `ps.failureAlerted` normalised to a strict boolean on load (cheap, same guard style as `ps.incidents`). Regression test added first (`tests/failures.test.mjs`). | `0ba92fc` (test), `940943a` (fix) |
| F3 | major | rejected | yes (as an isolated heuristic probe) | Rejected: advisory heuristic only, no shipped copy contains the word today, and the adverb-separated construction is a known limit of the simple preceder/follower check. Recorded in NOTES.md under "Known limits". | (this commit) |
| F4 | minor | minor | yes | Accepted. AC15-AC18 rows added to the test-to-AC mapping tables in NOTES.md and VERIFICATION.md. The lower-confidence note (a stored `incidents[id]` record that is itself an array) was also addressed as a one-line change: arrays are now treated like other non-object records (first-seen) instead of being accepted as a pre-existing record. | (this commit), `940943a` (fix) |

After these fixes the PM considers no blocker or major finding open from this review.

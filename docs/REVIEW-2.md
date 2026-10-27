# Review 2: independent audit of the F2/F3/F4 fixes and the e2e hand-edits

Audits commits `5df6df2` (failing tests for AC15/16/17), `09970a1` (F2/F3/F4 fix)
and `4c1839f` (hand-edited `scripts/e2e.mjs`). Not a rewrite: the fixes are sound.
Test count before this review: **98**. After: **103**. All pass offline.

## Step 1: mutation check of each F2/F3/F4 change

Method: undo one change in the working tree, `npm test`, confirm a named
AC15/AC16/AC17 test fails for the right reason, then `git checkout` + `npm run build`.

| Change undone (src/detect-incidents.js) | Result | Named tests that failed |
|---|---|---|
| F2: resolution gate back to `prev.notified === true \|\| passes` | caught | `AC15: a resolved incident first seen as history, then edited later, emits nothing`; `AC15: an incident that never passed the filter while open does not emit resolved` (3 fails incl. golden) |
| F3: later-timestamp-only + keep newer stored value, back to plain `!==` and store `updatedAt` | caught | `AC16: an older updated_at than the stored one emits nothing and does not move state back` (2 fails incl. property model) |
| F4 part A: `truncateWords` slice back to `max` (no ellipsis budget) | caught | `AC17: update text in the email is at most 500 characters including the ellipsis` |
| F4 part B: subject guard back to `> 150` | **NOT caught** (gap) | none |

### Gap found and closed

The subject-length guard could be reverted from `> 149` to `> 150` with no test
failing. The existing AC17 subject test (`tests/email.test.mjs`) sweeps title
lengths `[100, 130, 135, ... 300]`, none of which produces a subject of exactly
150 characters (that needs a 123-character title with the `new incident` prefix),
so the 149-vs-150 boundary was never exercised.

Fix per instructions (test first, shown failing, then kept): added
`AC17: subject is at most 149 for a contiguous range of title lengths (hits the
exact-150 boundary)` which sweeps title lengths 110..170 so the exact-150 subject
is always hit. It fails on `> 150` and passes on `> 149`. Commit `67c4b62`.

## Step 2: same classes of bug elsewhere

Checked in `src/detect-incidents.js` and `src/check-settings.js`. Three real
defects found and fixed (failing test committed first in `087b7b6`, fixes in
`acee6b3`); two classes checked and found already correct.

### Fixed

1. **Missing / unparsable `updated_at` fires spurious updates (AC16 class).**
   For a known incident whose status and impact are unchanged, if `updated_at`
   goes from a value to missing (`undefined`/`''`), the old `bothTimes` fallback
   compared as text, treated `'' !== '2026-...'` as a change, emitted an `update`,
   and overwrote the stored timestamp with `''`. When the field reappeared the
   stored `''` again looked changed, so a second `update` fired (a flip-flop).
   Fix: when we hold a valid stored time and the new one does not parse, treat it
   as no change and keep the stored value (mirrors the out-of-order handling).
   Test: `AC16: a missing updated_at does not alert and does not overwrite the
   stored timestamp`.

2. **Truncation can split a surrogate pair (AC17 class).** A title whose emoji
   (two UTF-16 code units) straddles the 149-char cut left a lone high surrogate
   (half a character). Length stayed at 149 so no AC was violated, but the subject
   ended in a broken character; the same applied to the 500-char update cut.
   Fix: `trimLoneSurrogate` drops a trailing high surrogate after any slice; used
   by the subject cut and by `truncateWords`. Test: `AC17: truncating a long title
   never leaves a lone (split) surrogate in the subject`.

3. **Entity-only update body renders a blank line (AC10 class).** A body of
   `&nbsp;&nbsp;` survived `stripHtml` as literal text, then `decodeEntities`
   turned it into spaces after the trim had already run, so `updateText` returned
   `'  '` (truthy) and the email showed an empty `Update:` line. Fix: `updateText`
   collapses whitespace and trims after decoding. Test: `AC10: an entity-only
   update body produces no blank "Update:" line`. (Pure-HTML bodies like
   `<p><br/></p>` or `<img src=x>` were already handled: they flatten to `''` and
   produce no line.)

### Checked, already correct (no change)

- **Reopened incident (`resolved` then `investigating` again).** A status change
  is always a change, so a reopened incident that passes the filter emits an
  `update`, whether it was previously alerted or only stored as history. Locked
  with a passing regression test `AC6: a reopened incident ... emits an update if
  it passes the filter`.
- **Both timestamps unparsable.** `Date.parse` of two equal garbage strings gives
  `NaN`; the text fallback treats equal strings as no change (stays quiet) and two
  different garbage strings as a change (conservative). No NaN comparison escapes.

### SPEC.md changes

Rules were added, so SPEC.md was updated (and only for that):
- **AC16**: a missing or unparsable `updated_at` is treated like an older one
  (emits nothing on its own, does not overwrite a known-good stored timestamp).
- **AC17**: truncation never splits a surrogate pair.
- **AC10**: an update body that is only markup or entities renders no update line
  (clarification, not a behaviour change beyond fix 3).

## Step 3: review of the `scripts/e2e.mjs` hand-edits (not edited; changes listed)

`git diff 2bc46c1 HEAD` shows `src/check-settings.js` and `tests/helpers.mjs`
unchanged since `2bc46c1`; only `scripts/e2e.mjs` changed.

The subject-format assertions were tightened correctly. Verified against the
detect node's actual output: `new incident`, `update`, `resolved`,
`page unreachable` (title "Status page unreachable"), `page recovered` (title
"Status page reachable again"). All five regexes match. The new closed-port /
HTML-404 section (AC19) is a meaningful test: it proves both a connection-refused
error item and a 404 HTML body count as failures on one run without stopping each
other, and asserts two `unreachable` mails naming both pages. The baseline
assumption (serverB = GitHub fixture, expect 0 mails) is correct: all 12 top-level
incidents in `fixtures/githubstatus.incidents.json` are `resolved`, so a first run
emits nothing.

Real problems (exact changes to make; I did not edit the file):

1. **Vacuous assertion.** `scripts/e2e.mjs:184`
   `check('baseline: execution succeeded and both pages were fetched', () => { assert.equal(r.exec.status, 'success'); assert.ok(true); });`
   The `assert.ok(true)` never checks the "both pages were fetched" claim. The
   `hits` counter (line 37) is maintained but never asserted anywhere.
   Change: replace `assert.ok(true)` with
   `assert.ok(hits.a > 0 && hits.b > 0, 'pages fetched: ' + JSON.stringify(hits))`.

2. **Residual race: capture is not tied to the awaited execution.** `runPhase`
   (lines 124-135) clears a shared module-level `mails` buffer, takes `T`, waits
   for the first execution with `startedAt > T`, then after a fixed `sleep(500)`
   reads every mail in the buffer. Removing the old pre-`sleep(1500)` was a correct
   fix for a lost-mail bug, but the fundamental race remains: an execution that
   started just before `T` (old mock state) finishes after the clear and its mail
   lands in this phase's buffer, and a second scheduled run could also land within
   the 500 ms window. Today this is masked only by `TICK` (6 s) being much larger
   than an execution plus 500 ms and by static-data dedup making old-state runs
   emit nothing. Change: key the capture to the awaited execution rather than a
   shared timer+buffer. Minimal option: before taking `T`, drain any in-flight run
   (poll `/executions?status=running` for this workflow until none), so a
   straddling old-state execution cannot pollute the buffer; stronger option: read
   the mail(s) attributable to `exec.id` only (e.g. tag the phase in the mock body
   and match it in the captured mail).

3. **Cross-workflow shared buffer.** Lines 251-263 deactivate `w`, then import and
   activate `w2`, then `runPhase(w2, ...)`. The `mails` buffer is shared; a late
   mail from `w`'s final tick could arrive after `runPhase` clears the buffer for
   `w2` and inflate `r.mails.length` (asserted `=== 2`). It is safe today only
   because `w` ends in the "steady" phase (0 mails). Change: after deactivating
   `w`, wait for its last running execution to stop (same running-executions poll
   as above) before importing `w2`.

4. **Closed-port assumption (minor, acceptable).** Line 256 uses
   `http://127.0.0.1:9` as the "dead host". Port 9 (discard) normally refuses, but
   it is a privileged port and its state is assumed, not guaranteed. For a
   deterministic closed port, listen on an ephemeral port, record it, close the
   server, and use that port. Acceptable as-is for AC19; noted only.

## Step 4: final state

- `npm test`: 103 tests, 103 pass, 0 fail (offline, a few seconds).
- `npm run lint:copy`: clean.

Commits from this review:
- `67c4b62` subject-150 boundary regression test (Step 1 gap).
- `087b7b6` failing tests for the three Step 2 defects (and the reopen lock).
- `acee6b3` the three Step 2 fixes and the SPEC.md rule updates.
- this file.

Note (PM): session A (id 505dd943) reached its 60-turn limit right after writing this file, so the PM re-ran `npm test` (103 pass, 0 fail) and `npm run lint:copy` (clean) and committed it. Permission denials: none.

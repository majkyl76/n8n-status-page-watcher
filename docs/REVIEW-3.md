# Fresh-session review 3 (reviewer C, raw output)

Reviewer saw only SPEC.md, package.json, src, tests, fixtures, scripts and workflow.json (copy in /workspace/team/review2-n8n-status-page-watcher; README, LISTING, NOTES, PR, VERIFICATION, CLAUDE.md and docs withheld on purpose). Session 4594d696-fe69-479a-8265-8f75a935ae76, 27 turns, notional cost USD 2.15, permission denials: 0. Output: /workspace/team/n8n-run/sp.review2.json.

## PM reproduction (27 Oct 2026)

Probe: `node /workspace/team/n8n-run/pm-probes/sp-repro.mjs` (uses tests/helpers.mjs against the shipped workflow.json).

| ID | Severity | Reproduced | PM output | Decision |
|---|---|---|---|---|
| F-A | major | yes | open: new; resolved 11:00: resolved; resolved, updated_at 11:30: resolved (again); postmortem 12:30: resolved (again) | Accepted, fix round |
| F-B | minor | yes | 30000-char title: text 20000, html 20000 | Accepted, fix round |
| F-C | minor | yes | old state without `notified`, then resolved: no event | Rejected: the template has never been published or installed, so no state in the old shape exists anywhere. Listed as a known limit if the state shape changes after release |

## Reviewer output

All findings confirmed. Writing the report.

---

# Independent Code Review — n8n Statuspage Watcher

Method: read SPEC.md and both Code nodes as shipped in `workflow.json` (tests run the embedded `jsCode` via `tests/helpers.mjs`, so probes exercise the real artefact). Ran the suite (`node --test`): **99 pass, 4 fail — all four are `copy.test.mjs` (README/LISTING withheld, expected)**. Wrote throwaway probes under `./scratch/` and ran them with `node`. I did not edit `src/` or `tests/`.

## Findings

| ID | Severity | What is wrong | Proof (command → output) | Suggested fix |
|----|----------|---------------|--------------------------|---------------|
| **F-A** | **major** | A `resolved` event is re-emitted whenever an already-resolved incident gets a later `updated_at` (e.g. a postmortem is posted) or transitions `resolved→postmortem→completed`. The resolved branch (`src/detect-incidents.js:353-356`) checks only `settings.alertOnResolved && prev.notified === true` and **omits the spec-required guard "whose stored status was not yet resolved"** (SPEC §Event rules, line 32). Violates AC6 ("resolution yields one resolved event and then none") and AC15 under realistic Statuspage behaviour (vendors routinely add a postmortem / final update after resolving, bumping `updated_at`). | `node scratch/p1.mjs` → `open: ['new']` / `resolved: ['resolved']` / `later-updated-while-resolved: ['resolved']  (spec expects [])` / `resolved->postmortem: ['resolved']  (spec expects [])` | In the `changed && resolved` branch, also require the stored status was open: `if (settings.alertOnResolved && prev.notified === true && !isResolved(prev.status))`. (A genuine reopen→re-resolve still works because `prev.status` is then non-resolved.) |
| **F-B** | minor | Email bodies are capped at **exactly 20000** chars (`out.length > 20000 → slice(0, 20000)`, `src/detect-incidents.js:220` and `:247`), but AC10 requires both bodies **"under 20000 characters"**. A long incident `name` (never truncated in the body, unlike the subject/update) reaches length 20000. The HTML cap can also slice mid-tag/entity, emitting malformed HTML. | `node scratch/p2.mjs` → `text.length = 20000 (spec: under 20000)` / `html.length = 20000 (spec: under 20000)` | Cap below the limit: `if (out.length >= 20000) out = out.slice(0, 19999)`; for HTML, cut at a tag boundary (and run `escapeHtml` on the incident title so an overlong title cannot dominate the body). |
| **F-C** | minor | Loading **pre-F2 static-data shape** (incident records without the `notified` field) silently drops a legitimate resolution: an incident alerted while open under the old code has `prev.notified === undefined`, so after upgrading, its `resolved` email is suppressed. | `node scratch/p3.mjs` → `old-state resolution: [] (user was alerted under old code; expect resolved?)` | When reading a stored record, migrate a missing `notified`: treat a non-resolved stored status as previously notified (`notified: Object.hasOwn(prev,'notified') ? prev.notified===true : !isResolved(prev.status)`), or add a one-time state migration. |

## Spec gaps / weak tests (not separately scored)

- **AC13 cannot catch F-A — the reference model has the same bug.** `tests/property-golden.test.mjs:54-55` emits `resolved` on `settings.alertOnResolved && prev.notified === true` with no "stored status not yet resolved" check, identical to the production code. The randomised test therefore compares two implementations that are wrong the same way, so it passes vacuously for the post-resolution case.
- **AC6 "then none" and the golden test are vacuous for F-A.** `events.test.mjs:79` and `property-golden.test.mjs:120-121` re-feed an *identical* `updated_at` after resolution, so `timeChanged` is false and the re-resolution path is never exercised. No test advances `updated_at` (or changes status) after a resolution.
- **Migration is unspecified.** The spec never says what happens to state stored by the pre-F2/pre-F3 code. F-C is the observable consequence; worth a NOTES.md line even if accepted as a one-time cost.
- **AC10 boundary is ambiguous in code vs spec.** Spec says "under 20000"; code allows exactly 20000 (F-B).

## Things that are correct (tried to break, could not)

- **AC17 subject ≤149 with emoji** (titles of 148/149/150/151/300 all give `subject.length=149`, no lone surrogate) and **update text ≤500** (nospace/spaces/emoji at 499/500/501 all ≤500, no lone surrogate); entity-only and markup-only bodies render no update line. `node scratch/p2.mjs`, `node scratch/p4.mjs`.
- **AC16 out-of-order / missing `updated_at`**: older timestamp emits nothing and does not move state back; later/status/impact change still counts; missing `updated_at` neither alerts nor overwrites. (Verified by the AC16 tests; logic at `src/detect-incidents.js:331-363` is sound.)
- **AC8 failures/recovery/flapping**, **AC7 filters incl. OpenAI component-less payload and mixed-case keywords**, **AC9 pruning/caps/`__proto__` keys/idempotent re-run** all pass and are non-vacuous.

## Verdict

**FAIL** — F-A is a genuine spec violation (SPEC line 32 / AC6 / AC15) that fires under ordinary vendor behaviour (a postmortem or any later edit on a resolved incident sends a duplicate "resolved" email), and the AC13 reference model shares the defect so the suite does not catch it. F-B and F-C are minor. Fixing F-A is a one-line guard; I'd re-review after it lands and after the reference model in `property-golden.test.mjs` is corrected to add the same guard.

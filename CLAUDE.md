# Project conventions: n8n template "Vendor status page watcher"

The full issue-style spec is in **SPEC.md**. Read it first and treat its acceptance criteria (AC1..AC14) as the contract. This file holds the conventions; SPEC.md holds the requirements.

## What this repo is
One importable n8n workflow (`workflow.json`) built for the n8n creator marketplace (n8n.io/workflows), plus README, LISTING, tests and evidence. The owner is Michal Patyjewicz (Poland, self-hosted n8n, British English). It will be reviewed by n8n staff against their template guidelines, so quality and honesty matter more than feature count.

## Hard rules
- Local work only. Never publish, push, sign in anywhere, or call n8n Cloud. No network access except fetching nothing: tests must run offline using `fixtures/`.
- No secrets anywhere. Credentials are referenced by name only (see SPEC.md AC3).
- Never weaken or delete a test to make it pass. If a test and the spec disagree, write the conflict in NOTES.md and stop.
- Plain, small code. No classes, no clever regex without a comment saying what it matches. No runtime dependencies (devDependencies: none; use `node:test`, `node:assert/strict`, `node:vm`). Node 24 is installed at `/workspace/tools/node-v24.22.1-linux-x64/bin` (put it first on PATH for anything that touches n8n; the default node is v20 and fine for the unit tests).
- Writing style for ALL prose (README, LISTING, sticky notes, code comments, messages sent by the workflow): British English (organise, licence, colour), plain and specific, no hype, no AI filler. No em dashes (use full stops, commas, colons or brackets). Banned words: excited, leverage, seamless, robust, cutting-edge, streamline, tailored, ensure, delve, passionate, game-changer, "powerful", "effortless", "supercharge", "unlock". Run `python3 /workspace/team/lint-writing.py README.md --words 400` style checks via `npm run lint:copy` (you write that script; it must scan README.md, LISTING.md and the sticky note text in workflow.json).

## n8n facts you need
- Local n8n 2.44.7 is installed at `/workspace/n8n-local/node_modules` (read-only reference for you: node descriptions are under `node_modules/n8n-nodes-base/dist/nodes/`, the editor UI under `node_modules/n8n-editor-ui/dist`). Do NOT start, stop or modify that n8n instance and do not touch `/workspace/n8n-local/data`; the PM runs end-to-end tests there later.
- Use current stable node typeVersions that exist in that install (check the `version`/`defaultVersion` in each node's `.node.js`). Do not guess parameter names: open the node's description file or look at how an exported workflow stores it. If unsure, say so in NOTES.md.
- Sticky Note node type is `n8n-nodes-base.stickyNote`, with parameters `content`, `color` (number), `width`, `height`. Work out from the editor UI source which colour numbers mean yellow, white and red, and record the evidence in `docs/sticky-colours.md`.
- Dedupe state uses `$getWorkflowStaticData('global')`. This persists only for ACTIVE workflows running from a trigger. Manual executions from the editor do NOT save it. SPEC.md and the sticky notes must say so.
- Code nodes: language JavaScript, mode "Run Once for All Items".

## Architecture (so the shipped JSON is testable)
- Source for each Code node lives in `src/<node-slug>.js` (a plain function body using n8n globals such as `$input`, `$json`, `$getWorkflowStaticData`, `$('Node name')`). `scripts/build.mjs` assembles `workflow.json` from node definitions plus those files, so the code in the JSON is exactly the code in `src/`. `npm run build` regenerates it; a test fails if `workflow.json` is stale.
- Unit tests load `workflow.json`, pull each Code node's `jsCode` out of it, and run it in `node:vm` with stubbed n8n globals. They test the shipped artefact, not a copy.
- Structure/guideline tests (`tests/guidelines.test.mjs`) parse `workflow.json` only.
- Fixtures in `fixtures/` are real captured responses; do not edit them.

## Process (follow in order)
1. `git checkout -b feature/build-workflow`. Commit in small meaningful steps with imperative messages (e.g. "Add guideline checks for sticky notes", "Parse post blocks into items"). Never commit to main.
2. TESTS FIRST. Write tests mapping 1:1 to SPEC.md acceptance criteria; name every test with its AC id, e.g. `AC7: keyword matching is case-insensitive`. Run them, show them failing for the right reasons, commit them ("Add failing acceptance tests"). Only then implement.
3. Include one randomised property test with a fixed seed (hand-rolled generator) and one golden-output test (fixture in, expected JSON out under `tests/golden/`).
4. Implement until `npm test` passes. `npm test` must run everything offline in a few seconds.
5. Write README.md, LISTING.md (see SPEC.md for contents), NOTES.md (ambiguities and the choice you made, anything you could not verify, exact `npm test` output) and `samples/` (sample outputs produced by the unit test harness from fixtures, e.g. `samples/parsed-posts.json`, `samples/alert-message.txt`).
6. Do not write VERIFICATION.md, PR.md or screenshots/: the PM produces those after live runs.
7. Do not merge. Leave the feature branch checked out with a clean tree.

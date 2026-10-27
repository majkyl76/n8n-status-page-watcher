# Vendor status page watcher

An n8n workflow that emails you when a service you depend on reports an incident on its status page. It reads the public Atlassian Statuspage v2 feeds (GitHub, Cloudflare, npm and plenty of others), remembers what it has already told you, and sends one email per page per run when something is new. If nothing has changed, it sends nothing.

This is a demo workflow. I have tested it against captured feeds and a local n8n, not against a long-running production setup.

## What you need

- n8n 2.44.7. That is the version I built and tested on. It uses core nodes only.
- An SMTP account, saved as a credential called "SMTP account".
- No API keys. The incident feeds are public.

## Setup

1. Import `workflow.json`.
2. Open the node "Set up your status pages and email". It is the only node with values to edit.
3. In "Send incident email", pick your SMTP credential and check the from and to addresses.
4. Activate the workflow. The schedule trigger runs every 5 minutes.

The settings:

- `pages`: one per line, as `Label | https://host`. Blank lines and lines starting with `#` are skipped.
- `minimumImpact`: `none`, `minor`, `major` or `critical`. Incidents below it are ignored. The default is `minor`.
- `componentKeywords`: optional, one per line, not case-sensitive. If you fill it in, only incidents whose title or affected components match are reported.
- `alertOnResolved`: whether you want an email when an incident is resolved.
- `fromEmail` and `toEmail`: replace the placeholders. The workflow refuses to run while they are still there.
- `failuresBeforeAlert` (3), `ignoreIncidentsOlderThanHours` (48) and `maxIncidentsPerPage` (10): tuning values, with the defaults in brackets.

To add a vendor, add a line such as `Discord | https://discordstatus.com`. Any site that serves Statuspage v2 JSON at `/api/v2/incidents.json` should work. You can paste the bare host, the page URL or the API URL and it is cut down to the origin.

## How it decides what to send

For each page it fetches `/api/v2/incidents.json` and compares the result with what it stored on the previous run. Per incident it keeps the id, status, impact and last update time.

- An unresolved incident it has not seen before is a new incident.
- A different status, impact or update time on a known incident is an update. If the status is now resolved, it is a resolution, but only for an incident you were emailed about earlier.
- An update time older than the stored one is ignored.
- On the first run only open incidents are reported. Resolved ones are stored as history and never sent.

The subject says what happened, for example `[Status] GitHub: new incident - <title>`. If a page fails to load several runs in a row (`failuresBeforeAlert`), you get one "unreachable" email, and one more when it loads again.

## Limits

- Atlassian Statuspage v2 JSON only. I have run the logic against captured feeds from GitHub, Cloudflare and npm. Other status systems are not supported.
- It polls, so it is not real time. You hear within one schedule interval.
- Scheduled maintenance is ignored on purpose. Only `incidents.json` is read.
- State is kept in the workflow's static data, which n8n only saves for an active workflow started by its trigger. A manual run does not save anything, so running it by hand sends the same alerts again each time.

## Trying it

Set your addresses and SMTP credential, then run it once with the manual trigger against a page that has an open incident. You will get an email every time you do that. Activate the workflow to get proper de-duplication.

If you would rather get a Slack or Teams message, swap "Send incident email" for that node and map `text` onto the message body. The rest stays as it is.

## If something looks wrong

- No email: check the SMTP credential, and that the incident reaches `minimumImpact`.
- The same email keeps arriving: you are probably running it manually.
- An "unreachable" email means the page failed `failuresBeforeAlert` checks in a row. A "recovered" one follows when it reads again.

## Tests

`npm test` rebuilds `workflow.json` from `src/` and runs the unit tests offline against the captured feeds in `fixtures/`. `npm run lint:copy` checks the wording of this file and the sticky notes. `npm run samples` rewrites the files in `samples/`.

`npm run e2e` imports the workflow into a local n8n through its API and runs it against two mock status pages and a local SMTP sink, so it needs `N8N_URL` and `N8N_API_KEY`. I ran it once on 27 October 2026 against n8n 2.44.7, with the schedule shortened to 10 seconds. All 14 checks passed: a new incident, an update, a resolution, a two-run outage and its recovery, a refused connection and an HTML 404 page, among others. One mock served a captured GitHub feed. No real mail server or live status page was used. That run was before my last wording edits to the workflow. The output is in `samples/e2e-run.txt` and the emails it sent are in `samples/e2e-emails.txt`.

The fixtures are captured feeds. I trimmed one product label out of a GitHub component name so the repo text stays clear of unrelated product names; nothing else in them was changed.

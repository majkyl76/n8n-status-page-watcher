# Vendor status page watcher

Email yourself when a third-party service you depend on reports an incident. The
workflow polls public Atlassian Statuspage v2 feeds (GitHub, Cloudflare, OpenAI
and similar), works out what is new, and sends one tidy email per page per run.
It stays quiet when nothing is happening.

## What it does

For each status page it fetches `/api/v2/incidents.json` and compares the result
with the state saved last time: a new incident, an update, or a resolution. It
also sends one email when a page fails to load several runs in a row, and one
when it recovers.

## Requirements

- n8n 2.44.7 (built and tested against this version). Core nodes only.
- An SMTP account, as a credential named "SMTP account".
- No API keys: Statuspage incident feeds are public.

## Setup

1. Import `workflow.json`.
2. Open **Set up your status pages and email** and edit the values there (the
   only node you need to change).
3. On **Send incident email**, select your SMTP credential and check the
   addresses.
4. Activate the workflow.

Settings: `pages` (one per line, `Label | https://host`; blank and `#` lines
ignored); `minimumImpact` (`none`, `minor`, `major` or `critical`, skips
incidents below it); `componentKeywords` (optional, one per line,
case-insensitive, limits reports to a matching component or title);
`alertOnResolved` (email on resolution or not); `fromEmail`/`toEmail` (replace
the placeholders); `failuresBeforeAlert`, `ignoreIncidentsOlderThanHours`,
`maxIncidentsPerPage` (tuning values with sensible defaults).

## Adding a vendor

Add a line to `pages`, for example `Discord | https://discordstatus.com`. Any
host serving Statuspage v2 JSON at `/api/v2/incidents.json` works: paste the
bare host, page URL or API URL, and the workflow reduces it to the origin.

## How events are decided

State is held per page: each incident's id, status, impact and update time. A
new unresolved id is a new event; a changed status, impact or update time is an
update, or a resolution if now resolved (only for an incident you were told
about). An older update time is ignored. The first run reports only open
incidents; resolved ones are stored as history. The subject names the event,
for example `[Status] GitHub: new incident - <title>`.

## Limits

- Works only with Atlassian Statuspage v2 JSON pages, tested against GitHub,
  Cloudflare and OpenAI.
- Polling is not real time; maintenance windows are ignored on purpose.
- State lives in workflow static data, saved only for active workflows run from
  a trigger. Manual runs do not save it, so a manual test repeats alerts.

## How to test

Set your addresses and SMTP credential, then run once with the manual trigger
against a page with an open incident. Manual runs do not persist state, so each
re-sends; activate the workflow for real de-duplication.

## Swapping email for Slack or Teams

Replace **Send incident email** with a Slack or Teams node, mapping `text`
onto the message body. The rest is unchanged.

## Troubleshooting

- No email: check the SMTP credential and that an incident passes `minimumImpact`.
- Repeated emails: you are probably running manually; activate the workflow.
- An "unreachable" email means the page failed `failuresBeforeAlert` checks in a
  row; "recovered" follows once it reads again.

## Live import test

Imported unchanged into a local n8n 2.44.7 through the public API, activated
with the schedule patched to 10 seconds. Two mock status pages (one serving the
real captured GitHub feed) and a local SMTP sink ran on localhost. All 14
end-to-end checks passed: baseline, new incident, no repeat, update, resolution,
a two-check outage, recovery, a refused connection and an HTML 404 page. No real
mail server was used. See `samples/e2e-run.txt` and `VERIFICATION.md`.

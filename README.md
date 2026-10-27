# Vendor status page watcher

Email yourself when a third-party service you depend on reports an incident. The
workflow polls the public Atlassian Statuspage v2 feeds of vendors such as GitHub,
Cloudflare and status feed, works out what is new since the last check, and sends one
tidy email per page per run. It stays quiet when nothing is happening.

## What it does

For each status page it fetches `/api/v2/incidents.json`, then compares the result
with the state it saved last time. It reports three kinds of event: a new incident,
a new update to a known incident, and a resolution. It also tells you once when a
page cannot be read several runs in a row, and once when it recovers.

## Requirements

- n8n 2.44.7 (the version this template was built and tested against). Core nodes
  only, no community nodes.
- An SMTP account for sending mail. The send step uses a credential named
  "SMTP account".
- No API keys. Statuspage incident feeds are public.

## Setup

1. Import `workflow.json`.
2. Open **Set up your status pages and email** and edit the values there. This is
   the only node you need to change.
3. On **Send incident email**, select your SMTP credential (named "SMTP account")
   and check the from and to addresses.
4. Activate the workflow so the schedule trigger runs it.

The settings you can edit:

- `pages`: one page per line, as `Label | https://host`. The label is optional.
  Blank lines and lines starting with `#` are ignored.
- `minimumImpact`: one of `none`, `minor`, `major`, `critical`. Incidents below
  this impact are skipped.
- `componentKeywords`: optional, one per line, case-insensitive. If set, only
  incidents touching a matching component or title are reported.
- `alertOnResolved`: whether to email when an incident is resolved.
- `fromEmail` and `toEmail`: replace the placeholders with real addresses.
- `failuresBeforeAlert`, `ignoreIncidentsOlderThanHours`, `maxIncidentsPerPage`:
  tuning values with sensible defaults.

## Adding a vendor

Find the vendor's status page and add a line to `pages`, for example
`Discord | https://discordstatus.com`. Any host that serves Statuspage v2 JSON at
`/api/v2/incidents.json` will work. You can paste the bare host, the full page URL
or the API URL; the workflow reduces each to its origin.

## How events are decided

State is held per page in workflow static data: the id, status, impact and update
time of each incident. A new unresolved id gives a new event. A known incident
whose status, impact or update time changed gives an update, or a resolution if it
is now resolved. A resolution is sent only for an incident you were told about. On
the first run, only incidents that are still open are reported; resolved incidents
are stored as history so you are not flooded.

## Limits

- Works only with Atlassian Statuspage v2 JSON pages. Pages built on other systems
  are not supported.
- Tested at the time of writing against GitHub, Cloudflare and status feed.
- Polling is not real time. You hear within one schedule interval, not instantly.
- Maintenance windows (`scheduled_maintenances`) are ignored on purpose.
- State lives in workflow static data, which is saved only for active workflows run
  from a trigger. A manual run does not save it, so a manual test repeats alerts.

## How to test

Set your addresses and SMTP credential, then run once with the manual trigger
against a page that has an open incident. Because manual runs do not persist state,
each manual run re-sends. Activate the workflow for real de-duplication.

## Swapping email for Slack or Teams

Replace the final **Send incident email** node with a Slack or Microsoft Teams node
and map the `text` field onto the message body. The rest of the workflow is unchanged.

## Troubleshooting

- No email: check the SMTP credential and that an incident passes `minimumImpact`.
- Repeated emails: you are probably running manually. Activate the workflow.
- An "unreachable" email: the page failed to load for `failuresBeforeAlert` checks.
  A "recovered" email follows once it reads again.

## Live import test

Imported unchanged into a local n8n 2.44.7 through the public API, then activated with
the schedule patched to 6 seconds. Two mock status pages (one of them serving the real
captured GitHub feed) and a local SMTP sink ran on localhost. All 14 end-to-end checks
passed: baseline, new incident, no repeat, update, resolution, a two-check outage with
one "unreachable" email, recovery, and a refused connection. No real mail server was used. See
`samples/e2e-run.txt` and `VERIFICATION.md`.

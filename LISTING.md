# Email me when a vendor status page reports an incident

Watch the public status pages of the services your automations depend on and get
an email the moment one reports an incident. The workflow polls each vendor's
Atlassian Statuspage v2 feed, works out what is new, and sends one plain and HTML
email per page per run. It uses core nodes only and no API keys, and it stays quiet
when all is well.

## How it works

- Polls `/api/v2/incidents.json` for each status page you list.
- Detects three event types: a new incident, a new update, and a resolution.
- Filters by minimum impact and optional component keywords, so you hear only what
  matters to you.
- De-duplicates by incident and update using workflow static data, so you are told
  once per event.
- Warns once when a page cannot be read several runs in a row, and once when it
  recovers.

## Setup

1. Import the workflow.
2. Open "Set up your status pages and email" and list your pages as
   `Label | https://host`, set the minimum impact and keywords, and replace the
   from and to email placeholders.
3. On "Send incident email", select your SMTP credential named "SMTP account".
4. Activate the workflow so the schedule trigger runs every 5 minutes.

## Requirements

- n8n 2.44.7, core nodes only.
- An SMTP account for sending mail.
- No API keys; the incident feeds are public.

## Suggested categories

I am not certain of n8n's exact current category list, so please check it. Likely
fits: Monitoring, DevOps, IT Ops, Notifications.

## Keywords

status page, statuspage, incident, outage, uptime, monitoring, email alert,
GitHub, Cloudflare, OpenAI, vendor, downtime.

## Limitations

- Works only with Atlassian Statuspage v2 JSON pages. Tested at the time of writing
  against GitHub, Cloudflare and OpenAI. Other status systems are not supported.
- Polling is not real time; you hear within one schedule interval.
- Maintenance windows are ignored on purpose.
- State lives in workflow static data, which saves only for active workflows. A
  manual run does not save state, so the first run and manual tests can repeat
  alerts. On the first run only still-open incidents are reported.

// Detect new, updated and resolved incidents
// Runs once for all items. Pairs each status page (from the settings node, in
// order) with the matching HTTP response (same order: batch size 1 keeps them
// aligned), compares against workflow static data and builds one email payload
// per page that has something to report. One broken page never stops the others.

const pageItems = $('Check settings and list status pages').all();
const responses = $input.all();
const staticData = $getWorkflowStaticData('global');

if (!staticData.pages || typeof staticData.pages !== 'object') {
  staticData.pages = {};
}

const RESOLVED_STATUSES = ['resolved', 'postmortem', 'completed'];
const IMPACT_RANK = { none: 0, minor: 1, major: 2, critical: 3 };
const MAX_BODY_CHARS = 19999; // AC10: strictly under 20000

// A null-prototype map, so odd keys like "__proto__" or "constructor" become
// plain own properties and never touch Object.prototype.
function emptyMap() {
  return Object.create(null);
}

function impactRank(impact) {
  const key = typeof impact === 'string' ? impact.toLowerCase() : '';
  return Object.hasOwn(IMPACT_RANK, key) ? IMPACT_RANK[key] : 0; // unknown or missing => none
}

function isResolved(status) {
  return RESOLVED_STATUSES.includes(String(status).toLowerCase());
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Format an ISO timestamp as "YYYY-MM-DD HH:mm UTC". Returns '' if unparsable.
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
    ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Turn a vendor update (which may contain HTML like <br />) into flat text.
function stripHtml(value) {
  return String(value)
    .replace(/<br\s*\/?>/gi, ' ')   // <br>, <br/>, <br /> become a space
    .replace(/<[^>]*>/g, '')        // drop any remaining HTML tag
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// Drop a trailing lone high surrogate left when a slice lands in the middle of a
// surrogate pair (an emoji is two UTF-16 code units), so we never emit half a
// character. A trailing low surrogate means a complete pair, so leave it.
function trimLoneSurrogate(text) {
  const code = text.charCodeAt(text.length - 1);
  return code >= 0xD800 && code <= 0xDBFF ? text.slice(0, -1) : text;
}

// Cut to at most "max" characters at a word boundary, adding an ellipsis.
function truncateWords(value, max) {
  const text = String(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 3);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return trimLoneSurrogate(base) + '...';
}

function updateText(raw) {
  // Decode entities last, then collapse and trim again: a body of entities only
  // (e.g. "&nbsp;") must not leave a blank line once the entities become spaces.
  const text = decodeEntities(stripHtml(raw)).replace(/\s+/g, ' ').trim();
  return truncateWords(text, 500);
}

// Cut text to at most "max" characters, never splitting an HTML entity
// (&amp; etc., always escaped so always terminated by ";") or landing inside
// an open tag.
function truncateHtml(value, max) {
  let cut = value.slice(0, max);
  const lastOpen = cut.lastIndexOf('<');
  const lastClose = cut.lastIndexOf('>');
  if (lastOpen > lastClose) cut = cut.slice(0, lastOpen);
  const lastAmp = cut.lastIndexOf('&');
  if (lastAmp !== -1 && cut.indexOf(';', lastAmp) === -1) cut = cut.slice(0, lastAmp);
  return cut;
}

function uniqueNames(names) {
  const out = [];
  const seen = emptyMap();
  for (const name of names) {
    if (name && !Object.hasOwn(seen, name)) {
      seen[name] = true;
      out.push(name);
    }
  }
  return out;
}

// Component names from the incident body and from each update's affected list.
function componentNames(incident) {
  const names = [];
  if (Array.isArray(incident.components)) {
    for (const c of incident.components) {
      if (c && typeof c.name === 'string') names.push(c.name);
    }
  }
  if (Array.isArray(incident.incident_updates)) {
    for (const u of incident.incident_updates) {
      if (u && Array.isArray(u.affected_components)) {
        for (const c of u.affected_components) {
          if (c && typeof c.name === 'string') names.push(c.name);
        }
      }
    }
  }
  return names;
}

function componentMatch(incident, keywords) {
  if (keywords.length === 0) return true; // no component filter set
  const haystacks = componentNames(incident).map(function (n) { return n.toLowerCase(); });
  haystacks.push(String(incident.name || '').toLowerCase()); // the incident title counts too
  return keywords.some(function (kw) {
    const needle = String(kw).toLowerCase(); // tolerate a non-lowercased keyword
    return haystacks.some(function (h) { return h.includes(needle); });
  });
}

function latestBody(incident) {
  const updates = Array.isArray(incident.incident_updates) ? incident.incident_updates : [];
  if (updates.length === 0) return '';
  const first = updates[0];
  return first && typeof first.body === 'string' ? first.body : '';
}

function incidentEvent(type, incident, origin) {
  const id = String(incident.id);
  const impact = typeof incident.impact === 'string' ? incident.impact : 'none';
  const shortlink = typeof incident.shortlink === 'string' ? incident.shortlink : '';
  return {
    type: type,
    title: String(incident.name || '(untitled incident)'),
    impact: impact,
    status: String(incident.status || ''),
    components: uniqueNames(componentNames(incident)),
    update: updateText(latestBody(incident)),
    startTime: fmtTime(incident.started_at || incident.created_at),
    updateTime: fmtTime(incident.updated_at),
    link: shortlink || (origin + '/incidents/' + id),
    severity: type === 'resolved' ? 0 : impactRank(impact),
  };
}

function unreachableEvent(failures, origin) {
  return {
    type: 'unreachable',
    title: 'Status page unreachable',
    impact: '',
    status: '',
    components: [],
    update: 'The status page did not return valid incident data for ' + failures + ' checks in a row.',
    startTime: '',
    updateTime: '',
    link: origin,
    severity: 3,
  };
}

function recoveredEvent(origin) {
  return {
    type: 'recovered',
    title: 'Status page reachable again',
    impact: '',
    status: '',
    components: [],
    update: 'The status page returned valid incident data again.',
    startTime: '',
    updateTime: '',
    link: origin,
    severity: 0,
  };
}

function renderText(label, origin, shown, hiddenCount, nowStr) {
  const lines = [];
  lines.push('Status page: ' + label + ' (' + origin + ')');
  lines.push('Checked at ' + nowStr);
  lines.push('');
  let n = 1;
  for (const e of shown) {
    lines.push(n + '. ' + e.type.toUpperCase() + ' - ' + e.title);
    const meta = [];
    if (e.impact) meta.push('Impact: ' + e.impact);
    if (e.status) meta.push('Status: ' + e.status);
    if (meta.length) lines.push('   ' + meta.join(' | '));
    if (e.components.length) lines.push('   Components: ' + e.components.join(', '));
    if (e.update) lines.push('   Update: ' + e.update);
    const times = [];
    if (e.startTime) times.push('Started: ' + e.startTime);
    if (e.updateTime) times.push('Updated: ' + e.updateTime);
    if (times.length) lines.push('   ' + times.join(' | '));
    if (e.link) lines.push('   Link: ' + e.link);
    lines.push('');
    n++;
  }
  if (hiddenCount > 0) lines.push('+' + hiddenCount + ' more events not shown');
  return lines.join('\n').trim();
}

function renderHtml(label, origin, shown, hiddenCount, nowStr) {
  const parts = [];
  parts.push('<p>Status page: <strong>' + escapeHtml(label) + '</strong> (' + escapeHtml(origin) + ')<br/>Checked at ' + escapeHtml(nowStr) + '</p>');
  parts.push('<ol>');
  for (const e of shown) {
    const bits = [];
    bits.push('<strong>' + escapeHtml(e.type.toUpperCase()) + '</strong> - ' + escapeHtml(e.title));
    const meta = [];
    if (e.impact) meta.push('Impact: ' + escapeHtml(e.impact));
    if (e.status) meta.push('Status: ' + escapeHtml(e.status));
    if (meta.length) bits.push('<br/>' + meta.join(' | '));
    if (e.components.length) bits.push('<br/>Components: ' + escapeHtml(e.components.join(', ')));
    if (e.update) bits.push('<br/>Update: ' + escapeHtml(e.update));
    const times = [];
    if (e.startTime) times.push('Started: ' + escapeHtml(e.startTime));
    if (e.updateTime) times.push('Updated: ' + escapeHtml(e.updateTime));
    if (times.length) bits.push('<br/>' + times.join(' | '));
    if (e.link) bits.push('<br/><a href="' + escapeHtml(e.link) + '">' + escapeHtml(e.link) + '</a>');
    parts.push('<li>' + bits.join('') + '</li>');
  }
  parts.push('</ol>');
  if (hiddenCount > 0) parts.push('<p>+' + escapeHtml(hiddenCount) + ' more events not shown</p>');
  return parts.join('\n');
}

// Cut text to at most "max" characters without splitting a surrogate pair.
// Only used as the last-resort hard cut below, when a single event is itself
// too large to fit (AC10/AC17, review F1).
function hardCutText(text) {
  return text.length > MAX_BODY_CHARS ? trimLoneSurrogate(text.slice(0, MAX_BODY_CHARS)) : text;
}

function hardCutHtml(html) {
  return html.length > MAX_BODY_CHARS ? truncateHtml(html, MAX_BODY_CHARS) : html;
}

// Render both bodies, dropping events from the end of the (severity-sorted)
// list and recomputing the "+N more" count until both fit under the cap. This
// keeps the footer that discloses the cap instead of silently losing it to a
// blind cut partway through the list (review F1). Only if a single remaining
// event is still too large on its own do we fall back to a hard cut of that
// one event's rendered text.
function renderBodies(label, origin, sorted, cap, nowStr) {
  const maxShown = Math.min(cap, sorted.length);
  let text = '';
  let html = '';
  for (let shownCount = maxShown; shownCount >= 1; shownCount--) {
    const shown = sorted.slice(0, shownCount);
    const hiddenCount = sorted.length - shownCount;
    text = renderText(label, origin, shown, hiddenCount, nowStr);
    html = renderHtml(label, origin, shown, hiddenCount, nowStr);
    if (text.length <= MAX_BODY_CHARS && html.length <= MAX_BODY_CHARS) {
      return { text: text, html: html };
    }
  }
  return { text: hardCutText(text), html: hardCutHtml(html) };
}

const out = [];

for (let i = 0; i < pageItems.length; i++) {
  const meta = pageItems[i].json;
  const pageKey = meta.pageKey;
  const origin = pageKey;
  const label = meta.label;
  const settings = meta.settings;

  let ps = Object.hasOwn(staticData.pages, pageKey) ? staticData.pages[pageKey] : undefined;
  if (!ps || typeof ps !== 'object') {
    ps = { incidents: emptyMap(), failures: 0, failureAlerted: false, initialised: false };
    staticData.pages[pageKey] = ps;
  }
  if (!ps.incidents || typeof ps.incidents !== 'object') ps.incidents = emptyMap();

  const resp = responses[i] ? responses[i].json : undefined;

  // Decide whether this response is usable.
  let failure = false;
  let body;
  if (resp === undefined || resp === null) {
    failure = true;
  } else if (resp.error !== undefined && resp.error !== null) {
    failure = true; // error item from the HTTP node
  } else {
    const statusCode = resp.statusCode;
    body = Object.hasOwn(resp, 'body') ? resp.body : resp;
    if (typeof statusCode === 'number' && statusCode !== 200) {
      failure = true; // e.g. 404 with an HTML body
    } else if (!body || typeof body !== 'object' || !Array.isArray(body.incidents)) {
      failure = true; // non-JSON, or JSON without an incidents array
    }
  }

  const events = [];

  if (failure) {
    ps.failures = (ps.failures || 0) + 1;
    if (ps.failures >= settings.failuresBeforeAlert && !ps.failureAlerted) {
      ps.failureAlerted = true;
      events.push(unreachableEvent(ps.failures, origin));
    }
    // Incident state is kept through failures; nothing is pruned.
  } else {
    if (ps.failureAlerted) {
      events.push(recoveredEvent(origin));
      ps.failureAlerted = false;
    }
    ps.failures = 0;

    const incidents = body.incidents;
    const nextIncidents = emptyMap();

    for (const incident of incidents) {
      if (!incident || typeof incident !== 'object' || incident.id === undefined || incident.id === null) continue;
      const id = String(incident.id);
      const status = String(incident.status || '');
      const impact = typeof incident.impact === 'string' ? incident.impact : 'none';
      const updatedAt = String(incident.updated_at || '');
      const resolved = isResolved(status);
      const passes = impactRank(impact) >= impactRank(settings.minimumImpact) && componentMatch(incident, settings.componentKeywords);

      const prev = Object.hasOwn(ps.incidents, id) ? ps.incidents[id] : undefined;

      if (prev === undefined) {
        // First time we have seen this incident id.
        if (resolved) {
          // Already-resolved incidents are history: store them, never alert.
          // ignoreIncidentsOlderThanHours bounds how much history is stored.
          const when = new Date(incident.resolved_at || incident.updated_at || incident.created_at).getTime();
          const keep = isNaN(when) || (Date.now() - when) <= settings.ignoreIncidentsOlderThanHours * 3600 * 1000;
          if (keep) {
            nextIncidents[id] = { status: status, updatedAt: updatedAt, impact: impact, notified: false };
          }
        } else {
          nextIncidents[id] = { status: status, updatedAt: updatedAt, impact: impact, notified: passes };
          if (passes) events.push(incidentEvent('new', incident, origin));
        }
      } else {
        const prevTime = Date.parse(prev.updatedAt);
        const nextTime = Date.parse(updatedAt);
        const prevValid = !isNaN(prevTime);
        const nextValid = !isNaN(nextTime);
        // A strictly later timestamp counts as a change. An older one (a stale
        // cache or a load balancer serving an old copy), or a missing/unparsable
        // one while we still hold a good one, does not, and never moves state back.
        let timeChanged;
        let keepStored;
        if (prevValid && nextValid) {
          timeChanged = nextTime > prevTime;
          keepStored = nextTime < prevTime;
        } else if (prevValid && !nextValid) {
          timeChanged = false;
          keepStored = true;
        } else {
          timeChanged = prev.updatedAt !== updatedAt; // neither parses: compare as text
          keepStored = false;
        }
        const changed = prev.status !== status || prev.impact !== impact || timeChanged;
        let notified = prev.notified === true;
        if (changed) {
          if (resolved) {
            // Only alert a resolution for something we told the user about,
            // and only once: a stored status that was already resolved
            // (resolved/postmortem/completed) must not re-alert (AC15).
            if (settings.alertOnResolved && prev.notified === true && !isResolved(prev.status)) {
              events.push(incidentEvent('resolved', incident, origin));
            }
          } else if (passes) {
            events.push(incidentEvent('update', incident, origin));
            notified = true;
          }
        }
        nextIncidents[id] = { status: status, updatedAt: keepStored ? prev.updatedAt : updatedAt, impact: impact, notified: notified };
      }
    }

    // Prune state to the incident ids present in this response.
    ps.incidents = nextIncidents;
    ps.initialised = true;
  }

  if (events.length > 0) {
    const sorted = events.slice().sort(function (a, b) { return b.severity - a.severity; });
    const cap = settings.maxIncidentsPerPage;
    const mostSevere = sorted[0];
    const n = events.length;

    const phrases = { new: 'new incident', update: 'update', resolved: 'resolved', unreachable: 'page unreachable', recovered: 'page recovered' };
    const summary = n === 1 ? (phrases[mostSevere.type] || 'event') : n + ' events';
    let subject = '[Status] ' + label + ': ' + summary + ' - ' + mostSevere.title;
    subject = subject.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (subject.length > 149) subject = trimLoneSurrogate(subject.slice(0, 149));

    const nowStr = fmtTime(new Date().toISOString());
    const bodies = renderBodies(label, origin, sorted, cap, nowStr);

    out.push({
      json: {
        hasEvents: true,
        pageKey: pageKey,
        label: label,
        eventCount: n,
        subject: subject,
        text: bodies.text,
        html: bodies.html,
        fromEmail: settings.fromEmail,
        toEmail: settings.toEmail,
      },
    });
  }
}

return out;

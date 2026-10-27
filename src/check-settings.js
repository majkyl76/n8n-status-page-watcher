// Check settings and list status pages
// Reads the single configuration item from the settings node, validates it and
// emits one item per status page with a normalised origin and API URL. This runs
// before any HTTP request, so a bad configuration fails fast with a clear message.

const config = $input.first().json;

const ALLOWED_IMPACTS = ['none', 'minor', 'major', 'critical'];

function asText(value) {
  return value === undefined || value === null ? '' : String(value);
}

function requirePositive(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('Setting "' + name + '" must be a positive number. Got: ' + asText(value));
  }
  return n;
}

function checkEmail(value, name, placeholder) {
  const email = asText(value).trim();
  if (email === '' || email === placeholder) {
    throw new Error('Set "' + name + '" to a real address (it still reads "' + (placeholder || 'empty') + '").');
  }
  if (!email.includes('@')) {
    throw new Error('Setting "' + name + '" is not an email address: ' + email);
  }
  return email;
}

const fromEmail = checkEmail(config.fromEmail, 'fromEmail', 'YOUR_SENDER_ADDRESS');
const toEmail = checkEmail(config.toEmail, 'toEmail', 'YOUR_RECIPIENT_ADDRESS');

const minimumImpact = (asText(config.minimumImpact).trim().toLowerCase()) || 'minor';
if (!ALLOWED_IMPACTS.includes(minimumImpact)) {
  throw new Error('Setting "minimumImpact" must be one of ' + ALLOWED_IMPACTS.join(', ') + '. Got: ' + asText(config.minimumImpact));
}

const failuresBeforeAlert = requirePositive(config.failuresBeforeAlert === undefined ? 3 : config.failuresBeforeAlert, 'failuresBeforeAlert');
const ignoreIncidentsOlderThanHours = requirePositive(config.ignoreIncidentsOlderThanHours === undefined ? 48 : config.ignoreIncidentsOlderThanHours, 'ignoreIncidentsOlderThanHours');
const maxIncidentsPerPage = requirePositive(config.maxIncidentsPerPage === undefined ? 10 : config.maxIncidentsPerPage, 'maxIncidentsPerPage');

const alertOnResolved = config.alertOnResolved === undefined ? true : Boolean(config.alertOnResolved);

// Component keywords: one per line, case-insensitive, blank lines dropped.
const componentKeywords = asText(config.componentKeywords)
  .split('\n')
  .map(function (line) { return line.trim(); })
  .filter(function (line) { return line !== ''; })
  .map(function (line) { return line.toLowerCase(); });

// Parse the pages box. One page per line: "Label | https://host" or just the URL.
// Blank lines and lines starting with # are ignored. De-duplicated by origin.
const rawLines = asText(config.pages).split('\n');
const seen = Object.create(null);
const pages = [];

for (const raw of rawLines) {
  const line = raw.trim();
  if (line === '' || line.startsWith('#')) continue;

  let label = '';
  let urlText = line;
  const bar = line.indexOf('|');
  if (bar !== -1) {
    label = line.slice(0, bar).trim();
    urlText = line.slice(bar + 1).trim();
  }
  if (urlText === '') {
    throw new Error('Cannot read a status page URL from this line: ' + raw);
  }
  // Add a scheme if the user left it off (a bare host like githubstatus.com).
  // /^https?:\/\//i matches an http or https prefix, ignoring case.
  if (!/^https?:\/\//i.test(urlText)) {
    urlText = 'https://' + urlText;
  }

  // The URL class is not available in the n8n Code node sandbox, so read the origin
  // with a pattern: scheme, then everything up to the first slash, ? or #.
  const match = /^(https?):\/\/([A-Za-z0-9.:\[\]-]+)(?:[/?#]|$)/i.exec(urlText);
  if (!match || match[2].startsWith(':')) {
    throw new Error('Cannot read a status page URL from this line: ' + raw);
  }
  const origin = match[1].toLowerCase() + '://' + match[2].toLowerCase();
  const host = match[2].toLowerCase();

  const pageKey = origin.toLowerCase();
  if (Object.hasOwn(seen, pageKey)) continue; // de-duplicate by origin
  seen[pageKey] = true;

  pages.push({
    pageKey: pageKey,
    label: label || host,
    apiUrl: origin + '/api/v2/incidents.json',
  });
}

if (pages.length === 0) {
  throw new Error('No status pages configured. Add at least one line like "GitHub | https://www.githubstatus.com".');
}

const settings = {
  minimumImpact: minimumImpact,
  componentKeywords: componentKeywords,
  alertOnResolved: alertOnResolved,
  failuresBeforeAlert: failuresBeforeAlert,
  ignoreIncidentsOlderThanHours: ignoreIncidentsOlderThanHours,
  maxIncidentsPerPage: maxIncidentsPerPage,
  fromEmail: fromEmail,
  toEmail: toEmail,
};

return pages.map(function (page) {
  return { json: { pageKey: page.pageKey, label: page.label, apiUrl: page.apiUrl, settings: settings } };
});

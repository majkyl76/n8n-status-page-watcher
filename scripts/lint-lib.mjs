// Shared copy checks for README.md, LISTING.md and the sticky note text.
// Enforces the CLAUDE.md writing rules: no em dashes, no banned words, British
// spelling. Used by both `npm run lint:copy` and the copy test.

export const BANNED_WORDS = [
  'excited', 'leverage', 'seamless', 'robust', 'cutting-edge', 'streamline',
  'tailored', 'ensure', 'delve', 'passionate', 'game-changer', 'powerful',
  'effortless', 'supercharge', 'unlock',
];

// American spellings whose British form is required (AC12). Each maps to its fix.
export const AMERICAN_SPELLINGS = {
  organize: 'organise', organized: 'organised', organizing: 'organising', organization: 'organisation',
  color: 'colour', colored: 'coloured', colors: 'colours',
  behavior: 'behaviour',
  summarize: 'summarise', summarized: 'summarised', summarizing: 'summarising',
  analyze: 'analyse', analyzed: 'analysed', analyzing: 'analysing',
  center: 'centre', centered: 'centred',
  favor: 'favour', favorite: 'favourite',
};

// "licence" (noun) vs "license" (verb) is a British/American split unlike the
// pairs above: in British English the verb keeps the "s" spelling too, so a
// plain word match would wrongly flag "to license". Flag "license" only when
// it is preceded by a determiner, "MIT", a possessive, or (allowing one
// adjective in between) by one of those - a conservative marker of noun use
// (review F3) that leaves "to license"/"we license" alone.
const LICENSE_NOUN_RE = /\b(a|an|the|mit|its|our|their|my|your|his|her|[a-z]+'s)\s+(?:[a-z-]+\s+)?licenses?\b/i;

// Returns an array of issue strings for one block of text. Empty means clean.
export function lintText(label, text) {
  const issues = [];
  const lower = text.toLowerCase();

  if (text.includes('—')) {
    issues.push(label + ': contains an em dash (—); use full stops, commas, colons or brackets');
  }

  for (const word of BANNED_WORDS) {
    // Word-boundary match so e.g. "powerful" is caught but partial hits are not.
    const re = new RegExp('(^|[^a-z])' + word.replace(/[-]/g, '\\-') + '([^a-z]|$)', 'i');
    if (re.test(lower)) {
      issues.push(label + ': banned word "' + word + '"');
    }
  }

  for (const [bad, good] of Object.entries(AMERICAN_SPELLINGS)) {
    const re = new RegExp('(^|[^a-z])' + bad + '([^a-z]|$)', 'i');
    if (re.test(lower)) {
      issues.push(label + ': American spelling "' + bad + '" (use "' + good + '")');
    }
  }

  if (LICENSE_NOUN_RE.test(text)) {
    issues.push(label + ': American spelling "license" (use "licence")');
  }

  return issues;
}

// Pull every sticky note's content out of a workflow object.
export function stickyTexts(workflow) {
  return workflow.nodes
    .filter((n) => n.type === 'n8n-nodes-base.stickyNote')
    .map((n) => (n.parameters && n.parameters.content) || '');
}

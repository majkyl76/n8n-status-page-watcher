// Shared copy checks for README.md and the sticky note text: no em dashes, no
// banned words, British spelling. Used by both `npm run lint:copy` and the copy test.

export const BANNED_WORDS = [
  'excited', 'leverage', 'seamless', 'robust', 'cutting-edge', 'streamline',
  'tailored', 'ensure', 'delve', 'passionate', 'game-changer', 'powerful',
  'effortless', 'supercharge', 'unlock',
];

// American spellings whose British form is required. Each maps to its fix.
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
// plain word match would wrongly flag "to license". The determiner-led check
// this replaced missed multi-adjective and sentence-initial noun use, so flag "license"/"licenses" as the noun by default, and only exempt
// it when either the preceding word marks verb use (a modal/auxiliary, "to",
// or a subject pronoun) or the following word is a determiner/pronoun
// introducing a direct object ("license their data", "license this
// software"). The preceding-word check alone misses a plain noun subject
// like "Vendors license their data...".
const LICENSE_VERB_PRECEDERS = new Set(['to', 'will', 'may', 'can', 'must', 'shall', 'would', 'should', 'we', 'you', 'they', 'i']);
const LICENSE_VERB_FOLLOWERS = new Set(['this', 'that', 'these', 'those', 'their', 'our', 'your', 'his', 'her', 'its', 'my', 'a', 'an', 'the', 'it', 'them', 'all']);

function hasLicenseNounUse(text) {
  const re = /\blicenses?\b/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    const beforeWord = ((before.match(/([a-z']+)\s*$/i) || [, ''])[1] || '').replace(/'/g, '').toLowerCase();
    const afterWord = ((after.match(/^\s*([a-z']+)/i) || [, ''])[1] || '').replace(/'/g, '').toLowerCase();
    const isVerbUse = LICENSE_VERB_PRECEDERS.has(beforeWord) || LICENSE_VERB_FOLLOWERS.has(afterWord);
    if (!isVerbUse) return true;
  }
  return false;
}

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

  if (hasLicenseNounUse(text)) {
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

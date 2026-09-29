// Basic profanity filtering for the MVP. This is a first line of defence, not
// a complete solution: reports + blocks + rate limits carry the rest. The word
// list is intentionally conservative (common English profanities/slurs are
// masked; everything else passes through).

const WORDS = [
  // Common profanities
  'fuck', 'fucking', 'fucker', 'shit', 'shitty', 'bitch', 'bitches', 'bastard',
  'asshole', 'dick', 'dickhead', 'pussy', 'cunt', 'whore', 'slut', 'cock',
  'motherfucker', 'bullshit', 'crap', 'damn',
  // Slurs (masked, never repeated back in UI copy)
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'chink', 'spic', 'kike',
  'tranny',
];

const PATTERN = new RegExp(`\\b(${WORDS.join('|')})\\b`, 'gi');

export interface FilterResult {
  text: string;
  /** True if at least one word was masked. */
  flagged: boolean;
  hits: number;
}

/** Mask profane words with asterisks, preserving word length. */
export function filterProfanity(input: string): FilterResult {
  let hits = 0;
  const text = input.replace(PATTERN, (m) => {
    hits += 1;
    return '*'.repeat(m.length);
  });
  return { text, flagged: hits > 0, hits };
}

const URL_RE = /https?:\/\/[^\s)]+/gi;

/** Count links in a message (used for link-spam suspicion scoring). */
export function countUrls(input: string): number {
  const m = input.match(URL_RE);
  return m ? m.length : 0;
}

/** True when the message is mostly SHOUTING (flood/shout detection). */
export function isShouting(input: string): boolean {
  const letters = input.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 10) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.8;
}

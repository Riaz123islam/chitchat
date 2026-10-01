import { randomUUID } from 'node:crypto';

// Temporary anonymous identities. Internal database ids are never exposed to
// clients; these random session ids + generated usernames are all anyone sees.

const ADJECTIVES = [
  'Curious', 'Quiet', 'Blue', 'Cosmic', 'Gentle', 'Misty', 'Brave', 'Calm',
  'Dizzy', 'Eager', 'Fuzzy', 'Golden', 'Happy', 'Icy', 'Jolly', 'Kind',
  'Lucky', 'Mellow', 'Nimble', 'Odd', 'Peppy', 'Quirky', 'Rusty', 'Sunny',
  'Tiny', 'Velvet', 'Witty', 'Amber', 'Bold', 'Clever', 'Dreamy', 'Electric',
];

const ANIMALS = [
  'Fox', 'Wolf', 'Tiger', 'Cat', 'Bear', 'Owl', 'Panda', 'Raven',
  'Dolphin', 'Falcon', 'Gecko', 'Heron', 'Ibis', 'Jaguar', 'Koala', 'Lynx',
  'Moose', 'Newt', 'Otter', 'Puma', 'Quail', 'Robin', 'Seal', 'Turtle',
  'Urchin', 'Viper', 'Whale', 'Yak', 'Zebra', 'Hawk', 'Mole', 'Wren',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Opaque random id for a session. Never a database primary key. */
export function generateSessionId(): string {
  return randomUUID();
}

/** Friendly anonymous username, e.g. CuriousFox42. */
export function generateUsername(): string {
  const num = 10 + Math.floor(Math.random() * 90); // 10..99
  return `${pick(ADJECTIVES)}${pick(ANIMALS)}${num}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

export function isValidRoomId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

// ── User-chosen nicknames ────────────────────────────────────────────────

const NICKNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,18}[\p{L}\p{N}]$/u;
const RESERVED = new Set([
  'admin', 'administrator', 'system', 'moderator', 'mod',
  'chitchat', 'support', 'anonymous', 'stranger',
]);

/**
 * Validate a user-requested nickname. Returns the cleaned nickname, or null
 * when it is missing/invalid. Callers fall back to generateUsername().
 * Profanity itself is checked by the caller via filterProfanity to avoid a
 * circular import.
 */
export function sanitizeNickname(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 2 || cleaned.length > 20) return null;
  if (!NICKNAME_RE.test(cleaned)) return null;
  if (RESERVED.has(cleaned.toLowerCase())) return null;
  return cleaned;
}

/**
 * Validate a client-supplied guest id (persistent id from the browser's
 * cache). Returns the cleaned id, or null when it isn't a plausible token —
 * callers fall back to minting one server-side.
 */
export function sanitizeGuestId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim();
  if (v.length < 8 || v.length > 64) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(v)) return null;
  return v;
}

import { describe, expect, it } from 'vitest';
import { generateSessionId, generateUsername, isValidRoomId, isValidSessionId } from '../src/identity.js';

describe('identity', () => {
  it('generates valid uuid session ids', () => {
    const id = generateSessionId();
    expect(isValidSessionId(id)).toBe(true);
    expect(isValidSessionId('not-a-uuid')).toBe(false);
    expect(isValidSessionId(123)).toBe(false);
    expect(isValidSessionId(undefined)).toBe(false);
  });

  it('generates usernames like CuriousFox42', () => {
    for (let i = 0; i < 200; i++) {
      const u = generateUsername();
      expect(u).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{2}$/);
    }
  });

  it('generates unique usernames in bulk', () => {
    const names = new Set<string>();
    for (let i = 0; i < 1000; i++) names.add(generateUsername());
    // 32 adjectives * 32 animals * 90 numbers = 92k combos; collisions ~impossible
    expect(names.size).toBeGreaterThan(990);
  });

  it('validates room ids', () => {
    expect(isValidRoomId(generateSessionId())).toBe(true);
    expect(isValidRoomId('room:123')).toBe(false);
  });
});

describe('sanitizeNickname', () => {
  it('accepts clean nicknames', async () => {
    const { sanitizeNickname } = await import('../src/identity.js');
    expect(sanitizeNickname('Riaz')).toBe('Riaz');
    expect(sanitizeNickname('  night owl  ')).toBe('night owl');
    expect(sanitizeNickname('user_123-x.y')).toBe('user_123-x.y');
  });

  it('rejects bad nicknames', async () => {
    const { sanitizeNickname } = await import('../src/identity.js');
    expect(sanitizeNickname('')).toBeNull();
    expect(sanitizeNickname('a')).toBeNull();
    expect(sanitizeNickname('x'.repeat(21))).toBeNull();
    expect(sanitizeNickname('admin')).toBeNull();
    expect(sanitizeNickname('System')).toBeNull();
    expect(sanitizeNickname('<script>')).toBeNull();
    expect(sanitizeNickname('no@email')).toBeNull();
    expect(sanitizeNickname(123)).toBeNull();
    expect(sanitizeNickname(undefined)).toBeNull();
  });
});

describe('createSession nickname', () => {
  it('uses a valid requested nickname and dedupes collisions', async () => {
    const { Matchmaker } = await import('../src/matchmaker.js');
    const m = new Matchmaker();
    const a = m.createSession('sock-a', 'Riaz');
    expect(a?.username).toBe('Riaz');
    const b = m.createSession('sock-b', 'Riaz');
    expect(b?.username).not.toBe('Riaz');
    expect(b?.username).toMatch(/^Riaz\d+$/);
    const c = m.createSession('sock-c', 'admin');
    expect(c?.username).not.toBe('admin');
  });
});

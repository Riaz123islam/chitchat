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

import { describe, expect, it } from 'vitest';
import { KeyedRateLimiter, countWithin, pruneOlderThan } from '../src/ratelimit.js';

describe('KeyedRateLimiter', () => {
  it('allows bursts up to capacity then blocks', () => {
    const rl = new KeyedRateLimiter(3, 1); // 1 token/sec; frozen clock => no refill
    const t = 1_000_000;
    expect(rl.consume('a', 1, t)).toBe(true);
    expect(rl.consume('a', 1, t)).toBe(true);
    expect(rl.consume('a', 1, t)).toBe(true);
    expect(rl.consume('a', 1, t)).toBe(false);
  });

  it('tracks keys independently', () => {
    const rl = new KeyedRateLimiter(1, 1);
    const t = 1_000_000;
    expect(rl.consume('a', 1, t)).toBe(true);
    expect(rl.consume('b', 1, t)).toBe(true);
    expect(rl.consume('a', 1, t)).toBe(false);
  });

  it('refills over time', () => {
    const rl = new KeyedRateLimiter(2, 1); // 1 token/sec
    expect(rl.consume('a', 1, 0)).toBe(true);
    expect(rl.consume('a', 1, 0)).toBe(true);
    expect(rl.consume('a', 1, 0)).toBe(false);
    expect(rl.consume('a', 1, 2000)).toBe(true); // 2s later: refilled
  });

  it('resets a key', () => {
    const rl = new KeyedRateLimiter(1, 1);
    const t = 1_000_000;
    expect(rl.consume('a', 1, t)).toBe(true);
    expect(rl.consume('a', 1, t)).toBe(false);
    rl.reset('a');
    expect(rl.consume('a', 1, t)).toBe(true);
  });
});

describe('sliding window helpers', () => {
  it('counts within a window', () => {
    expect(countWithin([100, 200, 900, 950], 100, 1000)).toBe(2);
    expect(countWithin([], 100, 1000)).toBe(0);
  });

  it('prunes old timestamps', () => {
    expect(pruneOlderThan([100, 200, 900, 950], 100, 1000)).toEqual([900, 950]);
  });
});

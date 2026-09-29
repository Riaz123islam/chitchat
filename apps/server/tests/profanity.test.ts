import { describe, expect, it } from 'vitest';
import { countUrls, filterProfanity, isShouting } from '../src/profanity.js';

describe('profanity filter', () => {
  it('leaves clean text untouched', () => {
    const r = filterProfanity('Hello there, how are you today?');
    expect(r.text).toBe('Hello there, how are you today?');
    expect(r.flagged).toBe(false);
  });

  it('masks profane words with asterisks', () => {
    const r = filterProfanity('you are a shit person');
    expect(r.text).toBe('you are a **** person');
    expect(r.flagged).toBe(true);
    expect(r.hits).toBe(1);
  });

  it('is case-insensitive and respects word boundaries', () => {
    const r = filterProfanity('SHITake mushrooms, Scunthorpe is a town');
    // "SHITake" and "Scunthorpe" must NOT be masked (word boundaries)
    expect(r.text).toBe('SHITake mushrooms, Scunthorpe is a town');
    expect(r.flagged).toBe(false);
  });

  it('masks multiple hits', () => {
    const r = filterProfanity('fuck this shit');
    expect(r.text).toBe('**** this ****');
    expect(r.hits).toBe(2);
  });
});

describe('spam signals', () => {
  it('counts urls', () => {
    expect(countUrls('no links here')).toBe(0);
    expect(countUrls('see https://a.com and http://b.org/x')).toBe(2);
  });

  it('detects shouting', () => {
    expect(isShouting('HELLO THIS IS VERY LOUD INDEED')).toBe(true);
    expect(isShouting('Hello there, normal sentence.')).toBe(false);
    expect(isShouting('OK')).toBe(false); // too short
  });
});

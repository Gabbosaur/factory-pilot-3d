import { describe, expect, it } from 'vitest';
import { overLimit } from '@/server/guard';

const req = (ip: string) => new Request('http://x/api/ask', { headers: { 'x-forwarded-for': ip } });

describe('rate limit guard', () => {
  it('allows 20 requests per minute per IP, then limits until the window slides', () => {
    const t = 1_000_000;
    for (let i = 0; i < 20; i++) expect(overLimit(req('1.1.1.1'), t + i)).toBe(false);
    expect(overLimit(req('1.1.1.1'), t + 100)).toBe(true);
    expect(overLimit(req('2.2.2.2'), t + 100)).toBe(false); // other visitors are unaffected
    expect(overLimit(req('1.1.1.1'), t + 61_000)).toBe(false);
  });
});

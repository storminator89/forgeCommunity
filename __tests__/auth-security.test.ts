import {
  isSameOriginRequest,
  getClientAddress,
} from '@/lib/server/auth-security';
import {
  consumeRateLimit,
  resetRateLimitStore,
} from '@/lib/server/rate-limit';

describe('authentication security helpers', () => {
  beforeEach(() => {
    resetRateLimitStore();
    process.env.NEXTAUTH_URL = 'https://community.example.test';
    delete process.env.TRUST_PROXY;
  });

  it('rejects cross site fetch metadata even when Origin is absent', () => {
    const request = new Request('https://community.example.test/api/register', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
    });

    expect(isSameOriginRequest(request)).toBe(false);
  });

  it('accepts a same origin browser request and rejects a different origin', () => {
    const sameOrigin = new Request('https://community.example.test/api/register', {
      method: 'POST',
      headers: { origin: 'https://community.example.test' },
    });
    const crossOrigin = new Request('https://community.example.test/api/register', {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
    });

    expect(isSameOriginRequest(sameOrigin)).toBe(true);
    expect(isSameOriginRequest(crossOrigin)).toBe(false);
  });

  it('fails closed to one address bucket unless a proxy is explicitly trusted', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.4' });
    expect(getClientAddress(headers)).toBe('unknown');

    process.env.TRUST_PROXY = 'true';
    expect(getClientAddress(headers)).toBe('203.0.113.4');
  });

  it('enforces a fixed window and reports a retry period', () => {
    const options = { limit: 2, windowMs: 60_000 };

    expect(consumeRateLimit('test', options, 1_000).allowed).toBe(true);
    expect(consumeRateLimit('test', options, 1_001).allowed).toBe(true);
    const blocked = consumeRateLimit('test', options, 1_002);

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBe(60);
    expect(consumeRateLimit('test', options, 61_001).allowed).toBe(true);
  });
});
